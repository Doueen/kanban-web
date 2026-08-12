<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { showToast } from "vant";
import { useAppStore, STATUS_ORDER, STATUS, vantThemeVars } from "./store";
import { api, jsonOpts, setOnUnauthorized } from "./api";

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

/* ---------- 顶栏 board 快速切换 ---------- */
const boardSheet = ref(false);
const boardActions = ref([]);
const boardSwitching = ref(false);

async function openBoardSwitch() {
  try {
    await store.loadBoards();
  } catch (_) { /* toast below */ }
  const cur = store.currentBoard ? store.currentBoard.slug : "";
  boardActions.value = store.boards.map((b) => ({
    name: b.slug === cur ? `${b.name || b.slug}（当前）` : b.name || b.slug,
    slug: b.slug,
    disabled: b.slug === cur,
  }));
  if (!boardActions.value.length) {
    showToast({ message: "暂无其他看板", type: "fail" });
    return;
  }
  boardSheet.value = true;
}
async function onBoardSelect(item) {
  if (item.disabled || boardSwitching.value) return;
  boardSwitching.value = true;
  try {
    await store.switchBoard(item.slug);
    showToast({ message: `已切换到「${item.name}」`, type: "success" });
  } catch (err) {
    showToast({ message: "切换失败: " + err.message, type: "fail" });
  } finally {
    boardSwitching.value = false;
  }
}

/* ---------- 长按 FAB（P2#14）：400ms → 9 状态「新建到此列」 ---------- */
const fabSheet = ref(false);
const FAB_ACTIONS = STATUS_ORDER.map((s) => ({ name: `新建到「${STATUS[s]}」`, status: s }));
let fabTimer = null;
let fabSuppress = 0;

function onFabTouchStart() {
  clearTimeout(fabTimer);
  fabTimer = setTimeout(() => {
    fabTimer = null;
    fabSuppress = Date.now() + 400;
    try { navigator.vibrate?.(30); } catch (_) { /* */ }
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
  get: () => Math.max(0, NAVS.findIndex((n) => n.id === store.view)),
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
  await store.refreshBoard();
  if (store.view === "stats") store.eventSince = 0;
  if (store.view === "stats") await store.pollEvents();
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

onMounted(() => {
  setOnUnauthorized(() => store.logout());
  store.initTheme();
  store.loadMob();
  store.loadCollapsed();
  if (store.authed) {
    store.startPolling();
    store.refreshBoard();
    store.loadBoards();
  }
  document.addEventListener("visibilitychange", onVis);
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVis);
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
        >{{ store.currentBoard ? store.currentBoard.name : "…" }} ▾</span>
      </div>

      <nav class="top-nav" aria-label="主导航">
        <button
          v-for="n in NAVS"
          :key="n.id"
          class="top-nav-btn"
          :class="{ active: store.view === n.id }"
          @click="store.setView(n.id)"
        >{{ n.label }}</button>
      </nav>

      <div class="controls">
        <button v-if="isMobile" class="icon-btn" title="搜索" aria-label="搜索" @click="searchDrop = !searchDrop">⌕</button>
        <van-search
          v-else
          v-model="store.search"
          placeholder="搜索任务…"
          shape="round"
          @update:model-value="onSearch"
        />
        <ThemeSwitcher />
        <button v-if="!isMobile" class="icon-btn" title="刷新" aria-label="刷新" @click="doRefresh">⟳</button>
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
    >＋</button>

    <van-action-sheet
      v-model:show="fabSheet"
      title="新建到此列"
      :actions="FAB_ACTIONS"
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
  </van-config-provider>

  <LoginScreen v-else />
</template>
