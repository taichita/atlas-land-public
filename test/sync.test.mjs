import test from "node:test";
import assert from "node:assert/strict";
import { DesktopSync, runtimeState, desktopMessage } from "../server/sync.mjs";
import { DesktopBridge } from "../server/desktop.mjs";
import { hasConversation, taskLane } from "../public/tasks.js";
import { mergeRecentHistory } from "../public/history.js";
import net from "node:net";
import crypto from "node:crypto";

test("empty drafts stay hidden and every started task has exactly one lane", () => {
  assert.equal(hasConversation({ title: "新しい案件", state: "idle" }), false);
  for (const state of ["running", "waiting", "completed", "failed", "interrupted", "unknown"]) {
    const t = { state, hasConversation: true };
    assert(hasConversation(t)); assert.equal(taskLane(t), state === "running" ? "working" : "attention");
    assert.equal(taskLane({ ...t, stored: true }), "stored");
  }
  assert.equal(runtimeState({ type: "active", activeFlags: [] }, { status: "interrupted" }), "running");
  assert.equal(runtimeState({ type: "notLoaded" }), "unknown");
  assert.equal(runtimeState({ type: "active", activeFlags: ["waitingOnApproval"] }), "waiting");
});
test("Atlas follow-ups remain visible and other agents are not labelled as the user", () => {
  const item = { id: "input", type: "functionCallOutput", namespace: "codex_app", name: "send_message_to_thread", output: "<codex_delegation>\n<source_thread_id>atlas-context</source_thread_id>\n<input>次の指示 <literal></input>\n</codex_delegation>" };
  assert.equal(desktopMessage(item, "atlas-context").sourceLabel, "あなた");
  assert.equal(desktopMessage(item, "another-context").sourceLabel, "連携メッセージ");
  assert.equal(desktopMessage(item, "atlas-context").content[0].text, "次の指示 <literal>");
  assert.equal(desktopMessage({ ...item, namespace: "untrusted" }, "atlas-context").type, "functionCallOutput");
});

test("desktop sends keep the original thread and model; uncertain sends are never retried", async () => {
  const calls = [], task = { id: "original", edits: [], external: true, state: "running" };
  const sync = new DesktopSync({ store: { data: { desktopContextId: "atlas-context" } }, bridge: { call() { throw Error("must not resume or fork"); } }, update() {}, emit() {}, desktop: {
    async ready() {}, async call(...args) { calls.push(args); return { ok: true }; }, close() {},
  } });
  sync.touch = () => {};
  await sync.send(task, { text: "続きの指示" });
  assert.equal(calls[0][0], "send_message_to_thread");
  assert.equal(calls[0][1].threadId,'original');assert.equal(calls[0][1].hostId,'local');
  assert.equal(calls[0][1].model,undefined);assert.equal(calls[0][1].thinking,undefined);
  assert(calls[0][1].prompt.startsWith('続きの指示\n\nAtlas Landでの作業方針'));
  await sync.send(task,{text:'次の作業'});
  assert.equal(calls[1][1].prompt,'次の作業');
  assert.equal(calls[0][2], "atlas-context");
  sync.desktop.call = async () => { calls.push("failure"); throw Error("connection lost"); };
  await assert.rejects(sync.send(task, { text: "二重送信しない" }), /connection lost/);
  assert.equal(calls.filter(c => c === "failure").length, 1);
});
test("paginated desktop summaries use persisted message bodies without losing live status", async () => {
  const t = { id: "thread", edits: [], events: [], state: "unknown" }, calls = [], updates = [];
  const sync = new DesktopSync({ store: { data: { desktopContextId: "context" } }, connect: async () => {},
    bridge: { async call(name, args) { calls.push(name); return { data: [{ id: "turn", status: "interrupted", startedAt: 1, items: [{ id: "message", type: "agentMessage", text: "作業しています" }] }], nextCursor: "older" }; } },
    update() {}, emit(name, data) { updates.push({ name, data }); }, cleanItem: i => i,
    desktop: { async ready() {}, async call() { return { thread: { title: "案件", status: { type: "active", activeFlags: [] }, updatedAt: 2 }, turns: [{ id: "turn", status: "inProgress", items: [] }] }; }, close() {} },
  });
  const r = await sync.read(t);
  assert.deepEqual(calls, ["thread/turns/list"]);
  assert.equal(r.data[0].items[0].text, "作業しています");
  assert.equal(t.state, "running");
  assert.equal(t.activeTurn, "turn");
  assert.equal(r.data[0].status, "inProgress");
  assert.equal(t.hasConversation, true);
  assert(updates.some(e => e.name === "historyUpdated"));
});

test("live updates preserve the reader's older-history pagination position", () => {
  const previous = { turns: [1, 2, 3, 4].map(n => ({ id: String(n), startedAt: n })), cursor: "before-1" };
  const merged = mergeRecentHistory(previous, { data: [{ id: "5", startedAt: 5 }, { id: "4", startedAt: 4, status: "completed" }], nextCursor: "before-4" });
  assert.equal(merged.cursor, "before-1");
  assert.deepEqual(merged.turns.map(t => t.id), ["1", "2", "3", "4", "5"]);
  assert.equal(merged.turns[3].status, "completed");
  assert.equal(mergeRecentHistory({ ...previous, cursor: null }, { data: [], nextCursor: "new" }).cursor, null);
});

test("desktop IPC decodes fragmented frames and propagates tool errors", async () => {
  const address = process.platform === "win32" ? "\\\\.\\pipe\\atlas-test-" + crypto.randomUUID() : "/tmp/atlas-test-" + crypto.randomUUID();
  const server = net.createServer(socket => {
    let data = Buffer.alloc(0);
    socket.on("data", chunk => {
      data = Buffer.concat([data, chunk]);
      while (data.length >= 4 && data.length >= data.readUInt32LE(0) + 4) {
        const n = data.readUInt32LE(0), m = JSON.parse(data.subarray(4, n + 4)); data = data.subarray(n + 4);
        const result = m.method === "tools/list" ? { tools: ["list_threads", "read_thread", "wait_threads", "send_message_to_thread"].map(name => ({ name, namespace: "codex_app" })) } : { success: false, contentItems: [{ type: "inputText", text: "rejected" }] };
        const body = Buffer.from(JSON.stringify({ id: m.id, result })), header = Buffer.alloc(4); header.writeUInt32LE(body.length);
        socket.write(header.subarray(0, 2)); setTimeout(() => socket.write(Buffer.concat([header.subarray(2), body])), 3);
      }
    });
  });
  await new Promise(r => server.listen(address, r));
  const d = new DesktopBridge({ discover: async () => address });
  try { await assert.rejects(d.call("read_thread", { threadId: "a" }, "context"), /rejected/); }
  finally { d.close(); await new Promise(r => server.close(r)); }
});

test("long-poll heartbeats cannot create an immediate desktop-sync feedback loop", async () => {
  let calls = 0;
  const sync = new DesktopSync({ store: { data: { tasks: [], desktopContextId: "context" } }, emit() {}, desktop: {
    async ready() {}, async call() { calls++; return { threads: [] }; }, close() {},
  } });
  await sync.touch(null);
  assert.equal(calls, 1);
  for (let i = 0; i < 20; i++) await sync.touch(null);
  assert.equal(calls, 1);
  await sync.touch(null, true);
  assert.equal(calls, 2);
});
