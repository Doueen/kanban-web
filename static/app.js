"use strict";

/* ---------- state ---------- */
const state = {
  view: "board",
  board: null,
  assignees: [],
  search: "",
  listStatus: "",
  listAssignee: "",
  detailId: null,
  refreshTimer: null,
};

const STATUS = {
  todo: "待办", ready: "就绪", running: "运行中", blocked: "阻塞",
  scheduled: "定时", review: "评审", done: "完成", archived: "归档", triage: "待梳理",
};

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

/* ---------- api ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON */ }
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

const jsonOpts = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function toast(msg, type = "info", ms = 2600) {
  const t = el("toast");
  t.textContent = msg;
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

function cardHtml(t) {
  const assignee = t.assignee
    ? `<span class="card-assignee" title="${esc(t.assignee)}">@${esc(t.assignee)}</span>` : "";
  const prio = t.priority > 0 ? `<span class="card-priority" title="优先级 ${t.priority}">P${t.priority}</span>` : "";
  return `
  <div class="card st-${esc(t.status)}" draggable="true" data-id="${esc(t.id)}">
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

function renderBoard() {
  const board = el("board");
  if (!state.board) { board.innerHTML = `<div class="empty">加载中…</div>`; return; }
  board.innerHTML = state.board.statuses.map((col) => `
    <section class="column st-${esc(col.status)}" data-status="${esc(col.status)}">
      <div class="column-head">
        <span class="dot"></span>
        <span class="column-title">${esc(col.label)}</span>
        <span class="column-count">${col.count}</span>
      </div>
      <div class="column-body">
        ${col.tasks.map(cardHtml).join("") || `<div class="empty" style="padding:18px 4px;font-size:12px;">空</div>`}
      </div>
    </section>`).join("");
  wireDragDrop(board);
}

function renderList() {
  const container = el("list-tasks");
  const tasks = (state.board ? state.board.statuses.flatMap((c) => c.tasks) : [])
    .filter((t) => !state.listStatus || t.status === state.listStatus)
    .filter((t) => !state.listAssignee || t.assignee === state.listAssignee)
    .filter((t) => !state.search || (t.title + " " + (t.body || "")).toLowerCase().includes(state.search.toLowerCase()))
    .filter((t) => t.status !== "archived");
  if (!tasks.length) { container.innerHTML = `<div class="empty">没有匹配的任务</div>`; return; }
  container.innerHTML = tasks.map((t) => `
    <div class="list-row" data-open="${esc(t.id)}">
      <div class="list-row-title">${esc(t.title)}</div>
      <div class="list-row-meta">
        ${badge(t.status)}
        ${t.priority > 0 ? `<span class="card-priority">P${t.priority}</span>` : ""}
        <span class="card-id">${esc(t.id)}</span>
        ${t.assignee ? `<span>@${esc(t.assignee)}</span>` : ""}
        <span title="${fmtTime(t.created_at)}">创建于 ${ago(t.created_at)}</span>
      </div>
    </div>`).join("");
}

function switchView(view) {
  state.view = view;
  el("view-board").classList.toggle("active", view === "board");
  el("view-list").classList.toggle("active", view === "list");
  el("board-view").classList.toggle("hidden", view !== "board");
  el("list-view").classList.toggle("hidden", view !== "list");
}

/* ---------- data loading ---------- */
async function refreshBoard() {
  try {
    const data = await api("/api/board");
    state.board = data;
    state.assignees = data.assignees || [];
    fillFilters();
    if (state.view === "board") renderBoard();
    else renderList();
    el("refresh").classList.add("spinning");
    setTimeout(() => el("refresh").classList.remove("spinning"), 400);
  } catch (err) {
    toast("刷新失败: " + err.message, "error");
  }
}

function fillFilters() {
  const statusSel = el("list-status");
  const assigneeSel = el("list-assignee");
  const curStatus = statusSel.value, curAssignee = assigneeSel.value;
  statusSel.innerHTML = `<option value="">全部状态</option>` +
    state.board.statuses.map((c) => `<option value="${esc(c.status)}">${esc(c.label)}</option>`).join("");
  assigneeSel.innerHTML = `<option value="">全部指派</option>` +
    state.assignees.map((a) => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join("");
  if (curStatus) statusSel.value = curStatus;
  if (curAssignee) assigneeSel.value = curAssignee;
}

/* ---------- actions ---------- */
const ACTION_LABEL = {
  complete: "完成", block: "阻塞", unblock: "解阻塞", schedule: "定时",
  promote: "提就绪", "request-review": "提评审", "request-changes": "退回修改",
  "reopen-review": "重新评审", archive: "归档", reclaim: "回收运行",
};

function menuFor(task, anchor) {
  const items = [
    { label: "查看详情", action: "view" },
  ];
  if (task.status === "running") items.push({ label: "回收运行", action: "reclaim" });
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
async function openDetail(id) {
  state.detailId = id;
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
  const isTouch = window.matchMedia("(pointer: coarse)").matches;

  content.innerHTML = `
  <div class="detail-head">
    <div>
      ${badge(t.status)}
      ${t.priority > 0 ? `<span class="card-priority"> P${t.priority}</span>` : ""}
    </div>
    <button class="btn-sm" data-act="close">✕ 关闭</button>
  </div>
  <h2 class="detail-title">${esc(t.title)}</h2>

  <div class="detail-actions">
    ${menuButtonsHtml(t)}
  </div>

  <div class="detail-section">
    <h3>信息</h3>
    <div class="kv">
      <dt>任务 ID</dt><dd><code>${esc(t.id)}</code></dd>
      <dt>指派</dt><dd>${t.assignee ? `@${esc(t.assignee)}` : '<span style="color:var(--muted)">未指派</span>'} ${!isTouch ? `<button class="btn-sm" data-act="assign">改指派</button>` : ""}</dd>
      <dt>创建者</dt><dd>${esc(t.created_by || "—")}</dd>
      <dt>工作区</dt><dd>${esc(t.workspace_kind || "")}${t.workspace_path ? " · " + esc(t.workspace_path) : ""}${t.branch_name ? " · " + esc(t.branch_name) : ""}</dd>
      <dt>连续失败</dt><dd>${t.consecutive_failures || 0}</dd>
      <dt>模型覆盖</dt><dd>${t.model_override ? esc(t.model_override) + (t.provider_override ? " (" + esc(t.provider_override) + ")" : "") : "—"}</dd>
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
    <h3>依赖</h3>
    <div style="margin-bottom:6px">父任务（${d.parents.length}）</div>
    ${d.parents.map((p) => `
      <div class="link-row">
        <button class="lnk" data-open="${esc(p.id)}">${esc(p.title || p.id)}</button>
        <span class="card-id">${esc(p.id)}</span>
        <button class="link-del" data-unlink="parent" data-other="${esc(p.id)}" title="解除依赖">✕</button>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无</div>`}
    <div style="margin:10px 0 6px">子任务（${d.children.length}）</div>
    ${d.children.map((c) => `
      <div class="link-row">
        <button class="lnk" data-open="${esc(c.id)}">${esc(c.title || c.id)}</button>
        <span class="card-id">${esc(c.id)}</span>
        <button class="link-del" data-unlink="child" data-other="${esc(c.id)}" title="解除依赖">✕</button>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无</div>`}
    <div class="attach-upload">
      <input id="link-input" type="text" placeholder="任务 ID" style="max-width:200px">
      <button class="btn-sm" data-act="add-link">添加依赖</button>
    </div>
  </div>

  <div class="detail-section">
    <h3>附件（${d.attachments.length}）</h3>
    ${d.attachments.map((a) => `
      <div class="attach-row">
        <span class="aname">${esc(a.filename)}</span>
        <span class="attach-meta">${a.size ? Math.ceil(a.size / 1024) + " KB" : ""} · ${esc(a.uploaded_by || "")} · ${ago(a.created_at)}</span>
        <button class="attach-del" data-del-attach="${a.id}" title="删除附件">✕</button>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无附件</div>`}
    <div class="attach-upload">
      <input type="file" id="attach-file">
      <button class="btn-sm" data-act="upload">上传</button>
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
      <button class="btn-primary btn-sm" data-act="comment">发送</button>
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
      <div class="event">
        <span class="event-kind">${esc(e.kind)}</span>
        <span class="event-payload">${esc(JSON.stringify(e.payload ?? ""))}</span>
        <span>${ago(e.created_at)}</span>
      </div>`).join("") || `<div class="empty" style="padding:8px;font-size:12px">无事件</div>`}
  </div>`;

  wireDetailEvents(content, d);
}

function menuButtonsHtml(t) {
  const btns = [];
  if (t.status === "running") btns.push(`<button class="btn-sm" data-act="reclaim">回收运行</button>`);
  if (t.status === "todo") btns.push(`<button class="btn-sm" data-act="promote">提就绪</button>`);
  if (t.status === "blocked") btns.push(`<button class="btn-sm" data-act="unblock">解阻塞</button>`);
  if (t.status === "scheduled") btns.push(`<button class="btn-sm" data-act="unblock">提就绪</button>`);
  if (t.status === "review") btns.push(`<button class="btn-sm" data-act="reopen-review">重新评审</button>`);
  if (["todo", "blocked", "scheduled", "review"].includes(t.status)) btns.push(`<button class="btn-sm" data-act="request-review">提评审</button>`);
  if (t.status !== "done" && t.status !== "archived") btns.push(`<button class="btn-sm" data-act="complete">完成</button>`);
  if (t.status !== "blocked" && t.status !== "done" && t.status !== "archived") btns.push(`<button class="btn-sm" data-act="block">阻塞</button>`);
  if (t.status !== "scheduled" && t.status !== "done" && t.status !== "archived") btns.push(`<button class="btn-sm" data-act="schedule">定时</button>`);
  if (t.status !== "done" && t.status !== "archived") btns.push(`<button class="btn-sm" data-act="assign">改指派</button>`);
  if (t.status !== "archived") btns.push(`<button class="btn-sm" data-act="archive">归档</button>`);
  btns.push(`<button class="btn-sm" data-act="child">子任务</button>`);
  if (t.status !== "running") btns.push(`<button class="btn-sm" data-act="model">模型覆盖</button>`);
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
      const direction = "child";
      await api(`/api/tasks/${encodeURIComponent(t.id)}/link`, jsonOpts("POST", { other_id: other, direction }))
        .then(() => toast("依赖已添加", "ok")).catch((err) => toast("失败: " + err.message, "error"));
      openDetail(t.id); return;
    }
    if (action === "assign") { openAssignModal(t); return; }
    if (action === "child") { openCreateModal({ parent: t.id }); return; }
    if (action === "model") { openModelModal(t); return; }
    if (action === "block") { promptNoteAndRun(t, "block", "阻塞原因"); return; }
    if (action === "schedule") { promptNoteAndRun(t, "schedule", "定时说明"); return; }
    if (action === "promote") { promptNoteAndRun(t, "promote", "就绪说明"); return; }
    if (action === "request-changes") { promptNoteAndRun(t, "request-changes", "修改要求"); return; }
    if (action === "reopen-review") { promptNoteAndRun(t, "reopen-review", "重开原因"); return; }
    await runAction(t.id, action);
  });
}

function promptNoteAndRun(t, action, label) {
  openModal(`
    <h2 style="margin-top:0">${ACTION_LABEL[action] || action}</h2>
    <div class="input-row"><label>${label}</label><textarea id="note-input" placeholder="可选备注…"></textarea></div>
    <div class="attach-upload">
      <button class="btn-primary" data-confirm>确认</button>
      <button data-close>取消</button>
    </div>`);
  $("[data-confirm]").onclick = async () => {
    closeModal();
    await runAction(t.id, action, el("note-input").value.trim());
  };
  $("[data-close]").onclick = closeModal;
}

function closeDrawer() {
  state.detailId = null;
  el("drawer").classList.add("hidden");
}

/* ---------- modals ---------- */
function openModal(html) {
  el("modal").classList.remove("hidden");
  el("modal-content").innerHTML = html;
}

function closeModal() { el("modal").classList.add("hidden"); }

function openCreateModal(prefill = {}) {
  const assigneeOpts = state.assignees.map((a) => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join("");
  openModal(`
    <h2 style="margin-top:0">新建任务</h2>
    <div class="input-row"><label>标题 *</label><input id="f-title" type="text" placeholder="任务标题" value="${esc(prefill.title || "")}"></div>
    <div class="input-row"><label>描述</label><textarea id="f-body" placeholder="任务描述（支持换行 / 代码块 / 粗体）">${esc(prefill.body || "")}</textarea></div>
    <div class="form-row">
      <div><label>指派</label><select id="f-assignee"><option value="">未指派</option>${assigneeOpts}</select></div>
      <div><label>优先级</label><select id="f-priority">
        <option value="0">P0 普通</option><option value="1">P1</option><option value="2">P2</option><option value="3">P3 最高</option>
      </select></div>
    </div>
    <div class="form-row">
      <div><label>工作区</label><select id="f-workspace">
        <option value="scratch">scratch（默认）</option><option value="worktree">worktree</option><option value="dir">dir</option>
      </select></div>
      <div><label>父任务 ID（可选）</label><input id="f-parent" type="text" placeholder="t_xxxx" value="${esc(prefill.parent || "")}"></div>
    </div>
    <div class="switch-row input-row">
      <span style="color:var(--muted)">放入待梳理（triage）</span>
      <label class="switch"><input id="f-triage" type="checkbox"><span class="slider"></span></label>
    </div>
    <div class="attach-upload">
      <button class="btn-primary" data-create>创建</button>
      <button data-close>取消</button>
    </div>`);
  $("[data-create]").onclick = async () => {
    const title = el("f-title").value.trim();
    if (!title) { toast("标题不能为空", "error"); return; }
    const parent = el("f-parent").value.trim();
    const payload = {
      title,
      body: el("f-body").value,
      assignee: el("f-assignee").value || undefined,
      priority: parseInt(el("f-priority").value, 10) || 0,
      workspace: el("f-workspace").value,
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
  $("[data-close]").onclick = closeModal;
}

function openAssignModal(t) {
  const assigneeOpts = state.assignees.map((a) => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join("");
  openModal(`
    <h2 style="margin-top:0">改指派</h2>
    <div class="input-row"><label>指派给</label><select id="a-assignee"><option value="">未指派</option>${assigneeOpts}</select></div>
    <div class="attach-upload">
      <button class="btn-primary" data-confirm>确认</button>
      <button data-close>取消</button>
    </div>`);
  $("[data-confirm]").onclick = async () => {
    const assignee = el("a-assignee").value;
    try {
      await api(`/api/tasks/${encodeURIComponent(t.id)}/assign`, jsonOpts("POST", { assignee }));
      toast("已更新指派", "ok");
      closeModal();
      await refreshBoard();
      if (state.detailId) openDetail(state.detailId);
    } catch (err) { toast("失败: " + err.message, "error"); }
  };
  $("[data-close]").onclick = closeModal;
}

function openModelModal(t) {
  openModal(`
    <h2 style="margin-top:0">模型覆盖</h2>
    <div class="input-row"><label>模型</label><input id="m-model" type="text" placeholder="模型名，清空则清除覆盖" value="${esc(t.model_override || "")}"></div>
    <div class="input-row"><label>Provider</label><input id="m-provider" type="text" placeholder="可选" value="${esc(t.provider_override || "")}"></div>
    <div class="attach-upload">
      <button class="btn-primary" data-confirm>确认</button>
      <button data-close>取消</button>
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
  $("[data-close]").onclick = closeModal;
}

/* ---------- events wiring ---------- */
function wireGlobal() {
  el("view-board").addEventListener("click", () => switchView("board"));
  el("view-list").addEventListener("click", () => switchView("list"));
  el("refresh").addEventListener("click", refreshBoard);
  el("fab").addEventListener("click", () => openCreateModal());

  el("search").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    if (state.view === "list") renderList();
  });
  el("list-status").addEventListener("change", (e) => { state.listStatus = e.target.value; renderList(); });
  el("list-assignee").addEventListener("change", (e) => { state.listAssignee = e.target.value; renderList(); });

  el("list-tasks").addEventListener("click", (e) => {
    const row = e.target.closest("[data-open]");
    if (row) openDetail(row.dataset.open);
  });

  el("drawer").addEventListener("click", (e) => {
    if (e.target === el("drawer")) closeDrawer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenu(); closeModal(); closeDrawer(); }
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
    if (["block", "schedule", "promote", "request-changes"].includes(action)) { promptNoteAndRun(task, action, ACTION_LABEL[action]); return; }
    await runAction(task.id, action);
  });

  document.addEventListener("click", (e) => {
    if (!el("menu").classList.contains("hidden") && !e.target.closest("#menu") && !e.target.closest("[data-menu]")) {
      closeMenu();
    }
    const menuBtn = e.target.closest("[data-menu]");
    if (menuBtn) {
      e.stopPropagation();
      showMenuForId(menuBtn.dataset.menu, menuBtn);
    }
  });

  el("modal").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-scrim")) closeModal();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else { startPolling(); refreshBoard(); }
  });
}

/* ---------- polling ---------- */
function startPolling() {
  if (state.refreshTimer) return;
  state.refreshTimer = setInterval(() => { if (!document.hidden) refreshBoard(); }, 30000);
}
function stopPolling() {
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
}

/* ---------- boot ---------- */
wireGlobal();
startPolling();
refreshBoard();
