import fs from "node:fs";
const ready = JSON.parse(
  fs.readFileSync(".test-data/preview-session.json", "utf8"),
);
const u = new URL(ready.url);
await fetch(u.origin + "/api/shutdown", {
  method: "POST",
  headers: {
    "x-workspace-token": u.hash.slice(1),
    "Content-Type": "application/json",
  },
  body: "{}",
});
console.log("Preview stopped");
