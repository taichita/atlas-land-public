import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const dir = path.resolve(".test-data", "ui-profile");
fs.mkdirSync(dir, { recursive: true });
const source = path.join(
  process.env.LOCALAPPDATA,
  "PersonalAIWorkspace",
  "data",
  "workspace.json",
);
fs.copyFileSync(source, path.join(dir, "workspace.json"));
const child = spawn(process.execPath, ["server/main.mjs"], {
  cwd: process.cwd(),
  windowsHide: true,
  env: { ...process.env, AI_WORKSPACE_DATA: dir },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stderr.pipe(process.stderr);
createInterface({ input: child.stdout }).once("line", (line) => {
  fs.writeFileSync(".test-data/preview-session.json", line);
  console.log("Preview ready");
});
