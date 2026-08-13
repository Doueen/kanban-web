/* Pinia store — board/tasks/filter/theme/auth/折叠状态/移动端开关/全局弹层。 */
import { defineStore } from "pinia";
import { watch } from "vue";
import { api, apiText, jsonOpts } from "./api";
import { ok, fail, confirm, loading, snackbar, COPY } from "./feedback";
import { persistBoardFilter } from "./utils";
import { createEventSource } from "./sse";

/* M1-2 E5: refreshBoard in-flight 去重 + 单调序号竞态守卫 */
let _boardSeq = 0;
let _boardInFlight = null;
/* 分页任务列表竞态守卫（fetchTasks 过期响应丢弃） */
let _tasksSeq = 0;
/* M2-3 S3: SSE 实例 + 300ms 合并节流句柄（模块级，非响应式） */
let _sse = null;
let _sseThrottle = null;
/* M2-4 S7: 详情已同步的看板字段指纹（外部变更 → 详情自动重拉） */
let _detailKey = "";

export const STATUS_ORDER = [
  "triage",
  "todo",
  "ready",
  "running",
  "blocked",
  "scheduled",
  "review",
  "done",
  "archived",
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
  {
    id: "linear",
    label: "线性精修",
    bg: "#08090a",
    bg2: "#0f1011",
    card: "#141516",
    text: "#f7f8f8",
    muted: "#8a8f98",
    accent: "#45e0cd",
    warn: "#ffb86c",
    danger: "#ff5c6c",
    onAccent: "#052e28",
    border: "rgba(255,255,255,0.08)",
    borderStrong: "rgba(255,255,255,0.14)",
    scrim: "rgba(0,0,0,0.7)",
  },
  {
    id: "bright",
    label: "明亮现代",
    bg: "#f5f7fb",
    bg2: "#eef1f7",
    card: "#ffffff",
    text: "#1a2233",
    muted: "#64748b",
    accent: "#3b82f6",
    warn: "#f59e0b",
    danger: "#ef4444",
    onAccent: "#ffffff",
    border: "#e2e8f0",
    borderStrong: "#cbd5e1",
    scrim: "rgba(30,41,59,0.4)",
  },
  {
    id: "glass",
    label: "玻璃拟态",
    bg: "#0a0f1e",
    bg2: "rgba(255,255,255,0.05)",
    card: "rgba(255,255,255,0.07)",
    text: "#eef2ff",
    muted: "#9aa4c7",
    accent: "#8ab4ff",
    warn: "#ffd08a",
    danger: "#ff8fa3",
    onAccent: "#0b1526",
    border: "rgba(255,255,255,0.12)",
    borderStrong: "rgba(255,255,255,0.2)",
    scrim: "rgba(5,10,25,0.6)",
  },
  {
    id: "geek",
    label: "终端极客",
    bg: "#05070c",
    bg2: "#0a0e16",
    card: "#0c111c",
    text: "#c9d6ea",
    muted: "#64748f",
    accent: "#5ff0e0",
    warn: "#ffb86c",
    danger: "#ff5c6c",
    onAccent: "#04231f",
    border: "#1a2438",
    borderStrong: "#27344f",
    scrim: "rgba(2,4,10,0.78)",
  },
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
  complete: "完成",
  block: "阻塞",
  unblock: "解阻塞",
  schedule: "定时",
  promote: "提就绪",
  "request-review": "提评审",
  "request-changes": "退回修改",
  "reopen-review": "重新评审",
  archive: "归档",
  uncomplete: "取消完成",
  unarchive: "恢复",
  reclaim: "回收运行",
  specify: "AI 细化",
  decompose: "AI 分解",
  claim: "认领",
  heartbeat: "心跳",
};

export function actionLabel(a) {
  return ACTION_LABEL[a] || a;
}

/* B1 可逆动作 → 5s 撤销条（操作提示清单 §3 B1：block→unblock、schedule→unblock、
   request-review→reopen-review；M2-2 S2：complete→uncomplete、archive→unarchive） */
const UNDO_ACTIONS = {
  block: "unblock",
  schedule: "unblock",
  "request-review": "reopen-review",
  complete: "uncomplete",
  archive: "unarchive",
};

/* M2-1 S1 乐观更新：动作 → 目标状态推导（菜单/快捷按钮等无显式目标时用；
   MoveSheet/拖拽显式传 targetStatus，以实际落点为准；CLI 永远是权威，refreshBoard 合并） */
const ACTION_TARGET = {
  complete: "done",
  block: "blocked",
  unblock: "ready",
  schedule: "scheduled",
  promote: "ready",
  "request-review": "review",
  "request-changes": "ready",
  "reopen-review": "ready",
  archive: "archived",
  uncomplete: "todo",
  unarchive: "todo",
  reclaim: null,
  heartbeat: null,
};
/* S1 10s 超时兜底：恢复原样继续后台等，响应到达后仅权威合并 */
const OP_TIMEOUT_MS = 10000;
let _opTimers = {}; // taskId -> timer 句柄；置 null 表示该任务已触发超时兜底

export function actionForTarget(task, targetStatus) {
  if (targetStatus === task.status) return null;
  /* 目标动作与 CLI 动词一一对应（CLI 是写操作权威，M1-5 E10 灰化禁用依赖此表）：
     complete: running|ready|blocked|review → done
     block:    running|ready → blocked（todo/其它状态 CLI 拒绝）
     schedule: todo|ready|running|blocked → scheduled
     promote:  todo|blocked → ready；unblock: blocked|scheduled → ready/todo
     reopen-review: review → ready/todo；request-review: 任意状态 → review
     archive:  非 archived → archived */
  switch (targetStatus) {
    case "done":
      if (["running", "ready", "blocked", "review"].includes(task.status))
        return { action: "complete" };
      return null;
    case "blocked":
      if (task.status === "running" || task.status === "ready") return { action: "block" };
      return null;
    case "review":
      return { action: "request-review" };
    case "scheduled":
      if (["todo", "ready", "running", "blocked"].includes(task.status))
        return { action: "schedule" };
      return null;
    case "ready":
      if (task.status === "scheduled" || task.status === "blocked") return { action: "unblock" };
      if (task.status === "review") return { action: "reopen-review" };
      if (task.status === "todo") return { action: "promote" };
      return null;
    case "todo":
      if (task.status === "blocked" || task.status === "scheduled") return { action: "unblock" };
      if (task.status === "review") return { action: "reopen-review" };
      return null;
    case "archived":
      return { action: "archive" };
    default:
      return null;
  }
}

export function menuItems(task) {
  const items = [];
  items.push({ label: "查看详情", action: "view" });
  items.push({ label: "移动到", action: "move" });
  /* M2-2 S2: 归档任务可一键恢复（unarchive verb） */
  if (task.status === "archived") items.push({ label: "恢复", action: "unarchive" });
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
  if (["todo", "blocked", "scheduled", "review"].includes(task.status))
    items.push({ label: "提评审", action: "request-review" });
  if (task.status !== "done" && task.status !== "archived")
    items.push({ label: "完成", action: "complete" });
  if (task.status !== "blocked" && task.status !== "done" && task.status !== "archived")
    items.push({ label: "阻塞", action: "block" });
  if (task.status !== "scheduled" && task.status !== "done" && task.status !== "archived")
    items.push({ label: "定时", action: "schedule" });
  if (task.status !== "archived" && task.status !== "done")
    items.push({ label: "归档", action: "archive" });
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
    pickerBackground: t.bg2,
    pickerCancelActionColor: t.muted,
    pickerConfirmActionColor: t.accent,
    pickerTitleColor: t.text,
    pickerLoadingColor: t.accent,
    pickerOptionTextColor: t.text,
    pickerOptionDisabledTextColor: t.muted,
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
    pullRefreshHeadTextColor: t.muted,
  };
}

export const useAppStore = defineStore("app", {
  state: () => ({
    authed: (() => {
      try {
        return !!localStorage.getItem("kb-auth");
      } catch (_) {
        return false;
      }
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
      } catch (_) {
        /* */
      }
      return "all";
    })(),
    listStatus: "",
    listAssignee: "",
    listArchived: false,
    sortBy: "status",
    detailId: null,
    detailOpts: {},
    events: [],
    eventAfter: 0, // M2-4 S6: 事件游标改事件 ID（单调，同秒事件不丢不重）
    /* M1-4 E7: 刷新失败可见化 + 连接状态 */
    boardError: "",
    lastSyncedAt: null,
    online: typeof navigator !== "undefined" ? navigator.onLine !== false : true,
    /* M2-3 S3: SSE 已连接（连接期间 60s 轮询暂停，空转轮询归零） */
    sseActive: false,
    theme: "linear",
    mob: {
      chips: true,
      swipe: true,
      autofold: true,
      longpress: true,
      indicator: true,
      quickact: true,
    },
    hiddenChips: (() => {
      try {
        return JSON.parse(localStorage.getItem("kb-hidden-chips") || "[]");
      } catch (_) {
        return [];
      }
    })(),
    collapsed: {},
    /* t_bcf7c7bd: 一键隐藏空列模式（本地持久化 kb-hide-empty） */
    hideEmpty: (() => {
      try {
        return localStorage.getItem("kb-hide-empty") === "1";
      } catch (_) {
        return false;
      }
    })(),
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
    /* 分页任务列表（GET /api/tasks 信封 {items,page,page_size,total,total_pages}） */
    tasks: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    /* 初始 true：首拉前的空窗不闪「没有匹配的任务」；fetchTasks 每次置 true、finally 置 false */
    tasksLoading: true,
    tasksError: "",
    /* M2-1 S1: 同步中任务集合（乐观更新 pending：卡片微标 + 按钮禁用 + 双击防重） */
    pendingOps: {},
  }),

  getters: {
    isMobile: () =>
      typeof matchMedia === "function" ? matchMedia("(max-width: 619px)").matches : false,
    isTouch: () =>
      (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) ||
      "ontouchstart" in window,
    visibleCols(state) {
      if (!state.board) return [];
      if (state.boardFilter !== "all") {
        const col = state.board.statuses.find((c) => c.status === state.boardFilter);
        if (!col || state.hiddenChips.includes(col.status)) return [];
        return [col];
      }
      return state.board.statuses.filter((c) => !state.hiddenChips.includes(c.status));
    },
    statuses(state) {
      return state.board ? state.board.statuses : [];
    },
    /* M1-6 E11: 状态顺序/文案单一来源 —— 优先由 /api/board 响应派生（db.py 权威），
       硬编码 STATUS_ORDER/STATUS 仅作数据未加载时的回退 */
    statusOrder(state) {
      return state.board && state.board.statuses.length
        ? state.board.statuses.map((c) => c.status)
        : STATUS_ORDER;
    },
    statusLabels(state) {
      const labels = {};
      if (state.board) {
        for (const c of state.board.statuses) labels[c.status] = c.label;
      }
      return labels;
    },
  },

  actions: {
    /* ---------- theme ---------- */
    initTheme() {
      let saved = "linear";
      try {
        saved = localStorage.getItem("kb-theme") || "linear";
      } catch (_) {
        /* */
      }
      this.applyTheme(saved, true);
      this.initSysDark();
    },
    /* 跟随系统深色模式（设置开关 kb-sys-dark） */
    initSysDark() {
      let on = false;
      try {
        on = localStorage.getItem("kb-sys-dark") === "1";
      } catch (_) {
        /* */
      }
      if (!on) return;
      const mq = matchMedia("(prefers-color-scheme: dark)");
      const apply = () => this.applyTheme(mq.matches ? "linear" : "bright", true);
      apply();
      mq.addEventListener?.("change", apply);
    },
    applyTheme(id, skipPersist) {
      const t = THEMES.find((x) => x.id === id) || THEMES[0];
      this.theme = t.id;
      document.body.dataset.theme = t.id;
      if (!skipPersist) {
        try {
          localStorage.setItem("kb-theme", t.id);
          localStorage.setItem("kb-sys-dark", "0"); // 手动选择后关闭跟随
        } catch (_) {
          /* */
        }
      }
      applyVantVars(t);
    },

    /* ---------- auth ---------- */
    setAuth(user, pass) {
      try {
        localStorage.setItem("kb-auth", JSON.stringify({ u: user, p: pass }));
      } catch (_) {
        /* */
      }
      this.authed = true;
      this.startPolling();
      this.startSse();
    },
    logout() {
      try {
        localStorage.removeItem("kb-auth");
      } catch (_) {
        /* */
      }
      this.authed = false;
      this.stopPolling();
      this.stopEventPolling();
      this.stopSse();
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
        } catch (_) {
          out[s.key] = s.def;
        }
      }
      this.mob = out;
    },
    setMob(key, val) {
      this.mob[key] = !!val;
      try {
        localStorage.setItem("kb-mob-" + key, val ? "1" : "0");
      } catch (_) {
        /* */
      }
    },
    /* 看板分类 chips 显示开关（隐藏状态集合持久化） */
    toggleChip(status) {
      const s = new Set(this.hiddenChips);
      if (s.has(status)) s.delete(status);
      else s.add(status);
      this.hiddenChips = [...s];
      try {
        localStorage.setItem("kb-hidden-chips", JSON.stringify(this.hiddenChips));
      } catch (_) {
        /* */
      }
    },

    /* ---------- collapse state ---------- */
    loadCollapsed() {
      try {
        this.collapsed = JSON.parse(localStorage.getItem("kb-collapsed") || "{}");
      } catch (_) {
        this.collapsed = {};
      }
    },
    setCollapsed(status, val) {
      this.collapsed[status] = !!val;
      try {
        localStorage.setItem("kb-collapsed", JSON.stringify(this.collapsed));
      } catch (_) {
        /* */
      }
    },
    toggleCollapsed(status) {
      this.setCollapsed(status, !(this.collapsed[status] === true));
    },
    isColFolded(col) {
      const manual = this.collapsed[col.status];
      if (manual !== undefined) return manual === true;
      let firstVisit = false;
      try {
        firstVisit = localStorage.getItem("kb-collapsed") === null;
      } catch (_) {
        /* */
      }
      if (col.status === "archived" && firstVisit) return true;
      if (this.mob.autofold && this.isMobile && this.boardFilter === "all" && col.count === 0)
        return true;
      return false;
    },

    /* ---------- t_bcf7c7bd: 一键隐藏/恢复空列 ----------
       模式开关（hideEmpty，持久化 kb-hide-empty）：
       - 开启：立即折叠所有空列（force，含此前手动展开的）；非空列永不折叠。
       - 关闭：恢复所有空列（仅展开 collapsed 显式为 true 的空列，不动移动端 autofold 默认态）。
       - 开启期间每次看板数据到达/乐观迁移后由 _enforceHideEmpty(false) 维持不变量：
         ① 空列保持折叠（尊重手动展开：collapsed[status]!==false 才折）；
         ② 折叠中的非空列立即展开（拖入/新建/移动后卡片绝不藏在折叠列里）；
         ③ 单列筛选模式下的当前列永不折叠（避免 56px 窄条）。
       折叠状态仍写入既有 collapsed 映射（kb-collapsed），与列头折叠按钮同源。 */
    toggleHideEmpty() {
      this.hideEmpty = !this.hideEmpty;
      try {
        localStorage.setItem("kb-hide-empty", this.hideEmpty ? "1" : "0");
      } catch (_) {
        /* */
      }
      if (this.hideEmpty) this._enforceHideEmpty(true);
      else this._restoreEmptyCols();
    },
    _enforceHideEmpty(force) {
      if (!this.board) return;
      for (const c of this.board.statuses) {
        /* 单列筛选模式下当前列不参与折叠 */
        if (this.boardFilter !== "all" && c.status === this.boardFilter) continue;
        if (c.count === 0) {
          if (force || this.collapsed[c.status] !== false) this.setCollapsed(c.status, true);
        } else if (this.isColFolded(c)) {
          /* 非空列绝不隐藏：拖入/新建/移动后立即展开 */
          this.setCollapsed(c.status, false);
        }
      }
    },
    _restoreEmptyCols() {
      if (!this.board) return;
      for (const c of this.board.statuses) {
        if (c.count === 0 && this.collapsed[c.status] === true) {
          this.setCollapsed(c.status, false);
        }
      }
    },

    /* ---------- data ---------- */
    /* M1-2 E5: 执行中重复调用返回同一 Promise；force 时绕过去重（手动刷新）。
       M1-3 E4: 普通轮询不带 force=1；仅手动刷新/切换带 force。 */
    async refreshBoard(force = false) {
      if (!this.authed) return;
      if (_boardInFlight && !force) return _boardInFlight;
      const p = this._fetchBoard(force);
      _boardInFlight = p;
      try {
        return await p;
      } finally {
        if (_boardInFlight === p) _boardInFlight = null;
      }
    },
    async _fetchBoard(force) {
      const seq = ++_boardSeq;
      try {
        const [data, cur] = await Promise.all([
          /* t_3ad4fe46: force（手动刷新/切换看板）绕过 ETag 条件请求，
             保证用户主动刷新必拿最新数据（同秒 304 粘滞的兜底防线） */
          api("/api/board", { etag: !force }),
          api("/api/boards/current" + (force ? "?force=1" : "")),
        ]);
        if (seq !== _boardSeq) return; // 竞态守卫：已有更新的请求，过期响应丢弃
        if (data) {
          /* 304（ETag 命中）→ data === null，board 未变化，跳过赋值 */
          this.board = data;
          this.assignees = data.assignees || [];
          if (
            this.boardFilter !== "all" &&
            !data.statuses.some((c) => c.status === this.boardFilter)
          ) {
            this.boardFilter = "all";
          }
          /* M2-4 S7: 详情监听 board 变更刷新（外部 CLI/SSE 改动状态/指派/标题 → 详情自动重拉） */
          this._syncDetailWithBoard();
          /* t_bcf7c7bd: 隐藏空列模式开启时，数据到达即维持不变量（空列折、非空列展） */
          if (this.hideEmpty) this._enforceHideEmpty(false);
        }
        /* 后台/CLI 切换 board 同步：左上角标题及时更新 */
        if (!this.currentBoard || cur.slug !== this.currentBoard.slug) {
          await this.loadBoards();
        }
        if (seq !== _boardSeq) return;
        this.boardError = "";
        this.lastSyncedAt = Date.now();
      } catch (err) {
        if (seq !== _boardSeq) return;
        if (err.message !== "Unauthorized") {
          console.error("refreshBoard:", err.message);
          this.boardError = err.message;
        }
      }
    },
    async loadBoards() {
      try {
        this.boards = await api("/api/boards");
        const cur = await api("/api/boards/current");
        const b = this.boards.find((x) => x.slug === cur.slug);
        this.currentBoard = {
          slug: cur.slug,
          name: (b && b.name) || cur.name || cur.slug,
          default_workdir: b ? b.default_workdir : undefined,
        };
      } catch (err) {
        this.currentBoard = null;
      }
    },
    async switchBoard(slug) {
      await api(`/api/boards/${encodeURIComponent(slug)}/switch`, jsonOpts("POST", {}));
      /* M2-4 S7: 切换 board 重置详情/筛选，防残留（详情/筛选属于旧 board） */
      this.detailId = null;
      this.detailOpts = {};
      _detailKey = "";
      this.boardFilter = "all";
      this.listStatus = "";
      this.listAssignee = "";
      this.search = "";
      try {
        persistBoardFilter("all");
      } catch (_) {
        /* */
      }
      await this.loadBoards();
      /* t_3ad4fe46: 切换看板强制拉新（旧 board 的 ETag 与新 board 指纹
         理论上可能雷同 → 304 → 串板显示旧数据），不依赖指纹差异 */
      await this.refreshBoard(true);
    },
    findTask(id) {
      if (!this.board) return null;
      for (const col of this.board.statuses) {
        const t = col.tasks.find((x) => x.id === id);
        if (t) return t;
      }
      return null;
    },
    /* M2-4 S7: 详情与看板变更同步 —— 任务在看板中且状态/优先级/指派/标题变化 → 重拉详情。
       注意：archived 任务不在看板 payload 中（S4 懒加载），找不到时保持现状不关闭详情。 */
    _syncDetailWithBoard() {
      if (!this.detailId || !this.board) return;
      const t = this.findTask(this.detailId);
      if (!t) return;
      const key = `${t.status}|${t.priority ?? ""}|${t.assignee ?? ""}|${t.title}`;
      if (key === _detailKey) return;
      _detailKey = key;
      this.openDetail(this.detailId);
    },

    /* ---------- 分页任务列表（GET /api/tasks 信封） ---------- */
    /* 过滤/搜索/切板变化 → 重置第 1 页 + 重拉（防抖 300ms）。注册一次，幂等。
       基线机制：首次回调（初始加载 currentBoard null→slug）只记录基线，
       不触发重置 —— 否则会清掉 URL 恢复的页码（实测踩坑）。 */
    initTasksWatch() {
      if (this._tasksWatchInstalled) return;
      this._tasksWatchInstalled = true;
      this.initPageFromUrl();
      const vm = this;
      let t = null;
      let lastBoardSlug = null;
      let lastFilters = null; // 首次回调建立基线
      let baseline = false;
      this._tasksWatch = watch(
        () => [
          vm.listStatus,
          vm.listAssignee,
          vm.listArchived,
          vm.search,
          vm.sortBy,
          vm.currentBoard ? vm.currentBoard.slug : null,
        ],
        (vals) => {
          const slug = vals[5];
          const boardChanged =
            baseline && slug !== null && lastBoardSlug !== null && slug !== lastBoardSlug;
          const filterChanged =
            baseline &&
            lastFilters !== null &&
            vals.slice(0, 5).some((v, i) => v !== lastFilters[i]);
          lastBoardSlug = slug;
          lastFilters = vals.slice(0, 5);
          baseline = true;
          if (t) clearTimeout(t);
          t = setTimeout(() => {
            if ((boardChanged || filterChanged) && vm.page !== 1) {
              vm.page = 1;
              vm._syncPageUrl();
            }
            vm.fetchTasks();
          }, 300);
        }
      );
    },
    /* 无 router：history.replaceState 轻量 URL 同步（仅 page 参数，不触发导航） */
    _syncPageUrl() {
      try {
        if (typeof window === "undefined" || !window.history || !window.history.replaceState)
          return;
        const url = new URL(window.location.href);
        url.searchParams.set("page", String(this.page));
        window.history.replaceState(null, "", url.toString());
      } catch (_) {
        /* URL 不可用时静默（非核心路径） */
      }
    },
    /* 重新加载应用时恢复当前页（?page=N） */
    initPageFromUrl() {
      try {
        if (typeof window === "undefined") return;
        const p = parseInt(new URL(window.location.href).searchParams.get("page") || "", 10);
        if (Number.isFinite(p) && p >= 1) this.page = p;
      } catch (_) {
        /* */
      }
    },
    /* 每次拉取必带 page + page_size；解析信封存 state。
       空页回退：当前页越界（如归档后总量减少）→ 回到最后一页。 */
    async fetchTasks() {
      if (!this.authed) return;
      const params = new URLSearchParams();
      params.set("page", String(this.page));
      params.set("page_size", String(this.pageSize));
      if (this.listStatus) params.set("status", this.listStatus);
      if (this.listAssignee) params.set("assignee", this.listAssignee);
      if (this.sortBy) params.set("sort", this.sortBy);
      const q = (this.search || "").trim();
      if (q) params.set("q", q);
      if (this.listArchived) params.set("archived", "1");
      const seq = ++_tasksSeq;
      this.tasksLoading = true;
      this.tasksError = "";
      try {
        const data = await api(`/api/tasks?${params.toString()}`);
        if (seq !== _tasksSeq) return; // 竞态守卫：过期响应丢弃
        this.tasks = data.items || [];
        this.page = data.page || this.page;
        this.pageSize = data.page_size || this.pageSize;
        this.total = data.total || 0;
        this.totalPages = data.total_pages || 0;
        if (this.tasks.length === 0 && this.total > 0 && this.page > this.totalPages) {
          this.page = this.totalPages;
          this._syncPageUrl();
          return this.fetchTasks(); // 越界页 → 回退最后一页重拉
        }
      } catch (err) {
        if (seq !== _tasksSeq) return;
        if (err.message !== "Unauthorized") {
          console.error("fetchTasks:", err.message);
          this.tasksError = err.message;
        }
      } finally {
        if (seq === _tasksSeq) this.tasksLoading = false;
      }
    },
    /* 翻页：钳制 1..totalPages（无数据时仅第 1 页） */
    async setPage(p) {
      const tp = this.totalPages > 0 ? this.totalPages : 1;
      const n = Number.isFinite(p) ? Math.min(Math.max(1, Math.trunc(p)), tp) : 1;
      if (n === this.page) return;
      this.page = n;
      this._syncPageUrl();
      await this.fetchTasks();
    },
    /* 改每页条数：钳制 1..100，重置回第 1 页 */
    async setPageSize(n) {
      const size = Number.isFinite(n) ? Math.min(Math.max(1, Math.trunc(n)), 100) : 20;
      if (size === this.pageSize) return;
      this.pageSize = size;
      this.page = 1;
      this._syncPageUrl();
      await this.fetchTasks();
    },
    /* 重拉当前页（下拉刷新 / 操作后对齐） */
    async refreshTasks() {
      await this.fetchTasks();
    },
    /* 乐观更新：仅操作当前页 —— 状态变更任务先从页内移除（move/archive 等），
       成功后 _reconcileTasks 重拉对齐；失败也重拉恢复真实状态 */
    _optimisticRemoveTask(id) {
      const idx = this.tasks.findIndex((t) => t.id === id);
      if (idx === -1) return false;
      this.tasks = this.tasks.filter((t) => t.id !== id);
      return true;
    },
    _reconcileTasks(removed) {
      /* 列表未加载（tasks 为空且无移除）时零开销；否则重拉当前页，
         fetchTasks 内建空页回退（页内数量降到 0 且还有数据 → 自动回退） */
      if (removed || this.tasks.length) return this.fetchTasks();
      return Promise.resolve();
    },

    /* ---------- M2-1 S1 乐观更新基础设施 ---------- */
    /* 看板列乐观迁移：源列移出 → 推入目标列（浅拷贝 + status 覆盖；原对象引用保留用于回滚）。
       返回快照；无 board/无目标列时返回 null（该动作退化为纯等待，不做乐观）。 */
    _optimisticMoveBoard(id, targetStatus) {
      if (!this.board || !targetStatus) return null;
      for (let ci = 0; ci < this.board.statuses.length; ci++) {
        const col = this.board.statuses[ci];
        const idx = col.tasks.findIndex((t) => t.id === id);
        if (idx === -1) continue;
        const task = col.tasks[idx];
        const snap = {
          task,
          fromStatus: col.status,
          fromIndex: idx,
          targetStatus,
          targetInserted: false,
        };
        col.tasks.splice(idx, 1);
        col.count = Math.max(0, (col.count || 0) - 1);
        const target = this.board.statuses.find((c) => c.status === targetStatus);
        if (target && targetStatus !== col.status) {
          target.tasks.push({ ...task, status: targetStatus });
          target.count = (target.count || 0) + 1;
          snap.targetInserted = true;
        }
        /* t_bcf7c7bd: 乐观迁移后立即维持隐藏空列不变量（目标列有卡即展开、源列清空即折叠） */
        if (this.hideEmpty) this._enforceHideEmpty(false);
        return snap;
      }
      return null;
    },
    /* 快照回滚：目标列移除乐观副本 → 源列原位恢复（失败 <1s 还原） */
    _rollbackOptimistic(snap) {
      if (!snap || !this.board) return;
      const target = this.board.statuses.find((c) => c.status === snap.targetStatus);
      if (target && snap.targetInserted) {
        const idx = target.tasks.findIndex((t) => t.id === snap.task.id);
        if (idx >= 0) {
          target.tasks.splice(idx, 1);
          target.count = Math.max(0, (target.count || 0) - 1);
        }
      }
      const from = this.board.statuses.find((c) => c.status === snap.fromStatus);
      if (from) {
        from.tasks.splice(Math.min(snap.fromIndex, from.tasks.length), 0, snap.task);
        from.count = (from.count || 0) + 1;
      }
    },
    /* 超时兜底：恢复原样 + 解锁 UI，继续后台等；响应到达后仅做权威合并 */
    _timeoutFallback(id, snapBoard, removed) {
      if (!this.pendingOps[id]) return;
      delete this.pendingOps[id];
      this._rollbackOptimistic(snapBoard);
      if (removed) this._reconcileTasks(true);
      _opTimers[id] = null;
    },

    /* ---------- task actions ---------- */
    /* M2-1 S1 乐观更新统一入口：
       - pendingOps 串行化同一任务（双击/多入口防重发）；
       - POST 前本地同构变更（看板列迁移 + 列表页移除），卡片「同步中」微标 + 按钮禁用；
       - 成功以服务端响应为权威（refreshBoard 合并）；失败快照回滚 + 失败 toast + 重试按钮；
       - 10s 超时兜底：恢复原样、解锁 UI，响应到达后仅权威合并。 */
    async runAction(id, action, note, targetStatus) {
      /* 同一任务 pending 串行化：进行中直接忽略（消灭双击双发） */
      if (this.pendingOps[id]) return null;
      if (action === "archive") {
        const c = COPY.confirm.archiveTask;
        const confirmed = await confirm({
          title: c.title,
          message: c.message,
          confirmText: c.confirmText,
        });
        if (!confirmed) return null; // 用户取消，静默
      }
      if (!note && action === "block") note = "via web";
      if (!note && action === "schedule") note = "scheduled via web";
      if (!note && ["promote", "request-changes"].includes(action)) note = "via web";
      /* 目标状态：显式传入（MoveSheet/拖拽落点）优先，否则按动作推导 */
      const tStatus = targetStatus || ACTION_TARGET[action] || null;
      /* 乐观更新：看板列迁移 + 列表页移除（快照留作回滚） */
      const snapBoard = tStatus ? this._optimisticMoveBoard(id, tStatus) : null;
      const removed = this._optimisticRemoveTask(id);
      this.pendingOps[id] = true;
      const timer = setTimeout(() => this._timeoutFallback(id, snapBoard, removed), OP_TIMEOUT_MS);
      _opTimers[id] = timer;
      const settle = () => {
        delete this.pendingOps[id];
        if (_opTimers[id] && _opTimers[id] !== null) clearTimeout(_opTimers[id]);
        delete _opTimers[id];
      };
      try {
        const res = await api(
          `/api/tasks/${encodeURIComponent(id)}/action`,
          jsonOpts("POST", { action, note })
        );
        const timedOut = _opTimers[id] === null; // 超时兜底已执行：不再重复反馈
        settle();
        if (timedOut) {
          await this.refreshBoard(); // 仅权威合并
          return res;
        }
        const label = actionLabel(action);
        const undo = UNDO_ACTIONS[action];
        if (undo) {
          /* B1：可逆动作成功 → 5s 撤销条（含手动关闭），替代普通 toast */
          snackbar(`已${label}`, {
            actionText: "撤销",
            onAction: () => this.runAction(id, undo, "undo via web"),
          });
        } else {
          /* B1/B3：状态迁移成功用中文动作标签（清单 §2.4「已归档」「已完成」），
             不透传 CLI 英文 res.message（如 "Archived t_xxx"） */
          ok(`已${label}`);
        }
        await this.refreshBoard();
        if (this.detailId) await this.openDetail(this.detailId);
        await this._reconcileTasks(removed);
        return res;
      } catch (err) {
        const timedOut = _opTimers[id] === null;
        settle();
        if (timedOut) {
          /* 兜底后失败：展示已恢复原样，仅提示失败（不重复回滚） */
          await this.refreshBoard();
          fail(COPY.fail("操作", err.message));
          throw err;
        }
        /* M2-1 S1：失败快照回滚（<1s 还原原列原位）+ 失败 toast + 重试按钮 */
        this._rollbackOptimistic(snapBoard);
        await this._reconcileTasks(removed);
        fail(COPY.fail("操作", err.message), {
          retry: () => this.runAction(id, action, note, targetStatus),
        });
        throw err;
      }
    },
    async runExtended(id, kind, payload = {}) {
      /* claim 也做乐观更新（ready→running）；specify/decompose/heartbeat 保持 loading */
      if (this.pendingOps[id]) return null;
      loading(COPY.misc.loading[kind] || COPY.misc.loading.default);
      const tStatus = kind === "claim" ? "running" : null;
      const snapBoard = tStatus ? this._optimisticMoveBoard(id, tStatus) : null;
      const removed = kind === "claim" ? this._optimisticRemoveTask(id) : false;
      if (tStatus) {
        this.pendingOps[id] = true;
        const timer = setTimeout(
          () => this._timeoutFallback(id, snapBoard, removed),
          OP_TIMEOUT_MS
        );
        _opTimers[id] = timer;
      }
      const settle = () => {
        delete this.pendingOps[id];
        if (_opTimers[id] && _opTimers[id] !== null) clearTimeout(_opTimers[id]);
        delete _opTimers[id];
      };
      try {
        const res = await api(
          `/api/tasks/${encodeURIComponent(id)}/${kind}`,
          jsonOpts("POST", payload)
        );
        const timedOut = _opTimers[id] === null;
        settle();
        if (timedOut) {
          await this.refreshBoard();
          return res;
        }
        ok(res.message || actionLabel(kind) || "完成");
        await this.refreshBoard();
        if (this.detailId) await this.openDetail(this.detailId);
        await this._reconcileTasks(removed);
        return res;
      } catch (err) {
        const timedOut = _opTimers[id] === null;
        settle();
        if (timedOut) {
          await this.refreshBoard();
          fail(COPY.failShort(err.message));
          throw err;
        }
        this._rollbackOptimistic(snapBoard);
        await this._reconcileTasks(removed);
        fail(COPY.failShort(err.message));
        throw err;
      }
    },
    handleTaskAction(task, action) {
      const needNote = ["block", "schedule", "promote", "request-changes", "reopen-review"];
      if (action === "view") {
        this.openDetail(task.id);
        return;
      }
      if (action === "move") {
        this.openMove(task);
        return;
      }
      if (action === "assign") {
        this.assignTask = task;
        return;
      }
      if (action === "child") {
        this.openCreate({ parent: task.id });
        return;
      }
      if (action === "edit-result") {
        this.editTask = task;
        return;
      }
      if (action === "context") {
        this.openDetail(task.id, { loadContext: true });
        return;
      }
      if (action === "log") {
        this.openDetail(task.id, { loadLog: true });
        return;
      }
      if (
        action === "specify" ||
        action === "decompose" ||
        action === "claim" ||
        action === "heartbeat"
      ) {
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
      /* B1：同 id 重开也强制详情重拉（状态迁移后详情同步），TaskDetail watch 依赖此 nonce */
      this.detailNonce = (this.detailNonce || 0) + 1;
      /* M2-4 S7: 记录当前看板指纹，避免下一个 refreshBoard 重复重拉 */
      const t = this.findTask(id);
      _detailKey = t ? `${t.status}|${t.priority ?? ""}|${t.assignee ?? ""}|${t.title}` : "";
    },
    closeDetail() {
      this.detailId = null;
      this.detailOpts = {};
    },

    /* ---------- events ---------- */
    /* M2-4 S6: 游标改事件 ID（created_at 同秒事件会丢/重；ID 单调精确续传） */
    async pollEvents() {
      try {
        const list = await api(`/api/events?after=${this.eventAfter}&limit=100`);
        if (!list || !list.length) return;
        const seen = new Set(this.events.map((e) => e.id));
        for (const ev of list) {
          if (!seen.has(ev.id)) {
            this.events.push(ev);
            seen.add(ev.id);
          }
        }
        if (this.events.length > 100) this.events = this.events.slice(this.events.length - 100);
        this.eventAfter = list[list.length - 1].id;
      } catch (_) {
        /* best-effort */
      }
    },

    /* ---------- polling ---------- */
    startPolling() {
      if (this.boardTimer) return;
      /* M1-3 E6: 轮询 30s → 60s（ETag 条件请求降频）；
         M1-4 E7: 断网时暂停轮询；
         M2-3 S3: SSE 连接期间暂停 60s 轮询（空转轮询归零），SSE 断开自动恢复兜底 */
      this.boardTimer = setInterval(() => {
        if (!this.sseActive && !document.hidden && this.authed && this.online) this.refreshBoard();
      }, 60000);
    },
    stopPolling() {
      if (this.boardTimer) {
        clearInterval(this.boardTimer);
        this.boardTimer = null;
      }
    },
    /* ---------- M2-3 S3: SSE 事件推送 ---------- */
    startSse() {
      if (_sse || !this.authed) return;
      const vm = this;
      _sse = createEventSource({
        onOpen: () => {
          /* 连接成功：恢复 SSE 推送模式（暂停 60s 轮询兜底） */
          vm.sseActive = true;
        },
        onEvent: () => {
          /* 300ms 合并节流：突发事件批（如批量操作）只触发一次 refreshBoard */
          if (document.hidden || _sseThrottle) return;
          _sseThrottle = setTimeout(() => {
            _sseThrottle = null;
            vm.refreshBoard();
          }, 300);
        },
        onError: () => {
          /* 连接失败：SSE 侧自动定时重连；期间降级到 60s 轮询兜底（sseActive=false） */
          vm.sseActive = false;
        },
      });
    },
    stopSse() {
      if (_sse) {
        _sse.close();
        _sse = null;
      }
      if (_sseThrottle) {
        clearTimeout(_sseThrottle);
        _sseThrottle = null;
      }
      this.sseActive = false;
    },
    /* 生命周期启动（App.vue onMounted 调用一次）：
       可见性暂停/恢复由 App.vue onVis 处理（stopSse/startSse） */
    initSse() {
      this.startSse();
    },
    /* M1-4 E7: 连接状态变化——断网暂停轮询，恢复立即刷新 */
    setOnline(v) {
      this.online = !!v;
      if (v) {
        this.startPolling();
        this.startSse(); // M2-3 S3: 网络恢复 → 重连 SSE
        this.refreshBoard(true);
      }
    },
    startEventPolling() {
      if (this.eventTimer) return;
      this.eventTimer = setInterval(() => {
        if (!document.hidden && this.view === "stats") this.pollEvents();
      }, 5000);
    },
    stopEventPolling() {
      if (this.eventTimer) {
        clearInterval(this.eventTimer);
        this.eventTimer = null;
      }
    },

    /* ---------- view ---------- */
    setView(v) {
      this.view = v;
      if (v === "stats") {
        if (!this.events.length) this.eventAfter = 0;
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
