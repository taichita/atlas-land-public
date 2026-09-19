import test from "node:test";
import assert from "node:assert/strict";
import { DesktopSync, runtimeState, desktopMessage, releaseLocalTask } from "../server/sync.mjs";
import { DesktopBridge, discoverPipes } from "../server/desktop.mjs";
import { hasConversation, taskLane } from "../public/tasks.js";
import { mergeRecentHistory } from "../public/history.js";
import net from "node:net";
import crypto from "node:crypto";

test("empty drafts stay hidden and every started task has exactly one lane", () => {
  assert.equal(runtimeState('active'), 'running');
  assert.equal(runtimeState('idle'), 'completed');
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

test('dismissed tasks stay hidden across sync restarts and reappear only on new activity; custom titles stay',async()=>{
 const t={id:'task',title:'自分のタイトル',customTitle:true,external:true,hasConversation:true};let text='old';
 const options={store:{data:{desktopContextId:'context'}},connect:async()=>{},update(){},emit(){},cleanItem:i=>i,
  bridge:{async call(){return {data:[{id:'turn',status:'completed',items:[{id:'reply',type:'agentMessage',text}]}]};}},
  desktop:{async ready(){},async call(){return {thread:{title:'auto-generated',status:'idle',updatedAt:1}};},close(){}}
 };
 await new DesktopSync(options).read(t);t.stored=true;t.storedActivityVersion=t.activityVersion;
 await new DesktopSync(options).read(t);assert(t.stored);assert.equal(t.title,'自分のタイトル');
 text='new reply';await new DesktopSync(options).read(t);assert(!t.stored);assert(t.unread);assert.equal(t.title,'自分のタイトル');
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
  assert(calls[0][1].prompt.startsWith('続きの指示\n\nAtlas Browserでの作業方針'));
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

test('pipe discovery accepts current Codex names and prefers inherited endpoints without duplicates', {skip:process.platform!=='win32'}, async()=>{
  const prefix='\\\\.\\pipe\\',id=crypto.randomUUID(),other=crypto.randomUUID();
  const preferred=prefix+'codex-browser-use-'+id;
  assert.deepEqual(await discoverPipes({env:{CODEX_APP_TOOLS_PIPE_PATH:preferred},readDirectory:async()=>[
    'codex-browser-use-'+id,'codex-browser-use\\'+other,'unrelated-'+id,'codex-browser-use-invalid'
  ]}),[preferred,prefix+'codex-browser-use\\'+other]);
});

test('stale endpoints fall back and a timed-out send reconnects without replay',async()=>{
  const address=process.platform==='win32'?'\\\\.\\pipe\\atlas-test-'+crypto.randomUUID():'/tmp/atlas-test-'+crypto.randomUUID();
  const sockets=new Set(),calls=[];
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let data=Buffer.alloc(0);
    socket.on('data',chunk=>{
      data=Buffer.concat([data,chunk]);
      while(data.length>=4&&data.length>=data.readUInt32LE(0)+4){
        const n=data.readUInt32LE(0),m=JSON.parse(data.subarray(4,n+4));data=data.subarray(n+4);
        calls.push(m.method==='tools/list'?'catalog':m.params.tool);
        if(m.params.tool==='send_message_to_thread')continue;
        const result=m.method==='tools/list'?{tools:['list_threads','read_thread','wait_threads','send_message_to_thread'].map(name=>({name,namespace:'codex_app'}))}:{success:true,contentItems:[{type:'inputText',text:'{"threads":[]}'}]};
        const body=Buffer.from(JSON.stringify({id:m.id,result})),header=Buffer.alloc(4);header.writeUInt32LE(body.length);socket.write(Buffer.concat([header,body]));
      }
    });
  });
  await new Promise(r=>server.listen(address,r));let discoveries=0;
  const d=new DesktopBridge({discover:async()=>{discoveries++;return [address+'-closed',address];}});
  try{
    await assert.rejects(d.call('send_message_to_thread',{threadId:'original',prompt:'once'},'context',30),/応答を確認/);
    await d.call('list_threads',{limit:1},'context');
    assert.equal(discoveries,2);assert.equal(calls.filter(c=>c==='send_message_to_thread').length,1);
    assert.equal(calls.filter(c=>c==='catalog').length,2);
  }finally{d.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});

test('local ownership transfers only at idle, with a send lock and successful unsubscribe',async()=>{
  const t={id:'same-thread',state:'completed',hasConversation:true},sending=new Set(),loaded=new Set([t.id]),calls=[];
  const options={sending,loaded,update(){},bridge:{async call(method,args){calls.push([method,args]);assert(sending.has(t.id));}}};
  for(const busy of [{activeTurn:'turn'},{queue:{text:'later'}},{state:'running'},{state:'starting'},{state:'waiting'}]){
    assert.equal(await releaseLocalTask({...t,...busy},options),false);
  }
  sending.add(t.id);assert.equal(await releaseLocalTask(t,options),false);sending.clear();assert.equal(calls.length,0);
  const call=options.bridge.call;options.bridge.call=async()=>{throw Error('not released');};
  await assert.rejects(releaseLocalTask(t,options),/not released/);assert(!t.external);assert(loaded.has(t.id));assert(!sending.size);
  options.bridge.call=call;assert.equal(await releaseLocalTask(t,options),true);
  assert(t.external);assert(!loaded.has(t.id));assert.equal(t.id,'same-thread');
  await releaseLocalTask(t,options);assert.deepEqual(calls,[['thread/unsubscribe',{threadId:t.id}]]);
});

test('desktop sync adopts idle local threads, preserves active work and isolates history failures',async()=>{
  const tasks=[{id:'idle',state:'completed',hasConversation:true},{id:'busy',state:'running',activeTurn:'turn',hasConversation:true},{id:'empty',state:'idle'},{id:'broken',external:true,state:'completed'},{id:'healthy',external:true,state:'completed'}];
  const releases=[],reads=[],events=[];let broken=true;
  const sync=new DesktopSync({store:{data:{tasks,desktopContextId:'context'}},connect:async()=>{},update(t){events.push(t.id);},emit(){},cleanItem:i=>i,
    releaseLocal:async t=>{releases.push(t.id);t.external=true;return true;},
    bridge:{async call(method,{threadId}){assert.equal(method,'thread/turns/list');return {data:[{id:'turn-'+threadId,status:'completed',items:[{id:'message',type:'agentMessage',text:'done'}]}]};}},
    desktop:{async ready(){},async call(name,args){
      if(name==='list_threads')return {threads:tasks.map(t=>({id:t.id,kind:'codex',hostId:'local',cwd:'C:\\fixture',title:t.id,updatedAt:1}))};
      assert.equal(name,'read_thread');reads.push(args.threadId);
      if(args.threadId==='broken'&&broken)throw Error('history unavailable');
      return {thread:{status:{type:'idle'},updatedAt:1},turns:[]};
    },close(){}}
  });
  await sync.touch(null,true);
  assert.deepEqual(releases,['idle']);assert.deepEqual(reads,['idle','broken','healthy']);
  assert.equal(tasks[1].activeTurn,'turn');assert(!tasks[1].external);assert(!tasks[2].external);
  assert.equal(tasks[3].syncError,'history unavailable');assert(tasks[4].syncedAt);assert(sync.available);
  broken=false;await sync.touch(null,true);assert.equal(tasks[3].syncError,null);assert(tasks[3].syncedAt);
  assert.deepEqual(releases,['idle']);assert(events.includes('healthy'));
});
