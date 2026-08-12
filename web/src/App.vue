<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useAppStore, vantThemeVars } from "./store";
import { api, jsonOpts, setOnUnauthorized } from "./api";
import { ok, fail, COPY } from "./feedback";

import LoginScreen from "./components/LoginScreen.vue";
import ThemeSwitcher from "./components/ThemeSwitcher.vue";
import TaskDetail from "./components/TaskDetail.vue";
import CreateTaskPopup from "./components/CreateTaskPopup.vue";
import MoveSheet from "./components/MoveSheet.vue";
import TaskMenu from "./components/TaskMenu.vue";
import Modals from "./components/Modals.vue";

import BoardView from "./views/BoardView.vue";
import ListView from "./views/ListView.vue";
import StatsView from "./views/StatsView.vue";
import SettingsView from "./views/SettingsView.vue";

const store = useAppStore();

const NAVS = [
  { id: "board", label: "看板", icon: "apps-o" },
  { id: "list", label: "列表", icon: "bars" },
  { id: "stats", label: "统计", icon: "bar-chart-o" },
  { id: "settings", label: "设置", icon: "setting-o" },
];

const isMobile = computed(() => store.isMobile);
const searchDrop = ref(false);

/* M1-5 E9: 快捷键说明面板（`?` 打开，Esc 关闭） */
const helpShow = ref(false);

/* ---------- 顶栏 board 快速切换 ---------- */
const boardSheet = ref(false);
const boardActions = ref([]);
const boardSwitching = ref(false);

async function openBoardSwitch() {
  try {
    await store.loadBoards();
  } catch (_) {
    /* toast below */
  }
  const cur = store.currentBoard ? store.currentBoard.slug : "";
  boardActions.value = store.boards.map((b) => ({
    name: b.slug === cur ? `${b.name || b.slug}（当前）` : b.name || b.slug,
    slug: b.slug,
    disabled: b.slug === cur,
  }));
  if (!boardActions.value.length) {
    fail(COPY.misc.noOtherBoard);
    return;
  }
  boardSheet.value = true;
}
async function onBoardSelect(item) {
  if (item.disabled || boardSwitching.value) return;
  boardSwitching.value = true;
  try {
    await store.switchBoard(item.slug);
    ok(COPY.ok.switched(item.name));
  } catch (err) {
    fail(COPY.fail("切换", err.message));
  } finally {
    boardSwitching.value = false;
  }
}

/* ---------- 长按 FAB（P2#14）：400ms → 9 状态「新建到此列」 ---------- */
const fabSheet = ref(false);
/* M1-6 E11: 状态顺序/文案由 /api/board 派生（db.py 权威），未加载时回退硬编码 */
const fabActions = computed(() =>
  store.statusOrder.map((s) => ({ name: `新建到「${store.statusLabels[s] || s}」`, status: s }))
);
let fabTimer = null;
let fabSuppress = 0;

function onFabTouchStart() {
  clearTimeout(fabTimer);
  fabTimer = setTimeout(() => {
    fabTimer = null;
    fabSuppress = Date.now() + 400;
    try {
      navigator.vibrate?.(30);
    } catch (_) {
      /* */
    }
    fabSheet.value = true;
  }, 400);
}
function onFabTouchEnd() {
  if (fabTimer) {
    clearTimeout(fabTimer);
    fabTimer = null;
  }
}
function onFabClick() {
  if (Date.now() < fabSuppress) return;
  store.showCreate = true;
}
function onFabAction(item) {
  store.openCreate({ status: item.status });
}

const tabIndex = computed({
  get: () =>
    Math.max(
      0,
      NAVS.findIndex((n) => n.id === store.view)
    ),
  set: (i) => {
    if (i >= 0 && NAVS[i]) store.setView(NAVS[i].id);
  },
});

const vantVars = computed(() => vantThemeVars(store.theme));

function onSearch() {
  if (store.view === "list") return;
  if (isMobile.value) store.setView("list");
}
function onSearchMobile() {
  if (store.view === "board") store.setView("list");
}
function closeSearchDrop() {
  searchDrop.value = false;
  store.search = "";
}
async function doRefresh() {
  await store.refreshBoard(true);
  await store.refreshTasks(); // 列表页分页数据同步刷新
  if (store.view === "stats") store.eventSince = 0;
  if (store.view === "stats") await store.pollEvents();
}

/* M1-4 E7: 「更新于 xx:xx」 */
function fmtClock(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* M1-4 E7: 断网横幅 + 恢复立即刷新（监听在 onMounted 注册） */
function onOffline() {
  store.setOnline(false);
}
function onOnline() {
  store.setOnline(true);
}

function onVis() {
  if (document.hidden) {
    store.stopPolling();
    store.stopEventPolling();
  } else {
    store.startPolling();
    store.refreshBoard();
    if (store.view === "stats") {
      store.startEventPolling();
      store.pollEvents();
    }
  }
}

/* ================= M1-5 E9: 全局键盘快捷键 =================
   Esc：依次关闭 详情 → 菜单 → 移动到 → 创建弹窗
   c：新建任务；/：聚焦搜索；?：快捷键提示 */
const SHORTCUT_HELP = [
  ["Esc", "依次关闭详情 / 菜单 / 移动到 / 新建弹窗"],
  ["c", "新建任务"],
  ["/", "聚焦搜索"],
  ["?", "显示本提示"],
  ["Enter（卡片聚焦时）", "打开任务详情"],
];
function isTypingTarget(t) {
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
async function onGlobalKeydown(e) {
  if (!store.authed) return;
  if (e.key === "Escape") {
    /* F5: Esc 依次关闭 快捷键面板 → 详情 → 菜单 → 移动到 → 创建弹窗
       确认弹窗（feedback.confirm 的 van-dialog）优先级最高：Esc 由 feedback.js
       捕获阶段监听取消弹窗，这里看到可见 dialog 时直接让路，避免误关弹窗下的详情/菜单 */
    const dlg = document.querySelector(".van-dialog");
    /* 确认弹窗（feedback.confirm 的 van-dialog）由 feedback.js 捕获阶段监听处理 Esc；
       快捷键面板自身是 van-dialog，排除之，否则 Esc 永远关不掉帮助面板（M1-5 E9） */
    if (dlg && getComputedStyle(dlg).display !== "none" && !dlg.classList.contains("help-dialog"))
      return;
    if (helpShow.value) {
      e.preventDefault();
      helpShow.value = false;
    } else if (store.detailId) {
      e.preventDefault();
      store.closeDetail();
    } else if (store.menuVisible) {
      e.preventDefault();
      store.closeMenu();
    } else if (store.moveTask) {
      e.preventDefault();
      store.closeMove();
    } else if (store.showCreate) {
      e.preventDefault();
      store.showCreate = false;
    }
    return;
  }
  if (isTypingTarget(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "c" || e.key === "C") {
    e.preventDefault();
    store.openCreate({});
  } else if (e.key === "/") {
    e.preventDefault();
    const input = document.querySelector(".controls .van-search input");
    if (input) input.focus();
  } else if (e.key === "?") {
    e.preventDefault();
    helpShow.value = true;
  }
}

onMounted(() => {
  setOnUnauthorized(() => store.logout());
  store.initTheme();
  store.loadMob();
  store.loadCollapsed();
  store.initTasksWatch(); // 分页列表：过滤/搜索/切板 → 重置第 1 页（防抖）+ URL ?page= 恢复
  if (store.authed) {
    store.startPolling();
    store.refreshBoard();
    store.loadBoards();
  }
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("keydown", onGlobalKeydown);
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVis);
  window.removeEventListener("offline", onOffline);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("keydown", onGlobalKeydown);
  store.stopPolling();
  store.stopEventPolling();
});
</script>

<template>
  <van-config-provider v-if="store.authed" :theme-vars="vantVars">
    <div class="bg-grid" aria-hidden="true"></div>

    <header id="topbar">
      <div class="brand" title="Hermes Kanban" @click="store.setView('board')">
        <span class="brand-brackets">⟨</span>
        <span class="brand-name">Hermes Kanban</span>
        <span class="brand-short">Kanban</span>
        <span class="brand-brackets">⟩</span>
        <span class="brand-sep">·</span>
        <span
          class="brand-board"
          role="button"
          tabindex="0"
          title="点击切换看板"
          aria-label="切换看板"
          @click.stop="openBoardSwitch"
          @keydown.enter.stop="openBoardSwitch"
          >{{ store.currentBoard ? store.currentBoard.name : "…" }} ▾</span
        >
      </div>

      <nav class="top-nav" aria-label="主导航">
        <button
          v-for="n in NAVS"
          :key="n.id"
          class="top-nav-btn"
          :class="{ active: store.view === n.id }"
          @click="store.setView(n.id)"
        >
          {{ n.label }}
        </button>
      </nav>

      <div class="controls">
        <button
          v-if="isMobile"
          class="icon-btn"
          title="搜索"
          aria-label="搜索"
          @click="searchDrop = !searchDrop"
        >
          ⌕
        </button>
        <van-search
          v-else
          v-model="store.search"
          placeholder="搜索任务…"
          shape="round"
          @update:model-value="onSearch"
        />
        <ThemeSwitcher />
        <button v-if="!isMobile" class="icon-btn" title="刷新" aria-label="刷新" @click="doRefresh">
          ⟳
        </button>
        <span v-if="store.lastSyncedAt && !isMobile" class="synced-at" title="最近一次成功同步时间"
          >更新于 {{ fmtClock(store.lastSyncedAt) }}</span
        >
      </div>

      <div v-if="searchDrop" class="search-drop">
        <van-search
          v-model="store.search"
          placeholder="搜索任务…"
          shape="round"
          @update:model-value="onSearchMobile"
        />
        <button class="btn" @click="closeSearchDrop">取消</button>
      </div>
    </header>

    <!-- M1-4 E7: 连接状态横幅（断网 / 刷新失败） -->
    <div v-if="!store.online" class="net-banner offline" role="alert">
      <span>⚠ 网络已断开 · 数据暂停更新</span>
      <span class="net-banner-sub">恢复联网后自动同步</span>
    </div>
    <div v-else-if="store.boardError" class="net-banner warn" role="alert">
      <span
        >⚠ 数据刷新失败 · 最后成功于
        {{ store.lastSyncedAt ? fmtClock(store.lastSyncedAt) : "—" }}</span
      >
      <button class="retry-btn" @click="store.refreshBoard(true)">重试</button>
    </div>

    <main id="main">
      <BoardView v-if="store.view === 'board'" />
      <ListView v-else-if="store.view === 'list'" />
      <StatsView v-else-if="store.view === 'stats'" />
      <SettingsView v-else-if="store.view === 'settings'" />
    </main>

    <van-tabbar v-model="tabIndex" class="bottom-tabbar" safe-area-inset-bottom fixed>
      <van-tabbar-item v-for="n in NAVS" :key="n.id" :icon="n.icon">{{ n.label }}</van-tabbar-item>
    </van-tabbar>

    <button
      id="fab"
      title="新建任务"
      aria-label="新建任务"
      @touchstart="onFabTouchStart"
      @touchend="onFabTouchEnd"
      @touchcancel="onFabTouchEnd"
      @click="onFabClick"
    >
      ＋
    </button>

    <van-action-sheet
      v-model:show="fabSheet"
      title="新建到此列"
      :actions="fabActions"
      close-on-click-action
      @select="onFabAction"
    />

    <van-action-sheet
      v-model:show="boardSheet"
      title="切换看板"
      :actions="boardActions"
      :loading="boardSwitching"
      close-on-click-action
      @select="onBoardSelect"
    />

    <TaskDetail />
    <CreateTaskPopup />
    <MoveSheet />
    <TaskMenu />
    <Modals />

    <!-- M1-5 E9: 快捷键说明面板（`?` 打开，Esc 关闭；van-dialog 自带焦点圈定） -->
    <van-dialog
      v-model:show="helpShow"
      title="键盘快捷键"
      :show-cancel-button="false"
      confirm-button-text="知道了"
      close-on-click-overlay
      class="help-dialog"
    >
      <div class="help-panel">
        <div v-for="([k, d], i) in SHORTCUT_HELP" :key="i" class="help-row">
          <kbd class="help-key">{{ k }}</kbd>
          <span class="help-desc">{{ d }}</span>
        </div>
      </div>
    </van-dialog>
  </van-config-provider>

  <LoginScreen v-else />
</template>

<style scoped>
/* 快捷键说明面板：kbd 键帽 + 说明行；样式随主题变量（追加覆盖，不重写既有选择器） */
.help-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px 20px 22px;
}
.help-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.help-key {
  flex: none;
  min-width: 46px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--text, #f7f8f8) 22%, transparent);
  border-bottom-width: 2px;
  background: color-mix(in srgb, var(--text, #f7f8f8) 6%, transparent);
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  text-align: center;
  color: var(--accent, #5ff0e0);
}
.help-desc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text, #f7f8f8);
}
</style>
