// Claude Code's documented statusLine JSON. Store metrics only, never prompts or credentials.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1048576) process.exit(0);
}
try {
  const d = JSON.parse(input);
  const windows = ["five_hour", "seven_day", "spend_limit"].flatMap((key) => {
    const w = d.rate_limits?.[key];
    return typeof w?.used_percentage === "number"
      ? [
          {
            bucket: key === "spend_limit" ? "利用上限" : "Claude",
            minutes:
              key === "five_hour" ? 300 : key === "seven_day" ? 10080 : null,
            usedPercent: w.used_percentage,
            resetsAt: w.resets_at,
          },
        ]
      : [];
  });
  const snapshot = {
    sessionId: d.session_id,
    name: d.session_name || d.model?.display_name || "Claude",
    model: d.model?.display_name,
    updatedAt: Date.now(),
    windows,
    ...(typeof d.cost?.total_cost_usd === "number"
      ? { costUsd: d.cost.total_cost_usd }
      : {}),
  };
  if (d.session_id) {
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "claude-usage",
    );
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(
      dir,
      crypto.createHash("sha256").update(d.session_id).digest("hex") + ".json",
    );
    const tmp = file + "." + process.pid + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(snapshot));
    await fs.rename(tmp, file);
  }
  process.stdout.write(
    [
      d.model?.display_name || "Claude",
      ...windows.map(
        (w) =>
          `${w.minutes === 10080 ? "週" : w.minutes === 300 ? "5h" : w.bucket} ${Math.round(w.usedPercent)}%`,
      ),
    ].join(" · "),
  );
} catch {}
