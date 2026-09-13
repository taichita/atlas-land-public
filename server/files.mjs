import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import iconv from "iconv-lite";
import { createTwoFilesPatch } from "diff";

export const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
export function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export function inside(root, file) {
  const rel = path.relative(root, file);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
export async function resolveFile(root, relative = "") {
  if (typeof relative !== "string" || relative.includes("\0"))
    fail("パスが不正です");
  const base = await fs.realpath(root),
    target = path.resolve(base, relative);
  if (!inside(base, target))
    fail("案件フォルダの外にはアクセスできません", 403);
  const actual = await fs.realpath(target);
  if (!inside(base, actual)) fail("フォルダ外へのリンクは開けません", 403);
  const parts = path.relative(base, actual).split(path.sep);
  if (
    parts.some((p) =>
      [".git", ".codex", ".ssh", ".aws"].includes(p.toLowerCase()),
    )
  )
    fail("この管理フォルダはエディターの対象外です", 403);
  return actual;
}
export async function listFiles(root, relative = "") {
  const dir = await resolveFile(root, relative);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(
      (e) =>
        !e.isSymbolicLink() &&
        !["node_modules", ".git", ".codex", ".ssh", ".aws"].includes(e.name),
    )
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name, "ja"),
    )
    .slice(0, 500)
    .map((e) => ({
      name: e.name,
      path: path.relative(root, path.join(dir, e.name)).replaceAll("\\", "/"),
      directory: e.isDirectory(),
    }));
}
export async function readFile(root, relative, encoding) {
  const file = await resolveFile(root, relative),
    stat = await fs.stat(file);
  if (!stat.isFile()) fail("ファイルを選択してください");
  if (stat.size > 2 * 1024 * 1024)
    fail(
      "編集できるテキストは2MBまでです。大きな成果物はプレビューを利用してください",
    );
  const bytes = await fs.readFile(file);
  let bom = "",
    detected = encoding;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    detected = "utf16-le";
    bom = "fffe";
  } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    detected = "utf8";
    bom = "efbbbf";
  }
  if (!detected) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      detected = "utf8";
    } catch {
      fail("UTF-8ではないファイルです。「Shift-JISで開く」を選択してください");
    }
  }
  if (!["utf8", "utf16-le", "shift_jis"].includes(detected))
    fail("未対応の文字コードです");
  const text = iconv.decode(bytes, detected);
  if (text.includes("\0")) fail("バイナリファイルは文章として編集できません");
  return {
    path: relative,
    text,
    version: hash(bytes),
    encoding: detected,
    bom,
    newline: text.includes("\r\n") ? "CRLF" : "LF",
    bytes: bytes.length,
  };
}
export async function readLocalFile(file, encoding) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    fail("ローカルファイルのパスが不正です");
  const actual = await fs.realpath(file);
  const root = path.dirname(actual);
  const result = await readFile(root, path.basename(actual), encoding);
  return { ...result, path: actual };
}
export async function saveLocalFile(file, input, backupDir) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    fail("ローカルファイルのパスが不正です");
  const actual = await fs.realpath(file);
  const result = await saveFile(
    path.dirname(actual),
    path.basename(actual),
    input,
    backupDir,
  );
  return { ...result, path: actual };
}
const locks = new Map();
export async function saveFile(root, relative, input, backupDir) {
  const file = await resolveFile(root, relative);
  const key = file.toLowerCase();
  const previous = locks.get(key) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(async () => {
      if (typeof input.text !== "string" || input.text.length > 2 * 1024 * 1024)
        fail("文章のサイズが大きすぎます");
      const old = await fs.readFile(file);
      if (hash(old) !== input.version)
        fail(
          "別の操作でファイルが更新されています。編集を保ったまま再読込して差分を確認してください。",
          409,
        );
      const current = await readFile(root, relative, input.encoding);
      let text = input.text;
      if (current.newline === "CRLF") text = text.replace(/\r?\n/g, "\r\n");
      const body = iconv.encode(text, current.encoding);
      if (iconv.decode(body, current.encoding) !== text)
        fail(
          "この文字コードで保存できない文字があります。元のファイルは変更していません",
        );
      const bytes = current.bom
        ? Buffer.concat([Buffer.from(current.bom, "hex"), body])
        : body;
      if (bytes.length > 2 * 1024 * 1024)
        fail("保存後のファイルが2MBを超えます。内容を分割してください");
      await fs.mkdir(backupDir, { recursive: true });
      const backup = path.join(backupDir, hash(old) + ".bak");
      await fs.writeFile(backup, old, { flag: "wx" }).catch((e) => {
        if (e.code !== "EEXIST") throw e;
      });
      const temp = file + ".workspace-" + crypto.randomUUID() + ".tmp";
      try {
        await fs.writeFile(temp, bytes, { flag: "wx" });
        if (hash(await fs.readFile(file)) !== input.version)
          fail("保存直前に更新を検知しました。再読込してください", 409);
        await fs.rename(temp, file);
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
      const patch = createTwoFilesPatch(
        relative,
        relative,
        current.text,
        text,
        "保存前",
        "人間の編集",
        { context: 3 },
      );
      return {
        ...current,
        text,
        version: hash(bytes),
        patch,
        changed: !old.equals(bytes),
      };
    });
  locks.set(key, job);
  try {
    return await job;
  } finally {
    if (locks.get(key) === job) locks.delete(key);
  }
}
