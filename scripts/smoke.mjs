import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd(),
  cwd = path.join(root, "playground");
await fs.mkdir(cwd, { recursive: true });
const processHandle = spawn(process.execPath, ["server/main.mjs"], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let errorText = "";
processHandle.stderr.on("data", (b) => (errorText += b.toString()));
const ready = await new Promise((resolve, reject) => {
  createInterface({ input: processHandle.stdout }).once("line", (line) => {
    try {
      resolve(JSON.parse(line));
    } catch (e) {
      reject(e);
    }
  });
  processHandle.once("exit", () =>
    reject(new Error(errorText || "Server exited")),
  );
});
const u = new URL(ready.url),
  origin = u.origin,
  token = u.hash.slice(1),
  headers = { "x-workspace-token": token, "Content-Type": "application/json" };
async function api(p, data) {
  const r = await fetch(origin + "/api" + p, {
    headers,
    method: data === undefined ? "GET" : "POST",
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(p + ": " + result.error);
  return result;
}
try {
  const unauth = await fetch(origin + "/api/bootstrap");
  assert.equal(unauth.status, 401);
  const cross = await fetch(origin + "/api/bootstrap", {
    headers: { ...headers, Origin: "https://evil.example" },
  });
  assert.equal(cross.status, 403);
  await api("/connect", {});
  const initial = await api("/bootstrap");
  assert.equal(initial.account.type, "chatgpt");
  assert(initial.models.some((m) => m.model === "gpt-6-astra"));
  console.log(
    "PASS authentication, origin boundary, subscription account, live model catalog",
  );
  const a = await api("/tasks", {
    title: "動作確認 · 原稿と成果物",
    cwd,
    model: "gpt-6-astra",
    access: "workspace-write",
  });
  const b = await api("/tasks", {
    title: "動作確認 · 後続のレビュー",
    cwd,
    model: "gpt-6-astra",
    access: "read-only",
  });
  await api("/dependencies", {
    from: a.id,
    to: b.id,
    note: "原稿の出力が終わった後にレビューする実動作テスト",
  });
  let seq = (await api("/bootstrap")).sequence;
  await api("/tasks/" + a.id + "/send", {
    text: "これは自作ワークスペースの実接続テストです。作業フォルダに sample-script.csv をUTF-8で作ってください。内容は正確に次の3行です。\n話者,台詞\n霊夢,今日は読書について話します。\n魔理沙,一緒に考えてみよう。\n作成後 workspace_artifact_register でこのファイルを登録し、最後に「原稿ファイルを作成しました」とだけ答えてください。",
    model: "gpt-6-astra",
    effort: "low",
  });
  const queued = await api("/tasks/" + b.id + "/send", {
    text: "作業フォルダの sample-script.csv を読み、2人の話者名を日本語で1行だけ答えてください。ファイルは変更しないでください。",
    model: "gpt-6-astra",
    effort: "low",
  });
  assert.equal(queued.queued, true);
  console.log("PASS real Codex turn start; dependent task queued");
  const deadline = Date.now() + 240000;
  let completions = new Set(),
    requests = [];
  while (Date.now() < deadline && completions.size < 2) {
    const r = await api("/events?after=" + seq);
    seq = r.sequence;
    for (const e of r.events) {
      if (e.type === "requests") requests = e.data;
      if (e.type === "task" && [a.id, b.id].includes(e.data.id)) {
        if (e.data.state === "failed")
          throw new Error(e.data.title + ": " + e.data.error);
        if (e.data.state === "completed") completions.add(e.data.id);
      }
    }
    if (requests.length)
      throw new Error(
        "Test requested human input: " +
          requests.map((r) => r.method).join(","),
      );
    console.log("Awaiting model: " + completions.size + "/2 finished");
  }
  assert.equal(completions.size, 2, "both real turns completed");
  const f = await api("/tasks/" + a.id + "/file?path=sample-script.csv");
  assert.match(f.text, /霊夢/);
  const edited = await api("/tasks/" + a.id + "/file", {
    ...f,
    text: f.text.replace(
      "今日は読書について話します。",
      "今日は、本の感想から考えを広げます。",
    ),
  });
  assert(edited.edit?.id);
  assert.match(
    await fs.readFile(path.join(cwd, "sample-script.csv"), "utf8"),
    /感想/,
  );
  const preview = await api("/tasks/" + a.id + "/preview", {
    path: "sample-script.csv",
  });
  assert.equal((await fetch(preview.url)).status, 200);
  const graph = await api("/graph");
  assert(
    graph.edges.some(
      (e) => e.kind === "dependency" && e.from === a.id && e.to === b.id,
    ),
  );
  assert(
    graph.nodes.some(
      (n) => n.kind === "file" && n.label === "sample-script.csv",
    ),
  );
  const history = await api("/tasks/" + b.id + "/history");
  const messages = history.data
    .flatMap((t) => t.items || [])
    .filter((i) => i.type === "agentMessage");
  assert(messages.some((m) => /霊夢/.test(m.text) && /魔理沙/.test(m.text)));
  console.log(
    "PASS actual file creation, artifact registration, queued execution, history, editing and globe data",
  );
  await fs.writeFile(
    path.join(root, ".test-data", "smoke-result.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        tasks: [a.id, b.id],
        cwd,
        checks: [
          "subscription authentication",
          "API auth and origin checks",
          "Astra real turn",
          "local shell file creation",
          "artifact tool",
          "dependency queue release",
          "history retrieval",
          "file edit + diff",
          "graph data",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await api("/shutdown", {}).catch(() => {});
  setTimeout(() => processHandle.kill(), 3000).unref();
}
