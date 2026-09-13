import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import iconv from "iconv-lite";
import { readFile, saveFile, resolveFile } from "../server/files.mjs";
import { StateStore } from "../server/state.mjs";

test("editor preserves CRLF, BOM and Japanese; detects concurrent external changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-files-"));
  try {
    await fs.writeFile(
      path.join(root, "script.csv"),
      Buffer.concat([
        Buffer.from([239, 187, 191]),
        Buffer.from("話者,台詞\r\n霊夢,元の台詞\r\n"),
      ]),
    );
    const file = await readFile(root, "script.csv");
    assert.equal(file.encoding, "utf8");
    assert.equal(file.newline, "CRLF");
    assert.equal(file.bom, "efbbbf");
    const saved = await saveFile(
      root,
      "script.csv",
      { ...file, text: file.text.replace("元の台詞", "編集した台詞") },
      path.join(root, "backups"),
    );
    assert.match(saved.patch, /編集した台詞/);
    assert.equal(
      (await fs.readFile(path.join(root, "script.csv")))
        .subarray(0, 3)
        .toString("hex"),
      "efbbbf",
    );
    await fs.appendFile(path.join(root, "script.csv"), "外部,変更\r\n");
    await assert.rejects(
      saveFile(
        root,
        "script.csv",
        { ...saved, text: "競合" },
        path.join(root, "backups"),
      ),
      (e) => e.status === 409,
    );
    assert.match(
      await fs.readFile(path.join(root, "script.csv"), "utf8"),
      /外部,変更/,
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test("Shift-JIS remains Shift-JIS and unrepresentable characters cannot silently corrupt a file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-encoding-"));
  try {
    await fs.writeFile(
      path.join(root, "ymm.csv"),
      iconv.encode("霊夢,こんにちは\r\n", "shift_jis"),
    );
    await assert.rejects(readFile(root, "ymm.csv"), /Shift-JIS/);
    const f = await readFile(root, "ymm.csv", "shift_jis");
    const saved = await saveFile(
      root,
      "ymm.csv",
      { ...f, text: f.text.replace("こんにちは", "こんばんは") },
      path.join(root, "backups"),
    );
    assert.equal(
      iconv.decode(await fs.readFile(path.join(root, "ymm.csv")), "shift_jis"),
      saved.text,
    );
    await assert.rejects(
      saveFile(
        root,
        "ymm.csv",
        { ...saved, text: "霊夢,🌍" },
        path.join(root, "backups"),
      ),
      /保存できない文字/,
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test("file access rejects traversal and links leaving a task folder", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-boundary-"));
  try {
    await fs.mkdir(path.join(root, "task"));
    await fs.writeFile(path.join(root, "outside.txt"), "private");
    await assert.rejects(
      resolveFile(path.join(root, "task"), "../outside.txt"),
      (e) => e.status === 403,
    );
    await fs.symlink(root, path.join(root, "task", "escape"), "junction");
    await assert.rejects(
      resolveFile(path.join(root, "task"), "escape/outside.txt"),
      (e) => e.status === 403,
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test("dependency graph rejects cycles and only completed prerequisites release queued work", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-graph-"));
  const state = new StateStore(root);
  try {
    state.addThread({ id: "a", cwd: root, name: "台本" }, { hasConversation: true });
    state.addThread({ id: "b", cwd: root, name: "動画" }, { hasConversation: true });
    state.addThread({ id: "c", cwd: root, name: "最終確認" }, { hasConversation: true });
    state.addDependency("a", "b");
    state.addDependency("b", "c");
    assert.throws(() => state.addDependency("c", "a"), /循環/);
    assert.equal(state.blockers("b").length, 1);
    state.task("a").state = "failed";
    assert.equal(state.blockers("b").length, 1);
    state.task("a").state = "completed";
    assert.equal(state.blockers("b").length, 0);
    const graph = state.graph();
    assert.equal(graph.nodes.filter((n) => n.kind === "folder").length, 1);
    assert.equal(graph.edges.filter((e) => e.kind === "dependency").length, 2);
    state.flush();
    const restarted = new StateStore(root);
    assert.equal(restarted.data.links.length, 2);
  } finally {
    clearTimeout(state.timer);
    await fs.rm(root, { recursive: true });
  }
});
