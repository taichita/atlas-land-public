import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

export function findCodex() {
  if (process.env.AI_WORKSPACE_CODEX) return process.env.AI_WORKSPACE_CODEX;
  const dir = path.join(
    process.env.LOCALAPPDATA || "",
    "OpenAI",
    "Codex",
    "bin",
  );
  const found = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .map((p) => path.join(dir, p, "codex.exe"))
        .filter((p) => fs.existsSync(p))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  if (!found.length)
    throw new Error(
      "Codex実行ファイルが見つかりません。AI_WORKSPACE_CODEXに最新版のパスを設定してください。",
    );
  return found[0];
}
export class CodexBridge extends EventEmitter {
  constructor() {
    super();
    this.pending = new Map();
    this.seq = 0;
    this.exe = null;
    this.starting = null;
    this.proc = null;
    this.lastError = "";
  }
  async ready() {
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      return await this.starting;
    } catch (e) {
      this.starting = null;
      throw e;
    }
  }
  async start() {
    this.exe = findCodex();
    this.proc = spawn(this.exe, ["app-server"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.on("error", (e) => this.fail(e));
    this.proc.on("exit", (code) => {
      this.proc = null;
      this.starting = null;
      this.fail(new Error("Codex接続が終了しました (" + code + ")"));
      this.emit("disconnected");
    });
    this.proc.stderr.on("data", (b) => {
      this.lastError = (this.lastError + b.toString()).slice(-6000);
    });
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.method) {
        this.emit(m.id !== undefined ? "request" : "notification", m);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      if (m.error)
        p.reject(Object.assign(new Error(m.error.message || JSON.stringify(m.error)),{code:m.error.code,data:m.error.data,codexErrorInfo:m.error.codexErrorInfo||m.error.data?.codexErrorInfo}));
      else p.resolve(m.result);
    });
    const init = await this.call(
      "initialize",
      {
        clientInfo: {
          name: "personal_ai_workspace",
          title: "Atlas Browser",
          version: "0.4.1",
        },
        capabilities: { experimentalApi: true },
      },
      30000,
    );
    this.send({ method: "initialized", params: {} });
    return init;
  }
  send(m) {
    if (!this.proc?.stdin.writable)
      throw new Error("Codexへ接続されていません");
    this.proc.stdin.write(JSON.stringify(m) + "\n");
  }
  call(method, params = {}, timeout = 90000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            method +
              " の応答がタイムアウトしました。処理状態を確認してください。",
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  respond(id, result) {
    this.send({ id, result });
  }
  fail(e) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }
  close() {
    this.proc?.stdin.end();
    this.proc?.kill();
    this.fail(new Error("終了"));
  }
}
