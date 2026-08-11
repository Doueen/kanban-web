"use strict";

/* ============================================================================
   Hermes Kanban Web — 前端应用 (v2)
   4 页面（看板/列表/统计/设置）+ 底部导航 + 详情抽屉 + 自定义控件。
   ========================================================================== */

/* ---------- state ---------- */
const state = {
  view: "board",
  board: null,
  assignees: [],
  boards: [],
  currentBoard: null,
  search: "",
  listStatus: "",
  listAssignee: "",
  listArchived: false,
  sortBy: "created",
  detailId: null,
  detailOpts: {},
  events: [],
  eventSince: 0,
  boardTimer: null,
  eventTimer: null,
};

const STATUS_ORDER = ["todo", "ready", "running", "blocked", "scheduled", "review", "done", "archived", "triage"];
const STATUS = {
  todo: "待办", ready: "就绪", running: "运行中", blocked: "阻塞",
  scheduled: "定时", review: "评审", done: "完成", archived: "归档", triage: "待梳理",
};

const THEMES = [
  { id: "hud", label: "终端 HUD", bg: "#04060c", accent: "#5ff0e0" },
  { id: "violet", label: "极夜紫", bg: "#0a0618", accent: "#8b7cf6" },
  { id: "paper", label: "暖纸", bg: "#f7f1e3", accent: "#b45309" },
  { id: "sakura", label: "樱花", bg: "#fff0f5", accent: "#ec4899" },
  { id: "bay", label: "海湾", bg: "#f0f7ff", accent: "#0ea5e9" },
];

/* ---------- utils ---------- */
const el = (id) => document.getElementById(id);
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function fmtTime(unix) {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ago(unix) {
  if (!unix) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

function dur(secs) {
  if (secs === null || secs === undefined) return "—";
  if (secs < 60) return `${Math.floor(secs)}秒`;
  if (secs < 3600) return `${Math.floor(secs / 60)}分钟`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}小时`;
  return `${(secs / 86400).toFixed(1)}天`;
}

function kindColor(kind) {
  let h = 0;
  const k = String(kind || "event");
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 360;
  return `hsl(${h} 68% 55%)`;
}

function shortPayload(p) {
  let s = "";
  if (p === null || p === undefined) return "";
  if (typeof p === "string") s = p;
  else { try { s = JSON.stringify(p); } catch (_) { s = String(p); } }
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

/* ---------- auth ---------- */
function getAuth() {
  try { return JSON.parse(localStorage.getItem("kb-auth") || "null"); } catch (_) { return null; }
}
function setAuth(user, pass) {
  try { localStorage.setItem("kb-auth", JSON.stringify({ u: user, p: pass })); } catch (_) { /* noop */ }
}
function clearAuth() {
  try { localStorage.removeItem("kb-auth"); } catch (_) { /* noop */ }
}
function authHeader() {
  const a = getAuth();
  return a ? "Basic " + btoa(a.u + ":" + a.p) : "";
}
function showLogin() {
  stopPolling(); stopEventPolling();
  el("login-screen").classList.remove("hidden");
  document.body.classList.add("no-app");
  setTimeout(() => { try { el("login-user").focus(); } catch (_) { /* noop */ } }, 60);
}
function hideLogin() {
  el("login-screen").classList.add("hidden");
  document.body.classList.remove("no-app");
}

/* ---------- api ---------- */
async function api(path, opts = {}) {
  const h = authHeader();
  if (h) opts.headers = { ...(opts.headers || {}), Authorization: h };
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON */ }
  if (res.status === 401) showLogin();
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

async function apiText(path) {
  const h = authHeader();
  const res = await fetch(path, h ? { headers: { Authorization: h } } : {});
  if (res.status === 401) showLogin();
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const d = await res.json(); if (d && d.detail) detail = d.detail; } catch (_) { /* noop */ }
    throw new Error(detail);
  }
  return res.text();
}

const jsonOpts = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const TOAST_ICON = { ok: "✓", error: "✕", warn: "!", info: "i" };
function toast(msg, type = "info", ms = 3000) {
  const t = el("toast");
  t.innerHTML = `<span class="toast-ic">${TOAST_ICON[type] || "i"}</span><span>${esc(msg)}</span>`;
  t.className = "toast " + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

/* ---------- markdown (minimal: newline / code block / bold / inline code) ---------- */
function mdToHtml(text) {
  if (!text) return "";
  let html = esc(text);
  const blocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\w`])(`[^`]+`)([^\w`]|$)/g, "$1<code>$2</code>$3");
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  html = html.replace(/\n/g, "<br>");
  return html;
}

/* ---------- rendering helpers ---------- */
function badge(status) {
  const label = STATUS[status] || status;
  return `<span class="badge st-${esc(status)}">${esc(label)}</span>`;
}

/* ---------- theme ---------- */
function applyTheme(id) {
  document.body.dataset.theme = THEMES.some((t) => t.id === id) ? id : "hud";
  try { localStorage.setItem("kb-theme", document.body.dataset.theme); } catch (_) { /* noop */ }
  renderThemePop();
}

function renderThemePop() {
  const cur = document.body.dataset.theme;
  el("theme-pop").innerHTML = THEMES.map((t) => `
    <button class="theme-item${t.id === cur ? " active" : ""}" data-theme="${t.id}">
      <span class="theme-swatch" style="background:linear-gradient(135deg,${t.bg} 0%,${t.bg} 45%,${t.accent} 46%,${t.accent} 100%)"></span>
      <span>${esc(t.label)}</span>
    </button>`).join("");
}

/* ---------- custom select ---------- */
let _openSel = null;

function mkSelect({ options, value = "", onChange, placeholder = "请选择…" }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cs-btn";
  btn.setAttribute("role", "listbox");
  btn.setAttribute("aria-haspopup", "listbox");
  let current = value;
  const pick = (v, o) => { current = v; if (onChange) onChange(v, o); };
  const render = () => {
    const cur = options.find((o) => String(o.value) === String(current));
    btn.innerHTML = `<span class="cs-label">${esc(cur ? cur.label : placeholder)}</span><span class="cs-caret"></span>`;
  };
  render();
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_openSel && _openSel.btn === btn) closeSel();
    else openSel(btn, options, current, pick);
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (_openSel && _openSel.btn === btn) return;
      openSel(btn, options, current, pick);
    }
  });
  btn._value = () => current;
  return btn;
}

function openSel(btn, options, value, onChange) {
  closeSel();
  const list = document.createElement("div");
  list.className = "cs-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("tabindex", "-1");
  const items = [];
  let activeIdx = 0;
  options.forEach((o, i) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "option");
    item.className = "cs-item" + (String(o.value) === String(value) ? " selected" : "");
    item.innerHTML = `<span>${esc(o.label)}</span>${String(o.value) === String(value) ? '<span class="cs-tick">✓</span>' : ""}`;
    if (String(o.value) === String(value)) activeIdx = i;
    item.addEventListener("mousedown", (e) => e.preventDefault());
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSel();
      onChange(o.value, o);
    });
    list.appendChild(item);
    items.push(item);
  });
  document.body.appendChild(list);
  const r = btn.getBoundingClientRect();
  list.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - list.offsetHeight - 8)) + "px";
  list.style.left = Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 8)) + "px";
  list.style.minWidth = Math.max(r.width, 170) + "px";
  const sel = {
    btn, list, items, activeIdx,
    move(d) {
      sel.activeIdx = (sel.activeIdx + d + items.length) % items.length;
      items[sel.activeIdx].focus();
    },
  };
  _openSel = sel;
  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel.move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel.move(-1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); items[sel.activeIdx].click(); }
    else if (e.key === "Escape") { closeSel(); btn.focus(); }
  });
  items[activeIdx].focus();
}

function closeSel() {
  if (_openSel) { _openSel.list.remove(); _openSel = null; }
}

/* ---------- custom checkbox ---------- */
function mkCheckbox({ checked = false, onChange, ariaLabel }) {
  const label = document.createElement("label");
  label.className = "check";
  label.title = ariaLabel || "";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.addEventListener("change", () => onChange && onChange(input.checked));
  label.appendChild(input);
  const box = document.createElement("span");
  box.className = "check-box";
  box.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 6l3 3 5-6"/></svg>';
  label.appendChild(box);
  return label;
}

/* ---------- navigation ---------- */
function switchView(view) {
  state.view = view;
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === view + "-view"));
  $$(".nav-btn, .top-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === view));
  el("search").value = state.search;
  el("list-search").value = state.search;
  if (view === "board") renderBoard();
  if (view === "list") { renderListFilters(); renderList(); }
  if (view === "stats") enterStats();
  if (view === "settings") renderSettings();
  if (view !== "stats") stopEventPolling();
}

/* ---------- board rendering ---------- */
function cardHtml(t, i) {
  const assignee = t.assignee
    ? `<span class="card-assignee" title="${esc(t.assignee)}">@${esc(t.assignee)}</span>` : "";
  const prio = t.priority > 0 ? `<span class="card-priority" title="优先级 ${t.priority}">P${t.priority}</span>` : "";
  return `
  <div class="card st-${esc(t.status)}" draggable="true" data-id="${esc(t.id)}" style="animation-delay:${Math.min(i, 7) * 40}ms">
    <div class="card-title">${esc(t.title)}</div>
    <div class="card-meta">
      <div class="card-tags">${prio}${assignee}</div>
      <div class="card-tags">
        <span class="card-id">${esc(t.id)}</span>
        <button class="menu-btn" data-menu="${esc(t.id)}" aria-label="操作菜单">⋯</button>
      </div>
    </div>
  </div>`;
}

function getCollapsed() {
  try { return JSON.parse(localStorage.getItem("kb-collapsed") || "{}"); } catch (_) { return {}; }
}
function setCollapsed(status, val) {
  const c = getCollapsed();
  if (val) c[status] = true; else delete c[status];
  try { localStorage.setItem("kb-collapsed", JSON.stringify(c)); } catch (_) { /* noop */ }
}

function renderBoard() {
  const board = el("board");
  if (!state.board) { board.innerHTML = `<div class="empty">加载中…</div>`; return; }
  const first = !board.classList.contains("rendered");
  const collapsed = getCollapsed();
  const firstVisit = !localStorage.getItem("kb-collapsed"); // 真正首次：归档列默认折叠
  board.innerHTML = state.board.statuses.map((col) => {
    const isCollapsed = collapsed[col.status] === true ||
      (firstVisit && col.status === "archived");
    return `
    <section class="column st-${esc(col.status)}${isCollapsed ? " folded" : ""}" data-status="${esc(col.status)}">
      <div class="column-head">
        <span class="dot"></span>
        <span class="column-title">${esc(col.label)}</span>
        <span class="column-count">${col.count}</span>
        <button class="col-fold" data-fold="${esc(col.status)}" title="${isCollapsed ? "展开" : "折叠"}" aria-label="${isCollapsed ? "展开" : "折叠"}">${isCollapsed ? "▸" : "▾"}</button>
      </div>
      <div class="column-body">
        ${col.tasks.map((t, i) => cardHtml(t, i)).join("") || `<div class="empty" style="padding:18px 4px;font-size:12px;">空</div>`}
      </div>
    </section>`;
  }).join("");
  if (first) {
    board.classList.add("enter");
    board.classList.add("rendered");
    setTimeout(() => board.classList.remove("enter"), 400);
  }
  wireDragDrop(board);
}

/* ---------- list rendering ---------- */
function renderListFilters() {
  const statusHost = el("list-status-wrap");
  const assigneeHost = el("list-assignee-wrap");
  statusHost.innerHTML = "";
  assigneeHost.innerHTML = "";
  const statusOpts = (state.board ? state.board.statuses : []).map((c) => ({ value: c.status, label: c.label }));
  statusHost.appendChild(mkSelect({
    options: [{ value: "", label: "全部状态" }, ...statusOpts],
    value: state.listStatus,
    placeholder: "全部状态",
    onChange: (v) => { state.listStatus = v; renderList(); },
  }));
  const assigneeOpts = (state.assignees || []).map((a) => ({ value: a.name, label: a.name }));
  assigneeHost.appendChild(mkSelect({
    options: [{ value: "", label: "全部指派" }, ...assigneeOpts],
    value: state.listAssignee,
    placeholder: "全部指派",
    onChange: (v) => { state.listAssignee = v; renderList(); },
  }));
}

function renderList() {
  const container = el("list-tasks");
  let tasks = (state.board ? state.board.statuses.flatMap((c) => c.tasks) : [])
    .filter((t) => !state.listStatus || t.status === state.listStatus)
    .filter((t) => !state.listAssignee || t.assignee === state.listAssignee);
  const q = state.search.trim().toLowerCase();
  if (q) tasks = tasks.filter((t) => (t.title + " " + (t.body || "")).toLowerCase().includes(q));
  if (!state.listArchived) tasks = tasks.filter((t) => t.status !== "archived");
  if (state.sortBy === "priority") {
    tasks = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.created_at || 0) - (a.created_at || 0));
  } else {
    tasks = [...tasks].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }
  el("list-sort-note").textContent = state.sortBy === "priority" ? "按优先级排序" : "按创建时间排序";
  if (!tasks.length) { container.innerHTML = `<div class="empty">没有匹配的任务</div>`; return; }
  const first = !container.classList.contains("rendered");
  container.innerHTML = tasks.map((t, i) => `
    <div class="list-row st-${esc(t.status)}" data-open="${esc(t.id)}" style="animation-delay:${Math.min(i, 7) * 40}ms">
      <div class="list-row-title">${esc(t.title)}</div>
      <div class="list-row-meta">
        ${badge(t.status)}
        ${t.priority > 0 ? `<span class="card-priority">P${t.priority}</span>` : ""}
        <span class="card-id">${esc(t.id)}</span>
        ${t.assignee ? `<span>@${esc(t.assignee)}</span>` : ""}
        <span title="${fmtTime(t.created_at)}">创建于 ${ago(t.created_at)}</span>
      </div>
    </div>`).join("");
  if (first) {
    container.classList.add("enter");
    container.classList.add("rendered");
    setTimeout(() => container.classList.remove("enter"), 350);
  }
}

/* ---------- data loading ---------- */
async function refreshBoard() {
  try {
    const data = await api("/api/board");
    state.board = data;
    state.assignees = data.assignees || [];
    if (state.view === "board") renderBoard();
    else if (state.view === "list") { renderListFilters(); renderList(); }
    el("refresh").classList.add("spinning");
    setTimeout(() => el("refresh").classList.remove("spinning"), 400);
  } catch (err) {
    toast("刷新失败: " + err.message, "error");
  }
}

async function loadBoards() {
  try {
    state.boards = await api("/api/boards");
    const cur = await api("/api/boards/current");
    const b = state.boards.find((x) => x.slug === cur.slug);
    state.currentBoard = { slug: cur.slug, name: (b && b.name) || cur.name || cur.slug };
  } catch (err) {
    state.currentBoard = null;
    toast("加载 boards 失败: " + err.message, "error");
  }
  updateBoardName();
}

function updateBoardName() {
  el("board-name").textContent = state.currentBoard ? state.currentBoard.name : "…";
}

/* ---------- actions ---------- */
const ACTION_LABEL = {
  complete: "完成", block: "阻塞", unblock: "解阻塞", schedule: "定时",
  promote: "提就绪", "request-review": "提评审", "request-changes": "退回修改",
  "reopen-review": "重新评审", archive: "归档", reclaim: "回收运行",
  specify: "AI 细化", decompose: "AI 分解", claim: "认领", heartbeat: "心跳",
};

function menuFor(task, anchor) {
  const items = [
    { label: "查看详情", action: "view" },
  ];
  if (task.status === "running") items.push({ label: "回收运行", action: "reclaim" });
  if (task.status === "running") items.push({ label: "心跳", action: "heartbeat" });
  if (task.status === "ready") items.push({ label: "认领", action: "claim" });
  if (task.status === "triage") items.push({ label: "细化（AI）", action: "specify" });
  if (task.status === "triage") items.push({ label: "分解（AI）", action: "decompose" });
  if (task.status === "done") items.push({ label: "编辑结果", action: "edit-result" });
  if (task.status === "todo") items.push({ label: "提就绪", action: "promote" });
  if (task.status === "blocked") items.push({ label: "解阻塞", action: "unblock" });
  if (task.status === "scheduled") items.push({ label: "提就绪", action: "unblock" });
  if (task.status === "review") items.push({ label: "退回修改", action: "request-changes" });
  if (["todo", "blocked", "scheduled", "review"].includes(task.status)) items.push({ label: "提评审", action: "request-review" });
  if (task.status !== "done" && task.status !== "archived") items.push({ label: "完成", action: "complete" });
  if (task.status !== "blocked" && task.status !== "done" && task.status !== "archived") items.push({ label: "阻塞", action: "block" });
  if (task.status !== "scheduled" && task.status !== "done" && task.status !== "archived") items.push({ label: "定时", action: "schedule" });
  if (task.status !== "archived" && task.status !== "done") items.push({ label: "归档", action: "archive" });
  items.push({ label: "改指派", action: "assign" });
  items.push({ label: "创建子任务", action: "child" });
  items.push({ label: "查看上下文", action: "context" });
  items.push({ label: "查看日志", action: "log" });
  openMenu(anchor, items, task);
}

function showMenuForId(id, anchor) {
  const task = findTask(id);
  if (!task) return;
  menuFor(task, anchor);
}

function findTask(id) {
  if (!state.board) return null;
  for (const col of state.board.statuses) {
    const t = col.tasks.find((x) => x.id === id);
    if (t) return t;
  }
  return null;
}

function actionForTarget(task, targetStatus) {
  if (targetStatus === task.status) return null;
  switch (targetStatus) {
    case "done": return { action: "complete" };
    case "blocked": return { action: "block" };
    case "review": return { action: "request-review" };
    case "scheduled": return { action: "schedule" };
    case "ready":
      if (task.status === "scheduled" || task.status === "blocked") return { action: "unblock" };
      if (task.status === "review") return { action: "reopen-review" };
      if (task.status === "running") return null;
      return { action: "promote" };
    case "todo":
      if (task.status === "blocked" || task.status === "scheduled") return { action: "unblock" };
      if (task.status === "review") return { action: "reopen-review" };
      return null;
    case "archived": return { action: "archive" };
    default: return null;
  }
}

async function runAction(id, action, note) {
  if (!note && action === "block") note = "via web";
  if (!note && action === "schedule") note = "scheduled via web";
  if (!note && ["promote", "request-changes"].includes(action)) note = "via web";
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/action`, jsonOpts("POST", { action, note }));
    toast(res.message || ACTION_LABEL[action] || "操作完成", "ok");
    await refreshBoard();
    if (state.detailId) openDetail(state.detailId);
  } catch (err) {
    toast("操作失败: " + err.message, "error");
  }
}

const EXT_LOADING = {
  specify: "AI 细化中…可能需要 1-3 分钟",
  decompose: "AI 分解中…可能需要 1-3 分钟",
  claim: "认领中…",
  heartbeat: "发送心跳中…",
};

async function runExtended(id, kind, payload = {}) {
  toast(EXT_LOADING[kind] || "处理中…", "info", 12000);
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/${kind}`, jsonOpts("POST", payload));
    toast(res.message || ACTION_LABEL[kind] || "完成", "ok");
    await refreshBoard();
    if (state.detailId) openDetail(state.detailId);
  } catch (err) {
    toast("失败: " + err.message, "error");
  }
}

function openEditResultModal(t) {
  openModal(`
    <h2>编辑结果</h2>
    <div class="input-row"><label>结果 *</label><textarea id="e-result" placeholder="Backfilled task result text">${esc(t.result || "")}</textarea></div>
    <div class="input-row"><label>摘要（可选）</label><textarea id="e-summary" placeholder="Structured handoff summary"></textarea></div>
    <div class="input-row"><label>元数据（可选，JSON）</label><textarea id="e-metadata" placeholder='{"changed_files": [...]}'></textarea></div>
    <div class="attach-upload">
      <button class="btn btn-primary" data-confirm>保存</button>
      <button class="btn" data-close>取消</button>
    </div>`);
  $("[data-confirm]").onclick = async () => {
    const result = el("e-result").value.trim();
    if (!result) { toast("结果不能为空", "error"); return; }
    let metadata = el("e-metadata").value.trim();
    if (metadata) {
      try { metadata = JSON.parse(metadata); }
      catch (_) { toast("元数据不是合法 JSON", "error"); return; }
    } else metadata = undefined;
    const payload = { result, summary: el("e-summary").value.trim() || undefined };
    if (metadata !== undefined) payload.metadata = metadata;
    try {
      const res = await api(`/api/tasks/${encodeURIComponent(t.id)}/edit`, jsonOpts("POST", payload));
      toast(res.message || "已保存结果", "ok");
      closeModal();
      await refreshBoard();
      if (state.detailId) openDetail(state.detailId);
    } catch (err) { toast("保存失败: " + err.message, "error"); }
  };
  $("#modal-content [data-close]").onclick = closeModal;
}

/* ---------- menu widget ---------- */
function openMenu(anchor, items, task) {
  closeMenu();
  const menu = el("menu");
  menu.innerHTML = items.map((it) => {
    const cls = it.danger ? ' class="danger"' : "";
    return `<button data-mi="${esc(it.action)}"${cls}>${esc(it.label)}</button>`;
  }).join("");
  menu.classList.remove("hidden");
  const r = anchor.getBoundingClientRect();
  const mw = Math.max(170, menu.offsetWidth);
  let x = Math.min(r.left, window.innerWidth - mw - 8);
  if (x < 8) x = 8;
  let y = r.bottom + 6;
  if (y + menu.offsetHeight > window.innerHeight) y = Math.max(8, r.top - menu.offsetHeight - 6);
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu._task = task;
}

function closeMenu() { el("menu").classList.add("hidden"); }

/* ---------- drag & drop (desktop) ---------- */
function wireDragDrop(board) {
  let dragId = null;
  board.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      dragId = card.dataset.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      dragId = null;
      board.querySelectorAll(".column").forEach((c) => c.classList.remove("drag-over"));
    });
  });
  board.querySelectorAll(".column").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drag-over"); });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const id = dragId || e.dataTransfer.getData("text/plain");
      if (!id) return;
      const task = findTask(id);
      const target = col.dataset.status;
      if (!task) return;
      const move = actionForTarget(task, target);
      if (!move) { toast(`无法将任务移动到「${STATUS[target] || target}」`, "error"); return; }
      toast(`正在移动到「${STATUS[target] || target}」…`, "info");
      await runAction(id, move.action, undefined);
    });
  });
}

/* ---------- detail drawer ---------- */
async function openDetail(id, opts = {}) {
  state.detailId = id;
  state.detailOpts = opts;
  const drawer = el("drawer");
  drawer.classList.remove("hidden");
  el("drawer-content").innerHTML = `<div class="empty">加载中…</div>`;
  try {
    const d = await api(`/api/tasks/${encodeURIComponent(id)}`);
    renderDetail(d);
  } catch (err) {
    el("drawer-content").innerHTML = `<div class="empty">加载失败: ${esc(err.message)}</div>`;
  }
}

function renderDetail(d) {
  const t = d.task;
  const content = el("drawer-content");

  content.innerHTML = `
  <div class="drawer-handle"></div>
  <div class="detail-head">
    <div>
      ${badge(t.status)}
      ${t.priority > 0 ? `<span class="card-priority"> P${t.priority}</span>` : ""}
    </div>
    <button class="btn btn-sm btn-ghost" data-act="close">✕ 关闭</button>
  </div>
  <h2 class="detail-title">${esc(t.title)}</h2>

  <div class="detail-actions">
    ${menuButtonsHtml(t)}
  </div>

  <div class="detail-section">
    <h3>信息</h3>
    <div class="kv">
      <dt>任务 ID</dt><dd><code class="mono">${esc(t.id)}</code></dd>
      <dt>指派</dt><dd>${t.assignee ? `@${esc(t.assignee)}` : '<span style="color:var(--muted)">未指派</span>'} <button class="btn btn-sm" data-act="assign">改指派</button></dd>
      <dt>创建者</dt><dd>${esc(t.created_by || "—")}</dd>
      <dt>工作区</dt><dd>${esc(t.workspace_kind || "")}${t.workspace_path ? " · " + esc(t.workspace_path) : ""}${t.branch_name ? " · " + esc(t.branch_name) : ""}</dd>
      <dt>连续失败</dt><dd>${t.consecutive_failures || 0}</dd>
      <dt>模型覆盖</dt><dd>${t.model_override ? esc(t.model_override) + (t.provider_override ? " (" + esc(t.provider_override) + ")" : "") : "—"} <button class="btn btn-sm" data-act="model">设置</button></dd>
      <dt>结果</dt><dd>${t.result ? `<div class="md-body">${mdToHtml(t.result)}</div>` : "—"}</dd>
    </div>
  </div>

  <div class="detail-section">
    <h3>时间线</h3>
    <div class="timeline">
      <span>创建 <b>${fmtTime(t.created_at)}</b></span>
      <span>开始 <b>${fmtTime(t.started_at)}</b></span>
      <span>完成 <b>${fmtTime(t.completed_at)}</b></span>
      <span>心跳 <b>${t.last_heartbeat_at ? ago(t.last_heartbeat_at) : "—"}</b></span>
    </div>
  </div>

  ${t.body ? `<div class="detail-section"><h3>描述</h3><div class="md-body">${mdToHtml(t.body)}</div></div>` : ""}

  <div class="detail-section">
    <h3>上下文</h3>
    <div id="ctx-box">
      ${state.detailOpts.loadContext ? "" : `<button class="btn btn-sm" data-act="load-context">加载上下文</button>`}
    </div>
  </div>

  <div class="detail-section">
    <h3>日志</h3>
    <div id="log-box">
      <div class="attach-upload">
        <button class="btn btn-sm" data-act="load-log">加载日志</button>
        <button class="btn btn-sm" data-act="load-log-more" data-tail="4096">最近 4KB</button>
      </div>
    </div>
  </div>

  <div class="detail-section">
    <h3>通知订阅（<span id="notify-count">0</span>）</h3>
    <div id="notify-box"></div>
  </div>

  <div class="detail-section">
    <h3>依赖</h3>
    <div style="margin-bottom:6px">父任务（${d.parents.length}）</div>
    ${d.parents.map((p) => `
      <div class="link-row">
        <button class="lnk" data-open="${esc(p.id)}">${esc(p.title || p.id)}</button>
        <span class="card-id">${esc(p.id)}</span>
        <button class="icon-del" data-unlink="parent" data-other="${esc(p.id)}" title="解除依赖">✕</button>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无</div>`}
    <div style="margin:10px 0 6px">子任务（${d.children.length}）</div>
    ${d.children.map((c) => `
      <div class="link-row">
        <button class="lnk" data-open="${esc(c.id)}">${esc(c.title || c.id)}</button>
        <span class="card-id">${esc(c.id)}</span>
        <button class="icon-del" data-unlink="child" data-other="${esc(c.id)}" title="解除依赖">✕</button>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无</div>`}
    <div class="attach-upload">
      <input id="link-input" type="text" placeholder="任务 ID">
      <button class="btn btn-sm" data-act="add-link">添加依赖</button>
    </div>
  </div>

  <div class="detail-section">
    <h3>附件（${d.attachments.length}）</h3>
    ${d.attachments.map((a) => `
      <div class="attach-row">
        <span class="aname">${esc(a.filename)}</span>
        <span class="attach-meta">${a.size ? Math.ceil(a.size / 1024) + " KB" : ""} · ${esc(a.uploaded_by || "")} · ${ago(a.created_at)}</span>
        <button class="icon-del" data-del-attach="${a.id}" title="删除附件">✕</button>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无附件</div>`}
    <div class="attach-upload">
      <input type="file" id="attach-file">
      <button class="btn btn-sm" data-act="upload">上传</button>
    </div>
  </div>

  <div class="detail-section">
    <h3>评论（${d.comments.length}）</h3>
    ${d.comments.map((c) => `
      <div class="comment">
        <div class="comment-head"><span class="comment-author">${esc(c.author)}</span><span>${fmtTime(c.created_at)}</span></div>
        <div class="comment-body">${esc(c.body)}</div>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">暂无评论</div>`}
    <div class="attach-upload" style="margin-top:10px">
      <textarea id="comment-input" placeholder="写评论…" style="flex:1;min-width:200px"></textarea>
      <button class="btn btn-primary btn-sm" data-act="comment">发送</button>
    </div>
  </div>

  <div class="detail-section">
    <h3>运行记录（${d.runs.length}）</h3>
    ${d.runs.map((r) => `
      <div class="run">
        <div class="run-head">
          <span class="run-status ${esc(r.status)}">${esc(r.status)}</span>
          <span>@${esc(r.profile || "?")}</span>
          <span>${fmtTime(r.started_at)} → ${r.ended_at ? fmtTime(r.ended_at) : "进行中"}</span>
          ${r.outcome ? `<span style="color:var(--muted)">${esc(r.outcome)}</span>` : ""}
        </div>
        ${r.summary ? `<div class="run-summary">${mdToHtml(r.summary)}</div>` : ""}
        ${r.error ? `<div style="color:var(--danger);font-size:12px">${esc(r.error)}</div>` : ""}
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">暂无运行记录</div>`}
  </div>

  <div class="detail-section">
    <h3>事件流（最近 ${d.events.length}）</h3>
    ${d.events.map((e) => `
      <div class="event" style="--evc:${kindColor(e.kind)}">
        <span class="event-kind">${esc(e.kind)}</span>
        <span class="event-body">${esc(shortPayload(e.payload))}</span>
        <span class="event-time">${ago(e.created_at)}</span>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无事件</div>`}
  </div>`;

  wireDetailEvents(content, d);
  loadNotifyBox(t.id);
  if (state.detailOpts.loadContext) loadContext(t.id);
  if (state.detailOpts.loadLog) loadLog(t.id, 2048);
  state.detailOpts = {};
  wireDrawerSwipe();
}

function menuButtonsHtml(t) {
  const btns = [];
  if (t.status === "running") btns.push(`<button class="btn btn-sm" data-act="reclaim">回收运行</button>`);
  if (t.status === "running") btns.push(`<button class="btn btn-sm" data-act="heartbeat">心跳</button>`);
  if (t.status === "ready") btns.push(`<button class="btn btn-sm" data-act="claim">认领</button>`);
  if (t.status === "triage") btns.push(`<button class="btn btn-sm" data-act="specify">细化</button>`);
  if (t.status === "triage") btns.push(`<button class="btn btn-sm" data-act="decompose">分解</button>`);
  if (t.status === "done") btns.push(`<button class="btn btn-sm" data-act="edit-result">编辑结果</button>`);
  if (t.status === "todo") btns.push(`<button class="btn btn-sm" data-act="promote">提就绪</button>`);
  if (t.status === "blocked") btns.push(`<button class="btn btn-sm" data-act="unblock">解阻塞</button>`);
  if (t.status === "scheduled") btns.push(`<button class="btn btn-sm" data-act="unblock">提就绪</button>`);
  if (t.status === "review") btns.push(`<button class="btn btn-sm" data-act="reopen-review">重新评审</button>`);
  if (["todo", "blocked", "scheduled", "review"].includes(t.status)) btns.push(`<button class="btn btn-sm" data-act="request-review">提评审</button>`);
  if (t.status !== "done" && t.status !== "archived") btns.push(`<button class="btn btn-sm" data-act="complete">完成</button>`);
  if (t.status !== "blocked" && t.status !== "done" && t.status !== "archived") btns.push(`<button class="btn btn-sm" data-act="block">阻塞</button>`);
  if (t.status !== "scheduled" && t.status !== "done" && t.status !== "archived") btns.push(`<button class="btn btn-sm" data-act="schedule">定时</button>`);
  if (t.status !== "done" && t.status !== "archived") btns.push(`<button class="btn btn-sm" data-act="assign">改指派</button>`);
  if (t.status !== "archived") btns.push(`<button class="btn btn-sm" data-act="archive">归档</button>`);
  btns.push(`<button class="btn btn-sm" data-act="child">子任务</button>`);
  if (t.status !== "running") btns.push(`<button class="btn btn-sm" data-act="model">模型覆盖</button>`);
  return btns.join("");
}

function wireDetailEvents(content, d) {
  const t = d.task;
  content.addEventListener("click", async (e) => {
    const openEl = e.target.closest("[data-open]");
    if (openEl) { openDetail(openEl.dataset.open); return; }
    const act = e.target.closest("[data-act]");
    const unlinkBtn = e.target.closest("[data-unlink]");
    const delAttach = e.target.closest("[data-del-attach]");
    if (delAttach) {
      await api(`/api/tasks/${encodeURIComponent(t.id)}/attachments/${delAttach.dataset.delAttach}`, { method: "DELETE" })
        .then(() => toast("附件已删除", "ok")).catch((err) => toast("删除失败: " + err.message, "error"));
      openDetail(t.id); return;
    }
    if (unlinkBtn) {
      const dir = unlinkBtn.dataset.unlink, other = unlinkBtn.dataset.other;
      await api(`/api/tasks/${encodeURIComponent(t.id)}/link/${encodeURIComponent(other)}?direction=${dir}`, { method: "DELETE" })
        .then(() => toast("依赖已解除", "ok")).catch((err) => toast("失败: " + err.message, "error"));
      openDetail(t.id); return;
    }
    if (!act) return;
    const action = act.dataset.act;
    if (action === "close") { closeDrawer(); return; }
    if (action === "comment") {
      const box = el("comment-input");
      const body = (box.value || "").trim();
      if (!body) { toast("评论不能为空", "error"); return; }
      await api(`/api/tasks/${encodeURIComponent(t.id)}/comment`, jsonOpts("POST", { body }))
        .then(() => toast("评论已发布", "ok")).catch((err) => toast("失败: " + err.message, "error"));
      openDetail(t.id); return;
    }
    if (action === "upload") {
      const f = el("attach-file").files[0];
      if (!f) { toast("请选择文件", "error"); return; }
      const fd = new FormData();
      fd.append("file", f);
      await api(`/api/tasks/${encodeURIComponent(t.id)}/attachments`, { method: "POST", body: fd })
        .then(() => toast("上传成功", "ok")).catch((err) => toast("上传失败: " + err.message, "error"));
      openDetail(t.id); return;
    }
    if (action === "add-link") {
      const other = el("link-input").value.trim();
      if (!other) { toast("请输入任务 ID", "error"); return; }
      await api(`/api/tasks/${encodeURIComponent(t.id)}/link`, jsonOpts("POST", { other_id: other, direction: "child" }))
        .then(() => toast("依赖已添加", "ok")).catch((err) => toast("失败: " + err.message, "error"));
      openDetail(t.id); return;
    }
    if (action === "load-context") { loadContext(t.id); return; }
    if (action === "load-log" || action === "load-log-more") { loadLog(t.id, act.dataset.tail ? parseInt(act.dataset.tail, 10) : 2048); return; }
    if (action === "assign") { openAssignModal(t); return; }
    if (action === "child") { openCreateModal({ parent: t.id }); return; }
    if (action === "model") { openModelModal(t); return; }
    if (action === "edit-result") { openEditResultModal(t); return; }
    if (action === "specify" || action === "decompose" || action === "claim" || action === "heartbeat") { runExtended(t.id, action); return; }
    if (action === "block") { promptNoteAndRun(t, "block", "阻塞原因"); return; }
    if (action === "schedule") { promptNoteAndRun(t, "schedule", "定时说明"); return; }
    if (action === "promote") { promptNoteAndRun(t, "promote", "就绪说明"); return; }
    if (action === "request-changes") { promptNoteAndRun(t, "request-changes", "修改要求"); return; }
    if (action === "reopen-review") { promptNoteAndRun(t, "reopen-review", "重开原因"); return; }
    await runAction(t.id, action);
  });
}

async function loadContext(taskId) {
  const box = el("ctx-box");
  box.innerHTML = `<div class="empty" style="padding:12px">加载中…</div>`;
  try {
    const text = await apiText(`/api/tasks/${encodeURIComponent(taskId)}/context`);
    box.innerHTML = text ? `<pre class="pre-block" style="margin:0">${esc(text)}</pre>` : `<div class="empty" style="padding:12px">无上下文</div>`;
  } catch (err) {
    box.innerHTML = `<div class="empty" style="padding:12px">加载失败: ${esc(err.message)}</div>`;
  }
}

async function loadLog(taskId, tail) {
  const box = el("log-box");
  box.innerHTML = `<div class="empty" style="padding:12px">加载中…</div>`;
  try {
    const url = tail ? `/api/tasks/${encodeURIComponent(taskId)}/log?tail=${tail}` : `/api/tasks/${encodeURIComponent(taskId)}/log`;
    const text = await apiText(url);
    box.innerHTML = text
      ? `<pre class="pre-block" style="margin:0">${esc(text)}</pre><div class="attach-upload"><button class="btn btn-sm" data-act="load-log">重新加载</button></div>`
      : `<div class="empty" style="padding:12px">无日志</div>`;
  } catch (err) {
    box.innerHTML = `<div class="empty" style="padding:12px">加载失败: ${esc(err.message)}</div>`;
  }
}

async function loadNotifyBox(taskId) {
  const box = el("notify-box");
  el("notify-count").textContent = "…";
  let subs = [];
  try {
    subs = await api(`/api/tasks/${encodeURIComponent(taskId)}/notify`);
  } catch (_) { subs = []; }
  el("notify-count").textContent = subs.length;
  const rows = subs.map((s, i) => `
    <div class="notify-row">
      <span class="notify-platform">${esc(s.platform || "?")}</span>
      <span>${esc(s.chat_id || s.chatId || "")}${s.thread_id ? " · thread " + esc(s.thread_id) : ""}${s.chat_type ? " · " + esc(s.chat_type) : ""}</span>
      <button class="icon-del" data-del-notify="${i}" title="取消订阅">✕</button>
    </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无订阅</div>`;
  box.innerHTML = rows + `
    <div class="attach-upload">
      <input id="n-platform" type="text" placeholder="platform (如 slack / weixin)" style="max-width:150px">
      <input id="n-chat" type="text" placeholder="chat-id" style="max-width:170px">
      <input id="n-thread" type="text" placeholder="thread-id(可选)" style="max-width:130px">
      <button class="btn btn-sm btn-primary" data-act="notify-add">订阅</button>
    </div>`;
  $$("[data-del-notify]", box).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const s = subs[+btn.dataset.delNotify];
      if (!s) return;
      try {
        await api(`/api/tasks/${encodeURIComponent(taskId)}/notify`, jsonOpts("DELETE", {
          platform: s.platform, chat_id: s.chat_id || s.chatId, thread_id: s.thread_id,
        }));
        toast("已取消订阅", "ok");
        loadNotifyBox(taskId);
      } catch (err) { toast("取消失败: " + err.message, "error"); }
    });
  });
  const addBtn = $("[data-act='notify-add']", box);
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const platform = el("n-platform").value.trim();
      const chat = el("n-chat").value.trim();
      if (!platform || !chat) { toast("platform 和 chat-id 必填", "error"); return; }
      try {
        const res = await api(`/api/tasks/${encodeURIComponent(taskId)}/notify`, jsonOpts("POST", {
          platform, chat_id: chat, thread_id: el("n-thread").value.trim() || undefined,
        }));
        toast(res.message || "已订阅", "ok");
        loadNotifyBox(taskId);
      } catch (err) { toast("订阅失败: " + err.message, "error"); }
    });
  }
}

function promptNoteAndRun(t, action, label) {
  openModal(`
    <h2 style="margin-top:0">${ACTION_LABEL[action] || action}</h2>
    <div class="input-row"><label>${label}</label><textarea id="note-input" placeholder="可选备注…"></textarea></div>
    <div class="attach-upload">
      <button class="btn btn-primary" data-confirm>确认</button>
      <button class="btn" data-close>取消</button>
    </div>`);
  $("[data-confirm]").onclick = async () => {
    closeModal();
    await runAction(t.id, action, el("note-input").value.trim());
  };
  $("#modal-content [data-close]").onclick = closeModal;
}

function closeDrawer() {
  state.detailId = null;
  el("drawer").classList.add("hidden");
}

function wireDrawerSwipe() {
  const inner = el("drawer-content");
  if (inner._swipe) return;
  inner._swipe = true;
  let startY = null;
  inner.addEventListener("touchstart", (e) => {
    if (inner.scrollTop <= 0) startY = e.touches[0].clientY;
  }, { passive: true });
  inner.addEventListener("touchmove", (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 80) { closeDrawer(); startY = null; }
  }, { passive: true });
  inner.addEventListener("touchend", () => { startY = null; }, { passive: true });
}

/* ---------- modals ---------- */
function openModal(html) {
  el("modal").classList.remove("hidden");
  el("modal-content").innerHTML = html;
}

function closeModal() { el("modal").classList.add("hidden"); }

function openCreateModal(prefill = {}) {
  let mode = "normal";
  const render = () => {
    openModal(`
      <h2 style="margin-top:0">新建任务</h2>
      <div class="modal-tabs">
        <button class="modal-tab${mode === "normal" ? " active" : ""}" data-mode="normal">普通任务</button>
        <button class="modal-tab${mode === "swarm" ? " active" : ""}" data-mode="swarm">Swarm</button>
      </div>
      <div id="create-body"></div>`);
    $$(".modal-tab").forEach((btn) => btn.addEventListener("click", () => { mode = btn.dataset.mode; render(); }));
    if (mode === "normal") renderCreateNormal(prefill);
    else renderCreateSwarm(prefill);
  };
  render();
}

function renderCreateNormal(prefill) {
  const host = el("create-body");
  const assigneeOpts = state.assignees.map((a) => ({ value: a.name, label: a.name }));
  host.innerHTML = `
    <div class="input-row"><label>标题 *</label><input id="f-title" type="text" placeholder="任务标题" value="${esc(prefill.title || "")}"></div>
    <div class="input-row"><label>描述</label><textarea id="f-body" placeholder="任务描述（支持换行 / 代码块 / 粗体）">${esc(prefill.body || "")}</textarea></div>
    <div class="form-row">
      <div><label>指派</label><div class="sel-host" id="f-assignee-host"></div></div>
      <div><label>优先级</label><div class="sel-host" id="f-priority-host"></div></div>
    </div>
    <div class="form-row">
      <div><label>工作区</label><div class="sel-host" id="f-workspace-host"></div></div>
      <div><label>父任务 ID（可选）</label><input id="f-parent" type="text" placeholder="t_xxxx" value="${esc(prefill.parent || "")}"></div>
    </div>
    <div class="switch-row input-row">
      <span style="color:var(--muted)">放入待梳理（triage）</span>
      <label class="switch"><input id="f-triage" type="checkbox"><span class="slider"></span></label>
    </div>
    <div class="attach-upload">
      <button class="btn btn-primary" data-create>创建</button>
      <button class="btn" data-close>取消</button>
    </div>`;
  el("f-assignee-host").appendChild(mkSelect({
    options: [{ value: "", label: "未指派" }, ...assigneeOpts],
    value: "", placeholder: "未指派", onChange: () => {},
  }));
  el("f-priority-host").appendChild(mkSelect({
    options: [
      { value: "0", label: "P0 普通" }, { value: "1", label: "P1" },
      { value: "2", label: "P2" }, { value: "3", label: "P3 最高" },
    ],
    value: "0", placeholder: "P0 普通", onChange: () => {},
  }));
  el("f-workspace-host").appendChild(mkSelect({
    options: [
      { value: "scratch", label: "scratch（默认）" },
      { value: "worktree", label: "worktree" },
      { value: "dir", label: "dir" },
    ],
    value: "scratch", placeholder: "scratch", onChange: () => {},
  }));
  $("[data-create]").onclick = async () => {
    const title = el("f-title").value.trim();
    if (!title) { toast("标题不能为空", "error"); return; }
    const parent = el("f-parent").value.trim();
    const payload = {
      title,
      body: el("f-body").value,
      assignee: readSelect("f-assignee-host") || undefined,
      priority: parseInt(readSelect("f-priority-host"), 10) || 0,
      workspace: readSelect("f-workspace-host"),
      triage: el("f-triage").checked,
    };
    if (parent) payload.parent = [parent];
    try {
      const res = await api("/api/tasks", jsonOpts("POST", payload));
      toast("已创建 " + (res.id || ""), "ok");
      closeModal();
      await refreshBoard();
      if (res.id) openDetail(res.id);
    } catch (err) {
      toast("创建失败: " + err.message, "error");
    }
  };
  $("#modal-content [data-close]").onclick = closeModal;
}

function readSelect(hostId) {
  const btn = $(".cs-btn", el(hostId));
  return btn && typeof btn._value === "function" ? btn._value() : "";
}

function renderCreateSwarm(prefill) {
  const host = el("create-body");
  let workers = prefill.swarmWorkers || [{ profile: "", title: "", skills: "" }];
  const assigneeOpts = state.assignees.map((a) => ({ value: a.name, label: a.name }));

  const renderWorkers = () => {
    const wh = el("swarm-workers");
    wh.innerHTML = "";
    workers.forEach((w, i) => {
      const row = document.createElement("div");
      row.className = "worker-row";
      row.innerHTML = `
        <input class="ww-profile" placeholder="profile *" value="${esc(w.profile)}" aria-label="profile">
        <input class="ww-title" placeholder="title(可选)" value="${esc(w.title)}" aria-label="title">
        <input class="ww-skills" placeholder="skills,逗号分隔(可选)" value="${esc(w.skills)}" aria-label="skills">
        <button class="btn btn-sm ww-del" type="button" aria-label="移除">✕</button>`;
      row.querySelector(".ww-profile").addEventListener("input", (e) => { w.profile = e.target.value; });
      row.querySelector(".ww-title").addEventListener("input", (e) => { w.title = e.target.value; });
      row.querySelector(".ww-skills").addEventListener("input", (e) => { w.skills = e.target.value; });
      row.querySelector(".ww-del").addEventListener("click", () => { workers.splice(i, 1); if (!workers.length) workers.push({ profile: "", title: "", skills: "" }); renderWorkers(); });
      wh.appendChild(row);
    });
  };

  host.innerHTML = `
    <div class="input-row"><label>目标（goal）*</label><textarea id="sw-goal" placeholder="Swarm 最终要达成的结果">${esc(prefill.body || "")}</textarea></div>
    <div class="input-row">
      <label>Workers</label>
      <div id="swarm-workers"></div>
      <div class="swarm-actions" style="margin-top:4px">
        <button class="btn btn-sm" id="sw-add-worker">＋ 添加 Worker</button>
      </div>
    </div>
    <div class="form-row">
      <div><label>Verifier（评审 profile）</label><input id="sw-verifier" type="text" placeholder="profile"></div>
      <div><label>Synthesizer（汇总 profile）</label><input id="sw-synth" type="text" placeholder="profile"></div>
    </div>
    <div class="form-row">
      <div><label>优先级</label><div class="sel-host" id="sw-priority-host"></div></div>
      <div><label>创建者</label><div class="sel-host" id="sw-assignee-host"></div></div>
    </div>
    <div class="attach-upload">
      <button class="btn btn-primary" data-swarm-create>创建 Swarm</button>
      <button class="btn" data-close>取消</button>
    </div>`;

  renderWorkers();
  el("sw-add-worker").addEventListener("click", () => { workers.push({ profile: "", title: "", skills: "" }); renderWorkers(); });
  el("sw-priority-host").appendChild(mkSelect({
    options: [{ value: "0", label: "P0 普通" }, { value: "1", label: "P1" }, { value: "2", label: "P2" }, { value: "3", label: "P3 最高" }],
    value: "0", placeholder: "P0 普通", onChange: () => {},
  }));
  el("sw-assignee-host").appendChild(mkSelect({
    options: [{ value: "", label: "默认" }, ...assigneeOpts],
    value: "", placeholder: "默认", onChange: () => {},
  }));

  $("[data-swarm-create]").onclick = async () => {
    const goal = el("sw-goal").value.trim();
    if (!goal) { toast("目标不能为空", "error"); return; }
    const validWorkers = workers
      .map((w) => ({ profile: w.profile.trim(), title: w.title.trim(), skills: w.skills.trim() }))
      .filter((w) => w.profile);
    if (!validWorkers.length) { toast("至少需要一个 worker profile", "error"); return; }
    const verifier = el("sw-verifier").value.trim();
    const synth = el("sw-synth").value.trim();
    if (!verifier || !synth) { toast("verifier 和 synthesizer 必填", "error"); return; }
    const payload = {
      goal,
      workers: validWorkers.map((w) => ({ profile: w.profile, title: w.title || undefined, skills: w.skills ? w.skills.split(",").map((s) => s.trim()).filter(Boolean) : undefined })),
      verifier,
      synthesizer: synth,
      priority: parseInt(readSelect("sw-priority-host"), 10) || 0,
    };
    const createdBy = readSelect("sw-assignee-host");
    if (createdBy) payload.created_by = createdBy;
    toast("Swarm 创建中…可能需要 1-3 分钟", "info", 12000);
    try {
      const res = await api("/api/swarm", jsonOpts("POST", payload));
      toast(res.message || "Swarm 已创建", "ok");
      closeModal();
      await refreshBoard();
    } catch (err) {
      toast("创建失败: " + err.message, "error");
    }
  };
  $("#modal-content [data-close]").onclick = closeModal;
}

function openAssignModal(t) {
  const assigneeOpts = state.assignees.map((a) => ({ value: a.name, label: a.name }));
  openModal(`
    <h2 style="margin-top:0">改指派</h2>
    <div class="input-row"><label>指派给</label><div class="sel-host" id="a-assignee-host"></div></div>
    <div class="attach-upload">
      <button class="btn btn-primary" data-confirm>确认</button>
      <button class="btn" data-close>取消</button>
    </div>`);
  el("a-assignee-host").appendChild(mkSelect({
    options: [{ value: "", label: "未指派" }, ...assigneeOpts],
    value: t.assignee || "",
    placeholder: "未指派",
    onChange: () => {},
  }));
  $("[data-confirm]").onclick = async () => {
    const assignee = readSelect("a-assignee-host");
    try {
      await api(`/api/tasks/${encodeURIComponent(t.id)}/assign`, jsonOpts("POST", { assignee }));
      toast("已更新指派", "ok");
      closeModal();
      await refreshBoard();
      if (state.detailId) openDetail(state.detailId);
    } catch (err) { toast("失败: " + err.message, "error"); }
  };
  $("#modal-content [data-close]").onclick = closeModal;
}

function openModelModal(t) {
  openModal(`
    <h2 style="margin-top:0">模型覆盖</h2>
    <div class="input-row"><label>模型</label><input id="m-model" type="text" placeholder="模型名，清空则清除覆盖" value="${esc(t.model_override || "")}"></div>
    <div class="input-row"><label>Provider</label><input id="m-provider" type="text" placeholder="可选" value="${esc(t.provider_override || "")}"></div>
    <div class="attach-upload">
      <button class="btn btn-primary" data-confirm>确认</button>
      <button class="btn" data-close>取消</button>
    </div>`);
  $("[data-confirm]").onclick = async () => {
    try {
      await api(`/api/tasks/${encodeURIComponent(t.id)}/set-model`, jsonOpts("POST", {
        model: el("m-model").value.trim() || null,
        provider: el("m-provider").value.trim() || null,
      }));
      toast("已更新模型覆盖", "ok");
      closeModal();
      await refreshBoard();
      if (state.detailId) openDetail(state.detailId);
    } catch (err) { toast("失败: " + err.message, "error"); }
  };
  $("#modal-content [data-close]").onclick = closeModal;
}

/* ---------- stats view ---------- */
function enterStats() {
  if (!state.events.length) {
    state.eventSince = 0;
    pollEvents();
  }
  startEventPolling();
  renderStats();
}

async function renderStats() {
  let s = null;
  try { s = await api("/api/stats"); } catch (err) { s = null; toast("统计加载失败: " + err.message, "error"); }
  const byStatus = (s && s.by_status) || {};
  const byAssignee = (s && s.by_assignee) || {};
  const oldest = s && s.oldest_ready_age_seconds;

  const total = STATUS_ORDER.reduce((a, st) => a + (byStatus[st] || 0), 0) || 1;
  const segs = STATUS_ORDER.map((st) => {
    const n = byStatus[st] || 0;
    return n ? `<div class="bar-seg st-${st}" style="width:${((n / total) * 100).toFixed(2)}%"></div>` : "";
  }).join("");
  const statusPanel = el("stats-status");
  statusPanel.innerHTML = `
    <div class="panel-head"><h3>状态分布</h3><span class="panel-note num">共 ${total} 个</span></div>
    <div class="bar-row">
      <span class="bar-label">合计</span>
      <div class="bar-track">${segs || `<div class="empty" style="padding:6px;font-size:12px">暂无任务</div>`}</div>
      <span class="bar-val num">${total}</span>
    </div>
    ${STATUS_ORDER.map((st) => {
      const n = byStatus[st] || 0;
      return `
      <div class="bar-row">
        <span class="bar-label"><span class="dot st-${st}" style="--c:${STATUS_CSS[st]}"></span>${STATUS[st]}</span>
        <div class="bar-track"><div class="bar-seg st-${st}" style="width:${(n / total * 100).toFixed(2)}%"></div></div>
        <span class="bar-val num">${n}</span>
      </div>`;
    }).join("")}`;

  const assigneePanel = el("stats-assignee");
  const rows = Object.entries(byAssignee)
    .map(([name, counts]) => ({ name, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
  const maxA = rows.reduce((m, r) => Math.max(m, r.total), 1) || 1;
  assigneePanel.innerHTML = `
    <div class="panel-head"><h3>指派分布</h3><span class="panel-note">${rows.length} 人</span></div>
    ${rows.map((r) => `
      <div class="bar-row">
        <span class="bar-label">@${esc(r.name)}</span>
        <div class="bar-track"><div class="bar-seg" style="width:${(r.total / maxA * 100).toFixed(1)}%;background:var(--accent)"></div></div>
        <span class="bar-val num">${r.total}</span>
      </div>`).join("") || `<div class="empty" style="padding:10px;font-size:12px">暂无指派</div>`}`;

  const readyPanel = el("stats-ready");
  readyPanel.innerHTML = `
    <div class="panel-head"><h3>最老 Ready 任务</h3></div>
    <div class="big-number num">${oldest !== null && oldest !== undefined ? dur(oldest) : "—"}</div>
    <div class="big-label">等待就绪最久的任务</div>
    <div class="big-sub">${(s && s.now) ? "统计时间 " + fmtTime(s.now) : ""}</div>`;
}

const STATUS_CSS = {
  todo: "#8b95ad", ready: "#5ff0e0", running: "#61afff", blocked: "#ff5c6c",
  scheduled: "#ffb86c", review: "#c792ea", done: "#50e07f", archived: "#56607a", triage: "#ffe14d",
};

async function pollEvents() {
  try {
    const list = await api(`/api/events?since=${state.eventSince}`);
    if (!list || !list.length) return;
    const seen = new Set(state.events.map((e) => e.id));
    let nearBottom = true;
    const listEl = el("events-list");
    if (listEl) {
      nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 70;
    }
    for (const ev of list) {
      if (!seen.has(ev.id)) { state.events.push(ev); seen.add(ev.id); }
    }
    if (state.events.length > 100) state.events = state.events.slice(state.events.length - 100);
    state.eventSince = list[list.length - 1].created_at;
    renderEvents();
    if (nearBottom && listEl) listEl.scrollTop = listEl.scrollHeight;
  } catch (_) { /* silent — stats events best-effort */ }
}

function renderEvents() {
  const listEl = el("events-list");
  if (!listEl) return;
  listEl.innerHTML = state.events.length
    ? state.events.map((e) => `
      <div class="event" style="--evc:${kindColor(e.kind)}">
        <span class="event-kind">${esc(e.kind)}</span>
        <span class="event-body">${esc(shortPayload(e.payload))}</span>
        <span class="event-time num">${ago(e.created_at)}</span>
      </div>`).join("")
    : `<div class="empty" style="padding:20px">等待事件…</div>`;
}

/* ---------- settings view ---------- */
function renderSettings() {
  renderSettingsBoard();
  renderSettingsNotify();
  renderSettingsMaintain();
  renderSettingsAbout();
}

function activeBoards() {
  return (state.boards || []).filter((b) => !b.archived);
}

function renderSettingsBoard() {
  const host = el("settings-board");
  const boards = activeBoards();
  const cur = state.currentBoard;
  const opts = boards.map((b) => ({ value: b.slug, label: b.slug + (b.is_current ? " ●" : "") }));

  host.innerHTML = `
    <div class="settings-block">
      <h4>当前 Board</h4>
      <div class="kv">
        <dt>Slug</dt><dd><code class="mono">${esc(cur ? cur.slug : "…")}</code></dd>
        <dt>名称</dt><dd>${esc(cur ? cur.name : "…")}</dd>
      </div>
    </div>
    <div class="settings-block">
      <h4>切换 Board</h4>
      <div class="settings-actions">
        <div class="sel-host grow" id="st-switch-host"></div>
        <button class="btn btn-primary" id="st-switch-btn">切换</button>
      </div>
    </div>
    <div class="settings-block">
      <h4>创建 Board</h4>
      <div class="form-row">
        <div><label>Slug（kebab-case）*</label><input id="st-new-slug" placeholder="my-project"></div>
        <div><label>名称</label><input id="st-new-name" placeholder="可选"></div>
      </div>
      <div class="form-row">
        <div><label>描述</label><input id="st-new-desc" placeholder="可选"></div>
        <div><label>Icon</label><input id="st-new-icon" placeholder="可选，emoji"></div>
      </div>
      <div class="form-row">
        <div><label>颜色</label><input id="st-new-color" type="color" value="#5ff0e0"></div>
        <div style="visibility:hidden"></div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="st-create-btn">创建</button>
      </div>
    </div>
    <div class="settings-block">
      <h4>重命名</h4>
      <div class="settings-actions">
        <div class="sel-host grow" id="st-rename-sel"></div>
        <input id="st-rename-name" placeholder="新名称 *" style="flex:1">
        <button class="btn" id="st-rename-btn">重命名</button>
      </div>
    </div>
    <div class="settings-block">
      <h4>默认工作目录</h4>
      <div class="settings-actions">
        <div class="sel-host grow" id="st-workdir-sel"></div>
        <input id="st-workdir-path" placeholder="绝对路径（留空清除）" style="flex:1">
        <button class="btn" id="st-workdir-set">设置</button>
        <button class="btn" id="st-workdir-clear">清除</button>
      </div>
    </div>
    <div class="settings-block">
      <h4>归档 / 删除</h4>
      <div class="settings-actions">
        <div class="sel-host grow" id="st-rm-sel"></div>
        <button class="btn" id="st-rm-archive">归档</button>
        <button class="btn btn-danger" id="st-rm-delete">删除（不可恢复）</button>
      </div>
    </div>`;

  let switchSel = "", renameSel = "", workdirSel = "", rmSel = "";
  el("st-switch-host").appendChild(mkSelect({ options: opts, value: cur ? cur.slug : "", placeholder: "选择 board", onChange: (v) => { switchSel = v; } }));
  el("st-rename-sel").appendChild(mkSelect({ options: opts, value: "", placeholder: "选择 board", onChange: (v) => { renameSel = v; } }));
  el("st-workdir-sel").appendChild(mkSelect({ options: opts, value: "", placeholder: "选择 board", onChange: (v) => { workdirSel = v; } }));
  el("st-rm-sel").appendChild(mkSelect({ options: opts, value: "", placeholder: "选择 board", onChange: (v) => { rmSel = v; } }));

  el("st-switch-btn").addEventListener("click", async () => {
    if (!switchSel) { toast("请先选择 board", "warn"); return; }
    await boardOp("切换", () => api(`/api/boards/${encodeURIComponent(switchSel)}/switch`, jsonOpts("POST", {})));
  });
  el("st-create-btn").addEventListener("click", async () => {
    const slug = el("st-new-slug").value.trim();
    if (!slug) { toast("slug 不能为空", "error"); return; }
    await boardOp("创建", () => api("/api/boards", jsonOpts("POST", {
      slug,
      name: el("st-new-name").value.trim() || undefined,
      description: el("st-new-desc").value.trim() || undefined,
      icon: el("st-new-icon").value.trim() || undefined,
      color: el("st-new-color").value || undefined,
    })));
  });
  el("st-rename-btn").addEventListener("click", async () => {
    if (!renameSel) { toast("请先选择 board", "warn"); return; }
    const name = el("st-rename-name").value.trim();
    if (!name) { toast("名称不能为空", "error"); return; }
    await boardOp("重命名", () => api(`/api/boards/${encodeURIComponent(renameSel)}/rename`, jsonOpts("POST", { name })));
  });
  el("st-workdir-set").addEventListener("click", async () => {
    if (!workdirSel) { toast("请先选择 board", "warn"); return; }
    const path = el("st-workdir-path").value.trim();
    await boardOp("设置工作目录", () => api(`/api/boards/${encodeURIComponent(workdirSel)}/workdir`, jsonOpts("POST", { path: path || null })));
  });
  el("st-workdir-clear").addEventListener("click", async () => {
    if (!workdirSel) { toast("请先选择 board", "warn"); return; }
    await boardOp("清除工作目录", () => api(`/api/boards/${encodeURIComponent(workdirSel)}/workdir`, jsonOpts("POST", { path: null })));
  });
  el("st-rm-archive").addEventListener("click", async () => {
    if (!rmSel) { toast("请先选择 board", "warn"); return; }
    confirmAction(`确认归档 board「${rmSel}」？（可恢复）`, async () => {
      await boardOp("归档", () => api(`/api/boards/${encodeURIComponent(rmSel)}`, { method: "DELETE" }));
    });
  });
  el("st-rm-delete").addEventListener("click", async () => {
    if (!rmSel) { toast("请先选择 board", "warn"); return; }
    confirmAction(`确认永久删除 board「${rmSel}」？此操作不可恢复！`, async () => {
      await boardOp("删除", () => api(`/api/boards/${encodeURIComponent(rmSel)}`, jsonOpts("DELETE", { delete: true })));
    }, true);
  });
}

/* helper: capture the current value of a custom select via its label */
async function boardOp(label, fn) {
  try {
    const res = await fn();
    toast((res && res.message) || label + "成功", "ok");
    await loadBoards();
    renderSettingsBoard();
    await refreshBoard();
  } catch (err) {
    toast(label + "失败: " + err.message, "error");
  }
}

function confirmAction(message, fn, danger = false) {
  openModal(`
    <h2 style="margin-top:0">确认操作</h2>
    <p style="color:var(--text);word-break:break-word">${esc(message)}</p>
    <div class="attach-upload">
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>确认</button>
      <button class="btn" data-close>取消</button>
    </div>`);
  $("[data-confirm]").onclick = async () => { closeModal(); await fn(); };
  $("#modal-content [data-close]").onclick = closeModal;
}

function renderSettingsNotify() {
  const host = el("settings-notify");
  host.innerHTML = `
    <div class="settings-block">
      <h4>查询任务订阅</h4>
      <div class="settings-actions">
        <input id="st-notify-task" placeholder="任务 ID (t_xxxx)" style="flex:1;max-width:280px">
        <button class="btn btn-primary" id="st-notify-load">查看</button>
      </div>
      <div id="st-notify-subs" class="notify-list"></div>
    </div>`;
  el("st-notify-load").addEventListener("click", async () => {
    const tid = el("st-notify-task").value.trim();
    if (!tid) { toast("请输入任务 ID", "warn"); return; }
    const box = el("st-notify-subs");
    box.innerHTML = `<div class="empty" style="padding:12px">加载中…</div>`;
    try {
      const subs = await api(`/api/tasks/${encodeURIComponent(tid)}/notify`);
      box.innerHTML = subs.length ? subs.map((s, i) => `
        <div class="notify-row">
          <span class="notify-platform">${esc(s.platform || "?")}</span>
          <span>${esc(s.chat_id || s.chatId || "")}${s.thread_id ? " · thread " + esc(s.thread_id) : ""}</span>
          <button class="icon-del" data-del-n="${i}" title="取消订阅">✕</button>
        </div>`).join("") : `<div class="empty" style="padding:12px">该任务无订阅</div>`;
      $$("[data-del-n]", box).forEach((btn) => {
        btn.addEventListener("click", async () => {
          const s = subs[+btn.dataset.delN];
          try {
            await api(`/api/tasks/${encodeURIComponent(tid)}/notify`, jsonOpts("DELETE", {
              platform: s.platform, chat_id: s.chat_id || s.chatId, thread_id: s.thread_id,
            }));
            toast("已取消订阅", "ok");
            el("st-notify-load").click();
          } catch (err) { toast("取消失败: " + err.message, "error"); }
        });
      });
    } catch (err) {
      box.innerHTML = `<div class="empty" style="padding:12px">加载失败: ${esc(err.message)}</div>`;
    }
  });
}

function renderSettingsMaintain() {
  const host = el("settings-maintain");
  host.innerHTML = `
    <div class="settings-block">
      <h4>垃圾回收（GC）</h4>
      <div class="settings-actions">
        <button class="btn" id="st-gc">运行 GC</button>
        <span class="panel-note">清理过期事件与日志（默认保留 30 天）</span>
      </div>
    </div>
    <div class="settings-block">
      <h4>数据库检查 / 修复</h4>
      <div class="settings-actions">
        <button class="btn" id="st-repair">运行检查</button>
      </div>
      <div id="st-maintain-out"></div>
    </div>`;
  el("st-gc").addEventListener("click", () => {
    openModal(`
      <h2 style="margin-top:0">运行 GC</h2>
      <div class="form-row">
        <div><label>事件保留天数</label><input id="gc-events" type="number" value="30" min="1"></div>
        <div><label>日志保留天数</label><input id="gc-logs" type="number" value="30" min="1"></div>
      </div>
      <div class="attach-upload">
        <button class="btn btn-primary" data-confirm>运行</button>
        <button class="btn" data-close>取消</button>
      </div>`);
    $("[data-confirm]").onclick = async () => {
      const ev = parseInt(el("gc-events").value, 10);
      const lg = parseInt(el("gc-logs").value, 10);
      closeModal();
      toast("GC 执行中…", "info");
      try {
        const res = await api("/api/gc", jsonOpts("POST", {
          event_retention_days: isNaN(ev) ? undefined : ev,
          log_retention_days: isNaN(lg) ? undefined : lg,
        }));
        el("st-maintain-out").innerHTML = `<pre class="pre-block">${esc(res.message || "GC 完成")}</pre>`;
        toast(res.message || "GC 完成", "ok");
      } catch (err) { toast("GC 失败: " + err.message, "error"); }
    };
    $("#modal-content [data-close]").onclick = closeModal;
  });
  el("st-repair").addEventListener("click", async () => {
    toast("DB 检查中…", "info");
    try {
      const res = await api("/api/repair", { method: "POST" });
      el("st-maintain-out").innerHTML = `<pre class="pre-block">${esc(JSON.stringify(res, null, 2))}</pre>`;
      toast("检查完成", "ok");
    } catch (err) { toast("检查失败: " + err.message, "error"); }
  });
}

function renderSettingsAbout() {
  const host = el("settings-about");
  host.innerHTML = `
    <div><b>Hermes Kanban Web</b> · v2（HUD 设计系统）</div>
    <div class="kv" style="margin-top:6px">
      <dt>端口</dt><dd><code class="mono">9120</code></dd>
      <dt>数据层</dt><dd>只读 SQLite + <code class="mono">hermes kanban</code> CLI 写操作</dd>
      <dt>主题</dt><dd>${THEMES.map((t) => esc(t.label)).join(" · ")}</dd>
      <dt>轮询</dt><dd>看板 30s · 事件 5s</dd>
    </div>
    <div class="settings-actions" style="margin-top:12px">
      <button class="btn btn-danger" id="st-logout">退出登录</button>
    </div>`;
  el("st-logout").addEventListener("click", () => {
    clearAuth();
    showLogin();
    toast("已退出登录", "info");
  });
}

/* ---------- events wiring ---------- */
function wireGlobal() {
  $$(".nav-btn, .top-nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.nav)));

  el("refresh").addEventListener("click", () => { refreshBoard(); if (state.view === "stats") renderStats(); });
  el("fab").addEventListener("click", () => openCreateModal());

  el("search").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    el("list-search").value = state.search;
    if (state.view === "list") renderList();
  });
  el("list-search").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    el("search").value = state.search;
    if (state.view === "list") renderList();
  });
  el("sort-btn").addEventListener("click", () => {
    state.sortBy = state.sortBy === "created" ? "priority" : "created";
    renderList();
  });
  el("list-archived").addEventListener("change", (e) => { state.listArchived = e.target.checked; renderList(); });

  el("list-tasks").addEventListener("click", (e) => {
    const row = e.target.closest("[data-open]");
    if (row) openDetail(row.dataset.open);
  });

  el("drawer").addEventListener("click", (e) => {
    if (e.target === el("drawer")) closeDrawer();
  });

  el("menu").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-mi]");
    if (!btn) return;
    const action = btn.dataset.mi;
    const task = el("menu")._task;
    closeMenu();
    if (!task) return;
    if (action === "view") { openDetail(task.id); return; }
    if (action === "assign") { openAssignModal(task); return; }
    if (action === "child") { openCreateModal({ parent: task.id }); return; }
    if (action === "edit-result") { openEditResultModal(task); return; }
    if (action === "context") { openDetail(task.id, { loadContext: true }); return; }
    if (action === "log") { openDetail(task.id, { loadLog: true }); return; }
    if (action === "specify" || action === "decompose" || action === "claim" || action === "heartbeat") { runExtended(task.id, action); return; }
    if (["block", "schedule", "promote", "request-changes"].includes(action)) { promptNoteAndRun(task, action, ACTION_LABEL[action]); return; }
    await runAction(task.id, action);
  });

  el("modal").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-scrim")) closeModal();
  });

  el("theme-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    el("theme-pop").classList.toggle("hidden");
  });
  el("theme-pop").addEventListener("click", (e) => {
    const item = e.target.closest("[data-theme]");
    if (!item) return;
    applyTheme(item.dataset.theme);
    el("theme-pop").classList.add("hidden");
  });

  el("board").addEventListener("click", (e) => {
    const foldBtn = e.target.closest("[data-fold]");
    if (foldBtn) {
      const status = foldBtn.dataset.fold;
      const col = foldBtn.closest(".column");
      const isFolded = col.classList.toggle("folded");
      setCollapsed(status, isFolded);
      foldBtn.textContent = isFolded ? "▸" : "▾";
      foldBtn.title = isFolded ? "展开" : "折叠";
      foldBtn.setAttribute("aria-label", isFolded ? "展开" : "折叠");
      return;
    }
    const card = e.target.closest(".card");
    if (!card) return;
    if (e.target.closest("[data-menu]")) return; // ⋯ 菜单交给全局处理
    openDetail(card.dataset.id);
  });

  document.addEventListener("click", (e) => {
    if (!el("menu").classList.contains("hidden") && !e.target.closest("#menu") && !e.target.closest("[data-menu]")) {
      closeMenu();
    }
    if (!el("theme-pop").classList.contains("hidden") && !e.target.closest("#theme-wrap")) {
      el("theme-pop").classList.add("hidden");
    }
    closeSel();
    const menuBtn = e.target.closest("[data-menu]");
    if (menuBtn) {
      e.stopPropagation();
      showMenuForId(menuBtn.dataset.menu, menuBtn);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenu(); closeSel(); closeModal(); closeDrawer(); el("theme-pop").classList.add("hidden"); }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stopPolling(); stopEventPolling(); }
    else {
      startPolling();
      if (state.view === "stats") { startEventPolling(); pollEvents(); }
      refreshBoard();
    }
  });
}

/* ---------- polling ---------- */
function startPolling() {
  if (state.boardTimer) return;
  state.boardTimer = setInterval(() => { if (!document.hidden) refreshBoard(); }, 30000);
}
function stopPolling() {
  if (state.boardTimer) { clearInterval(state.boardTimer); state.boardTimer = null; }
}
function startEventPolling() {
  if (state.eventTimer) return;
  state.eventTimer = setInterval(() => { if (!document.hidden && state.view === "stats") pollEvents(); }, 5000);
}
function stopEventPolling() {
  if (state.eventTimer) { clearInterval(state.eventTimer); state.eventTimer = null; }
}

/* ---------- boot ---------- */
(function init() {
  try {
    const saved = localStorage.getItem("kb-theme");
    applyTheme(saved || "hud");
  } catch (_) { applyTheme("hud"); }
  renderThemePop();
  wireGlobal();

  el("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = el("login-user").value.trim();
    const pass = el("login-pass").value;
    const err = el("login-error");
    const btn = el("login-btn");
    err.classList.add("hidden");
    btn.disabled = true; btn.textContent = "验证中…";
    try {
      const res = await fetch("/api/board", {
        headers: { Authorization: "Basic " + btoa(user + ":" + pass) },
      });
      if (res.ok) {
        setAuth(user, pass);
        hideLogin();
        startPolling();
        refreshBoard();
        loadBoards();
      } else {
        err.textContent = "用户名或密码错误";
        err.classList.remove("hidden");
      }
    } catch (_) {
      err.textContent = "无法连接服务器，请重试";
      err.classList.remove("hidden");
    }
    btn.disabled = false; btn.textContent = "登录";
  });

  if (getAuth()) {
    startPolling();
    refreshBoard();
    loadBoards();
  } else {
    showLogin();
  }
})();
