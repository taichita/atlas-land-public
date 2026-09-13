import fs from "node:fs/promises";
import path from "node:path";
const url =
  "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500&family=Zen+Kaku+Gothic+New:wght@400;500&display=swap";
let css = await (
  await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/133.0.0.0 Safari/537.36" },
  })
).text();
if (!css.includes("@font-face")) throw new Error("Font CSS unavailable");
const urls = [
  ...new Set(
    [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(
      (m) => m[1],
    ),
  ),
];
await fs.mkdir("public/fonts", { recursive: true });
let i = 0;
for (const link of urls) {
  const name = String(++i) + path.extname(new URL(link).pathname);
  const r = await fetch(link);
  if (!r.ok) throw new Error("Font download failed");
  await fs.writeFile(
    "public/fonts/" + name,
    Buffer.from(await r.arrayBuffer()),
  );
  css = css.replaceAll(link, "/fonts/" + name);
}
await fs.writeFile("public/fonts.css", css);
console.log(
  "Bundled " +
    urls.length +
    " local font subsets; no external font requests at runtime",
);
