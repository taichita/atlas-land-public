export function windowLabel(w) {
  if (w.minutes === 10080) return "週間";
  if (w.minutes === 300) return "5時間";
  if (w.minutes && w.minutes % 1440 === 0) return w.minutes / 1440 + "日";
  if (w.minutes && w.minutes % 60 === 0) return w.minutes / 60 + "時間";
  return w.minutes ? w.minutes + "分" : "利用上限";
}
export function usageSummary(usage) {
  return (
    (usage?.providers || [])
      .flatMap((p) => {
        const windows =
          p.id === "codex" && p.windows.some((w) => w.bucketId === "codex")
            ? p.windows.filter((w) => w.bucketId === "codex")
            : p.windows;
        const w = windows.find((w) => w.minutes === 10080) || windows[0];
        return w
          ? [
              p.name.replace(" Code", "") +
                " " +
                windowLabel(w) +
                " " +
                Math.round(w.usedPercent) +
                "%",
            ]
          : [];
      })
      .join(" · ") || "利用量"
  );
}
export function usageHTML(usage, esc) {
  return (usage?.providers || [])
    .map(
      (p) =>
        `<section class="usage-provider"><h3>${esc(p.name)}<span class="usage-updated">${p.updatedAt ? new Date(p.updatedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span></h3>${p.windows.map((w) => `<div class="usage-window"><div><span>${esc(p.windows.some((o) => o.bucket !== w.bucket) ? w.bucket + " · " : "")}${windowLabel(w)}</span><strong>${Number(w.usedPercent.toFixed(1))}% 使用</strong></div><progress max="100" value="${Math.max(0, Math.min(100, w.usedPercent))}" aria-label="${esc(p.name + " " + windowLabel(w))}"></progress>${w.resetsAt ? `<small class="muted">リセット ${new Date(w.resetsAt * 1000).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>` : ""}</div>`).join("")}${p.status ? `<p class="small muted">${esc(p.status)}</p>` : ""}${p.id === "claude" && !p.enabled ? '<button id="claude-usage-connect">Claudeを接続</button>' : ""}${
          p.sessions?.some((s) => typeof s.costUsd === "number")
            ? "<h4>API換算額 · セッション別</h4>" +
              p.sessions
                .filter((s) => typeof s.costUsd === "number")
                .map(
                  (s) =>
                    `<div class="usage-session"><span title="${esc(s.name)}">${esc(s.name)}</span><span>$${s.costUsd.toFixed(4)}</span></div>`,
                )
                .join("")
            : ""
        }</section>`,
    )
    .join("");
}
