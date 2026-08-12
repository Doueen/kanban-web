/* Pinia store — board/tasks/filter/theme/auth/折叠状态/移动端开关/全局弹层。 */
import { defineStore } from "pinia";
import { showConfirmDialog, showToast } from "vant";
import { api, apiText, jsonOpts } from "./api";

export const STATUS_ORDER = [
  "triage", "todo", "ready", "running", "blocked", "scheduled", "review", "done", "archived",
];

export const STATUS = {
  triage: "待梳理",
  todo: "待办",
  ready: "就绪",
  running: "运行中",
  blocked: "阻塞",
  scheduled: "定时",
  review: "评审",
  done: "完成",
  archived: "归档",
};

export const STATUS_CSS = {
  todo: "#8b95ad",
  ready: "#5ff0e0",
  running: "#61afff",
  blocked: "#ff5c6c",
  scheduled: "#ffb86c",
  review: "#c792ea",
  done: "#50e07f",
  archived: "#56607a",
  triage: "#ffe14d",
};

export const THEMES = [
  { id: "linear", label: "线性精修", bg: "#08090a", bg2: "#0f1011", card: "#141516", text: "#f7f8f8", muted: "#8a8f98", accent: "#45e0cd", warn: "#ffb86c", danger: "#ff5c6c", onAccent: "#052e28", border: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.14)", scrim: "rgba(0,0,0,0.7)" },
  { id: "bright", label: "明亮现代", bg: "#f5f7fb", bg2: "#eef1f7", card: "#ffffff", text: "#1a2233", muted: "#64748b", accent: "#3b82f6", warn: "#f59e0b", danger: "#ef4444", onAccent: "#ffffff", border: "#e2e8f0", borderStrong: "#cbd5e1", scrim: "rgba(30,41,59,0.4)" },
  { id: "glass", label: "玻璃拟态", bg: "#0a0f1e", bg2: "rgba(255,255,255,0.05)", card: "rgba(255,255,255,0.07)", text: "#eef2ff", muted: "#9aa4c7", accent: "#8ab4ff", warn: "#ffd08a", danger: "#ff8fa3", onAccent: "#0b1526", border: "rgba(255,255,255,0.12)", borderStrong: "rgba(255,255,255,0.2)", scrim: "rgba(5,10,25,0.6)" },
  { id: "geek", label: "终端极客", bg: "#05070c", bg2: "#0a0e16", card: "#0c111c", text: "#c9d6ea", muted: "#64748f", accent: "#5ff0e0", warn: "#ffb86c", danger: "#ff5c6c", onAccent: "#04231f", border: "#1a2438", borderStrong: "#27344f", scrim: "rgba(2,4,10,0.78)" },
];

export const MOB_SWITCHES = [
  { key: "chips", label: "状态筛选 Chips", desc: "看板上方状态快捷筛选", def: true },
  { key: "swipe", label: "左右滑动切列", desc: "单列模式下左右滑动切换状态", def: true },
  { key: "autofold", label: "空列自动折叠", desc: "移动端自动折叠空列", def: true },
  { key: "longpress", label: "长按移动", desc: "长按卡片打开「移动到」面板", def: true },
  { key: "indicator", label: "进度指示器", desc: "看板下方当前列位置圆点", def: true },
  { key: "quickact", label: "快捷完成", desc: "卡片上的 ✓ 快捷完成按钮", def: true },
];

export const ACTION_LABEL = {
  complete: "完成", block: "阻塞", unblock: "解阻塞", schedule: "定时",
  promote: "提就绪", "request-review": "提评审", "request-changes": "退回修改",
  "reopen-review": "重新评审", archive: "归档", reclaim: "回收运行",
  specify: "AI 细化", decompose: "AI 分解", claim: "认领", heartbeat: "心跳",
};

export function actionLabel(a) {
  return ACTION_LABEL[a] || a;
}

export function actionForTarget(task, targetStatus) {
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

export function menuItems(task) {
  const items = [];
  items.push({ label: "查看详情", action: "view" });
  if (task.status === "running") {
    items.push({ label: "回收运行", action: "reclaim" });
    items.push({ label: "心跳", action: "heartbeat" });
  }
  if (task.status === "ready") items.push({ label: "认领", action: "claim" });
  if (task.status === "triage") {
    items.push({ label: "细化（AI）", action: "specify" });
    items.push({ label: "分解（AI）", action: "decompose" });
  }
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
  return items;
}

function applyVantVars(t) {
  const root = document.documentElement.style;
  const map = {
    "--van-primary-color": t.accent,
    "--van-success-color": "#50e07f",
    "--van-danger-color": t.danger,
    "--van-warning-color": t.warn,
    "--van-background": t.bg,
    "--van-background-2": t.bg2,
    "--van-text-color": t.text,
    "--van-text-color-2": t.muted,
    "--van-text-color-3": t.muted,
    "--van-active-color": t.muted,
    "--van-border-color": t.border,
    "--van-cell-background": t.card,
    "--van-cell-background-active": t.card,
    "--van-cell-border-color": t.border,
    "--van-cell-group-background": "transparent",
    "--van-popup-background": t.bg2,
    "--van-popup-round-radius": "16px",
    "--van-button-primary-color": t.onAccent,
    "--van-button-primary-background": t.accent,
    "--van-button-primary-border-color": t.accent,
    "--van-button-default-color": t.text,
    "--van-button-default-background": t.card,
    "--van-button-default-border-color": t.border,
    "--van-switch-on-background": t.accent,
    "--van-switch-off-background": t.border,
    "--van-search-background": "transparent",
    "--van-search-content-background": t.bg2,
    "--van-search-input-text-color": t.text,
    "--van-search-placeholder-color": t.muted,
    "--van-field-input-text-color": t.text,
    "--van-field-placeholder-text-color": t.muted,
    "--van-field-label-color": t.text,
    "--van-field-background": t.bg2,
    "--van-tabbar-background": t.bg2,
    "--van-tabbar-item-text-color": t.muted,
    "--van-tabbar-item-active-color": t.accent,
    "--van-tabbar-item-active-background": "transparent",
    "--van-action-sheet-background": t.bg2,
    "--van-action-sheet-item-text-color": t.text,
    "--van-action-sheet-cancel-text-color": t.muted,
    "--van-dialog-background": t.bg2,
    "--van-dialog-header-text-color": t.text,
    "--van-dialog-message-text-color": t.text,
    "--van-toast-background": t.card,
    "--van-toast-text-color": t.text,
    "--van-tag-default-color": t.text,
    "--van-tag-default-background": t.bg2,
    "--van-tag-danger-color": t.danger,
    "--van-tag-danger-background": "rgba(255,92,108,0.14)",
    "--van-tag-success-color": "#50e07f",
    "--van-tag-success-background": "rgba(80,224,127,0.14)",
    "--van-tag-primary-color": t.accent,
    "--van-tag-primary-background": "rgba(69,224,205,0.14)",
    "--van-tag-warning-color": t.warn,
    "--van-tag-warning-background": "rgba(255,184,108,0.14)",
    "--van-empty-description-color": t.muted,
    "--van-nav-bar-background": t.bg2,
    "--van-pull-refresh-head-text-color": t.muted,
    "--van-overlay-background": t.scrim,
    "--van-picker-background": t.bg2,
    "--van-picker-option-text-color": t.text,
    "--van-picker-option-disabled-text-color": t.muted,
    "--van-picker-mask-color": "transparent",
    "--van-picker-title-color": t.text,
    "--van-uploader-upload-icon-color": t.muted,
    "--van-uploader-upload-background": t.bg2,
    "--van-uploader-upload-border-color": t.border,
    "--van-tabs-bottom-bar-color": t.accent,
    "--van-tab-text-color": t.muted,
    "--van-tab-active-text-color": t.accent,
  };
  for (const [k, v] of Object.entries(map)) root.setProperty(k, v);
}

export function vantThemeVars(themeId) {
  const t = THEMES.find((x) => x.id === themeId) || THEMES[0];
  return {
    primaryColor: t.accent,
    successColor: "#50e07f",
    dangerColor: t.danger,
    warningColor: t.warn,
    backgroundColor: t.bg,
    background2: t.bg2,
    textColor: t.text,
    textColor2: t.muted,
    textColor3: t.muted,
    activeColor: t.muted,
    borderColor: t.border,
    cellBackground: t.card,
    cellBorderColor: t.border,
    popupBackground: t.bg2,
    popupRoundRadius: "16px",
    buttonPrimaryColor: t.onAccent,
    buttonPrimaryBackground: t.accent,
    buttonPrimaryBorderColor: t.accent,
    buttonDefaultColor: t.text,
    buttonDefaultBackground: t.card,
    buttonDefaultBorderColor: t.border,
    switchOnBackground: t.accent,
    switchOffBackground: t.border,
    searchBackground: "transparent",
    searchContentBackground: t.bg2,
    searchInputTextColor: t.text,
    searchPlaceholderColor: t.muted,
    fieldInputTextColor: t.text,
    fieldPlaceholderTextColor: t.muted,
    fieldLabelColor: t.text,
    tabbarBackground: t.bg2,
    tabbarItemTextColor: t.muted,
    tabbarItemActiveColor: t.accent,
    actionSheetBackground: t.bg2,
    actionSheetItemTextColor: t.text,
    actionSheetCancelTextColor: t.muted,
    dialogBackground: t.bg2,
    dialogHeaderTextColor: t.text,
    dialogMessageTextColor: t.text,
    toastBackground: t.card,
    toastTextColor: t.text,
    tagDefaultColor: t.text,
    tagDefaultBackground: t.bg2,
    emptyDescriptionColor: t.muted,
    overlayBackground: t.scrim,
    pickerBackground: t.bg2,
    pickerOptionTextColor: t.text,
    pickerOptionDisabledTextColor: t.muted,
    pullRefreshHeadTextColor: t.muted,
  };
}

export const useAppStore = defineStore("app", {
  state: () => ({
    authed: (() => {
      try { return !!localStorage.getItem("kb-auth"); } catch (_) { return false; }
    })(),
    view: "board",
    board: null,
    assignees: [],
    boards: [],
    currentBoard: null,
    search: "",
    boardFilter: (() => {
      try {
        if (typeof matchMedia === "function" && matchMedia("(max-width: 619px)").matches) {
          const saved = localStorage.getItem("kb-board-filter");
          if (saved) return saved;
        }
      } catch (_) { /* */ }
      return "all";
    })(),
    listStatus: "",
    listAssignee: "",
    listArchived: false,
    sortBy: "created",
    detailId: null,
    detailOpts: {},
    events: [],
    eventSince: 0,
    theme: "linear",
    mob: { chips: true, swipe: true, autofold: true, longpress: true, indicator: true, quickact: true },
    collapsed: {},
    draggingId: null,
    showCreate: false,
    createPrefill: {},
    moveTask: null,
    menuVisible: false,
    menuTask: null,
    menuPos: { x: 0, y: 0 },
    noteTask: null,
    noteAction: "",
    assignTask: null,
    modelTask: null,
    editTask: null,
    boardTimer: null,
    eventTimer: null,
  }),

  getters: {
    isMobile: () => (typeof matchMedia === "function" ? matchMedia("(max-width: 619px)").matches : false),
    isTouch: () =>
      (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) ||
      "ontouchstart" in window,
    visibleCols(state) {
      if (!state.board) return [];
      if (state.boardFilter !== "all") {
        const col = state.board.statuses.find((c) => c.status === state.boardFilter);
        return col ? [col] : [];
      }
      return state.board.statuses;
    },
    statuses(state) {
      return state.board ? state.board.statuses : [];
    },
  },

  actions: {
    /* ---------- theme ---------- */
    initTheme() {
      let saved = "linear";
      try { saved = localStorage.getItem("kb-theme") || "linear"; } catch (_) { /* */ }
      this.applyTheme(saved);
    },
    applyTheme(id) {
      const t = THEMES.find((x) => x.id === id) || THEMES[0];
      this.theme = t.id;
      document.body.dataset.theme = t.id;
      try { localStorage.setItem("kb-theme", t.id); } catch (_) { /* */ }
      applyVantVars(t);
    },

    /* ---------- auth ---------- */
    setAuth(user, pass) {
      try { localStorage.setItem("kb-auth", JSON.stringify({ u: user, p: pass })); } catch (_) { /* */ }
      this.authed = true;
      this.startPolling();
    },
    logout() {
      try { localStorage.removeItem("kb-auth"); } catch (_) { /* */ }
      this.authed = false;
      this.stopPolling();
      this.stopEventPolling();
      this.detailId = null;
      this.detailOpts = {};
      this.menuVisible = false;
      this.menuTask = null;
      this.moveTask = null;
      this.showCreate = false;
    },
    async login(user, pass) {
      const res = await fetch("/api/board", {
        headers: { Authorization: "Basic " + btoa(user + ":" + pass) },
      });
      if (res.ok) {
        this.setAuth(user, pass);
        return true;
      }
      return false;
    },

    /* ---------- mobile switches ---------- */
    loadMob() {
      const out = {};
      for (const s of MOB_SWITCHES) {
        try {
          const v = localStorage.getItem("kb-mob-" + s.key);
          out[s.key] = v === null ? s.def : v === "1" || v === "true";
        } catch (_) { out[s.key] = s.def; }
      }
      this.mob = out;
    },
    setMob(key, val) {
      this.mob[key] = !!val;
      try { localStorage.setItem("kb-mob-" + key, val ? "1" : "0"); } catch (_) { /* */ }
    },

    /* ---------- collapse state ---------- */
    loadCollapsed() {
      try { this.collapsed = JSON.parse(localStorage.getItem("kb-collapsed") || "{}"); } catch (_) { this.collapsed = {}; }
    },
    setCollapsed(status, val) {
      this.collapsed[status] = !!val;
      try { localStorage.setItem("kb-collapsed", JSON.stringify(this.collapsed)); } catch (_) { /* */ }
    },
    toggleCollapsed(status) {
      this.setCollapsed(status, !(this.collapsed[status] === true));
    },
    isColFolded(col) {
      const manual = this.collapsed[col.status];
      if (manual !== undefined) return manual === true;
      let firstVisit = false;
      try { firstVisit = localStorage.getItem("kb-collapsed") === null; } catch (_) { /* */ }
      if (col.status === "archived" && firstVisit) return true;
      if (this.mob.autofold && this.isMobile && this.boardFilter === "all" && col.count === 0) return true;
      return false;
    },

    /* ---------- data ---------- */
    async refreshBoard() {
      if (!this.authed) return;
      try {
        const data = await api("/api/board");
        this.board = data;
        this.assignees = data.assignees || [];
        if (this.boardFilter !== "all" && !data.statuses.some((c) => c.status === this.boardFilter)) {
          this.boardFilter = "all";
        }
      } catch (err) {
        if (err.message !== "Unauthorized") console.error("refreshBoard:", err.message);
      }
    },
    async loadBoards() {
      try {
        this.boards = await api("/api/boards");
        const cur = await api("/api/boards/current");
        const b = this.boards.find((x) => x.slug === cur.slug);
        this.currentBoard = { slug: cur.slug, name: (b && b.name) || cur.name || cur.slug };
      } catch (err) {
        this.currentBoard = null;
      }
    },
    async switchBoard(slug) {
      await api(`/api/boards/${encodeURIComponent(slug)}/switch`, jsonOpts("POST", {}));
      await this.loadBoards();
      await this.refreshBoard();
    },
    findTask(id) {
      if (!this.board) return null;
      for (const col of this.board.statuses) {
        const t = col.tasks.find((x) => x.id === id);
        if (t) return t;
      }
      return null;
    },

    /* ---------- task actions ---------- */
    async runAction(id, action, note) {
      if (action === "archive") {
        try {
          await showConfirmDialog({
            title: "归档任务",
            message: "确定要归档该任务吗？归档后可在列表页勾选「含归档」查看。",
            confirmButtonText: "归档",
            confirmButtonColor: "#ff5c6c",
          });
        } catch (_) {
          return null; // 用户取消
        }
      }
      if (!note && action === "block") note = "via web";
      if (!note && action === "schedule") note = "scheduled via web";
      if (!note && ["promote", "request-changes"].includes(action)) note = "via web";
      try {
        const res = await api(`/api/tasks/${encodeURIComponent(id)}/action`, jsonOpts("POST", { action, note }));
        showToast({ message: res.message || actionLabel(action) || "操作完成", type: "success" });
        await this.refreshBoard();
        if (this.detailId) await this.openDetail(this.detailId);
        return res;
      } catch (err) {
        showToast({ message: "操作失败: " + err.message, type: "fail" });
        throw err;
      }
    },
    async runExtended(id, kind, payload = {}) {
      const loading = {
        specify: "AI 细化中…可能需要 1-3 分钟",
        decompose: "AI 分解中…可能需要 1-3 分钟",
        claim: "认领中…",
        heartbeat: "发送心跳中…",
      };
      showToast({ message: loading[kind] || "处理中…", type: "loading", duration: 12000, forbidClick: false });
      try {
        const res = await api(`/api/tasks/${encodeURIComponent(id)}/${kind}`, jsonOpts("POST", payload));
        showToast({ message: res.message || actionLabel(kind) || "完成", type: "success" });
        await this.refreshBoard();
        if (this.detailId) await this.openDetail(this.detailId);
        return res;
      } catch (err) {
        showToast({ message: "失败: " + err.message, type: "fail" });
        throw err;
      }
    },
    handleTaskAction(task, action) {
      const needNote = ["block", "schedule", "promote", "request-changes", "reopen-review"];
      if (action === "view") { this.openDetail(task.id); return; }
      if (action === "assign") { this.assignTask = task; return; }
      if (action === "child") { this.openCreate({ parent: task.id }); return; }
      if (action === "edit-result") { this.editTask = task; return; }
      if (action === "context") { this.openDetail(task.id, { loadContext: true }); return; }
      if (action === "log") { this.openDetail(task.id, { loadLog: true }); return; }
      if (action === "specify" || action === "decompose" || action === "claim" || action === "heartbeat") {
        this.runExtended(task.id, action);
        return;
      }
      if (needNote.includes(action)) {
        this.noteTask = task;
        this.noteAction = action;
        return;
      }
      this.runAction(task.id, action);
    },

    /* ---------- detail ---------- */
    openDetail(id, opts = {}) {
      this.detailId = id;
      this.detailOpts = opts;
    },
    closeDetail() {
      this.detailId = null;
      this.detailOpts = {};
    },

    /* ---------- events ---------- */
    async pollEvents() {
      try {
        const list = await api(`/api/events?since=${this.eventSince}`);
        if (!list || !list.length) return;
        const seen = new Set(this.events.map((e) => e.id));
        for (const ev of list) {
          if (!seen.has(ev.id)) { this.events.push(ev); seen.add(ev.id); }
        }
        if (this.events.length > 100) this.events = this.events.slice(this.events.length - 100);
        this.eventSince = list[list.length - 1].created_at;
      } catch (_) {
        /* best-effort */
      }
    },

    /* ---------- polling ---------- */
    startPolling() {
      if (this.boardTimer) return;
      this.boardTimer = setInterval(() => {
        if (!document.hidden && this.authed) this.refreshBoard();
      }, 30000);
    },
    stopPolling() {
      if (this.boardTimer) { clearInterval(this.boardTimer); this.boardTimer = null; }
    },
    startEventPolling() {
      if (this.eventTimer) return;
      this.eventTimer = setInterval(() => {
        if (!document.hidden && this.view === "stats") this.pollEvents();
      }, 5000);
    },
    stopEventPolling() {
      if (this.eventTimer) { clearInterval(this.eventTimer); this.eventTimer = null; }
    },

    /* ---------- view ---------- */
    setView(v) {
      this.view = v;
      if (v === "stats") {
        if (!this.events.length) this.eventSince = 0;
        this.startEventPolling();
        this.pollEvents();
      } else {
        this.stopEventPolling();
      }
    },

    /* ---------- global popups ---------- */
    openCreate(prefill = {}) {
      this.createPrefill = prefill;
      this.showCreate = true;
    },
    openMove(task) {
      this.moveTask = task;
    },
    closeMove() {
      this.moveTask = null;
    },
    openMenu(task, x = 0, y = 0) {
      this.menuTask = task;
      this.menuPos = { x, y };
      this.menuVisible = true;
    },
    closeMenu() {
      this.menuVisible = false;
      this.menuTask = null;
    },
  },
});
