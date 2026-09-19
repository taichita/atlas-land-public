import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
test("local HTTP service persists drafts, streams media ranges and isolates previews", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-http-")),
    cwd = path.join(dir, "project"),
    data = path.join(dir, "data");
  await fs.mkdir(cwd);
  await fs.mkdir(data);
  await fs.writeFile(path.join(cwd, "note.md"), "# 初稿\n");
  const localFile = path.join(dir, "local-note.md");
  await fs.writeFile(localFile, "# ローカル\n");
  await fs.writeFile(path.join(cwd, "test.mp4"), Buffer.alloc(1024 * 1024, 7));
  await fs.writeFile(path.join(cwd, "page.html"), "<h1>Preview</h1>");
  await fs.writeFile(
    path.join(data, "workspace.json"),
    JSON.stringify({
      tasks: [
        {
          id: "http-test",
          title: "Fixture",
          cwd,
          state: "idle",
          files: [],
          events: [],
          edits: [],
        },
      ],
      links: [],
      tabs: [],
    }),
  );
  const child = spawn(process.execPath, ["server/main.mjs"], {
    cwd: process.cwd(),
    windowsHide: true,
    env: { ...process.env, AI_WORKSPACE_DATA: data, AI_WORKSPACE_CODEX: process.execPath, LOCALAPPDATA: dir, CODEX_HOME: path.join(dir,'codex'), GPT_ATLAS_DESKTOP_SYNC: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (b) => (errors += b.toString()));
  const ready = await new Promise((resolve, reject) => {
    const timer=setTimeout(()=>{child.kill();reject(new Error('Fixture server startup timed out: '+errors));},10000);
    const failed=e=>{clearTimeout(timer);reject(e);};
    const exited=code=>failed(new Error('Fixture server exited '+code+': '+errors));
    createInterface({ input: child.stdout }).once("line", line=>{
      clearTimeout(timer);child.off('exit',exited);
      try{resolve(JSON.parse(line));}catch(e){child.kill();reject(e);}
    });
    child.once("error", failed);child.once('exit',exited);
  });
  const url = new URL(ready.url),
    headers = {
      "x-workspace-token": url.hash.slice(1),
      "Content-Type": "application/json",
    };
  async function api(p, b) {
    return fetch(url.origin + "/api" + p, {
      headers,
      method: b === undefined ? "GET" : "POST",
      ...(b === undefined ? {} : { body: JSON.stringify(b) }),
    });
  }
  try {
    const policy=await (await api('/agent-policy')).json();assert(policy.instructions.length>0);
    assert.equal((await api('/agent-policy',{instructions:'短い方針'})).status,200);
    assert.equal((await (await api('/agent-policy')).json()).instructions,'短い方針');
    assert.equal((await api('/agent-policy',{instructions:'x'.repeat(6001)})).status,400);
    await api("/tasks/http-test/settings", { stored: true });
    const events=await(await fetch(url.origin+'/api/events',{headers,signal:AbortSignal.timeout(4000)})).json();
    assert(events.events.some(e=>e.type==='task'&&e.data.id==='http-test'&&e.data.stored===true));
    assert.equal((await fetch(url.origin + "/api/graph")).status, 401);
    assert.equal(
      (
        await fetch(url.origin + "/api/graph", {
          headers: { ...headers, Origin: "https://attacker.example" },
        })
      ).status,
      403,
    );
    assert.equal((await api("/rpc", { method: "command/exec" })).status, 404);
    const f = await (await api("/tasks/http-test/file?path=note.md")).json();
    const local = await (
      await api("/local/file?path=" + encodeURIComponent(localFile))
    ).json();
    assert.equal(local.text, "# ローカル\n");
    const localSaved = await (
      await api("/local/file", {
        ...local,
        text: "# Atlasで編集\n",
      })
    ).json();
    assert.equal(localSaved.changed, true);
    assert.equal(await fs.readFile(localFile, "utf8"), "# Atlasで編集\n");
    const large=path.join(dir,'large.mp4');
    const handle=await fs.open(large,'w');await handle.truncate(300*1024*1024);await handle.close();
    const media=await(await api('/local/open',{path:large})).json();
    assert.equal(media.bytes,300*1024*1024);assert(media.preview);assert.equal(media.text,undefined);
    const tail=await fetch(media.preview,{headers:{Range:'bytes=-1024'}});
    assert.equal(tail.status,206);assert.equal((await tail.arrayBuffer()).byteLength,1024);
    assert.equal((await fetch(media.preview,{method:'HEAD'})).headers.get('content-length'),String(300*1024*1024));
    const htmlOpen=await(await api('/local/open',{path:path.join(cwd,'page.html')})).json();
    assert.match(await(await fetch(htmlOpen.preview)).text(),/Preview/);
    assert.equal((await fetch(htmlOpen.preview.replace('page.html','%2E%2E%2Foutside.txt'))).status,403);
    await api('/local/draft',{...localSaved,dirty:true,text:'保存前の下書き'});
    assert.equal((await(await api('/local/draft?path='+encodeURIComponent(localFile))).json()).text,'保存前の下書き');
    assert.equal((await(await api('/local/draft?path='+encodeURIComponent(localFile.replaceAll('\\','/')))).json()).text,'保存前の下書き');
    assert.equal(await fs.readFile(localFile,'utf8'),'# Atlasで編集\n');
    await api('/local/draft',{path:localFile,clear:true});
    assert.equal(
      (
        await api("/tasks/http-test/draft", {
          ...f,
          text: "# 編集途中\n",
          original: f.text,
        })
      ).status,
      200,
    );
    const drafts = await (await api("/tasks/http-test/drafts")).json();
    assert.equal(drafts.drafts[0].text, "# 編集途中\n");
    assert.equal(
      await fs.readFile(path.join(cwd, "note.md"), "utf8"),
      "# 初稿\n",
    );
    assert.equal(
      (await api("/tasks/http-test/draft", { ...f, path: "../outside.txt" }))
        .status,
      403,
    );
    const p = await (
      await api("/tasks/http-test/preview", { path: "test.mp4" })
    ).json();
    const range = await fetch(p.url, { headers: { Range: "bytes=100-199" } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    assert.equal(range.headers.get("content-range"), "bytes 100-199/1048576");
    const html = await (
      await api("/tasks/http-test/preview", { path: "page.html" })
    ).json();
    const doc = await fetch(html.url);
    assert.match(
      doc.headers.get("content-security-policy"),
      /sandbox allow-scripts/,
    );
    assert(
      !doc.headers.get("content-security-policy").includes("allow-same-origin"),
    );
    await api("/tasks/http-test/draft", { path: "note.md", clear: true });
    assert.equal(
      (await (await api("/tasks/http-test/drafts")).json()).drafts.length,
      0,
    );
  } finally {
    await api("/shutdown", {});
    await new Promise((r) => child.once("exit", r));
    await fs.rm(dir, { recursive: true });
  }
});
