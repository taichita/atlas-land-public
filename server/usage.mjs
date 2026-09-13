import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const profile = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  "PersonalAIWorkspace",
);
const integrations = path.join(profile, "integrations");
const claudeSettings = path.join(os.homedir(), ".claude", "settings.json");
export function codexUsage(result, updatedAt = Date.now()) {
  const buckets = Object.values(result?.rateLimitsByLimitId || {});
  if (!buckets.length && result?.rateLimits) buckets.push(result.rateLimits);
  return {
    id: "codex",
    name: "Codex",
    updatedAt,
    windows: buckets.flatMap((b) =>
      ["primary", "secondary"].flatMap((key) => {
        const w = b[key];
        return typeof w?.usedPercent === "number"
          ? [
              {
                bucketId: b.limitId || "codex",
                bucket:
                  b.limitName ||
                  (b.limitId === "codex" ? "Codex" : b.limitId) ||
                  "Codex",
                minutes: w.windowDurationMins,
                usedPercent: w.usedPercent,
                resetsAt: w.resetsAt,
              },
            ]
          : [];
      }),
    ),
  };
}
export async function claudeUsage() {
  let enabled = false;
  try {
    const s = JSON.parse(await fs.readFile(claudeSettings, "utf8"));
    enabled = s.statusLine?.command?.includes("gpt-atlas-claude.mjs") || false;
  } catch {}
  const dir = path.join(integrations, "claude-usage");
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => /^[\w-]+\.json$/.test(n));
  } catch {}
  const snapshots = (
    await Promise.all(
      names.map(async (n) => {
        try {
          return JSON.parse(await fs.readFile(path.join(dir, n), "utf8"));
        } catch {
          return null;
        }
      }),
    )
  )
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const latest = snapshots[0];
  return {
    id: "claude",
    name: "Claude Code",
    enabled,
    updatedAt: latest?.updatedAt,
    windows: latest?.windows || [],
    sessions: snapshots.slice(0, 20),
    status: latest ? "" : enabled ? "次のClaude応答を待機" : "未接続",
  };
}
export async function enableClaudeUsage() {
  const script = path.join(integrations, "gpt-atlas-claude.mjs");
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(claudeSettings, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (
    settings.statusLine?.command &&
    !settings.statusLine.command.includes("gpt-atlas-claude.mjs")
  ) {
    throw new Error(
      "既存のClaudeステータスラインがあります。設定を統合してから接続してください。",
    );
  }
  await fs.mkdir(integrations, { recursive: true });
  await fs.copyFile(
    fileURLToPath(new URL("../scripts/claude-statusline.mjs", import.meta.url)),
    script,
  );
  const command = 'node "' + script.replaceAll("\\", "/") + '"';
  if (settings.statusLine?.command !== command) {
    await fs.mkdir(path.dirname(claudeSettings), { recursive: true });
    try {
      await fs.copyFile(
        claudeSettings,
        path.join(integrations, "claude-settings-" + Date.now() + ".json"),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    settings.statusLine = { type: "command", command };
    await fs.writeFile(
      claudeSettings + ".atlas.tmp",
      JSON.stringify(settings, null, 2) + "\n",
    );
    await fs.rename(claudeSettings + ".atlas.tmp", claudeSettings);
  }
  return claudeUsage();
}
