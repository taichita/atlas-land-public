export const shortcutDefinitions = [
  { command: 'youtube-capture', group: 'YouTube', label: '文字起こしとスクショを保存', keys: 'Ctrl+Shift+Y' },
  { command: 'youtube-preview', group: 'YouTube', label: 'おすすめ欄の見え方', keys: 'Ctrl+Alt+Y' },
  { command: "bookmark-page", group: "Web", label: "このページをブックマーク", keys: "Ctrl+D" },
  { command: "bookmarks", group: "Web", label: "ブックマークを開く", keys: "Ctrl+Shift+O" },
  { command: "new-note", group: "ファイル", label: "新しいメモ", keys: "Ctrl+Alt+N" },
  { command: "save-file", group: "ファイル", label: "ファイルを保存", keys: "Ctrl+S" },
  { command: "new-window", group: "表示", label: "新しいウィンドウ", keys: "Ctrl+N" },
  { command: "speed-up", group: "動画", label: "再生速度を 0.25 倍上げる", keys: "V", media: true },
  { command: "speed-down", group: "動画", label: "再生速度を 0.25 倍下げる", keys: "Z", media: true },
  { command: "new-tab", group: "タブ", label: "Webタブを開く", keys: "Ctrl+T" },
  { command: "close-tab", group: "タブ", label: "タブを閉じる", keys: "Ctrl+W" },
  { command: "reopen-tab", group: "タブ", label: "閉じたタブを戻す", keys: "Ctrl+Shift+T" },
  { command: "next-tab", group: "タブ", label: "次のタブへ移動", keys: "Ctrl+Tab" },
  { command: "previous-tab", group: "タブ", label: "前のタブへ移動", keys: "Ctrl+Shift+Tab" },
  { command: "next-tab-page", group: "タブ", label: "次のタブへ移動（別キー）", keys: "Ctrl+PageDown" },
  { command: "previous-tab-page", group: "タブ", label: "前のタブへ移動（別キー）", keys: "Ctrl+PageUp" },
  { command: "move-tab-left", group: "タブ", label: "タブを左へ並べ替える", keys: "Ctrl+Shift+PageUp" },
  { command: "move-tab-right", group: "タブ", label: "タブを右へ並べ替える", keys: "Ctrl+Shift+PageDown" },
  ...Array.from({ length: 8 }, (_, index) => ({
    command: `tab-${index + 1}`,
    group: "タブ",
    label: `${index + 1}番目のタブへ移動`,
    keys: `Ctrl+${index + 1}`,
  })),
  { command: "tab-9", group: "タブ", label: "最後のタブへ移動", keys: "Ctrl+9" },
  { command: "address", group: "Web", label: "アドレス・検索欄へ移動", keys: "Ctrl+L" },
  { command: "split", group: "ペイン", label: "ペインを追加", keys: "Ctrl+Backslash" },
  { command: "zoom-pane", group: "ペイン", label: "ペインを拡大 / 元の分割に戻す", keys: "Ctrl+Shift+Enter" },
  { command: "close-pane", group: "ペイン", label: "選択中のペインを閉じる", keys: "Ctrl+Shift+W" },
  { command: "move-pane", group: "ペイン", label: "タブを次のペインへ移動", keys: "Ctrl+Alt+M" },
  { command: "focus-left", group: "ペイン", label: "前のペインへ移動", keys: "Ctrl+Alt+ArrowLeft" },
  { command: "focus-right", group: "ペイン", label: "次のペインへ移動", keys: "Ctrl+Alt+ArrowRight" },
  { command: "new-task", group: "案件", label: "新しい案件を作る", keys: "Ctrl+Shift+N" },
  { command: "send", group: "案件", label: "AIへ送信", keys: "Ctrl+Enter" },
  { command: "sidebar", group: "表示", label: "サイドバーを表示 / 隠す", keys: "Ctrl+Shift+B" },
  { command: "shortcuts", group: "表示", label: "ショートカット一覧を開く", keys: "F1" },
];

export const defaultShortcutBindings = Object.fromEntries(
  shortcutDefinitions.map(({ command, keys }) => [command, keys]),
);

export const shortcutRows = shortcutDefinitions.map(({ keys, label }) => [
  displayShortcut(keys),
  label,
]);

export function normalizeShortcutBindings(value) {
  const result = { ...defaultShortcutBindings };
  if (!value || typeof value !== "object") return result;
  for (const definition of shortcutDefinitions) {
    const binding = value[definition.command];
    if (typeof binding === "string") result[definition.command] = binding;
  }
  // Newly added defaults must not steal a key already customized by the user.
  for(const [command,binding] of Object.entries(value))if(binding&&Object.hasOwn(result,command)){
    for(const other of Object.keys(result))if(other!==command&&!Object.hasOwn(value,other)&&result[other]===binding)result[other]='';
  }
  return result;
}

function eventKey(e) {
  const code = String(e.code || "");
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  const byCode = {
    ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
    Tab: "Tab", PageUp: "PageUp", PageDown: "PageDown", Home: "Home", End: "End",
    Insert: "Insert", Delete: "Delete", Backspace: "Backspace", Enter: "Enter", Space: "Space",
    Escape: "Escape", Backslash: "Backslash", IntlYen: "Backslash", IntlBackslash: "Backslash",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";",
    Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
  };
  if (byCode[code]) return byCode[code];
  const key = String(e.key || "");
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (/^F(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  const aliases = { "¥": "Backslash", "\\": "Backslash", " ": "Space", Esc: "Escape", Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown" };
  return aliases[key] || key;
}

export function eventToShortcut(e) {
  if (e.isComposing || e.keyCode === 229 || e.metaKey) return "";
  const key = eventKey(e);
  if (!key || ["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(key)) return "";
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key]
    .filter(Boolean)
    .join("+");
}

export function displayShortcut(value) {
  return String(value || "").replaceAll("+", " + ").replace("Backslash", "\\（￥）");
}

export function shortcutCommand(e, bindings) {
  if (e.isComposing || e.metaKey || e.repeat) return null;
  const chord = eventToShortcut(e);
  if (!chord) return null;
  const active = normalizeShortcutBindings(bindings);
  const found = shortcutDefinitions.find(
    ({ command, media }) => !media && active[command] === chord,
  );
  return found?.command || null;
}

export function moveTab(tabs, key, delta) {
  const index = tabs.findIndex((tab) => tab.key === key);
  const to = Math.min(tabs.length - 1, Math.max(0, index + delta));
  if (index < 0 || index === to) return tabs;
  const result = [...tabs];
  result.splice(to, 0, result.splice(index, 1)[0]);
  return result;
}
