import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { codexUsage } from "../server/usage.mjs";
import { usageSummary } from "../public/usage.js";

test("usage keeps separate model quotas and never substitutes Spark for the Codex weekly quota", () => {
  const result = codexUsage({
    rateLimitsByLimitId: {
      spark: {
        limitId: "spark",
        limitName: "Spark",
        primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 99 },
      },
      codex: {
        limitId: "codex",
        secondary: {
          usedPercent: 46,
          windowDurationMins: 10080,
          resetsAt: 100,
        },
      },
      missing: {
        limitId: "missing",
        primary: { usedPercent: null, windowDurationMins: 300 },
      },
    },
  });
  assert.equal(result.windows.length, 2);
  assert.equal(usageSummary({ providers: [result] }), "Codex 週間 46%");
  assert.equal(
    usageSummary({ providers: [codexUsage({ rateLimits: null })] }),
    "利用量",
  );
  const legacy = codexUsage({
    rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300 } },
  });
  assert.equal(legacy.windows[0].usedPercent, 0);
});

test("Claude capture retains independent sessions and persists metrics without prompt or credentials", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-usage-"));
  try {
    const script = path.join(dir, "capture.mjs");
    await fs.copyFile("scripts/claude-statusline.mjs", script);
    for (const id of ["session-a", "session-b"]) {
      const child = spawn(process.execPath, [script], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const done = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (c) =>
          c === 0 ? resolve() : reject(Error("capture failed")),
        );
      });
      child.stdin.end(
        JSON.stringify({
          session_id: id,
          model: { display_name: "Claude" },
          cost: { total_cost_usd: 1.25 },
          rate_limits: { seven_day: { used_percentage: 12, resets_at: 1234 } },
          prompt: "do not persist",
          api_key: "secret-fixture",
        }),
      );
      await done;
    }
    const names = await fs.readdir(path.join(dir, "claude-usage"));
    assert.equal(names.length, 2);
    for (const n of names) {
      const raw = await fs.readFile(path.join(dir, "claude-usage", n), "utf8");
      assert(!raw.includes("secret-fixture"));
      assert(!raw.includes("do not persist"));
      const record = JSON.parse(raw);
      assert.equal(record.windows[0].usedPercent, 12);
      assert.equal(record.costUsd, 1.25);
    }
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});
