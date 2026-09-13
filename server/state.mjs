import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hasConversation } from "../public/tasks.js";

export class StateStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "workspace.json");
    this.data = { version: 1, tasks: [], links: [], tabs: [], activeTab: null };
    if (fs.existsSync(this.file)) {
      try {
        this.data = {
          ...this.data,
          ...JSON.parse(fs.readFileSync(this.file, "utf8")),
        };
      } catch (e) {
        throw new Error(
          "状態ファイルを読み込めません。" + this.file + " : " + e.message,
        );
      }
    }
    for (const t of this.data.tasks) {
      if (["running", "waiting", "starting"].includes(t.state))
        t.state = "disconnected";
      t.activeTurn = null;
    }
    this.timer = null;
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.timer);
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2));
    fs.renameSync(temp, this.file);
  }
  task(id) {
    const t = this.data.tasks.find((t) => t.id === id);
    if (!t) {
      const e = new Error("案件が見つかりません");
      e.status = 404;
      throw e;
    }
    return t;
  }
  addThread(thread, extra = {}) {
    let t = this.data.tasks.find((t) => t.id === thread.id);
    if (t) return t;
    t = {
      id: thread.id,
      title: thread.name || thread.preview?.slice(0, 65) || "新しい案件",
      cwd: thread.cwd,
      model: thread.model,
      effort: thread.reasoningEffort || "medium",
      createdAt: thread.createdAt * 1000 || Date.now(),
      lastReplyAt: thread.updatedAt * 1000 || Date.now(),
      state: "idle",
      unread: false,
      events: [],
      files: [],
      edits: [],
      ...extra,
    };
    this.data.tasks.push(t);
    this.save();
    return t;
  }
  event(t, type, label, detail = {}) {
    t.events.push({
      id: crypto.randomUUID(),
      at: Date.now(),
      type,
      label,
      ...detail,
    });
    if (t.events.length > 200) t.events.splice(0, t.events.length - 200);
    this.save();
  }
  dependencies(id) {
    return this.data.links.filter(
      (e) => e.kind === "dependency" && e.to === id,
    );
  }
  blockers(id) {
    return this.dependencies(id).filter(
      (e) =>
        this.data.tasks.find((t) => t.id === e.from)?.state !== "completed",
    );
  }
  addDependency(from, to, note = "") {
    this.task(from);
    this.task(to);
    if (from === to) throw new Error("自分自身には依存できません");
    if (
      this.data.links.some(
        (l) => l.kind === "dependency" && l.from === from && l.to === to,
      )
    )
      return;
    const visit = (id, seen = new Set()) => {
      if (id === from) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return this.data.links
        .filter((l) => l.kind === "dependency" && l.from === id)
        .some((l) => visit(l.to, seen));
    };
    if (visit(to)) throw new Error("循環する依存関係は登録できません");
    this.data.links.push({
      id: crypto.randomUUID(),
      from,
      to,
      kind: "dependency",
      note,
      source: "user",
      at: Date.now(),
    });
    this.save();
  }
  graph() {
    const nodes = [],
      edges = [...this.data.links];
    const folders = new Map(),
      files = new Map();
    for (const t of this.data.tasks) {
      if (!hasConversation(t) || t.stored) continue;
      nodes.push({
        id: t.id,
        label: t.title,
        kind: "task",
        state: t.state,
        cwd: t.cwd,
        taskId: t.id,
        unread: t.unread,
      });
      const fid = "folder:" + t.cwd.toLowerCase();
      if (!folders.has(fid)) {
        folders.set(fid, true);
        nodes.push({
          id: fid,
          label: path.basename(t.cwd),
          path: t.cwd,
          kind: "folder",
          state: "folder",
        });
      }
      edges.push({
        id: "belongs:" + t.id,
        from: fid,
        to: t.id,
        kind: "folder",
        source: "metadata",
        note: "同じフォルダ。処理の依存関係を意味しません",
      });
      for (const f of (t.files || []).slice(-30)) {
        const absolute = path.resolve(t.cwd, f.path),
          id = "file:" + absolute.toLowerCase();
        if (!files.has(id)) {
          files.set(id, true);
          nodes.push({
            id,
            label: path.basename(f.path),
            path: f.path,
            kind: "file",
            state: "file",
            taskId: t.id,
          });
        }
        edges.push({
          id: t.id + ":" + id,
          from: t.id,
          to: id,
          kind: f.kind || "file",
          source: f.source || "observed",
          at: f.at,
          note: f.note || "この案件で扱ったファイル",
        });
      }
    }
    const ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: edges.filter(e => ids.has(e.from) && ids.has(e.to)) };
  }
}
