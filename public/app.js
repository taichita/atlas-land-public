import {setupVoice} from './voice-input.js';
import {Autosave} from './autosave.js';
import {setupYouTube} from './youtube.js';
import {usageLimited,aiErrorText} from './ai-errors.js';
import {tabIcon,svgIcon} from './tab-icons.js';
import {setupBookmarkFlyout} from './bookmark-flyout.js';
import {bookmarkMarks,bookmarkMark,flatBookmarks} from './bookmark-marks.js';
import {requestHTML,requestKey,readRequestForm} from './requests-ui.js';
import {setupImagePaste} from './image-paste.js';
import { marked } from "/vendor/marked.js";
import DOMPurify from "/vendor/purify.js";
import { usageSummary, usageHTML } from "./usage.js";
import { hasConversation, taskLane, laneNames } from "./tasks.js";
import { applyTheme, normalizeTheme, themePresets, fontPresets } from "./theme.js";
import { mergeRecentHistory, conversationItems } from "./history.js";
import {
  shortcutDefinitions,
  defaultShortcutBindings,
  normalizeShortcutBindings,
  eventToShortcut,
  displayShortcut,
  shortcutCommand,
  moveTab,
} from "./shortcuts.js";
import { paneMode, paneBridge, setupPanes } from "./pane-shell.js";
import { fileLink } from './file-links.js';
import {setupTabRail} from './tab-rail.js';
import {setupPageTranslation} from './page-translation.js';
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const windowId = new URLSearchParams(location.search).get('window') || (paneMode ? parent.atlasWindowId : 'main');
window.atlasWindowId=windowId;
const token =
  location.hash.slice(1) || sessionStorage.getItem("workspace-token");
if (token) {
  sessionStorage.setItem("workspace-token", token);
  history.replaceState(null, "", location.pathname+location.search);
}
const native = paneMode ? !!parent.chrome?.webview : !!paneBridge;
let paneShell, paneVisible = true, closingWindow=false;
const editorCache = paneMode ? parent.atlasEditorCache : (window.atlasEditorCache = {files:{},local:{},drafts:{}});
const state = {
  tasks: [],
  models: [],
  links: [],
  requests: [],
  connected: false,
  active: null,
  open: [],
  viewTabs: [],
  activeView: null,
  mode: "work",
  artifact: "files",
  layout: "split",
  filter: "attention",
  drafts: {},
  edits: {},
  webAttachments: {},
  files: editorCache.files,
  histories: new Map(),
  sending: new Set(),
  imageUploads: new Map(),
  tabs: [],
  activeTab: null,
  browserSplit: false,
  browserSecondary: null,
  closedViews: [],
  localEditors: editorCache.local,
  sequence: 0,
  ui: {},
  graph: null,
  selectedNode: null,
};
const states = {
  idle: "待機",
  starting: "開始中",
  running: "実行中",
  completed: "あなたの番",
  waiting: "確認待ち",
  failed: "エラー",
  interrupted: "中断",
  queued: "前提待ち",
  disconnected: "接続切れ",
  history: "履歴",
  unknown: "状態未取得",
};
const task = () => state.tasks.find((t) => t.id === state.active),
  status = (t) => t?.stored ? "保管" : t?.state==='failed'&&(t.usageLimited||usageLimited(t.error)) ? 'AI利用上限' : states[t?.state] || "状態未取得";
const time = (n) =>
  n
    ? new Date(n).toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 6000);
}
async function api(url, data, keepalive=false) {
  if (paneMode && (url === '/preferences' || url === '/tabs')) return {ok:true};
  const r = await fetch("/api" + url, {
    keepalive,
    method: data === undefined ? "GET" : "POST",
    headers: {
      "x-workspace-token": token,
      "x-atlas-window": windowId,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(result.error || "操作に失敗しました"), {
      status: r.status,
      codexErrorInfo: result.codexErrorInfo,
    });
  return result;
}
function action(id, fn) {
  $(id).addEventListener("click", () =>
    Promise.resolve()
      .then(fn)
      .catch((e) => toast(e.message)),
  );
}
action('new-window',()=>host('window.new'));
action('dual-monitor',()=>host('window.dual'));
const pendingNative = new Map();
function host(action, args = {}) {
  if (!native)
    return Promise.reject(
      new Error(
        "この操作はWindowsアプリ内で使えます。dist/AtlasBrowser.exe を開いてください。",
      ),
    );
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingNative.delete(requestId);
      reject(new Error("ブラウザ操作の応答がありません"));
    }, 30000);
    pendingNative.set(requestId, { resolve, reject, timer });
    (paneShell?.post || (m=>paneBridge.postMessage(m)))({ action, requestId, ...args });
  });
}
function postHost(action, args = {}) {
  if (native) (paneShell?.post || (m=>paneBridge.postMessage(m)))({ action, ...args });
}
function upsert(t) {
  const i = state.tasks.findIndex((x) => x.id === t.id);
  if (i < 0) state.tasks.push(t);
  else state.tasks[i] = t;
}
function preferenceSnapshot(){return {...state.ui,active:state.active,open:state.open,drafts:state.drafts,layout:state.layout,viewTabs:state.viewTabs,activeView:state.activeView};}
const draftCacheKey='atlas-pending-drafts:'+windowId;
let lastDraftWarning=0;
function draftSaveFailed(e){
  if(!e.status)showServiceDown();
  if(Date.now()-lastDraftWarning<30000)return;
  lastDraftWarning=Date.now();
  toast('保存を再試行します。入力はこの画面に保持しています');
}
const preferenceSave=new Autosave({
  save:value=>api('/preferences',value),
  cache:value=>{try{localStorage.setItem(draftCacheKey,JSON.stringify(value.drafts||{}));}catch{}},
  clearCache:()=>{try{localStorage.removeItem(draftCacheKey);}catch{}},
  onError:draftSaveFailed,
});
async function savePreferences(){
  if(paneMode)return;
  preferenceSave.queue(preferenceSnapshot());
  await preferenceSave.flush();
}
function prefs() {
  if(closingWindow)return;
  if(paneMode){paneShell?.persist();return;}
  preferenceSave.queue(preferenceSnapshot());
}
window.addEventListener('pagehide',()=>{
  if(paneMode||!state.ui||closingWindow)return;
  stashDraft();clearTimeout(preferenceSave.timer);
  preferenceSave.queue(preferenceSnapshot());
  preferenceSave.flush().catch(()=>{});
});
function shortcutBindings() {
  return normalizeShortcutBindings(state.ui.shortcuts);
}
function syncShortcutSettings() {
  const bindings = shortcutBindings();
  state.ui.shortcuts = bindings;
  postHost("window.shortcuts", { bindings });
  postHost("browser.mediaKeys", {
    enabled: state.ui.videoKeys !== false,
    increase: bindings["speed-up"],
    decrease: bindings["speed-down"],
  });
  if ($("menu-shortcut-key"))
    $("menu-shortcut-key").textContent = displayShortcut(bindings.shortcuts) || "未設定";
  if ($("composer-note"))
    $("composer-note").textContent = bindings.send ? `${displayShortcut(bindings.send)} で送信` : "送信ボタンで送信";
}
function markdown(text, copyable = false) {
  const html=DOMPurify.sanitize(marked.parse(text || "", { breaks: false }), {
    FORBID_TAGS: [
      "img",
      "iframe",
      "style",
      "script",
      "form",
      "input",
      "button",
    ],
    FORBID_ATTR: ["style"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|file):|[a-z]:[\\/]|[^a-z]|[a-z+.-]+(?:[^a-z+.:\-]|$))/i,
  });
  const content=document.createElement('div');content.innerHTML=html;
  if(copyable)for(const pre of content.querySelectorAll('pre')){
    if(!pre.querySelector('code'))continue;
    const block=document.createElement('div'),button=document.createElement('button');
    block.className='copyable-code';button.type='button';button.dataset.copyCode='';button.textContent='コピー';button.setAttribute('aria-label','コード・プロンプトをコピー');
    pre.replaceWith(block);block.append(button,pre);
  }
  for(const a of content.querySelectorAll('a[href]')){
    const target=fileLink(a.getAttribute('href'));
    if(!target||target.web||target.anchor!==undefined)continue;
    a.title='Atlas内で開く';
  }
  return content.innerHTML;
}
document.addEventListener("click", (e) => {
  const preview=e.target.closest('[data-open-local]');
  const a = preview || e.target.closest(".message-body a,.reading a");
  if (!a) return;
  e.preventDefault();
  const href = preview?.dataset.openLocal || a.getAttribute("href");
  if (!href) return;
  const target=fileLink(href,a.closest('.reading')?currentEditor()?.path:'',task()?.cwd);
  if(target?.web)openWeb(target.web).catch(e=>toast(e.message));
  else if(target?.anchor)document.getElementById(target.anchor)?.scrollIntoView();
  else if(target?.local)loadLocalPath(target.local).catch(e=>toast(e.message));
  else if(target?.relative&&task())openFile(target.relative).catch(e=>toast(e.message));
  else if(!target)toast('このリンクはAtlas内で開けません。Windows上のファイルへのリンクが必要です。');
});
function localPath(value){return /^[a-z]:[\\/]/i.test(value)?value:task()?.cwd?task().cwd.replace(/[\\/]$/,'')+'/'+value:value;}
async function revealLocal(filename){
  if(native)return host('file.reveal',{path:filename});
  openDialog(dialogHeader('保存場所')+'<input id="folder-path" readonly style="width:100%" value="'+esc(filename.replaceAll('/','\\'))+'"><button id="copy-folder-path">パスをコピー</button>');
  $('copy-folder-path').onclick=async()=>{await navigator.clipboard.writeText($('folder-path').value);toast('コピーしました');};
}
action('reveal-file',()=>{const e=currentEditor();if(e)return revealLocal(e.local?e.path:localPath(e.path));});
function renderSidebar() {
  const q = $("task-search").value.toLowerCase();
  const all = state.tasks.filter(hasConversation).sort(
    (a, b) => (b.lastReplyAt || b.createdAt) - (a.lastReplyAt || a.createdAt),
  );
  const filtered = all.filter(
    (t) =>
      (t.title + " " + t.cwd).toLowerCase().includes(q) &&
      taskLane(t) === state.filter,
  );
  const card = (t) => `<div class="task-entry"><button class="task-card" data-task="${esc(t.id)}" aria-pressed="${t.id === state.active}"><span class="title">${esc(t.title)}</span><span class="folder" title="${esc(t.cwd)}">⌁ ${esc(t.cwd?.split(/[\\/]/).filter(Boolean).pop() || t.cwd)}</span><span class="state"><i class="dot ${esc(t.state)}"></i>${esc(t.stored ? "保管" : status(t))}${t.unread ? '<span class="pink">● 新着</span>' : ""}${t.external ? '<span class="sync-mark" title="Codexアプリと同期">⇄</span>' : ""}<time>${time(t.lastReplyAt)}</time></span></button><button class="task-dismiss" data-dismiss="${esc(t.id)}" aria-label="${esc(t.title)}を一覧から片づける" title="一覧から片づける">×</button></div>`;
  let html;
  if (state.ui.grouping === "folder") {
    const folders = new Map();
    for (const t of filtered) { const key = (t.cwd || "").toLowerCase(); if (!folders.has(key)) folders.set(key, []); folders.get(key).push(t); }
    html = [...folders.values()].map(tasks => `<section class="folder-group"><h3 title="${esc(tasks[0].cwd)}">⌁ ${esc(tasks[0].cwd?.split(/[\\/]/).filter(Boolean).pop() || tasks[0].cwd)} <span>${tasks.length}</span></h3>${tasks.map(card).join("")}</section>`).join("");
  } else html = filtered.map(card).join("");
  const content = filtered.length
    ? html
    : '<div class="empty small">' +
      (q ? "一致する案件がありません" : state.filter === "working" ? "いま作業中の案件はありません" : state.filter === "stored" ? "保管した案件はありません" : "確認する案件はありません") +
      "</div>";
  if (renderSidebar.lastContent !== content) { $("task-list").innerHTML = content; renderSidebar.lastContent = content; }
  const unread=all.filter(t=>t.unread&&!t.stored);$('sidebar-notification').hidden=!document.body.classList.contains('sidebar-hidden')||!unread.length;$('sidebar-notification').title=unread.length+' 件の新しい返答';
  $("unread-count").textContent = all.filter((t) => t.unread && !t.stored).length
    ? all.filter((t) => t.unread && !t.stored).length + " 新着"
    : "";
  $("task-count").textContent =
    all.filter(t => !t.stored).length +
    " 件 · " +
    state.tasks.filter((t) => ["running", "starting"].includes(t.state))
      .length +
    " 件実行中";
  postHost("activity", {
    running: state.tasks.filter((t) =>
      !t.external && ["running", "starting", "waiting", "queued"].includes(t.state),
    ).length,
  });
  document.querySelectorAll("[data-filter]").forEach(b => { b.setAttribute("aria-pressed", b.dataset.filter === state.filter); b.textContent = laneNames[b.dataset.filter] + " " + all.filter(t => taskLane(t) === b.dataset.filter).length; });
}
$("task-list").addEventListener("click", (e) => {
  const dismiss=e.target.closest("[data-dismiss]");if(dismiss){dismissTask(dismiss.dataset.dismiss).catch(e=>toast(e.message));return;}
  const b = e.target.closest("[data-task]");
  if (b) selectTask(b.dataset.task).catch((e) => toast(e.message));
});
$("task-search").addEventListener("input", renderSidebar);
document.querySelectorAll("[data-filter]").forEach((b) =>
  b.addEventListener("click", () => {
    state.filter = b.dataset.filter;
    state.ui.taskFilter = state.filter;
    prefs();
    document
      .querySelectorAll("[data-filter]")
      .forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderSidebar();
  }),
);
let viewEpoch = 0;
$("task-grouping").addEventListener("change", e => { state.ui.grouping = e.target.value; prefs(); renderSidebar(); });
action("sync-tasks", async () => { const r = await api("/sync", { active: state.active }); r.tasks.forEach(upsert); renderSidebar(); if (state.active) await loadHistory(state.active); if (!r.available && r.error) toast(r.error); });
async function dismissTask(id){upsert(await api('/tasks/'+id+'/settings',{stored:true}));await closeView('task:'+id);renderSidebar();renderActive();}
action('sidebar-notification',async()=>{const t=state.tasks.filter(t=>t.unread&&!t.stored).sort((a,b)=>b.lastReplyAt-a.lastReplyAt)[0];if(t)await selectTask(t.id);});
action('default-folder',async()=>{const folder=await host('chooseFolder',{path:state.defaultFolder});if(folder){state.defaultFolder=(await api('/default-folder',{folder})).folder;renderDefaultFolder();}});
function renderDefaultFolder(){const folder=state.defaultFolder||'C:\\dev';$('default-folder').title='新しい案件の既定フォルダ: '+folder;}
action("store-task", async () => { const t = task(); if (!t) return; upsert(await api("/tasks/" + t.id + "/settings", { stored: !t.stored })); renderSidebar(); renderActive(); });
function addView(kind, id, extra = {}) {
  const key = kind + ":" + id;
  if (!state.viewTabs.some((v) => v.key === key))
    state.viewTabs.push({ key, kind, id, ...extra });
  return key;
}
function focusView(key) {
  state.activeView = key;
  const view = state.viewTabs.find((v) => v.key === key);
  const web = view?.kind === "web",
    file = ["file", "folder", "localfile"].includes(view?.kind);
  $("work-view").classList.toggle("web-focus", web);
  $("work-view").classList.toggle("file-focus", file);
  $("work-view").classList.toggle("document-focus", ['file','localfile'].includes(view?.kind));
  $("browser-view").hidden = !web;
  $("files-view").hidden = false;
  state.artifact = web ? "browser" : "files";
  renderWorkTabs();
  syncBrowserLayout();
  prefs();
  paneShell?.changed();
}
function renderWorkTabs() {
  for (const id of state.open)
    if (state.tasks.some((t) => t.id === id)) addView("task", id);
  for (const t of state.tabs) addView("web", t.id);
  const markup =
    state.viewTabs
      .map((v) => {
        const t =
          v.kind === "task"
            ? state.tasks.find((t) => t.id === v.id)
            : v.kind === "web"
              ? state.tabs.find((t) => t.id === v.id)
              : null;
        const title =
          (v.kind==='localfile'&&state.localEditors[v.id]?.untitled?'無題':null) ||
          t?.title ||
          (v.kind === "folder" ? "ファイル" : v.path?.split(/[\\/]/).at(-1)) ||
          "Web";
        const glyph = tabIcon(v,t,esc);
        return `<div draggable="true" data-tab-key="${esc(v.key)}" data-tab-title="${esc(title)}" class="work-tab kind-${v.kind} ${v.key === state.activeView ? "active" : ""}"><button data-view="${esc(v.key)}" aria-label="${esc(title)}" aria-current="${v.key===state.activeView?'page':'false'}" title="${esc(title)}${t?.url?' — '+esc(t.url):''}"><span class="tab-kind">${glyph}</span><span class="tab-title">${t?.unread ? "● " : ""}${esc(title)}</span></button><button class="close" data-close-view="${esc(v.key)}" aria-label="${esc(title)}のタブを閉じる">×</button></div>`;
      })
      .join("") +
    (paneMode ? '<button data-pane-action="split" title="ペインを追加">▥＋</button><button data-pane-action="move-pane" title="タブを次のペインへ移動">⇥</button><button data-pane-action="close-pane" title="このペインを閉じる">▥×</button>' : '');
  if (renderWorkTabs.markup !== markup) {
    $("work-tabs").innerHTML = markup;
    renderWorkTabs.markup = markup;
  }
  tabRail.refresh();
}
async function selectView(key) {
  const epoch = ++viewEpoch,
    v = state.viewTabs.find((v) => v.key === key);
  if (!v) return;
  if (v.kind === "task") return selectTask(v.id, false);
  if (v.kind === "web") {
    stashDraft();
    state.activeTab = v.id;
    setMode("work");
    focusView(key);
    const t = state.tabs.find((t) => t.id === v.id);
    renderBrowserTabs();
    persistTabs();
    if (native && t) {
      await host(t.loaded ? "browser.select" : "browser.open", {
        id: t.id,
        url: t.url,
      });
      t.loaded = true;
      await ensureSecondary();
      if (epoch !== viewEpoch) {
        const current = state.tabs.find(
          (t) => "web:" + t.id === state.activeView,
        );
        if (current) await host("browser.select", { id: current.id });
      }
      syncBrowserLayout();
    }
  } else if (v.kind === "localfile") {
    if(!state.localEditors[v.id]) await loadLocalPath(v.path);
    focusView(v.key);
    renderFiles();
    renderEditor();
  } else {
    await selectTask(v.taskId, false, false);
    if (epoch !== viewEpoch) return;
    if (v.kind === "file") await openFile(v.path);
    if (epoch === viewEpoch) focusView(key);
  }
}
async function closeView(key) {
  if(!paneMode) await paneShell?.close(key);
  const index = state.viewTabs.findIndex((v) => v.key === key),
    v = state.viewTabs[index];
  if (!v) return;
  if (v.kind === "web") {
    state.closedViews.push({ view: { ...v }, tab: { ...state.tabs.find((t) => t.id === v.id), loaded: false }, index });
    if (native) await host("browser.close", { id: v.id });
    state.tabs = state.tabs.filter((t) => t.id !== v.id);
    if (state.activeTab === v.id)
      state.activeTab = state.tabs.at(-1)?.id || null;
    persistTabs();
  }
  // Keep editors and unsaved text available for reopening a tab.
  if (v.kind !== "web") state.closedViews.push({ view: { ...v }, index });
  if (state.closedViews.length > 20) state.closedViews.shift();
  if (v.kind === "task") state.open = state.open.filter((id) => id !== v.id);
  // Closing a document tab keeps any draft in the task's editor cache.
  state.viewTabs = state.viewTabs.filter((v) => v.key !== key);
  if (state.activeView === key) {
    const next = state.viewTabs[Math.min(index, state.viewTabs.length - 1)];
    if (next) await selectView(next.key);
    else {
      stashDraft();
      state.active = null;
      focusView(null);
      renderActive();
    }
  }
  renderWorkTabs();
  renderBrowserTabs();
  syncBrowserLayout();
  prefs();
}
$("pane-tabbar").addEventListener("click", (e) => {
  const paneAction=e.target.closest('[data-pane-action]');
  if(paneAction){paneShell.shortcut(paneAction.dataset.paneAction);return;}
  const v = e.target.closest("[data-view]"),
    c = e.target.closest("[data-close-view]");
  const run = v
    ? () => selectView(v.dataset.view)
    : c
      ? () => closeView(c.dataset.closeView)
      : e.target.closest('button')?.id === "open-web-home"
        ? () => openWeb("https://www.google.com/")
        : e.target.closest('button')?.id === "open-files-home"
          ? openLocalFile
          : null;
  if (run)
    Promise.resolve()
      .then(run)
      .catch((e) => toast(e.message));
});
function stashDraft() {
  if (state.active) state.drafts[state.active] = $("prompt").value;
}
function expandComposer(expanded) {
  $("composer").classList.toggle("is-collapsed", !expanded);
  $("composer-fields").hidden = !expanded;
  $("composer-toggle").setAttribute("aria-expanded", String(expanded));
  $("composer-toggle").textContent = expanded ? "入力欄を閉じる" : ($("prompt").value ? "指示を入力 · 下書きあり" : "指示を入力");
}
$("composer-toggle").addEventListener("click", () => {
  const expanded = $("composer-fields").hidden;
  expandComposer(expanded);
  if (expanded) $("prompt").focus();
});
async function selectTask(id, advanceEpoch = true, seeReply = true) {
  if(state.active!==id||state.activeView!=='task:'+id)conversationBottomPending=id;
  if (advanceEpoch) viewEpoch++;
  stashDraft();
  state.active = id;
  if (hasConversation(task())) state.filter = taskLane(task());
  if (!state.open.includes(id)) state.open.push(id);
  focusView(addView("task", id));
  setMode("work");
  renderActive();
  $("prompt").value = state.drafts[id] || "";
  expandComposer(false);
  renderSidebar();
  renderWorkTabs();
  prefs();
  await Promise.allSettled([
    state.histories.has(id) && !task()?.external ? null : loadHistory(id),
    fileState(id).loadedDrafts ? null : loadFiles(id),
  ]);
  if (seeReply && state.active === id) markSeen();
}
function markSeen() {
  const t = task();
  if (
    t?.unread &&
    state.mode === "work" &&
    state.activeView === "task:" + t.id &&
    document.visibilityState === "visible" && paneVisible
  )
    api("/tasks/" + t.id + "/seen", { at: t.lastReplyAt })
      .then(upsert)
      .catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    markSeen();
    state.graph?.setVisible(state.mode === "globe");
  } else state.graph?.setVisible(false);
});
function renderConnection() {
  if(state.serviceDown)return;
  $("connection").textContent = state.connected
    ? state.account?.type === "chatgpt"
      ? "Codex"
      : "Codex · " + (state.account?.type || "未ログイン")
    : "Codex · 未接続";
  $("connection").classList.toggle("ok", state.connected);
  populateModels();
}
function populateModels() {
  const preserve = task()?.external && !task()?.model;
  const current =
    preserve ? "" : task()?.model ||
    $("model").value ||
    state.models.find((m) => m.isDefault)?.model;
  const values = (task()?.external ? '<option value="">現在の設定</option>' : "") + state.models
    .map(
      (m) =>
        `<option value="${esc(m.model)}">${esc(m.displayName || m.model)}</option>`,
    )
    .join("");
  if ($("model").innerHTML !== values) $("model").innerHTML = values;
  if (current || preserve) $("model").value = current;
  populateEfforts();
}
function populateEfforts() {
  if (task()?.external && !$("model").value) { const options = '<option value="">現在の設定</option>'; if ($("effort").innerHTML !== options) $("effort").innerHTML = options; return; }
  const m = state.models.find((m) => m.model === $("model").value);
  const current = task()?.effort || $("effort").value || "medium";
  const options = (
    m?.supportedReasoningEfforts || [{ reasoningEffort: "medium" }]
  )
    .map(
      (e) =>
        `<option value="${esc(e.reasoningEffort)}">${esc({ low: "軽く", medium: "標準", high: "深く", xhigh: "さらに深く", max: "最大", ultra: "最大・自動委任" }[e.reasoningEffort] || e.reasoningEffort)}</option>`,
    )
    .join("");
  if ($("effort").innerHTML !== options) $("effort").innerHTML = options;
  $("effort").value = current;
  if (!$("effort").value) $("effort").selectedIndex = 0;
}
let modelSave = Promise.resolve();
function saveModelChoice() {
  const t = task();
  if (!t) return;
  const values = { model: $("model").value, effort: $("effort").value };
  Object.assign(t, values);
  state.ui.lastModel = values.model;
  state.ui.lastEffort = values.effort;
  prefs();
  modelSave = modelSave
    .catch(() => {})
    .then(() => api("/tasks/" + t.id + "/settings", values));
  modelSave.catch((e) => toast(e.message));
}
$("model").addEventListener("change", () => {
  populateEfforts();
  saveModelChoice();
});
$("effort").addEventListener("change", saveModelChoice);
function renderActive() {
  $("voice-provider").value=state.ui.voiceByModel?.[task()?.model||"default"]||"auto";
  const t = task();
  $("task-title").textContent = t?.title || "Atlas Browser";
  $("task-folder").textContent = t?.cwd || state.defaultFolder || "C:\\dev";
  $("task-status").innerHTML = t
    ? `<i class="dot ${esc(t.state)}"></i>${esc(status(t))}`
    : "";
  $("inspect-task").hidden = !t;
  $('reconnect-task').hidden=!t||!(['disconnected','unknown','failed'].includes(t.state)||t.syncError);
  $('open-codex').hidden=!t||!hasConversation(t);
  $('open-codex').disabled=!!t&&!t.external&&!!t.activeTurn;
  $("store-task").hidden = !t || !hasConversation(t);
  $("store-task").textContent = t?.stored ? "保管から戻す" : "保管する";
  $("composer").hidden = !t;
  $("prompt").disabled = !t;
  $("interrupt").hidden = !t?.activeTurn || t?.external;
  $("send").disabled =
    !t || state.sending.has(t.id) || state.imageUploads.get(t.id)>0 || (!t.external && (!!t.activeTurn || t.state === "starting")) || !!t.queue;
  const blockers = t
    ? state.links.filter(
        (l) =>
          l.kind === "dependency" &&
          l.to === t.id &&
          state.tasks.find((x) => x.id === l.from)?.state !== "completed",
      )
    : [];
  $("send").textContent = t?.external && t.activeTurn ? "追加で伝える ↗" : blockers.length ? "前提の完了後に送信" : "送信 ↗";
  $("composer-note").textContent = t?.queue
    ? "送信予約中です。前提のAI応答が終わると開始します。"
    : "Ctrl + Enter で送信";
  if (t?.queue)
    $("composer-note").innerHTML +=
      ' <button id="cancel-queue-button">予約を取り消す</button>';
  populateModels();
  renderConversation();
  renderRequests();
  renderPlan();
  renderAttachments();
  renderFiles();
  renderEditor();
  renderWorkTabs();
  syncBrowserLayout();
}
async function loadHistory(id, cursor) {
  const result = await api(
    "/tasks/" +
      id +
      "/history" +
      (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
  );
  const existing = state.histories.get(id);
  if (!cursor && result.source === "desktop") { mergeHistory(id, result); if (state.active === id) renderConversation(); return; }
  const turns = cursor
    ? [...(result.data || []).reverse(), ...(existing?.turns || [])]
    : [...(result.data || [])].reverse();
  const seen = new Set();
  state.histories.set(id, {
    compactHistory: !!result.compactHistory || !!existing?.compactHistory,
    turns: turns.filter((t) => !seen.has(t.id) && seen.add(t.id)),
    cursor: result.nextCursor,
    live: new Map((result.live || []).map((i) => [i.id, i])),
  });
  if (state.active === id) renderConversation();
}
function mergeHistory(id, result) {
  state.histories.set(id, mergeRecentHistory(state.histories.get(id), result));
}
function allItems(history) {
  return conversationItems(history, task()?.activeTurn);
}
function conversationHTML(items) {
  let html = "", group = [];
  const flush = () => { if (!group.length) return; html += `<details class="process-group" data-process="${esc(group[0].id)}"><summary>処理 ${group.length}件</summary>${group.map(itemHTML).join("")}</details>`; group = []; };
  for (const i of items) {
    if (["userMessage", "agentMessage"].includes(i.type)) { flush(); html += itemHTML(i); }
    else if (itemHTML(i)) group.push(i);
  }
  flush(); return html;
}
function itemHTML(i) {
  if (i.type === "userMessage") {
    return `<article class="message user" data-item="${esc(i.id)}"><div class="message-label">${esc(i.sourceLabel || "あなた")}</div><div class="message-body">${esc(
      (i.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n"),
    ).replaceAll("\n", "<br>")}${(i.content||[]).filter(c=>c.type==='image'||c.type==='localImage').map(c=>safeImage(c.url)?imageThumb(c.url,c.name||'添付画像'):'<span class="attachment">添付画像</span>').join('')}</div></article>`;
  }
  if (i.type === "agentMessage") {
    return `<article class="message" data-item="${esc(i.id)}"><div class="message-label">AI <span class="muted">${i.phase === "commentary" ? "進捗" : ""}</span><button class="copy-message" data-copy-message="${esc(i.id)}" aria-label="回答全文をコピー">コピー</button></div><div class="message-body">${markdown(i.text,true)}</div></article>`;
  }
  if (i.type === "plan") {
    return `<article class="message"><div class="message-label">作業計画</div><div class="message-body">${markdown(i.text)}</div></article>`;
  }
  const names = {
    commandExecution: "ローカル処理",
    fileChange: "ファイルの変更",
    mcpToolCall: "外部ツール",
    dynamicToolCall: "ワークスペース連携",
    webSearch: "Web調査",
    imageGeneration: "画像生成",
    collabAgentToolCall: "サブタスク",
    contextCompaction: "会話の圧縮",
  };
  if (!names[i.type]) return "";
  const detail =
    i.command ||
    i.tool ||
    i.query ||
    (i.changes || []).map((c) => c.path).join("\n") ||
    i.savedPath ||
    i.status ||
    "";
  return `<details class="tool-summary" data-item="${esc(i.id)}"><summary>${esc(names[i.type])} <span>· ${esc(i.status || "記録")}</span></summary><pre>${esc(detail)}${i.aggregatedOutput ? "\n\n" + esc(i.aggregatedOutput.slice(-10000)) : ""}</pre></details>`;
}
const welcomeHTML = $("conversation").innerHTML;
let conversationBottomPending=null;
function renderConversation() {
  const t = task();
  if (!t) {
    $("conversation").innerHTML = welcomeHTML;
    $("welcome-new")?.addEventListener("click", () =>
      newTask().catch((e) => toast(e.message)),
    );
    return;
  }
  const changed=$("conversation").dataset.task!==t.id;
  $("conversation").dataset.task = t.id;
  const history = state.histories.get(t.id),
    nearBottom = changed || conversationBottomPending===t.id ||
      $("conversation").scrollHeight -
        $("conversation").scrollTop -
        $("conversation").clientHeight <
      110,
    oldScroll = $("conversation").scrollTop;
  let html = "";
  if (t.external)
    html =
      `<div class="conversation-sync"><span title="${esc(t.syncError || state.desktop?.error || "Codexアプリと同期")}">${t.syncError || state.desktop?.error ? "⇄ Codex · 接続を確認" : "⇄ Codex"}</span><button id="refresh-conversation" title="会話を更新">↻</button></div>`;
  if (!history) html += '<div class="empty">会話を読み込んでいます…</div>';
  else {
    if(history.compactHistory)html += '<div class="conversation-sync" title="大きな会話は要約表示です。元の会話はCodexに残っています">軽量表示 · 一部の履歴を省略</div>';
    if (history.cursor)
      html += '<button id="load-older" class="older">以前の会話を読む</button>';
    html += conversationHTML(allItems(history));
    if (!allItems(history).length)
      html +=
        '<div class="welcome"><img class="welcome-icon" src="/assets/atlas-browser.png" alt=""><h2>新しい案件</h2></div>';
  }
  if (t.state === "running" || t.state === "starting")
    html += '<div class="busy-label">◌ 作業中</div>';
  if (t.error)
    html += '<div class="tool-summary pink">' + esc(aiErrorText(t.usageLimited?{codexErrorInfo:'UsageLimitExceeded',message:t.error}:t.error)) + "</div>";
  const opened = new Set([...$("conversation").querySelectorAll("[data-process][open]")].map(el => el.dataset.process));
  $("conversation").innerHTML = html;
  for (const el of $("conversation").querySelectorAll("[data-process]")) if (opened.has(el.dataset.process)) el.open = true;
  if (nearBottom) $("conversation").scrollTop = $("conversation").scrollHeight;
  else $("conversation").scrollTop = oldScroll;
  if(history&&conversationBottomPending===t.id)conversationBottomPending=null;
}
$("conversation").addEventListener("click", async (e) => {
  try {
    const code=e.target.closest('button[data-copy-code]'),message=e.target.closest('button[data-copy-message]');
    if(code||message){
      const text=code?code.closest('.copyable-code').querySelector('code').textContent:allItems(state.histories.get(state.active)).find(i=>i.id===message.dataset.copyMessage)?.text;
      if(typeof text==='string'){await navigator.clipboard.writeText(text);toast('コピーしました');}return;
    }
    if (e.target.id === "refresh-conversation") await loadHistory(state.active);
    if (e.target.id === "load-older")
      await loadHistory(
        state.active,
        state.histories.get(state.active)?.cursor,
      );
    if (e.target.id === "fork-history") {
      const t = await api("/tasks/" + state.active + "/fork", {});
      upsert(t);
      await selectTask(t.id);
    }
  } catch (err) {
    toast(aiErrorText(err));
  }
});
function scheduleConversation() {
  if (scheduleConversation.timer) return;
  scheduleConversation.timer = setTimeout(() => {
    scheduleConversation.timer = null;
    renderConversation();
  }, 120);
}
function renderPlan() {
  const p = task()?.plan;
  $("plan-area").innerHTML = p?.length
    ? "<details><summary>進め方 · " +
      p.filter((s) => s.status === "completed").length +
      " / " +
      p.length +
      "</summary>" +
      p
        .map(
          (s) =>
            `<div class="plan-step">${s.status === "completed" ? "✓" : s.status === "inProgress" ? "◌" : "○"} ${esc(s.step)}</div>`,
        )
        .join("") +
      "</details>"
    : "";
}
function renderRequests() {
  const list = state.requests.filter(r => r.params.threadId === state.active);
  const area=$('request-area'), signatures=new Map();
  for(const r of list){
    const key=requestKey(r.id),signature=JSON.stringify(r);signatures.set(key,signature);
    let card=[...area.children].find(c=>c.dataset.request===key);
    if(card?.dataset.signature===signature)continue;
    const template=document.createElement('template');template.innerHTML=requestHTML(r);
    const next=template.content.firstElementChild;next.dataset.signature=signature;
    if(card)card.replaceWith(next);else area.append(next);
  }
  for(const card of [...area.children])if(!signatures.has(card.dataset.request))card.remove();
  if(!list.length&&task()?.external&&task().state==='waiting'){
    area.innerHTML='<div class="request-card"><p>Codex側で確認が必要です。</p><button type="button" id="approval-open-source">Codexで確認</button></div>';
  }
}
$('request-area').addEventListener('click',async e=>{
  if(e.target.id==='approval-open-source'){await api('/tasks/'+state.active+'/open-source',{}).catch(err=>toast(err.message));return;}
  const card=e.target.closest('[data-request]');if(!card)return;
  const r=state.requests.find(r=>requestKey(r.id)===card.dataset.request);if(!r)return;
  const choice=e.target.closest('[data-choice-question]');
  if(choice){const input=[...card.querySelectorAll('[data-question]')].find(el=>el.dataset.question===choice.dataset.choiceQuestion);input.value=choice.dataset.choiceValue;input.focus();return;}
  const link=e.target.closest('[data-request-url]');if(link){await openWeb(link.dataset.requestUrl).catch(e=>toast(e.message));return;}
  const button=e.target.closest('[data-answer]');if(!button||card.dataset.sending)return;
  const decision=button.dataset.answer,error=card.querySelector('.request-error');
  try {
    const data={id:r.id,decision,accept:decision==='accept'};
    if(decision==='submit'){
      data.answers=Object.fromEntries([...card.querySelectorAll('[data-question]')].map(el=>[el.dataset.question,[el.value]]));
      if(Object.values(data.answers).some(a=>!a[0].trim()))throw Error('回答を入力してください');
    }
    if(decision==='accept'&&r.method.includes('elicitation'))data.content=readRequestForm(card,r);
    card.dataset.sending='true';card.querySelectorAll('button').forEach(b=>b.disabled=true);error.hidden=true;
    await api('/requests/respond',data);
    state.requests=state.requests.filter(x=>requestKey(x.id)!==requestKey(r.id));renderRequests();
  }catch(err){
    error.textContent=err.message;error.hidden=false;
    delete card.dataset.sending;card.querySelectorAll('button').forEach(b=>b.disabled=false);
  }
});
function renderAttachments() {
  const t = task();
  if (!t) {
    $("attachments").innerHTML = "";
    return;
  }
  const edits = (t.edits || []).filter((e) => !e.sentAt);
  const excluded = state.edits[t.id] || [];
  $("attachments").innerHTML =
    edits
      .filter((e) => !excluded.includes(e.id))
      .map(
        (e) =>
          `<span class="attachment">差分 · ${esc(e.path)} <button data-edit-remove="${esc(e.id)}" aria-label="差分の添付を外す">×</button></span>`,
      )
      .join("") +
    (state.webAttachments[t.id]
      ? '<span class="attachment">Web · ' +
        esc(state.webAttachments[t.id].title) +
        ' <button id="remove-web-attachment" aria-label="ページの添付を外す">×</button></span>'
      : "") + (t.images||[]).filter(i=>!i.sentAt).map(i=>`<span class="image-attachment">${imageThumb('/image/'+i.id,i.name)}<button type="button" data-image-remove="${esc(i.id)}" aria-label="${esc(i.name)}の添付を外す" ${state.sending.has(t.id)||t.queue?'disabled':''}>×</button></span>`).join('') +
      (state.imageUploads.get(t.id)>0?'<span class="attachment">画像を追加中…</span>':'');
}
function safeImage(url){return typeof url==='string'&&(/^\/image\/[a-f0-9]{48}$/.test(url)||/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(url));}
function imageThumb(url,name){return `<button type="button" class="image-thumb" data-image-open="${esc(url)}" title="${esc(name)}"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></button>`;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-image-open]');if(b&&safeImage(b.dataset.imageOpen))openDialog(dialogHeader('添付画像')+`<img class="attachment-full" src="${esc(b.dataset.imageOpen)}" alt="添付画像">`);});
setupImagePaste({composer:$('composer'),prompt:$('prompt'),picker:$('image-picker'),choose:$('attach-image'),error:toast,
  upload(count){
    const id=state.active;
    if(id){state.imageUploads.set(id,(state.imageUploads.get(id)||0)+count);renderActive();}
    return async file=>{
      try{
        if(!id)throw Error('案件を選んでください');
        if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('PNG・JPEG・WebP・GIFの画像を選んでください');
        if(file.size>12*1024*1024)throw Error('画像は1枚12MBまでです');
        const response=await fetch('/api/tasks/'+id+'/images?name='+encodeURIComponent(file.name||'貼り付け画像.png'),{method:'POST',headers:{'x-workspace-token':token,'Content-Type':file.type},body:file});
        const result=await response.json();if(!response.ok)throw Error(result.error||'画像を追加できませんでした');
        const t=state.tasks.find(t=>t.id===id);if(t&&!t.images?.some(i=>i.id===result.image.id))(t.images||=[]).push(result.image);
      }finally{if(id){state.imageUploads.set(id,Math.max(0,(state.imageUploads.get(id)||1)-1));if(state.active===id)renderActive();}}
    };
  }
});
$("attachments").addEventListener("click", (e) => {
  const imageId=e.target.closest('[data-image-remove]')?.dataset.imageRemove;
  if(imageId){const id=state.active;api('/tasks/'+id+'/images/remove',{id:imageId}).then(()=>{const t=state.tasks.find(t=>t.id===id);if(t)t.images=(t.images||[]).filter(i=>i.id!==imageId);renderAttachments();}).catch(e=>toast(e.message));return;}
  const id = e.target.dataset.editRemove;
  if (id) {
    (state.edits[state.active] ||= []).push(id);
    renderAttachments();
  }
  if (e.target.id === "remove-web-attachment") {
    delete state.webAttachments[state.active];
    renderAttachments();
  }
});
$("prompt").addEventListener("input", () => {
  stashDraft();
  prefs();
});
$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = task();
  if (!t || $("send").disabled) return;
  const text = $("prompt").value;
  const imageIds=(t.images||[]).filter(i=>!i.sentAt).map(i=>i.id);
  if (!text.trim()&&!imageIds.length) return;
  $("send").disabled = true;
  state.sending.add(t.id);
  try {
    const result = await api("/tasks/" + t.id + "/send", {
      text,
      imageIds,
      model: $("model").value,
      effort: $("effort").value,
      editIds: (t.edits || [])
        .filter((e) => !e.sentAt && !(state.edits[t.id] || []).includes(e.id))
        .map((e) => e.id),
      browserContext: state.webAttachments[t.id],
    });
    state.drafts[t.id] = "";
    delete state.webAttachments[t.id];
    if (state.active === t.id) { $("prompt").value = ""; expandComposer(false); }
    prefs();
    if (result.queued) toast("前提のAI応答完了後に開始するよう予約しました");
    else await loadHistory(t.id);
    renderAttachments();
  } catch (err) {
    toast(aiErrorText(err));
  } finally {
    state.sending.delete(t.id);
    renderActive();
  }
});
action("interrupt", async () => {
  await api("/tasks/" + state.active + "/interrupt", {});
  toast("中断を依頼しました");
});
$("composer-note").addEventListener("click", async (e) => {
  if (e.target.id === "cancel-queue-button") {
    try {
      const r = await api("/tasks/" + state.active + "/cancel-queue", {});
      state.drafts[state.active] = r.draft?.text || "";
      $("prompt").value = state.drafts[state.active];
      prefs();
    } catch (err) {
      toast(err.message);
    }
  }
});
function setLayout(value) {
  state.layout = value;
  $("panes").dataset.layout = value;
  document.querySelectorAll("[data-layout]").forEach((b) => {
    if (b.tagName === "BUTTON")
      b.setAttribute("aria-pressed", b.dataset.layout === value);
  });
  prefs();
  syncBrowserLayout();
}
document
  .querySelectorAll("button[data-layout]")
  .forEach((b) =>
    b.addEventListener("click", () => setLayout(b.dataset.layout)),
  );
function setArtifact(mode) {
  if (mode === "browser") {
    if (state.activeTab) focusView(addView("web", state.activeTab));
  } else {
    $("files-view").hidden = false;
    if (state.artifact === "browser")
      focusView(task() ? addView("task", state.active) : null);
  }
  renderBrowserTabs();
  syncBrowserLayout();
}
action("files-mode", () => {
  if (task())
    return selectView(
      addView("folder", state.active, { taskId: state.active }),
    );
});
action("browser-mode", () => openWeb("https://www.google.com/"));
action("sidebar-toggle", () => {
  document.body.classList.toggle("sidebar-hidden");state.ui.sidebarHidden=document.body.classList.contains("sidebar-hidden");prefs();renderSidebar();
  syncBrowserLayout();
  state.graph?.resize();
});
let resizing = false;
$("splitter").addEventListener("pointerdown", (e) => {
  resizing = true;
  $("splitter").setPointerCapture(e.pointerId);
  postHost("browser.layout", { visible: false });
});
$("splitter").addEventListener("pointermove", (e) => {
  if (!resizing) return;
  const r = $("panes").getBoundingClientRect(),
    width = Math.max(270, Math.min(r.width - 260, e.clientX - r.left));
  $("panes").style.setProperty("--conversation-width", width + "px");
});
$("splitter").addEventListener("pointerup", () => {
  resizing = false;
  syncBrowserLayout();
});
$("splitter").addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    const width =
      $("conversation-pane").getBoundingClientRect().width +
      (e.key === "ArrowLeft" ? -25 : 25);
    $("panes").style.setProperty(
      "--conversation-width",
      Math.max(270, width) + "px",
    );
    syncBrowserLayout();
  }
});
function openDialog(html) {
  postHost("browser.layout", { visible: false });
  $("dialog-body").innerHTML = html;
  $("dialog").showModal();
  paneShell?.render();
  $("dialog")
    .querySelector("[data-dialog-close]")
    ?.addEventListener("click", () => closeDialog());
}
function closeDialog() {
  $("dialog").close();
  syncBrowserLayout();
}
$("dialog").addEventListener("close", syncBrowserLayout);
function dialogHeader(title) {
  return `<div class="dialog-heading"><h2>${esc(title)}</h2><button data-dialog-close aria-label="閉じる">×</button></div>`;
}
async function newTask() {
  if (newTask.pending) return newTask.pending;
  $("new-task").disabled = true;
  newTask.pending = (async () => {
    const t = await api("/tasks", {
      cwd: state.defaultFolder || "C:\\dev",
      model: state.ui.lastModel || state.models.find((m) => m.isDefault)?.model,
      effort: state.ui.lastEffort || "medium",
    });
    upsert(t);
    setLayout("split");
    await selectTask(t.id);
    expandComposer(true);
    $("prompt").focus();
    return t;
  })();
  try {
    return await newTask.pending;
  } finally {
    newTask.pending = null;
    $("new-task").disabled = false;
  }
}
action("task-title", () => {
  const t = task();
  if (!t) return;
  openDialog(
    dialogHeader("案件名") +
      `<form id="rename-form"><input id="rename-title" value="${esc(t.title)}" maxlength="120" required aria-label="案件名"><div class="dialog-actions"><button class="primary">保存</button></div></form>`,
  );
  $("rename-title").focus();
  $("rename-title").select();
  $("rename-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      upsert(
        await api("/tasks/" + t.id + "/rename", {
          title: $("rename-title").value,
        }),
      );
      closeDialog();
      renderSidebar();
      renderActive();
    } catch (e) {
      toast(e.message);
    }
  });
});
action("task-folder", async () => {
  const t = task();
  if (!t || t.external) return;
  await saveDrafts();
  const cwd = await host("chooseFolder", {
    path: t.cwd || state.defaultFolder,
  });
  if (cwd && cwd !== t.cwd) {
    upsert(await api("/tasks/" + t.id + "/settings", { cwd }));
    state.files[t.id] = { dir: "", entries: [], editor: null, editors: {} };
    state.viewTabs = state.viewTabs.filter(
      (v) => v.kind === "task" || v.taskId !== t.id,
    );
    await selectTask(t.id);
  }
});
action("new-task", newTask);
action("welcome-new", newTask);
async function importHistory() {
  openDialog(
    dialogHeader("Codexの履歴を読み込む") +
      '<form id="history-search-form" class="form-field"><input id="history-search" placeholder="会話のタイトルを検索"></form><div id="history-results">読み込んでいます…</div><button id="history-more" hidden>さらに読む</button>',
  );
  let cursor;
  async function load(more = false) {
    const r = await api(
      "/history/list?search=" +
        encodeURIComponent($("history-search").value) +
        (more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    const html = r.data
      .map(
        (t) =>
          `<div class="history-row"><div><strong>${esc(t.name || t.preview?.slice(0, 100) || "無題")}</strong><small>${esc(t.cwd)} · ${new Date(t.updatedAt * 1000).toLocaleDateString("ja-JP")}</small></div><button data-import="${esc(t.id)}">読み込む</button></div>`,
      )
      .join("");
    if (more) $("history-results").insertAdjacentHTML("beforeend", html);
    else
      $("history-results").innerHTML = html || "<p>履歴が見つかりません。</p>";
    cursor = r.nextCursor;
    $("history-more").hidden = !cursor;
  }
  $("history-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    load().catch((e) => toast(e.message));
  });
  $("history-more").addEventListener("click", () =>
    load(true).catch((e) => toast(e.message)),
  );
  $("history-results").addEventListener("click", async (e) => {
    const id = e.target.dataset.import;
    if (!id) return;
    e.target.disabled = true;
    try {
      const t = await api("/history/import", { id });
      upsert(t);
      closeDialog();
      await selectTask(t.id);
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
    }
  });
  await load();
}
action("import-task", importHistory);
async function settings() {
  $("app-menu").open = false;
  const m = await api("/metrics");
  openDialog(
    dialogHeader("設定") +
      `<div class="metric-line"><span>Codex</span><strong>${state.connected ? "接続済み" : "未接続"}</strong></div><div class="metric-line"><span>アカウント</span><strong>${esc(state.account?.plan || state.account?.type || "未ログイン")}</strong></div><div class="metric-line"><span>バックエンドのメモリ</span><strong>${Math.round(m.node.rss / 1048576)} MB</strong></div><div class="form-field" style="margin-top:22px"><label for="reading-size">本文の大きさ</label><input id="reading-size" type="range" min="14" max="26" value="${state.ui.bodySize || 17}"></div><div class="dialog-actions"><button id="reconnect">再接続</button>${!state.account ? '<button id="login" class="primary">ChatGPTでログイン</button>' : ""}</div>`,
  );
  const shortcutButton = document.createElement("button");
  const accessField=document.createElement('div');accessField.className='form-field';accessField.innerHTML='<label for="default-access">新しい案件の権限</label><select id="default-access"><option value="danger-full-access">通常 · PC全体の操作を許可（確認なし）</option><option value="workspace-write">作業フォルダ内の編集 · 範囲外は確認</option><option value="read-only">読み取りのみ · 変更は確認</option></select>';
  $('dialog').querySelector('.dialog-actions').before(accessField);$('default-access').value=state.defaultAccess||'danger-full-access';$('default-access').onchange=async e=>{try{state.defaultAccess=(await api('/default-access',{access:e.target.value})).access;toast('新しい案件に適用します');}catch(error){toast(error.message);}};
  const policyButton=document.createElement('button');policyButton.textContent='実行方針';policyButton.onclick=()=>editAgentPolicy().catch(e=>toast(e.message));$('dialog').querySelector('.dialog-actions').prepend(policyButton);
  shortcutButton.textContent = `ショートカット · ${displayShortcut(shortcutBindings().shortcuts) || "未設定"}`;
  shortcutButton.addEventListener("click", showShortcuts);
  $("dialog").querySelector(".dialog-actions").prepend(shortcutButton);
  $("reading-size").addEventListener("input", (e) => {
    state.ui.bodySize = Number(e.target.value);
    document.documentElement.style.setProperty(
      "--body-size",
      e.target.value + "px",
    );
    prefs();
  });
  $("reconnect").addEventListener("click", async () => {
    try {
      const r = await api("/connect", {});
      Object.assign(state, r);
      renderConnection();
      toast("接続しました");
      closeDialog();
    } catch (e) {
      toast(e.message);
    }
  });
  $("login")?.addEventListener("click", async () => {
    try {
      const r = await api("/login", {});
      closeDialog();
      if (r.authUrl) await openWeb(r.authUrl);
    } catch (e) {
      toast(e.message);
    }
  });
}
action("settings-button", settings);
async function showConnections(){
  $('app-menu').open=false;const c=await api('/connections');
  openDialog(dialogHeader('AIの接続')+'<section class="connection-section"><h3>Codex</h3><p>'+esc(state.account?.plan||state.account?.type||'未ログイン')+'</p><button id="connect-codex">再接続</button><button id="login-codex">ChatGPTでログイン</button></section><section class="connection-section"><h3>音声入力</h3><p class="small muted">録音を選択した接続先へ送ります。APIの利用枠を使用します。</p>'+c.voice.map(p=>'<label class="connection-key">'+esc(p.label)+'<input type="password" autocomplete="new-password" data-voice-key="'+p.id+'" placeholder="'+(p.configured?'登録済み · 変更する場合だけ入力':'APIキー')+'"><small>'+esc(p.model)+'</small></label>').join('')+'<div class="dialog-actions"><button id="connections-file">設定ファイルを開く</button><button id="connections-save" class="primary">保存</button></div></section>');
  $('connect-codex').onclick=async()=>{try{Object.assign(state,await api('/connect',{}));await api('/sync',{active:state.active});renderConnection();toast('接続しました');}catch(e){toast(e.message);}};
  $('login-codex').onclick=async()=>{try{const r=await api('/login',{});if(r.authUrl){closeDialog();await openWeb(r.authUrl);}}catch(e){toast(e.message);}};
  $('connections-save').onclick=async()=>{try{const data={};document.querySelectorAll('[data-voice-key]').forEach(e=>{if(e.value.trim())data[e.dataset.voiceKey]={apiKey:e.value.trim()};});await api('/connections',data);await showConnections();toast('保存しました');}catch(e){toast(e.message);}};
  $('connections-file').onclick=async()=>{try{const r=await api('/connections/file',{});closeDialog();await loadLocalPath(r.path);}catch(e){toast(e.message);}};
}
action('ai-connections',showConnections);
$('voice-provider').onchange=()=>{state.ui.voiceByModel||={};state.ui.voiceByModel[task()?.model||'default']=$('voice-provider').value;prefs();};
const voice=setupVoice({button:$('voice-input'),choice:()=>$('voice-provider').value,api,token,taskId:()=>state.active,settings:showConnections,toast,insert:(id,text)=>{
  if(state.active===id){const prompt=$('prompt');prompt.value+=(prompt.value?'\n':'')+text;stashDraft();expandComposer(true);prompt.focus();}
  else{state.drafts[id]=(state.drafts[id]||'')+(state.drafts[id]?'\n':'')+text;toast('録音を開始した案件の下書きへ入力しました');}prefs();
}});
action("menu-shortcuts", () => {
  $("app-menu").open = false;
  showShortcuts();
});
document.addEventListener("pointerdown", (event) => {
  if (!$("app-menu").contains(event.target)) $("app-menu").open = false;
});
function setAppearance(value){
  state.ui.theme=applyTheme(value.theme);state.ui.bodySize=value.bodySize;state.ui.appearanceVersion=3;
  document.documentElement.style.setProperty('--body-size',value.bodySize+'px');state.graph?.setTheme(state.ui.theme);
  if($('theme-preset')&&document.activeElement?.closest('#dialog')==null)refreshPalette();
}
let appearanceTimer;
function saveAppearance(){
  clearTimeout(appearanceTimer);appearanceTimer=setTimeout(()=>api('/appearance',{theme:state.ui.theme,bodySize:state.ui.bodySize}).catch(e=>toast('外観を保存できません: '+e.message)),160);
}
function refreshPalette(){
  const t=normalizeTheme(state.ui.theme);
  for(const [id,value] of Object.entries({'theme-preset':t.preset,'theme-mode':t.mode,'font-preset':t.font,'theme-brightness':t.brightness,'accent-color':t.accent,'glow-strength':t.glow*100,'palette-font':state.ui.bodySize||16}))if($(id))$(id).value=value;
  if($('globe-motion'))$('globe-motion').checked=t.motion;
  if($('palette-font-value'))$('palette-font-value').textContent=state.ui.bodySize||16;
  if($('brightness-value'))$('brightness-value').textContent=t.brightness;
}
function showPalette() {
  const theme = normalizeTheme(state.ui.theme);
  const swatches = [["Nebula", "#b88aff"], ["Aurora", "#40e9bb"], ["Solar", "#ffc857"], ["Rose", "#ff70a9"], ["Ocean", "#5bc5ff"], ["Ember", "#ff9665"]];
  openDialog(dialogHeader('外観')+`<div class="palette-field"><label for="theme-preset">プリセット</label><select id="theme-preset"><option value="custom">カスタム</option>${themePresets.map(p=>`<option value="${p.id}">${p.label} · ${p.mode==='light'?'ライト':'ダーク'}</option>`).join('')}</select></div>
    <div class="palette-field"><label for="theme-mode">モード</label><select id="theme-mode"><option value="dark">ダーク</option><option value="light">ライト</option></select></div>
    <div class="theme-reading-preview"><strong>Atlas Browser</strong><p>考えを整理して、次の一歩へ。</p><small>会話・原稿・ファイルを読みやすく</small></div>
    <div class="palette-field"><label for="font-preset">書体</label><select id="font-preset">${Object.entries(fontPresets).map(([id,p])=>`<option value="${id}">${p.label}</option>`).join('')}</select></div>
    <div class="palette-field"><label for="palette-font">文字サイズ</label><input id="palette-font" type="range" min="14" max="24"><output id="palette-font-value"></output></div>
    <div class="palette-field"><label for="theme-brightness">背景の明るさ</label><input id="theme-brightness" type="range" min="0" max="100"><output id="brightness-value"></output></div>
    <div class="color-swatches">${swatches.map(([name,color])=>`<button data-color="${color}" style="--swatch:${color}" aria-label="${name}" title="${name}"><i></i>${name}</button>`).join('')}</div>
    <div class="palette-field"><label for="accent-color">アクセント</label><input id="accent-color" type="color"></div>
    <div class="palette-field"><label for="glow-strength">輝き</label><input id="glow-strength" type="range" min="0" max="100"></div>
    <div class="palette-field"><label for="globe-motion">星のゆらぎ</label><input id="globe-motion" type="checkbox"></div>`);
  refreshPalette();
  const change = () => {setAppearance({theme:{...state.ui.theme,preset:'custom',mode:$('theme-mode').value,font:$('font-preset').value,brightness:Number($('theme-brightness').value),accent:$('accent-color').value,glow:Number($('glow-strength').value)/100,motion:$('globe-motion').checked},bodySize:Number($('palette-font').value)});refreshPalette();saveAppearance();};
  $('theme-preset').addEventListener('change',()=>{const preset=themePresets.find(p=>p.id===$('theme-preset').value);if(!preset)return;setAppearance({theme:{...preset,preset:preset.id,motion:state.ui.theme.motion},bodySize:preset.bodySize});refreshPalette();saveAppearance();});
  document.querySelectorAll("[data-color]").forEach(b => b.addEventListener("click", () => { $("accent-color").value = b.dataset.color; change(); }));
  ['theme-mode','font-preset','theme-brightness','palette-font','accent-color','glow-strength','globe-motion'].forEach(id=>$(id).addEventListener('input',change));
}
action("palette-button", showPalette);
action('menu-appearance',()=>{$('app-menu').open=false;showPalette();});
function renderUsageBadge() {
  $("usage-button").textContent = state.serviceDown?'利用量 · 未更新':usageSummary(state.usage);
}
async function showUsage() {
  openDialog(
    dialogHeader("利用量") +
      '<div id="usage-content">読み込み中…</div><div class="dialog-actions"><button id="refresh-usage">更新</button></div>',
  );
  const render = () => {
    if (!$("usage-content")) return;
    $("usage-content").innerHTML = usageHTML(state.usage, esc);
    $("claude-usage-connect")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const p = await api("/usage/claude/connect", {});
        state.usage.providers = [
          ...state.usage.providers.filter((v) => v.id !== "claude"),
          p,
        ];
        render();
      } catch (e) {
        toast(e.message);
        render();
      }
    });
  };
  const refresh = async () => {
    state.usage = await api("/usage");
    renderUsageBadge();
    render();
  };
  $("refresh-usage").addEventListener("click", () =>
    refresh().catch((e) => toast(e.message)),
  );
  if (state.usage) render();
  await refresh();
}
action("usage-button", showUsage);
let recoveryRefresh;
function showServiceDown(message='接続を復元中…') {
  state.serviceDown=true;$('connection').textContent=message;$('connection').classList.remove('ok');
  $('service-reconnect').hidden=false;
  renderUsageBadge();
}
function refreshRecoveredService() {
  if(recoveryRefresh)return recoveryRefresh;
  recoveryRefresh=(async()=>{
    // Keep the live DOM, WebViews and editors. Only resync server-owned state.
    stashDraft();
    if(!paneMode){await paneShell?.save();await saveDrafts();await savePreferences();await api('/tabs',{tabs:state.tabs,activeTab:state.activeTab});}
    const b=await api('/bootstrap');
    for(const key of ['tasks','connected','account','models','error','requests','sequence','serviceId','links','bookmarks','usage','desktop'])state[key]=b[key];
    state.serviceDown=false;closingWindow=false;$('service-reconnect').hidden=true;
    renderConnection();renderUsageBadge();renderSidebar();renderWorkTabs();renderActive();
    if(state.active)await loadHistory(state.active);
  })().finally(()=>{recoveryRefresh=null;});
  return recoveryRefresh;
}
action('service-reconnect',async()=>{
  if(native&&!paneMode)await host('app.reconnect');
  else await refreshRecoveredService();
});
async function poll() {
  while (true) {
    if(paneMode&&!paneVisible){await new Promise(r=>setTimeout(r,3000));continue;}
    try {
      const r = await api("/events?after=" + state.sequence + "&active=" + encodeURIComponent(state.active || "") + '&serviceId=' + encodeURIComponent(state.serviceId||''));
      if(state.serviceDown||(r.serviceId&&state.serviceId&&r.serviceId!==state.serviceId)){
        await refreshRecoveredService();continue;
      }
      if(r.serviceId)state.serviceId=r.serviceId;
      for (const e of r.events) {
        state.sequence = e.seq;
        handleEvent(e);
      }
      state.sequence = r.sequence;
      renderConnection();
    } catch (e) {
      showServiceDown();
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}
function handleEvent(e) {
  if(e.type==='defaultFolder'){state.defaultFolder=e.data.folder;renderDefaultFolder();return;}
  if(e.type==='bookmarks'){state.bookmarks=e.data;renderBookmarkState();renderBookmarkList();bookmarkFlyout?.refresh();return;}
  if(e.type==='noteSaved'){noteSaved(e.data);return;}
  if(e.type==='appearance'){setAppearance(e.data);return;}
  if (e.type === "desktopConnection") { state.desktop = e.data; if (task()?.external) scheduleConversation(); }
  if (e.type === "historyUpdated") {
    mergeHistory(e.data.threadId, e.data);
    if (state.active === e.data.threadId) { scheduleConversation(); markSeen(); }
  }
  if (e.type === "usage") {
    state.usage ||= { providers: [] };
    state.usage.providers = [
      e.data,
      ...state.usage.providers.filter((p) => p.id !== "codex"),
    ];
    renderUsageBadge();
  }

  if (e.type === "connection") {
    Object.assign(state, e.data);
    renderConnection();
    if (e.data.error) toast(e.data.error);
  }
  if (e.type === "task") {
    upsert(e.data);
    renderSidebar();
    renderWorkTabs();
    if (state.active === e.data.id) {
      $('reconnect-task').hidden=!(['disconnected','unknown','failed'].includes(e.data.state)||e.data.syncError);
      $("task-title").textContent = e.data.title;
      if (e.data.state === "queued") {
        $("composer-note").innerHTML =
          '送信予約中です。前提のAI応答完了後に開始します。 <button id="cancel-queue-button">予約を取り消す</button>';
      } else if (e.data.state === "running") {
        $("composer-note").textContent = "Ctrl + Enter で送信";
      }
      $("task-status").innerHTML =
        `<i class="dot ${esc(e.data.state)}"></i>${esc(status(e.data))}`;
      $("interrupt").hidden = !e.data.activeTurn || e.data.external;
      $("send").disabled =
        state.sending.has(e.data.id) || (!e.data.external && (!!e.data.activeTurn || e.data.state === "starting")) || e.data.state === "queued";
      $("send").textContent = e.data.external && e.data.activeTurn ? "追加で伝える ↗" : "送信 ↗";
      $("composer").hidden = false;
      $("prompt").disabled = false;
      $("store-task").hidden = !hasConversation(e.data);
      renderPlan();
      renderAttachments();
      if (["completed", "failed", "interrupted"].includes(e.data.state))
        markSeen();
    }
    if (state.mode === "globe") scheduleGraph();
  }
  if (e.type === "requests") {
    state.requests = e.data;
    renderRequests();
  }
  if (e.type === "links") {
    state.links = e.data;
    if (state.mode === "globe") scheduleGraph();
    renderActive();
  }
  if (e.type === "item" || e.type === "delta") {
    const p = e.data;
    let h = state.histories.get(p.threadId);
    if (!h) {
      h = { turns: [], live: new Map() };
      state.histories.set(p.threadId, h);
    }
    const turnId = p.turnId || state.tasks.find(t => t.id === p.threadId)?.activeTurn;
    if (e.type === "item") h.live.set(p.item.id, { ...p.item, turnId });
    else {
      const item = h.live.get(p.itemId) || {
        id: p.itemId,
        type: "agentMessage",
        text: "",
      };
      item.text += p.delta;
      item.turnId = turnId;
      h.live.set(p.itemId, item);
    }
    if (state.active === p.threadId) scheduleConversation();
  }
  if (e.type === "turnCompleted") {
    loadHistory(e.data.threadId).catch((e) => toast(e.message));
    if (state.active === e.data.threadId) {
      loadFiles(e.data.threadId).catch(() => {});
      renderActive();
    }
  }
}
async function boot() {
  try {
    const b = await api("/bootstrap");
    Object.assign(state, b);
    state.ui = b.ui || {};
    if(!paneMode)try{const cached=JSON.parse(localStorage.getItem(draftCacheKey)||'null');if(cached&&typeof cached==='object'&&!Array.isArray(cached))state.ui.drafts={...state.ui.drafts,...Object.fromEntries(Object.entries(cached).filter(([,v])=>typeof v==='string'))};}catch{}
    document.body.classList.toggle("sidebar-hidden",!!state.ui.sidebarHidden);renderDefaultFolder();
    state.ui.shortcuts = normalizeShortcutBindings(state.ui.shortcuts);
    syncShortcutSettings();
    if (state.ui.appearanceVersion !== 3) { state.ui.bodySize = Math.max(14, (state.ui.bodySize || 19) - 2); state.ui.appearanceVersion = 3; }
    state.ui.theme = applyTheme(state.ui.theme);
    state.filter = ["working", "attention", "stored"].includes(state.ui.taskFilter) ? state.ui.taskFilter : "attention";
    $("task-grouping").value = state.ui.grouping || "time";
    state.open = (state.ui.open || []).filter((id) =>
      state.tasks.some((t) => t.id === id),
    );
    state.viewTabs = (state.ui.viewTabs || []).filter((v) =>
      v.kind === "web"
        ? (b.tabs || []).some((t) => t.id === v.id)
        : v.kind === 'localfile' || state.tasks.some((t) => t.id === (v.taskId || v.id)),
    );
    const restoreView = state.ui.activeView;
    if(!paneMode)Object.assign(editorCache.drafts,state.ui.drafts || {});
    state.drafts = editorCache.drafts;
    state.active = state.tasks.some((t) => t.id === state.ui.active)
      ? state.ui.active
      : null;
    state.layout = state.ui.layout || "split";
    state.tabs = b.tabs || [];
    state.activeTab = b.activeTab;
    state.browserSplit = false;
    state.browserSecondary = state.ui.browserSecondary || null;
    document.documentElement.style.setProperty(
      "--body-size",
      (state.ui.bodySize || 17) + "px",
    );
    renderConnection();
    renderUsageBadge();
    renderSidebar();
    renderActive();
    renderWorkTabs();
    setLayout(state.layout);
    renderBrowserTabs();
    poll();
    if(paneMode){state.active=null;state.open=[];state.viewTabs=[];state.tabs=[];state.activeTab=null;state.activeView=null;renderWorkTabs();paneShell.ready();return;}
    const restoredPane = state.ui.rightPane;
    $('workspace-deck').style.setProperty('--pane-ratio',(state.ui.paneRatio || 50)+'%');
    if (state.active) await selectTask(state.active);
    if (restoreView && state.viewTabs.some((v) => v.key === restoreView))
      await selectView(restoreView);
    await paneShell.restore(state.ui.paneWorkspace,restoredPane&&state.viewTabs.some(v=>v.key===restoredPane.key)?restoredPane:null);
    postHost('window.ready');
  } catch (e) {
    toast(e.message);
    $("connection").textContent = "起動エラー";
  }
}

// File editor: each task keeps its unsaved editor state while switching views.
function fileState(id = state.active) {
  return (state.files[id] ||= {
    dir: "",
    entries: [],
    editor: null,
    editors: {},
  });
}
async function loadFiles(id, dir) {
  if (!id) return;
  const f = fileState(id);
  if (!f.loadedDrafts) {
    f.loadedDrafts = true;
    const saved = await api("/tasks/" + id + "/drafts");
    if (saved.drafts.length && !f.editor) {
      for (const draft of saved.drafts) (f.editors ||= {})[draft.path] = draft;
      f.editor = saved.drafts.sort((a, b) => b.at - a.at)[0];
      f.editor.summary = "下書きを復元";
    }
  }
  if (dir !== undefined) f.dir = dir;
  const r = await api(
    "/tasks/" + id + "/files?path=" + encodeURIComponent(f.dir),
  );
  f.entries = r.entries;
  if (state.active === id) {
    renderFiles();
    renderEditor();
  }
}
function renderFiles() {
  if (!task()) {
    $("file-list").innerHTML = '<div class="empty">案件を選択</div>';
    return;
  }
  const f = fileState();
  $("file-breadcrumb").textContent = f.dir || "案件フォルダ";
  $("file-list").classList.toggle("compact", !!f.editor);
  $("file-list").innerHTML = f.entries.length
    ? f.entries
        .map(
          (e) =>
            `<button class="file-row" data-file="${esc(e.path)}" data-directory="${e.directory}"><span class="file-icon">${e.directory ? "▱" : "◈"}</span><span>${esc(e.name)}</span><small>${e.directory ? "開く" : e.name.split(".").pop().toUpperCase()}</small></button>`,
        )
        .join("")
    : '<div class="empty small">ファイルがありません</div>';
  $("artifact-close").hidden = !f.editor;
}
$("file-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-file]");
  if (!b) return;
  (b.dataset.directory === "true"
    ? loadFiles(state.active, b.dataset.file)
    : openFile(b.dataset.file)
  ).catch((e) => toast(e.message));
});
action("file-up", () =>
  loadFiles(state.active, fileState().dir.split("/").slice(0, -1).join("/")),
);
action("file-refresh", () => loadFiles(state.active));
async function openFile(relative, encoding) {
  const id = state.active;
  if (!id) return;
  const fs = fileState(id);
  const epoch = viewEpoch;
  fs.editors ||= {};
  if (fs.editor) fs.editors[fs.editor.path] = fs.editor;
  const show = () => {
    fs.editors[relative] = fs.editor;
    if (state.active === id && epoch === viewEpoch) {
      focusView(
        addView("file", id + ":" + relative, { taskId: id, path: relative }),
      );
      renderFiles();
      renderEditor();
    }
  };
  if (fs.editors[relative] && !encoding) {
    fs.editor = fs.editors[relative];
    show();
    return;
  }
  const ext = relative.split(".").pop().toLowerCase();
  if (
    [
      "html",
      "htm",
      "pdf",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "svg",
      "mp4",
      "m4v",
      "mov",
      "webm",
      "mp3",
      "wav",
      "m4a",
      "ogg",
      "flac",
    ].includes(ext)
  ) {
    const p = await api("/tasks/" + id + "/preview", { path: relative });
    if(p.revealPath)return revealLocal(p.revealPath);
    fs.editor = { path: relative, preview: p.url, ext, mode: "read" };
    show();
    return;
  }
  try {
    const f = await api(
      "/tasks/" +
        id +
        "/file?path=" +
        encodeURIComponent(relative) +
        (encoding ? "&encoding=" + encoding : ""),
    );
    if(f.revealPath)return revealLocal(f.revealPath);
    fs.editor = { ...f, original: f.text, mode: "read", dirty: false, ext };
    show();
  } catch (e) {
    if (e.message.includes("Shift-JIS")) {
      openDialog(
        dialogHeader("文字コードを選ぶ") +
          "<p>" +
          esc(relative) +
          '</p><p class="small muted">UTF-8として読み込めませんでした。現在のファイルは変更していません。</p><button id="open-sjis" class="primary">Shift-JISで開く</button>',
      );
      $("open-sjis").addEventListener("click", () => {
        closeDialog();
        openFile(relative, "shift_jis").catch((e) => toast(e.message));
      });
    } else if(/ファイルを選|編集できるテキストは2MB|バイナリファイルは文章/.test(e.message))return revealLocal(localPath(relative));
    else throw e;
  }
}
async function openLocalFile() {
  const {folder}=await api('/notes/folder');
  const selected = await host("chooseFile", { path: folder || state.defaultFolder || "C:\\dev" });
  if (!selected) return;
  await loadLocalPath(selected);
}
async function chooseNoteFolder(){
  const current=await api('/notes/folder');
  const folder=await host('chooseFolder',{path:current.folder||task()?.cwd||state.defaultFolder||'C:\\dev'});
  if(!folder)return null;return (await api('/notes/folder',{folder})).folder;
}
action('note-folder',async()=>{$('app-menu').open=false;await chooseNoteFolder();});
async function newNote(){
  if(newNote.pending)return;newNote.pending=true;
  try{
    if(!(await api('/notes/folder')).folder&&!await chooseNoteFolder())return;
    const note=await api('/notes',{});state.localEditors[note.path]=note;
    await loadLocalPath(note.path);document.querySelector('.work-tab.active')?.scrollIntoView({block:'nearest',inline:'nearest'});$('text-editor')?.focus();
    await saveDrafts();prefs();
  }finally{newNote.pending=false;}
}
action('new-note',newNote);
function noteSaved({source,file}){
  const oldKey='localfile:'+source,newKey='localfile:'+file.path,editor=state.localEditors[source];
  if(editor){const text=editor.text;Object.assign(editor,file,{text,original:file.text,dirty:text!==file.text,mode:editor.mode||'edit'});delete state.localEditors[source];state.localEditors[file.path]=editor;}
  for(const view of state.viewTabs)if(view.key===oldKey)Object.assign(view,{key:newKey,id:file.path,path:file.path});
  if(state.activeView===oldKey)state.activeView=newKey;
  renderWorkTabs();renderEditor();prefs();
}
async function saveNewNote(e){
  const folder=e.path.replace(/[\\/][^\\/]+$/,''),title=(e.text.trim().split(/\r?\n/)[0]||'メモ').replace(/^[#* >-]+/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().slice(0,55)||'メモ';
  const name=title+'-'+Date.now().toString(36)+'.md',source=e.path;
  const file=await api('/notes/save',{source,folder,name,text:e.text,version:e.version,encoding:e.encoding});noteSaved({source,file});toast('保存しました');
}
async function loadLocalPath(selected, encoding) {
  const show = (editor) => {
    if(editor.path&&editor.path!==selected){
      const oldKey='localfile:'+selected,newKey='localfile:'+editor.path;
      for(const view of state.viewTabs)if(view.key===oldKey)Object.assign(view,{key:newKey,id:editor.path,path:editor.path});
      delete state.localEditors[selected];selected=editor.path;
    }
    state.localEditors[selected] = editor;
    const key = 'localfile:' + selected;
    if(!state.viewTabs.some(v=>v.key===key))state.viewTabs.push({key,kind:'localfile',id:selected,path:selected});
    focusView(key);renderFiles();renderEditor();
  };
  if(state.localEditors[selected]&&!encoding){show(state.localEditors[selected]);return;}
  try {
    const f = await api('/local/open',{path:selected,encoding});
    if(f.revealPath)return revealLocal(f.revealPath);
    const draft = f.preview ? null : await api('/local/draft?path='+encodeURIComponent(selected));
    show(draft ? {...draft,path:f.path,local:true,dirty:true,untitled:f.untitled} : {...f,original:f.text,mode:f.untitled?'edit':'read',dirty:false,local:true});
  } catch (e) {
    if (e.message.includes("Shift-JIS")) {
      openDialog(
        dialogHeader("文字コードを選ぶ") +
          "<p>" + esc(selected) + '</p><p class="small muted">UTF-8として読み込めませんでした。現在のファイルは変更していません。</p><button id="open-local-sjis" class="primary">Shift-JISで開く</button>',
      );
      $("open-local-sjis").addEventListener("click", () => {
        closeDialog();
        loadLocalPath(selected,'shift_jis').catch(x=>toast(x.message));
      });
    } else if(/ファイルを選|編集できるテキストは2MB|バイナリファイルは文章/.test(e.message))return revealLocal(selected);
    else throw e;
  }
}
action("open-local-file", () => openLocalFile());
function csvData(e) {
  const p = window.Papa.parse(e.text, { skipEmptyLines: false });
  // Papa already falls back to commas when sparse chapter rows prevent detection.
  p.errors = p.errors.filter(error => error.code !== 'UndetectableDelimiter');
  return p;
}
let draftTimer = null;
async function saveDrafts() {
  const promises = Object.entries(state.files).flatMap(([id, f]) => {
    const editors = { ...f.editors };
    if (f.editor) editors[f.editor.path] = f.editor;
    return Object.values(editors)
      .filter((e) => !e.preview && e.dirty)
      .map((e) =>
        api(
          "/tasks/" + id + "/draft",
          e.dirty
            ? Object.fromEntries(
                [
                  "path",
                  "text",
                  "original",
                  "version",
                  "encoding",
                  "newline",
                  "bom",
                  "bytes",
                  "ext",
                  "mode",
                ].map((k) => [k, e[k]]),
              )
            : { path: e.path, clear: true },
        ),
      );
  });
  for(const e of Object.values(state.localEditors))if(e.dirty&&!e.preview)promises.push(api('/local/draft',e));
  await Promise.all(promises);
}
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(
    () =>
      saveDrafts().catch(draftSaveFailed),
    700,
  );
}
async function editAgentPolicy(){
  const p=await api('/agent-policy');
  openDialog(dialogHeader('実行方針')+'<textarea id="agent-policy" aria-label="AIの実行方針" rows="13" style="width:100%"></textarea><div class="dialog-actions"><button id="policy-reset">標準に戻す</button><button id="policy-save" class="primary">保存</button></div>');
  $('agent-policy').value=p.instructions;
  $('policy-reset').onclick=()=>{$('agent-policy').value=p.defaults;};
  $('policy-save').onclick=async()=>{try{await api('/agent-policy',{instructions:$('agent-policy').value});closeDialog();toast('次の指示から反映します');}catch(e){toast(e.message);}};
}
function currentEditor() {
  const activeLocal = state.viewTabs.find((v) => v.key === state.activeView && v.kind === "localfile");
  const view=state.viewTabs.find(v=>v.key===state.activeView);
  return activeLocal
    ? state.localEditors[activeLocal.id]
    : state.active
      ? (view?.kind==='file'?fileState().editors[view.path]||fileState().editor:fileState().editor)
      : null;
}
function renderEditor() {
  const e=currentEditor();
  const key = e ? (e.local ? "local:" : state.active + ":") + e.path : "";
  const signature=e ? key+':'+e.mode+':'+(e.version||e.preview)+':'+e.dirty+':'+(e.revision||0)+':'+(e.summary||'') : '';
  if(e && renderEditor.signature===signature)return;
  renderEditor.signature=signature;
  if (e && !e.local) (fileState().editors ||= {})[e.path] = e;
  $("editor").dataset.key = key;
  $("editor").hidden = !e;
  $("artifact-close").hidden = !e;
  $('reveal-file').hidden=!native||!e;
  if (!e) return;
  $("editor-name").textContent =
    e.path.split(/[\\/]/).at(-1) + (e.dirty ? " · 未保存" : "");
  $("editor-meta").textContent = e.preview
    ? "ローカルの成果物プレビュー"
    : e.local
      ? `${e.encoding} · ${e.newline} · ${(e.bytes / 1024).toFixed(1)} KB · ローカルファイル`
    : `${e.encoding} · ${e.newline} · ${(e.bytes / 1024).toFixed(1)} KB`;
  $("save-file").hidden = !!e.preview;
  $("save-file").disabled = !e.dirty&&!e.untitled;
  ["read", "edit", "source"].forEach((m) => {
    $(m + "-mode").setAttribute("aria-pressed", e.mode === m);
    $(m + "-mode").hidden = !!e.preview && m !== "read";
  });
  $("edit-summary").textContent = e.summary || "";
  if (e.preview) {
    if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(e.ext))
      $("editor-content").innerHTML =
        `<img class="media-preview" src="${esc(e.preview)}" alt="${esc(e.path)}">`;
    else if (["mp4", "m4v", "mov", "webm", "mp3", "wav", "ogg", "m4a", "flac"].includes(e.ext))
      $("editor-content").innerHTML =
        `<${["mp3", "wav","ogg","m4a","flac"].includes(e.ext) ? "audio" : "video"} class="media-preview" src="${esc(e.preview)}" preload="metadata" controls></${["mp3", "wav","ogg","m4a","flac"].includes(e.ext) ? "audio" : "video"}>`;
    else
      $("editor-content").innerHTML =
        `<iframe class="preview-frame" src="${esc(e.preview)}" sandbox="allow-scripts allow-forms allow-downloads" title="${esc(e.path)}"></iframe>`;
    return;
  }
  if (e.ext === "csv" && e.mode !== "source") {
    const parsed = csvData(e);
    e.csv = parsed.data;
    if (parsed.errors.length) {
      $("editor-content").innerHTML =
        '<p class="csv-error">CSVの構造に問題があります。「元データ」から確認してください。' +
        esc(parsed.errors.map((x) => x.message).join(" / ")) +
        "</p>";
      return;
    }
    const rows = e.csv,
      hasHeader =
        rows.length > 1 &&
        rows[0].every((c) => String(c).length < 45) &&
        rows[0].some((c) =>
          /話者|セリフ|台詞|speaker|text|scene|id|本文|内容|名前/i.test(c),
        );
    e.hasHeader = hasHeader;
    const start = hasHeader ? 1 : 0;
    const count = Math.min(rows.length, start + 250);
    $("editor-content").innerHTML =
      '<div class="csv-rows">' +
      rows
        .slice(start, count)
        .map((row, n) => {
          const index = n + start;
          return `<div class="csv-row"><span class="csv-row-number">${index + 1}</span><div class="csv-fields">${row.map((cell, col) => `<div class="csv-field"><label>${esc(hasHeader ? rows[0][col] || "列 " + (col + 1) : "列 " + (col + 1))}</label>${e.mode === "edit" ? `<textarea data-csv-row="${index}" data-csv-col="${col}" rows="${Math.min(8, Math.max(2, Math.ceil(String(cell).length / 40)))}">${esc(cell)}</textarea>` : `<div class="csv-text">${esc(cell)}</div>`}</div>`).join("")}</div></div>`;
        })
        .join("") +
      "</div>" +
      (rows.length > count
        ? '<p class="small muted">最初の250行を表示しています。全文は元データで確認できます。</p>'
        : "");
    return;
  }
  if (e.mode === "read")
    $("editor-content").innerHTML =
      ['md','markdown'].includes(e.ext)
        ? '<div class="reading">' + markdown(e.text) + "</div>"
        : '<div class="reading" style="white-space:pre-wrap">' +
          esc(e.text) +
          "</div>";
  else
    $("editor-content").innerHTML =
      `<textarea id="text-editor" class="${e.mode === "source" ? "source" : ""}" aria-label="${esc(e.path)}を編集">${esc(e.text)}</textarea>`;
}
$("editor-content").addEventListener("input", (e) => {
  const f = currentEditor();
  if (!f) return;
  if (e.target.id === "text-editor") f.text = e.target.value;
  else if (e.target.dataset.csvRow !== undefined) {
    f.csv[Number(e.target.dataset.csvRow)][Number(e.target.dataset.csvCol)] =
      e.target.value;
    f.text = window.Papa.unparse(f.csv, {
      newline: f.newline === "CRLF" ? "\r\n" : "\n",
      delimiter: csvData(f).meta.delimiter || ",",
    });
  } else return;
  f.dirty = f.text !== f.original;
  f.revision=(f.revision||0)+1;
  renderEditor.signature=(f.local?'local:':state.active+':')+f.path+':'+f.mode+':'+(f.version||f.preview)+':'+f.dirty+':'+f.revision+':'+(f.summary||'');
  $("editor-name").textContent =
    f.path.split(/[\\/]/).at(-1) + (f.dirty ? " · 未保存" : "");
  $("save-file").disabled = !f.dirty&&!f.untitled;
  scheduleDraft();
});
for (const m of ["read", "edit", "source"])
  action(m + "-mode", () => {
    const e = currentEditor();
    if (e) {
      e.mode = m;
      renderEditor();
    }
  });
action("save-file", async () => {
  const id = state.active,
    e = currentEditor();
  if(e?.untitled){await saveNewNote(e);return;}
  if (!e?.dirty) return;
  $("save-file").disabled = true;
  try {
    const saved = await api(e.local ? "/local/file" : "/tasks/" + id + "/file", {
      path: e.path,
      text: e.text,
      version: e.version,
      encoding: e.encoding,
    });
    Object.assign(e, saved, {
      original: saved.text,
      dirty: false,
      summary: saved.changed
        ? (e.local?'保存しました':'保存しました。次の指示に編集差分を添付します。')
        : "変更はありません。",
    });
    if (!e.local) await api("/tasks/" + id + "/draft", { path: e.path, clear: true });
    else await api('/local/draft',{path:e.path,clear:true});
    if (state.active === id) renderEditor();
    toast(e.local?'保存しました':'保存しました。編集差分をAIに渡せます。');
  } catch (err) {
    e.summary = err.message;
    if (state.active === id) renderEditor();
    if (err.status === 409) {
      openDialog(
        dialogHeader("外部の変更を検知しました") +
          '<p class="small">あなたの編集内容は画面に残っています。現在のファイルとの差を確認し、必要なら内容を統合してください。</p><button id="show-current-file">現在のファイルを比較表示</button><div id="conflict-view"></div>',
      );
      $("show-current-file").addEventListener("click", async () => {
        try {
          const current = await api(
            (e.local?'/local/file?path=':'/tasks/'+id+'/file?path=') +
              encodeURIComponent(e.path) +
              "&encoding=" +
              e.encoding,
          );
          $("conflict-view").innerHTML =
            '<p class="small muted">ディスク上の現在の内容</p><textarea id="current-conflict" readonly rows="12" style="width:100%">' +
            esc(current.text) +
            '</textarea><p class="small muted">必要な内容を上からコピーし、編集画面で統合できます。</p><button id="ack-conflict">現在の版を保存の比較対象にする</button>';
          $("ack-conflict").addEventListener("click", () => {
            e.version = current.version;
            e.original = current.text;
            e.dirty = e.text !== e.original;
            closeDialog();
            renderEditor();
            toast("次の保存は、今確認した版からの編集として扱います");
          });
        } catch (x) {
          toast(x.message);
        }
      });
    } else toast(err.message);
  }
});
action("artifact-close", async () => {
  await saveDrafts();
  if(paneMode)paneShell.shortcut('close-tab');
  else await closeView(state.activeView);
});

// WebView2 owns ordinary browsing; web pages never receive the app's privileged bridge.
action("suspend-tabs", async () => {
  let count = 0;
  for (const t of state.tabs) {
    if (t.id !== state.activeTab && t.loaded) {
      await host("browser.close", { id: t.id });
      t.loaded = false;
      count++;
    }
  }
  state.browserSplit = false;
  state.ui.browserSplit = false;
  renderBrowserTabs();
  syncBrowserLayout();
  prefs();
  toast(count + " 個のタブを休止しました。選ぶと再読込します。");
});
function persistTabs() {
  if(closingWindow)return;
  if(paneMode){paneShell?.persist();return;}
  clearTimeout(persistTabs.timer);
  persistTabs.timer = setTimeout(
    () =>
      api("/tabs", { tabs: state.tabs, activeTab: state.activeTab }).catch(
        () => {},
      ),
    300,
  );
}
function renderBookmarkState(){
  const page=state.tabs.find(t=>t.id===state.activeTab),saved=flatBookmarks(state.bookmarks).find(b=>b.url===page?.url);
  $('bookmark-page').textContent=saved?bookmarkMark(saved.mark).symbol:'☆';$('bookmark-page').setAttribute('aria-pressed',String(!!saved));
  $('bookmark-page').title=saved?'ブックマークを編集（Ctrl+D）':'ブックマーク（Ctrl+D）';
}
async function saveBookmark(data){state.bookmarks=await api('/bookmarks',data);renderBookmarkState();renderBookmarkList();bookmarkFlyout?.refresh();}
async function bookmarkPage(mark){
  const selected=typeof mark==='string'?bookmarkMark(mark).id:null;
  const page=state.activeView?.startsWith('web:')&&state.tabs.find(t=>t.id===state.activeTab);
  if(!page){const t=task();if(!t){toast('Webページか案件を開いてください');return;}await saveBookmark({kind:'task',taskId:t.id,title:t.title,mark:selected||'star',parentId:null});toast(bookmarkMark(selected).symbol+' に登録しました');return;}
  const existing=(state.bookmarks||[]).find(b=>b.url===page.url);
  if(existing&&!selected){editBookmarkDialog(existing);return;}
  await saveBookmark({id:existing?.id,url:page.url,title:existing?.title||page.title,mark:selected||'star',parentId:null});toast(bookmarkMark(selected).symbol+' に登録しました');
}
let bookmarkFilter='all';
function renderBookmarkList(){
  if(!$('bookmark-results'))return;
  const query=$('bookmark-search').value.trim().toLocaleLowerCase();
  const found=flatBookmarks(state.bookmarks).filter(b=>(bookmarkFilter==='all'||bookmarkMark(b.mark).id===bookmarkFilter)&&(!query||(b.title+' '+(b.url||'')).toLocaleLowerCase().includes(query)));
  for(const button of document.querySelectorAll('[data-bookmark-filter]'))button.setAttribute('aria-pressed',String(button.dataset.bookmarkFilter===bookmarkFilter));
  $('bookmark-results').innerHTML=found.length?found.map(b=>`<div class="bookmark-row"><button class="bookmark-open" data-bookmark-open="${esc(b.id)}" title="${esc(b.url||b.title)}"><strong>${bookmarkMark(b.mark).symbol} ${esc(b.title)}</strong><span>${esc(b.kind==='task'?'AIとの会話':b.url)}</span></button><button data-bookmark-edit="${esc(b.id)}" aria-label="${esc(b.title)}を編集">編集</button></div>`).join(''):`<div class="empty">${query?'見つかりませんでした':'まだ項目がありません'}</div>`;
}
async function showBookmarks(mark){
  $('app-menu').open=false;bookmarkFilter=bookmarkMarks.some(m=>m.id===mark)?mark:'all';state.bookmarks=await api('/bookmarks');
  openDialog(dialogHeader('ブックマーク')+'<div class="bookmark-toolbar"><button data-bookmark-filter="all">すべて</button>'+bookmarkMarks.map(m=>'<button data-bookmark-filter="'+m.id+'" aria-label="'+m.name+'">'+m.symbol+'</button>').join('')+'<span class="spacer"></span><button id="bookmark-chrome">Chromeと同期</button></div><input id="bookmark-search" type="search" placeholder="名前・URLで検索" aria-label="ブックマークを検索" style="width:100%;margin:10px 0"><div id="bookmark-results"></div>');
  $('bookmark-chrome').onclick=async()=>{const r=await api('/bookmarks/chrome',{enabled:true});state.bookmarks=await api('/bookmarks');renderBookmarkList();bookmarkFlyout.refresh();toast(r.profiles?flatBookmarks(state.bookmarks).length+' 件を同期しました':'このPCにChromeのブックマークがありません');};
  $('bookmark-search').oninput=renderBookmarkList;
  for(const b of document.querySelectorAll('[data-bookmark-filter]'))b.onclick=()=>{bookmarkFilter=b.dataset.bookmarkFilter;renderBookmarkList();};
  $('bookmark-results').onclick=event=>{const open=event.target.closest('[data-bookmark-open]'),edit=event.target.closest('[data-bookmark-edit]'),id=open?.dataset.bookmarkOpen||edit?.dataset.bookmarkEdit,b=(state.bookmarks||[]).find(b=>b.id===id);if(!b)return;if(edit)editBookmarkDialog(b);else{closeDialog();openBookmark(b).catch(e=>toast(e.message));}};
  renderBookmarkList();$('bookmark-search').focus();
}
function editBookmarkDialog(bookmark){
  openDialog(dialogHeader('ブックマークを編集')+`<div class="bookmark-edit"><label for="bookmark-title">名前</label><input id="bookmark-title" value="${esc(bookmark.title)}">${bookmark.kind==='task'?'':`<label for="bookmark-url">URL</label><input id="bookmark-url" value="${esc(bookmark.url)}">`}<label for="bookmark-mark">マーク</label><select id="bookmark-mark">${bookmarkMarks.map(m=>`<option value="${m.id}" ${bookmarkMark(bookmark.mark).id===m.id?'selected':''}>${m.symbol} ${m.name}</option>`).join('')}</select></div><p id="bookmark-error" class="request-error" role="alert"></p><div class="dialog-actions"><button id="bookmark-remove">削除</button><span class="spacer"></span><button id="bookmark-cancel">キャンセル</button><button id="bookmark-save" class="primary">保存</button></div>`);
  const submit=async remove=>{try{const mark=$('bookmark-mark').value;await saveBookmark(remove?{id:bookmark.id,remove:true}:{id:bookmark.id,kind:bookmark.kind,taskId:bookmark.taskId,title:$('bookmark-title').value,url:$('bookmark-url')?.value,mark,parentId:null});await showBookmarks(remove?bookmarkFilter:mark);}catch(e){$('bookmark-error').textContent=e.message;}};
  $('bookmark-save').onclick=()=>submit(false);$('bookmark-remove').onclick=()=>submit(true);$('bookmark-cancel').onclick=()=>showBookmarks().catch(e=>toast(e.message));
}
action('bookmark-page',bookmarkPage);action('show-bookmarks',showBookmarks);action('menu-bookmarks',showBookmarks);
async function openBookmark(b){if(b.kind==='task'){await selectTask(b.taskId);return;}await openWeb(b.url);}
const bookmarkFlyout=setupBookmarkFlyout({state,api,open:openBookmark,manage:showBookmarks,layout:syncBrowserLayout,esc,error:toast,saveCurrent:bookmarkPage});
$('new-note').querySelector('span').innerHTML=svgIcon('note');$('open-web-home').querySelector('span').innerHTML=tabIcon({kind:'web'},null,esc);$('open-files-home').querySelector('span').innerHTML=svgIcon('folder');
const newTaskShortcut=document.createElement('button');newTaskShortcut.id='new-task-tab';newTaskShortcut.title='新しい案件';newTaskShortcut.innerHTML=tabIcon({kind:'task'},null,esc)+'<span class="rail-label">新しい案件</span>';newTaskShortcut.onclick=()=>newTask().catch(e=>toast(e.message));document.querySelector('.tab-actions').append(newTaskShortcut);
const pageTranslation=setupPageTranslation({host,api,state,save:prefs,toast,openWeb});
function normalizeURL(value) {
  value = value.trim();
  if (/^https?:\/\//i.test(value)) return new URL(value).href;
  if (
    /^[\w.-]+\.[a-z]{2,}([/:]|$)/i.test(value) ||
    /^localhost[:/]/i.test(value) ||
    /^127\.0\.0\.1[:/]/.test(value)
  )
    return (
      "http" +
      (value.startsWith("localhost") || value.startsWith("127.") ? "" : "s") +
      "://" +
      value
    );
  return "https://www.google.com/search?q=" + encodeURIComponent(value);
}
async function openWeb(url, newTab = true) {
  url = normalizeURL(url);
  setMode("work");
  viewEpoch++;
  stashDraft();
  let id = newTab ? null : state.activeTab;
  if (!id) {
    id = "web-" + crypto.randomUUID();
    state.tabs.push({ id, url, title: new URL(url).hostname });
  } else {
    const t = state.tabs.find((t) => t.id === id);
    if (t) t.url = url;
  }
  state.activeTab = id;
  focusView(addView("web", id));
  renderBrowserTabs();
  persistTabs();
  if (native) {
    await host("browser.open", { id, url });
    const opened = state.tabs.find((t) => t.id === id);
    if (opened) opened.loaded = true;
    await ensureSecondary();
    syncBrowserLayout();
  } else {
    $("browser-slot").innerHTML =
      '<div class="fallback-note"><p>Windowsアプリで表示</p><p>' +
      esc(url) +
      "</p></div>";
  }
}
function renderBrowserTabs() {
  pageTranslation.render();
  renderBookmarkState();
  renderWorkTabs();
  const t = state.tabs.find((t) => t.id === state.activeTab);
  if (document.activeElement !== $("address"))
    $("address").value = t?.url || "";
  $("browser-back").disabled = !t?.back;
  $("browser-forward").disabled = !t?.forward;
  const secondary = $("browser-secondary");
  const candidates = state.tabs.filter((x) => x.id !== state.activeTab);
  if (!candidates.some((x) => x.id === state.browserSecondary))
    state.browserSecondary = candidates[0]?.id || null;
  secondary.innerHTML = candidates.map((x) => `<option value="${esc(x.id)}">${esc(x.title || x.url || "Web")}</option>`).join("");
  secondary.hidden = !state.browserSplit || candidates.length === 0;
  if (state.browserSecondary) secondary.value = state.browserSecondary;
  $("browser-split").hidden = false;
  $("browser-split").setAttribute("aria-pressed", state.browserSplit && candidates.length > 0);
  $("browser-split").textContent = state.browserSplit ? "▥ 1画面" : "▥ 分割";
}
$("address-form").addEventListener("submit", (e) => {
  e.preventDefault();
  openWeb($("address").value, false).catch((e) => toast(e.message));
});
async function ensureSecondary() {
  if (!native || !state.browserSplit) return;
  renderBrowserTabs();
  const secondary = state.tabs.find((t) => t.id === state.browserSecondary && t.id !== state.activeTab);
  if (secondary && !secondary.loaded) {
    // Share pending loads across tab changes and layout updates.
    if (!secondary.loading) secondary.loading = host("browser.open", { id: secondary.id, url: secondary.url });
    try { await secondary.loading; secondary.loaded = true; } finally { delete secondary.loading; }
  }
}
async function toggleBrowserSplit() {
  if (!state.browserSplit && state.tabs.length < 2) {
    const original = state.activeView;
    await openWeb("https://www.google.com");
    if (original) await selectView(original);
  }
  state.browserSplit = !state.browserSplit;
  renderBrowserTabs();
  state.ui.browserSplit = state.browserSplit;
  state.ui.browserSecondary = state.browserSecondary;
  await ensureSecondary();
  prefs();
  syncBrowserLayout();
}
$("browser-split").addEventListener("click", () => toggleBrowserSplit().catch((e) => toast(e.message)));
$("browser-secondary").addEventListener("change", (e) => {
  state.browserSecondary = e.target.value || null;
  state.ui.browserSecondary = state.browserSecondary;
  const secondary = state.tabs.find((t) => t.id === state.browserSecondary);
  Promise.resolve(secondary && native && !secondary.loaded ? host("browser.open", { id: secondary.id, url: secondary.url }).then(() => { secondary.loaded = true; }) : null)
    .then(() => { prefs(); syncBrowserLayout(); })
    .catch((err) => toast(err.message));
});
document
  .querySelectorAll("[data-url]")
  .forEach((b) =>
    b.addEventListener("click", () =>
      openWeb(b.dataset.url).catch((e) => toast(e.message)),
    ),
  );
for (const op of ["back", "forward", "reload"])
  action("browser-" + op, () => host("browser." + op, { id: state.activeTab }));
action("share-page", async () => {
  if (!task()) throw new Error("ページを添付する案件を左から選んでください");
  const page = await host("browser.read", { id: state.activeTab });
  state.webAttachments[state.active] = page;
  renderAttachments();
  await selectTask(state.active);
  $("prompt").focus();
  toast("ページを添付しました");
});
$("video-speed").addEventListener("change", async (e) => {
  try {
    const count = await host("browser.speed", {
      id: state.activeTab,
      speed: Number(e.target.value),
    });
    toast(
      count
        ? "再生速度を変更しました"
        : "このページでは動画・音声を見つけられませんでした",
    );
  } catch (err) {
    toast(err.message);
  }
});
let browserLayoutFrame = null;
const tabRail=setupTabRail(syncBrowserLayout);
function syncBrowserLayout() {
  if (!native) return;
  if (browserLayoutFrame !== null) return;
  browserLayoutFrame = requestAnimationFrame(() => {
    browserLayoutFrame = null;
    const slot = $("browser-slot").getBoundingClientRect(),rail=$('pane-tabbar').getBoundingClientRect();
    const left=Math.min(slot.right,Math.max(slot.x,rail.right,bookmarkFlyout.right()));
    const r={x:left,y:slot.y,width:Math.max(0,slot.right-left),height:slot.height};
    const visible = paneVisible && !$('workspace-deck').classList.contains('dragging') && state.mode === "work" && state.activeView === "web:" + state.activeTab && !!state.activeTab && !$("dialog").open && !resizing;
    const secondary = state.tabs.find((t) => t.id === state.browserSecondary && t.id !== state.activeTab);
    const split = false;
    const gap = 4;
    const half = Math.max(1, Math.floor((r.width - gap) / 2));
    postHost("browser.layout", {
      visible,
      panes: visible ? [
        { id: state.activeTab, x: Math.round(r.x), y: Math.round(r.y), width: split ? half : Math.round(r.width), height: Math.round(r.height) },
        ...(split ? [{ id: secondary.id, x: Math.round(r.x + half + gap), y: Math.round(r.y), width: half, height: Math.round(r.height) }] : []),
      ] : [],
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
      viewportWidth: innerWidth,
    });
  });
}
new ResizeObserver(() => {
  syncBrowserLayout();
  state.graph?.resize();
}).observe($("panes"));
window.addEventListener("resize", syncBrowserLayout);
function showShortcuts() {
  state.ui.shortcuts = shortcutBindings();
  openDialog(dialogHeader("キーボード ショートカット") +
    `<div class="shortcut-editor">
      <p class="shortcut-intro">割り当てを選び、使いたいキーを押してください。Deleteで解除、Escでキャンセルできます。</p>
      <div class="shortcut-tools"><input id="shortcut-search" type="search" placeholder="操作名やキーで検索" aria-label="ショートカットを検索"><button id="shortcut-reset-all">すべて初期設定に戻す</button></div>
      <div class="shortcut-table-wrap"><table class="shortcut-table"><thead><tr><th>分類</th><th>操作</th><th>割り当て</th><th aria-label="初期設定に戻す"></th></tr></thead><tbody>${shortcutDefinitions.map(({ command, group, label }) => `<tr data-shortcut-row="${esc(command)}" data-search="${esc(`${group} ${label} ${command}`.toLowerCase())}"><td class="shortcut-group">${esc(group)}</td><td class="shortcut-command">${esc(label)}</td><td class="shortcut-keys"><button class="shortcut-binding" data-shortcut-command="${esc(command)}"></button></td><td><button class="shortcut-reset" data-shortcut-reset="${esc(command)}" title="この操作を初期設定に戻す" aria-label="${esc(label)}を初期設定に戻す">↺</button></td></tr>`).join("")}</tbody></table><div id="shortcut-empty" class="shortcut-empty" hidden>一致する操作がありません</div></div>
      <label class="shortcut-toggle"><input id="video-keys-enabled" type="checkbox" ${state.ui.videoKeys !== false ? "checked" : ""}>Webページ上で動画の速度ショートカットを使う</label>
    </div>`);
  let recording = null;
  const buttons = [...document.querySelectorAll("[data-shortcut-command]")];
  const finishRecording = () => {
    recording = null;
    postHost("window.shortcutCapture", { enabled: false });
    refresh();
  };
  const refresh = () => {
    for (const button of buttons) {
      const command = button.dataset.shortcutCommand;
      const value = state.ui.shortcuts[command];
      button.textContent = recording === command ? "キーを入力…" : (displayShortcut(value) || "未設定");
      button.classList.toggle("recording", recording === command);
      button.classList.toggle("unassigned", !value && recording !== command);
      const reset = document.querySelector(`[data-shortcut-reset="${command}"]`);
      reset.disabled = value === defaultShortcutBindings[command];
      const row = button.closest("tr");
      row.dataset.search = `${row.dataset.search.split("  key:")[0]}  key:${String(value).toLowerCase()}`;
    }
    if ($("menu-shortcut-key")) $("menu-shortcut-key").textContent = displayShortcut(state.ui.shortcuts.shortcuts) || "未設定";
  };
  const saveBinding = (command, value) => {
    const old = state.ui.shortcuts[command];
    if (old === value) return finishRecording();
    const conflict = value && shortcutDefinitions.find(({ command: other }) => other !== command && state.ui.shortcuts[other] === value);
    state.ui.shortcuts[command] = value;
    if (conflict) {
      state.ui.shortcuts[conflict.command] = old || "";
      toast(`${conflict.label} と割り当てを入れ替えました`);
    }
    syncShortcutSettings();
    prefs();
    finishRecording();
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      recording = button.dataset.shortcutCommand;
      postHost("window.shortcutCapture", { enabled: true });
      refresh();
      button.focus();
    });
    button.addEventListener("keydown", (event) => {
      if (recording !== button.dataset.shortcutCommand) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") return finishRecording();
      if ((event.key === "Delete" || event.key === "Backspace") && !event.ctrlKey && !event.altKey && !event.shiftKey)
        return saveBinding(recording, "");
      const value = eventToShortcut(event);
      if (!value) return;
      const definition = shortcutDefinitions.find(({ command }) => command === recording);
      if (!definition.media && !event.ctrlKey && !event.altKey && !event.shiftKey && !/^F(?:[1-9]|1[0-2])$/.test(value)) {
        toast("文字入力を妨げないよう、Ctrl・Alt・Shiftのいずれかと組み合わせてください");
        return;
      }
      saveBinding(recording, value);
    }, true);
  }
  document.querySelectorAll("[data-shortcut-reset]").forEach((button) => button.addEventListener("click", () => {
    saveBinding(button.dataset.shortcutReset, defaultShortcutBindings[button.dataset.shortcutReset]);
  }));
  $("shortcut-reset-all").addEventListener("click", () => {
    state.ui.shortcuts = { ...defaultShortcutBindings };
    syncShortcutSettings();
    prefs();
    finishRecording();
    toast("ショートカットを初期設定に戻しました");
  });
  $("shortcut-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll("[data-shortcut-row]").forEach((row) => {
      row.hidden = !!query && !row.dataset.search.includes(query);
      if (!row.hidden) visible++;
    });
    $("shortcut-empty").hidden = visible !== 0;
  });
  $("video-keys-enabled").addEventListener("change", (e) => {
    state.ui.videoKeys = e.target.checked;
    syncShortcutSettings();
    prefs();
  });
  $("dialog").addEventListener("close", () => postHost("window.shortcutCapture", { enabled: false }), { once: true });
  refresh();
}
const youtube=setupYouTube({api,host,toast,openDialog,closeDialog,header:dialogHeader,esc,openFile:loadLocalPath});
async function runShortcut(command, sourceId = null) {
  if(command==='youtube-capture')return youtube.capture(sourceId||state.activeTab);
  if(command==='youtube-preview')return host('browser.youtube.preview',{id:sourceId||state.activeTab});
  if(command==='bookmark-page')return bookmarkPage();
  if(command==='bookmarks')return showBookmarks();
  if(command==='new-note')return newNote();
  if(command==='save-file'){$('save-file').click();return;}
  if(command==='new-window')return host('window.new');
  command = ({ "next-tab-page": "next-tab", "previous-tab-page": "previous-tab" })[command] || command;
  if (paneMode && command === "send") { $("composer").requestSubmit(); return; }
  if(paneMode && ['split','zoom-pane','close-pane','move-pane','focus-left','focus-right','sidebar','shortcuts'].includes(command)){paneShell.shortcut(command);return;}
  if (command === "shortcuts") {
    if ($("dialog").open && $("dialog").querySelector(".shortcut-editor")) closeDialog();
    else if (!$("dialog").open) showShortcuts();
    return;
  }
  if ($("dialog").open) return;
  if (command === "new-tab") {
    await openWeb("https://www.google.com");
    if (native) await host("window.focusUI");
    $("address").value = state.tabs.find((t) => t.id === state.activeTab)?.url || "";
    $("address").focus(); $("address").select();
  } else if (command === "close-tab") {
    await closeView(sourceId ? "web:" + sourceId : state.activeView);
  } else if (command === "reopen-tab") {
    const closed = state.closedViews.pop();
    if (!closed) return;
    const { view, tab, index } = closed;
    if (state.viewTabs.some((v) => v.key === view.key)) return;
    if (tab) state.tabs.push(tab);
    if (view.kind === "task") state.open.push(view.id);
    state.viewTabs.splice(Math.min(index, state.viewTabs.length), 0, view);
    await selectView(view.key);
  } else if (command === "next-tab" || command === "previous-tab" || /^tab-[1-9]$/.test(command)) {
    const tabs = state.viewTabs;
    if (!tabs.length) return;
    const index = tabs.findIndex((v) => v.key === state.activeView);
    const number = Number(command.slice(4));
    const next = command.startsWith("tab-") ? (number === 9 ? tabs.length - 1 : Math.min(number - 1, tabs.length - 1)) :
      (index + (command === "next-tab" ? 1 : -1) + tabs.length) % tabs.length;
    await selectView(tabs[next].key);
  } else if (command === "move-tab-left" || command === "move-tab-right") {
    state.viewTabs = moveTab(state.viewTabs, state.activeView, command === "move-tab-left" ? -1 : 1);
    renderWorkTabs(); prefs();
  } else if (command === "address") {
    if (sourceId && sourceId !== state.activeTab) await selectView("web:" + sourceId);
    if (!state.activeView?.startsWith("web:")) {
      if (state.activeTab) await selectView("web:" + state.activeTab);
      else await openWeb("https://www.google.com");
    }
    if (native) await host("window.focusUI");
    $("address").value = state.tabs.find((t) => t.id === state.activeTab)?.url || "";
    $("address").focus(); $("address").select();
  } else if (command === "zoom-pane") {
    return paneShell.zoom();
  } else if (command === "split") {
    return paneShell.toggle();
  } else if (command === "close-pane") {
    return paneShell.closePane();
  } else if (command === "move-pane") {
    return paneShell.moveCurrent();
  } else if (command === "focus-left" || command === "focus-right") {
    await paneShell.focus(command==='focus-right'?'right':'left');
  } else if (command === "new-task") await newTask();
  else if (command === "send") $("composer").requestSubmit();
  else if (command === "sidebar") $("sidebar-toggle").click();
  if (["next-tab", "previous-tab", "reopen-tab", "close-tab", "move-tab-left", "move-tab-right", "split"].includes(command) || /^tab-[1-9]$/.test(command)) {
    if (state.activeView?.startsWith("web:")) await host("browser.focus", { id: state.activeTab });
  }
}
// In the Windows host, accelerator keys are delivered by WinForms even when a
// different WebView has focus. This fallback supports the workspace web preview.
document.addEventListener("keydown", (e) => {
  if (native || e.target.closest?.('.shortcut-binding.recording')) return;
  const command = shortcutCommand(e, state.ui.shortcuts);
  if (!command) return;
  e.preventDefault();
  runShortcut(command).catch((error) => toast(error.message));
}, true);
action('reconnect-task',async()=>{const t=task();if(!t)return;$('reconnect-task').disabled=true;try{upsert(await api('/tasks/'+t.id+'/reconnect',{}));await loadHistory(t.id);renderSidebar();renderActive();toast('再接続しました');}finally{$('reconnect-task').disabled=false;}});
action('open-codex',()=>api('/tasks/'+state.active+'/open-source',{}));
if (native)
  paneBridge.addEventListener("message", (e) => {
    const m = e.data;
    if(!paneMode&&paneShell?.route(m))return;
    pageTranslation.event(m);
    youtube.event(m).catch(e=>toast(e.message));
    if (m.type === "shortcut") {
      if(!paneMode&&document.activeElement?.id==='secondary-frame'&&m.command==='address'){document.activeElement.contentWindow.postMessage({channel:'atlas-pane-v1',type:'native',message:m},location.origin);return;}
      runShortcut(m.command, m.id).catch((error) => toast(error.message));
      return;
    }
    if (m.type === "response") {
      const p = pendingNative.get(m.requestId);
      if (p) {
        clearTimeout(p.timer);
        pendingNative.delete(m.requestId);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.result);
      }
      return;
    }
    if(m.type==='app.resumed'){
      api('/connect',{}).catch(()=>{});
      api('/sync',{active:state.active}).then(r=>{r.tasks.forEach(upsert);renderSidebar();renderActive();if(state.active)return loadHistory(state.active);}).catch(e=>toast(e.message));return;
    }
    if(m.type==='app.serviceRecovering'){showServiceDown();return;}
    if(m.type==='app.serviceRecovered'){refreshRecoveredService().catch(e=>{showServiceDown('再接続できます');toast(e.message);});return;}
    if(m.type==='app.serviceFailed'){showServiceDown('再接続できます');toast(m.message);return;}
    if (m.type === "app.closing" || m.type==='app.saving') {
      if(m.type==='app.closing'&&voice.active()){toast('音声入力を終了してから閉じてください');return;}
      closingWindow=m.type==='app.closing';
      stashDraft();
      clearTimeout(preferenceSave.timer);
      clearTimeout(persistTabs.timer);
      clearTimeout(draftTimer);
      Promise.resolve(paneMode?null:paneShell?.save()).then(()=>Promise.all([
        saveDrafts(),
        api("/tabs", { tabs: state.tabs, activeTab: state.activeTab }),
        savePreferences(),
      ]))
        .then(async() => {if(m.type==='app.closing'){await api('/window/reset',{});postHost("app.exit");}})
        .catch((e) =>
          {closingWindow=false;toast("下書きを保存できないため終了を止めました: " + e.message);},
        );
      return;
    }
    if(m.type==='window.twoPanes'){paneShell.twoPanes().catch(e=>toast(e.message));return;}
    if (m.type === "openUrl") openWeb(m.url).catch((e) => toast(e.message));
    if (m.type === 'browser.suspended') {
      const tab=state.tabs.find(t=>t.id===m.id);if(tab)tab.loaded=false;
      return;
    }
    if (m.type === "browser.created") {
      state.tabs.push({ id: m.id, url: m.url, title: m.title, loaded: true });
      viewEpoch++;
      state.activeTab = m.id;
      setMode("work");
      focusView(addView("web", m.id));
      renderBrowserTabs();
      persistTabs();
      syncBrowserLayout();
    }
    if(m.type==='browser.favicon'){const t=state.tabs.find(t=>t.id===m.id);if(t&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(m.icon)){t.icon=m.icon;renderWorkTabs();persistTabs();}return;}
    if (m.type === "browser.state") {
      const t = state.tabs.find((t) => t.id === m.id);
      if (t) {
        Object.assign(t, m, { loaded: true });
        renderBrowserTabs();
        persistTabs();
      }
    }
    if (m.type === "browser.error") {
      toast(m.error);
      $("browser-message").textContent = m.error;
    }
  });

// The globe shares actual tasks, file references and declared dependencies with the work view.
async function setMode(mode) {
  state.mode = mode;
  $("work-view").hidden = mode !== "work";
  $("globe-view").hidden = mode !== "globe";
  $("work-mode").setAttribute("aria-pressed", mode === "work");
  $("globe-mode").setAttribute("aria-pressed", mode === "globe");
  syncBrowserLayout();
  if (mode === "globe") {
    if (!state.graph) {
      try {
        const { WorkspaceGlobe } = await import("/graph.js");
        state.graph = new WorkspaceGlobe(
          $("graph-canvas"),
          $("graph-label-layer"),
          selectNode,
        );
        state.graph.setTheme(state.ui.theme);
      } catch (e) {
        $("graph-stage").innerHTML =
          '<div class="empty">3D表示を開始できませんでした。一覧から案件を選べます。<p>' +
          esc(e.message) +
          "</p></div>";
      }
    }
    await refreshGraph();
    state.graph?.setVisible(true);
  } else state.graph?.setVisible(false);
}
action("work-mode", () => setMode("work"));
action("globe-mode", () => setMode("globe"));
action("inspect-task", async () => {
  await setMode("globe");
  selectNode(state.active);
});
let graphData = { nodes: [], edges: [] };
async function refreshGraph() {
  graphData = await api("/graph");
  state.graph?.setData(graphData);
  const hint = document.querySelector(".graph-hint");
  if (hint) hint.textContent = "ドラッグで回転 · ホイールで拡大";
  const visible = state.tasks.filter(t => hasConversation(t) && !t.stored);
  const count = (s) => visible.filter((t) => s.includes(t.state)).length;
  $("graph-stats").innerHTML = [
    ["案件", visible.length],
    ["実行中", count(["running", "starting"])],
    ["確認・前提待ち", count(["waiting", "queued"])],
    ["エラー・接続切れ", count(["failed", "disconnected"])],
  ]
    .map(
      ([label, n]) =>
        `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`,
    )
    .join("");
  if ($("graph-empty")) $("graph-empty").hidden = !!graphData.nodes.length;
  if (state.selectedNode) renderInspector(state.selectedNode);
  else renderNodeList();
}
function scheduleGraph() {
  clearTimeout(scheduleGraph.timer);
  scheduleGraph.timer = setTimeout(
    () => refreshGraph().catch((e) => toast(e.message)),
    400,
  );
}
function selectNode(id) {
  state.selectedNode = id;
  state.graph?.select(id);
  renderInspector(id);
}
function renderNodeList() {
  const target = $("graph-node-list");
  if (!target) return;
  target.innerHTML =
    '<div class="inspector-section"><h3>案件を選ぶ</h3>' +
    state.tasks
      .filter(t => hasConversation(t) && !t.stored)
      .map(
        (t) =>
          `<button class="node-list-button" data-node="${esc(t.id)}"><i class="dot ${esc(t.state)}"></i> ${esc(t.title)}</button>`,
      )
      .join("") +
    "</div>";
}
function renderInspector(id) {
  const node = graphData.nodes.find((n) => n.id === id);
  if (!node) {
    state.selectedNode = null;
    return;
  }
  const t = state.tasks.find((t) => t.id === node.taskId);
  const relationships = graphData.edges.filter(
    (e) => e.from === id || e.to === id,
  );
  let html = `<div class="eyebrow">${node.kind === "task" ? "TASK" : node.kind === "folder" ? "FOLDER" : "ARTIFACT"}</div><h2 class="inspector-title">${esc(node.label)}</h2><p class="small muted" style="overflow-wrap:anywhere">${esc(node.cwd || node.path || "")}</p>`;
  if (node.kind === "task" && t) {
    const blockers = state.links.filter(
        (l) =>
          l.kind === "dependency" &&
          l.to === id &&
          state.tasks.find((x) => x.id === l.from)?.state !== "completed",
      ),
      elapsed = t.turnStartedAt
        ? Math.max(
            0,
            Math.round(
              ((t.activeTurn ? Date.now() : t.turnEndedAt) || t.turnStartedAt) -
                t.turnStartedAt,
            ) / 1000,
          )
        : null;
    const usage = t.tokenUsage,
      last = usage?.last,
      total = usage?.total;
    html += `<span class="badge"><i class="dot ${esc(t.state)}"></i>${esc(status(t))}</span><p><button class="primary" data-go-task="${esc(id)}">開く ↗</button></p>`;
    const blocker =
      t.state === "waiting"
        ? "確認への回答待ち"
        : blockers.length
          ? "前提の完了待ち"
          : t.error || (t.state === "disconnected" ? "Codexとの接続切れ" : "");
    if (blocker)
      html += `<div class="inspector-section"><h3>${esc(blocker)}</h3>${blockers.map((l) => `<p><button data-node="${esc(l.from)}">${esc(state.tasks.find((t) => t.id === l.from)?.title)}</button></p>`).join("")}</div>`;
    const metrics = [
      ["モデル", t.model],
      ["経過", elapsed == null ? null : Math.round(elapsed) + " 秒"],
      ["最終更新", t.lastEventAt ? time(t.lastEventAt) : null],
      ["入力 tokens", last?.inputTokens?.toLocaleString()],
      ["出力 tokens", total?.outputTokens?.toLocaleString()],
      ["文脈上限", usage?.modelContextWindow?.toLocaleString()],
      ["会話の圧縮", t.compactions ? t.compactions + " 回" : null],
    ].filter(([, v]) => v != null);
    if (metrics.length)
      html +=
        '<div class="inspector-section">' +
        metrics
          .map(
            ([k, v]) =>
              `<div class="metric-line"><span>${esc(k)}</span><span>${esc(v)}</span></div>`,
          )
          .join("") +
        "</div>";
    if (!t.external)
      html += `<div class="inspector-section"><h3>前提を追加</h3><select id="dependency-from" aria-label="前提にする案件"><option value="">案件を選択</option>${state.tasks
        .filter((x) => x.id !== id && !x.external)
        .map((x) => `<option value="${esc(x.id)}">${esc(x.title)}</option>`)
        .join(
          "",
        )}</select><input id="dependency-note" placeholder="例: 台本の確認結果が必要" aria-label="依存する理由"><button id="add-dependency" data-target="${esc(id)}">前提としてつなぐ</button></div>`;
  }
  html += `<div class="inspector-section"><h3>つながり · ${relationships.length}</h3>${
    relationships
      .map((l) => {
        const other = l.from === id ? l.to : l.from,
          n = graphData.nodes.find((n) => n.id === other),
          labels = {
            dependency: l.to === id ? "前提" : "この案件を待つ",
            folder: "同じ作業フォルダ",
            fork: "履歴の引継ぎ",
            delegates: "委任",
            reads: "閲覧",
            writes: "AIの編集",
            humanEdit: "人間の編集",
            artifact: "成果物",
            generated: "生成",
            file: "ファイル",
          };
        return `<div class="relation"><span class="muted">${esc(labels[l.kind] || l.kind)}</span><br><button data-node="${esc(other)}">${esc(n?.label || other)}</button>${l.note ? '<div class="small muted">' + esc(l.note) + "</div>" : ""}${l.kind === "dependency" ? '<button data-remove-link="' + esc(l.id) + '" aria-label="依存関係を外す">×</button>' : ""}</div>`;
      })
      .join("") || '<p class="muted">まだありません</p>'
  }</div>`;
  if (node.kind === "task" && t)
    html +=
      '<div class="inspector-section"><h3>記録</h3>' +
      [...(t.events || [])]
        .reverse()
        .slice(0, 20)
        .map(
          (e) =>
            `<div class="evidence ${e.type === "error" ? "error" : ""}"><time>${time(e.at)}</time><div>${esc(e.label)}</div>${e.detail || e.command ? "<details><summary>記録を読む</summary><pre>" + esc(e.command || "") + "\n" + esc(e.detail || "") + "</pre></details>" : ""}</div>`,
        )
        .join("") +
      "</div>";
  if (node.kind === "file" && t)
    html +=
      '<p><button data-open-artifact="' +
      esc(node.path) +
      '" data-artifact-task="' +
      esc(t.id) +
      '">この成果物を開く ↗</button></p>';
  html += '<div id="graph-node-list"></div>';
  $("graph-inspector").innerHTML = html;
  renderNodeList();
}
$("graph-inspector").addEventListener("click", async (e) => {
  try {
    const node = e.target.closest("[data-node]");
    if (node) selectNode(node.dataset.node);
    const go = e.target.closest("[data-go-task]");
    if (go) await selectTask(go.dataset.goTask);
    const artifact = e.target.closest("[data-open-artifact]");
    if (artifact) {
      await selectTask(artifact.dataset.artifactTask);
      await openFile(artifact.dataset.openArtifact);
    }
    if (e.target.id === "add-dependency") {
      const from = $("dependency-from").value;
      if (!from) throw new Error("前提にする案件を選んでください");
      state.links = await api("/dependencies", {
        from,
        to: e.target.dataset.target,
        note: $("dependency-note").value,
      });
      await refreshGraph();
      toast("前提を登録しました");
    }
    if (e.target.dataset.removeLink) {
      state.links = await api("/dependencies/remove", {
        id: e.target.dataset.removeLink,
      });
      await refreshGraph();
    }
  } catch (err) {
    toast(err.message);
  }
});
action("graph-reset", () => state.graph?.reset());
action("graph-labels", () => {
  const value = $("graph-labels").getAttribute("aria-pressed") !== "true";
  $("graph-labels").setAttribute("aria-pressed", value);
  state.graph?.setLabels(value);
});
action("graph-list", () => {
  $("graph-node-list")?.scrollIntoView({ block: "start" });
  $("graph-node-list button")?.focus();
});
window.addEventListener("beforeunload", (e) => {
  if (
    Object.values(state.files).some(
      (f) =>
        f.editor?.dirty || Object.values(f.editors || {}).some((e) => e.dirty),
    )
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
function describeView(v){if(!v)return null;const tab=state.tabs.find(t=>t.id===v.id);return {...v,tab:tab?{id:tab.id,url:tab.url,title:tab.title,icon:tab.icon}:v.tab,task:state.tasks.find(t=>t.id===(v.taskId||v.id))||v.task};}
async function focusContent(){
  if(state.activeView?.startsWith('web:')){await host('browser.focus',{id:state.activeTab});return;}
  if(native)await host('window.focusUI');
  if(state.activeView?.startsWith('task:'))$('prompt').focus();
  else {const el=$('editor-content').querySelector('textarea,input')||$('editor-content');el.tabIndex=-1;el.focus();}
}
paneShell=setupPanes({
  token,esc,views:()=>state.viewTabs,current:()=>state.viewTabs.find(v=>v.key===state.activeView),
  title:v=>state.tasks.find(t=>v.kind==='task'&&t.id===v.id)?.title || state.tabs.find(t=>v.kind==='web'&&t.id===v.id)?.title || v.path?.split(/[\\/]/).pop() || 'ファイル',
  describe:describeView,
  async open(v){
    if(v.task)upsert(v.task);
    if(v.tab&&!state.tabs.some(t=>t.id===v.tab.id))state.tabs.push({...v.tab,loaded:false});
    if(!state.viewTabs.some(t=>t.key===v.key))state.viewTabs.push(v);
    await selectView(v.key);
  },
  merge(v){if(v.task)upsert(v.task);if(v.tab){const t=state.tabs.find(t=>t.id===v.tab.id);if(t)Object.assign(t,{title:v.tab.title,url:v.tab.url,icon:v.tab.icon});else state.tabs.push({...v.tab,loaded:false});}if(!state.viewTabs.some(t=>t.key===v.key))state.viewTabs.push(v);renderWorkTabs();persistTabs();},
  rememberLayout(value){state.ui.paneWorkspace=value;state.ui.rightPane=null;prefs();},
  snapshot(){return {views:state.viewTabs.map(describeView),tabs:state.tabs.map(t=>({id:t.id,url:t.url,title:t.title,icon:t.icon})),activeView:state.activeView};},
  async restore(saved={}){
    stashDraft();
    const views=saved.views||[],tabs=saved.tabs||[];
    for(const v of views)if(v.task)upsert(v.task);
    for(const t of state.tabs)if(!tabs.some(b=>b.id===t.id)&&native)await host('browser.close',{id:t.id});
    state.tabs=tabs.map(t=>({...t,loaded:state.tabs.find(b=>b.id===t.id)?.loaded||false}));
    state.viewTabs=views;state.open=views.filter(v=>v.kind==='task').map(v=>v.id);
    state.active=null;state.activeTab=null;state.activeView=null;
    setMode('work');renderWorkTabs();renderBrowserTabs();
    const next=views.find(v=>v.key===saved.activeView)||views[0];
    if(next)await selectView(next.key);else {focusView(null);renderActive();}
    persistTabs();prefs();
  },
  ratio(n){state.ui.paneRatio=Math.min(75,Math.max(25,n));prefs();},
  async makeCompanion(){if(state.active){const key=addView('folder',state.active,{taskId:state.active});return state.viewTabs.find(v=>v.key===key);}await openWeb('https://www.google.com');return state.viewTabs.find(v=>v.key===state.activeView);},
  close:closeView,shortcut:runShortcut,error:toast,focus:focusContent,layout:syncBrowserLayout,
  move(key,delta){state.viewTabs=moveTab(state.viewTabs,key,delta);renderWorkTabs();prefs();},
  place(key,index){const view=state.viewTabs.find(v=>v.key===key);if(!view)return;state.viewTabs=state.viewTabs.filter(v=>v.key!==key);state.viewTabs.splice(Math.max(0,Math.min(index,state.viewTabs.length)),0,view);renderWorkTabs();prefs();},
  visibility(v){paneVisible=v;syncBrowserLayout();},
  async save(){if(voice.active())throw Error('音声入力を終了してから閉じてください');stashDraft();await saveDrafts();prefs();},drafts:()=>state.drafts,
  mergeDrafts(d){Object.assign(state.drafts,d);prefs();},
});
boot();
