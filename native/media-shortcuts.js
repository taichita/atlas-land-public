// Installed once for every document and frame. No polling or AI calls.
(() => {
  const channel = "gpt-atlas-media-v1";
  let enabled = true, increase = "V", decrease = "Z", badge, timer;
  const valid = (m) => m?.channel === channel &&
    (m.delta === 0.25 || m.delta === -0.25 || (Number.isFinite(m.speed) && m.speed >= 0.25 && m.speed <= 8));
  function forward(message) {
    for (let i = 0; i < window.frames.length; i++) window.frames[i].postMessage(message, "*");
  }
  function videos(root = document) {
    const found = [...root.querySelectorAll("video")];
    for (const node of root.querySelectorAll("*")) if (node.shadowRoot) found.push(...videos(node.shadowRoot));
    return found;
  }
  function apply(message) {
    const rates = [];
    for (const video of videos()) {
      try {
        video.playbackRate = Math.min(8, Math.max(0.25, Math.round((message.speed ?? video.playbackRate + message.delta) * 4) / 4));
        rates.push(video.playbackRate);
      } catch { /* A site's unavailable player must not stop other videos. */ }
    }
    forward({ ...message, kind: "apply" });
    if (!rates.length || !document.documentElement) return;
    if (!badge?.isConnected) {
      badge = document.createElement("div");
      badge.setAttribute("role", "status");
      badge.style.cssText = "position:fixed!important;top:20px!important;right:20px!important;z-index:2147483647!important;padding:10px 16px!important;border-radius:12px!important;background:#241536!important;color:#fff!important;font:600 18px system-ui!important;pointer-events:none!important;box-shadow:0 2px 18px #0005!important";
      (document.fullscreenElement || document.documentElement).appendChild(badge);
    }
    badge.textContent = [...new Set(rates)].map((rate) => rate + "×").join(" / ");
    clearTimeout(timer);
    timer = setTimeout(() => badge.remove(), 1000);
  }
  function request(message) {
    if (window !== window.top) window.parent.postMessage({ ...message, kind: "request" }, "*");
    else window.chrome?.webview?.postMessage({ type: "atlas.mediaStep", delta: message.delta });
  }
  function keyName(event) {
    const code = String(event.code || "");
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
    const named = { ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", Tab: "Tab", PageUp: "PageUp", PageDown: "PageDown", Home: "Home", End: "End", Insert: "Insert", Delete: "Delete", Backspace: "Backspace", Enter: "Enter", Space: "Space", Escape: "Escape", Backslash: "Backslash", IntlYen: "Backslash", IntlBackslash: "Backslash", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`" };
    if (named[code]) return named[code];
    const key = String(event.key || "");
    if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
    if (/^F(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
    return { "¥": "Backslash", "\\": "Backslash", " ": "Space", Esc: "Escape" }[key] || key;
  }
  function chord(event) {
    const key = keyName(event);
    if (!key || event.metaKey || ["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(key)) return "";
    return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
  }
  function settings(message) {
    enabled = message.enabled !== false;
    if (typeof message.increase === "string") increase = message.increase;
    if (typeof message.decrease === "string") decrease = message.decrease;
    forward(message);
  }
  window.addEventListener("message", (event) => {
    const m = event.data;
    if (m?.channel !== channel) return;
    if (event.source === window.parent && window !== window.top) {
      if (m.kind === "settings") settings(m);
      else if (m.kind === "apply" && valid(m)) apply(m);
    } else if (m.kind === "ready" || (m.kind === "request" && valid(m))) {
      for (let i = 0; i < window.frames.length; i++) if (event.source === window.frames[i]) {
        if (m.kind === "ready") event.source.postMessage({ channel, kind: "settings", enabled, increase, decrease }, "*");
        else if (enabled) request(m);
        break;
      }
    }
  });
  if (window === window.top) window.chrome?.webview?.addEventListener("message", (event) => {
    const m = event.data;
    if (m?.channel !== channel) return;
    if (m.kind === "settings") settings(m);
    else if (valid(m)) apply(m);
  });
  window.addEventListener("keydown", (event) => {
    if (!enabled || !event.isTrusted || event.isComposing || event.keyCode === 229 || event.repeat || event.metaKey) return;
    const pressed = chord(event);
    if (!pressed || (pressed !== increase && pressed !== decrease)) return;
    const path = event.composedPath();
    path.push(document.activeElement);
    if (path.some((node) => node?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName) || node?.getAttribute?.("role") === "textbox")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    request({ channel, delta: pressed === increase ? 0.25 : -0.25 });
  }, true);
  if (window !== window.top) window.parent.postMessage({ channel, kind: "ready" }, "*");
})();
