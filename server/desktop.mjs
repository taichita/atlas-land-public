import net from "node:net";
import fs from 'node:fs/promises';
import crypto from "node:crypto";

const required = ["list_threads", "read_thread", "wait_threads", "send_message_to_thread"];
const allowed = new Set([...required,"navigate_to_codex_page"]);
const maxFrame = 8 * 1024 * 1024;

// Compatibility adapter for the installed Codex App Tools transport. It keeps
// desktop-owned runs on their original executor. No source session is resumed,
// interrupted, or forked by this adapter. Never retry a dispatched mutation.
export class DesktopBridge {
  constructor({ discover } = {}) {
    this.discover = discover || discoverPipes;
    this.pending = new Map();
    this.seq = 0;
    this.buffer = Buffer.alloc(0);
    this.tools = new Map();
    this.closed = false;
  }
  async ready() {
    if (this.socket && !this.socket.destroyed && this.tools.size) return;
    if (this.connecting) return this.connecting;
    if (this.closed) throw new Error("接続を終了しました");
    this.connecting = (async () => {
      const discovered = await this.discover(), addresses=Array.isArray(discovered)?discovered:[discovered];
      let lastError;
      for(const address of addresses){
      try{
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(address);
        const timer = setTimeout(() => socket.destroy(new Error("Codexアプリへの接続がタイムアウトしました")), 4000);
        socket.once("error", reject);
        socket.once("connect", () => {
          clearTimeout(timer);
          this.socket = socket;
          this.buffer = Buffer.alloc(0);
          socket.on("data", (b) => { if (this.socket === socket) this.receive(b); });
          resolve();
        });
        socket.on("error", (e) => { if (this.socket === socket) this.fail(e); });
        socket.on("close", () => { clearTimeout(timer); if (this.socket === socket) this.fail(new Error("Codexアプリとの接続が切れました")); });
      });
      const catalog = await this.request("tools/list", { threadStartKind: "all" },4000);
      this.tools = new Map(catalog.tools.filter((t) => allowed.has(t.name)).map((t) => [t.name, t]));
      if (required.some(name=>!this.tools.has(name))) throw new Error("このCodexアプリの接続仕様に対応していません");
      return;
      }catch(e){lastError=e;this.socket?.destroy();this.socket=null;this.tools.clear();}
      }
      throw lastError||new Error('Codexアプリの接続先が見つかりません。Codexを起動してください');
    })().catch(e => { this.socket?.destroy(); this.tools.clear(); throw e; }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  request(method, params, timeout = 20000) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error("Codexアプリを開いてください"));
    const id = ++this.seq;
    const payload = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    if (payload.length > maxFrame) return Promise.reject(new Error("送信内容が大きすぎます"));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error=new Error("Codexからの応答を確認できませんでした。会話を更新して確認してください");
        reject(error);
        // Force fresh discovery after a stale connection; never resend this request.
        this.socket?.destroy();
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(Buffer.concat([header, payload]));
    });
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > maxFrame) { this.socket.destroy(new Error("接続応答が大きすぎます")); return; }
      if (this.buffer.length < length + 4) return;
      const frame = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      let message;
      try { message = JSON.parse(frame); } catch { this.socket.destroy(new Error("接続応答を読み取れません")); return; }
      const p = this.pending.get(message.id);
      if (!p) continue;
      clearTimeout(p.timer);
      this.pending.delete(message.id);
      if (message.error) p.reject(new Error(message.error.message));
      else p.resolve(message.result);
    }
  }
  async call(name, args, callerId, timeout) {
    if (!allowed.has(name)) throw new Error("未対応の操作です");
    await this.ready();
    const tool = this.tools.get(name);
    if(!tool)throw new Error('このCodexアプリからは画面を開けません。Codex側で該当するタスクを開いてください');
    if (!callerId) throw new Error("案件を選んでください");
    const result = await this.request("tools/call", {
      namespace: tool.namespace, tool: name, arguments: args,
      threadId: callerId, turnId: "atlas-ui-" + crypto.randomUUID(),
      callId: "atlas-ui-" + crypto.randomUUID(),
    }, timeout);
    const text = (result.contentItems || []).filter((c) => c.type === "inputText").map((c) => c.text).join("\n");
    if (!result.success) throw new Error(text || "Codexで操作を完了できませんでした");
    try { return JSON.parse(text); } catch { return { text }; }
  }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.tools.clear();
  }
  close() { this.closed = true; this.socket?.destroy(); this.fail(new Error("接続を終了しました")); }
}

export async function discoverPipes({env=process.env,readDirectory=fs.readdir}={}) {
  if (process.platform !== "win32") throw new Error("Codexアプリとの同期はWindowsで利用できます");
  const prefix='\\\\.\\pipe\\',valid=/^codex-browser-use(?:-|\\)[0-9a-f-]{36}$/i;
  const preferred=env.CODEX_APP_TOOLS_PIPE_PATH;
  const names=await readDirectory(prefix).catch(()=>[]);
  return [...new Set([...(preferred?.startsWith(prefix)&&valid.test(preferred.slice(prefix.length))?[preferred]:[]),...names.filter(n=>valid.test(n)).map(n=>prefix+n)])].slice(0,16);
}
