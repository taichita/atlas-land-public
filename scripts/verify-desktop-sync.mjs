import fs from "node:fs";
import path from "node:path";
import { CodexBridge } from "../server/codex.mjs";
import { DesktopBridge } from "../server/desktop.mjs";

const bridge = new CodexBridge(), desktop = new DesktopBridge();
const out = path.resolve(".test-data/desktop-sync-check.json");
let sourceId, contextId;
try {
  await bridge.ready();
  const context = await bridge.call("thread/start", { cwd: process.cwd(), sandbox: "read-only", approvalPolicy: "on-request", deferGoalContinuation: true });
  contextId = context.thread.id;
  await bridge.call("thread/inject_items", { threadId: contextId, items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "GPT Atlasの接続テスト用コンテキストです。" }] }] });
  const source = await bridge.call("thread/start", { cwd: process.cwd(), model: "gpt-5.6-sol", sandbox: "read-only", approvalPolicy: "on-request", deferGoalContinuation: true });
  sourceId = source.thread.id;
  await bridge.call("thread/name/set", { threadId: sourceId, name: "Atlas 同期の動作確認" });
  fs.writeFileSync(out, JSON.stringify({ sourceId, contextId }));
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Seed timed out")), 100000);
    bridge.on("notification", m => { if (m.method === "turn/completed" && m.params.threadId === sourceId) { clearTimeout(timer); resolve(m.params.turn); } });
  });
  await bridge.call("turn/start", { threadId: sourceId, model: "gpt-5.6-sol", effort: "low", input: [{ type: "text", text: "接続テストです。ツールを使わず ATLAS_INIT とだけ返答してください。" }] });
  await done;
  bridge.close();
  console.log("Seed conversation saved; original executor released.");
  const sent = await desktop.call("send_message_to_thread", { threadId: sourceId, hostId: "local", prompt: "同期テストの続きです。前の返答に含まれていた合言葉と ATLAS_SYNC_OK を1行で返してください。ツールは使わないでください。", model: "gpt-5.6-sol", thinking: "low" }, contextId, 45000);
  console.log("Same-thread send:", JSON.stringify(sent));
  let cursor, sawActive = false, final;
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    const result = await desktop.call("wait_threads", { targets: [{ threadId: sourceId, hostId: "local", ...(cursor ? { afterCursor: cursor } : {}) }], timeoutMs: 0 }, contextId);
    const p = result.polls?.[0];
    if (p?.cursor) cursor = p.cursor;
    sawActive ||= p?.thread?.status?.type === "active";
    await bridge.ready();
    const read = await bridge.call("thread/turns/list", { threadId: sourceId, itemsView: "full", limit: 1, sortDirection: "desc" });
    final = read.data?.[0]?.items?.filter(i => i.type === "agentMessage").at(-1)?.text;
    if (final?.includes("ATLAS_INIT") && final?.includes("ATLAS_SYNC_OK")) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!final?.includes("ATLAS_INIT") || !final?.includes("ATLAS_SYNC_OK")) throw new Error("Previous context was not verified: " + final);
  const result = { sourceId, contextId, sawActive, final, checkedAt: new Date().toISOString() };
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { bridge.close(); desktop.close(); }
