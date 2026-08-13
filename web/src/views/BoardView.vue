<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useAppStore, STATUS_ORDER } from "../store";
import { persistBoardFilter } from "../utils";
import BoardChips from "../components/BoardChips.vue";
import BoardDots from "../components/BoardDots.vue";
import BoardColumn from "../components/BoardColumn.vue";

const store = useAppStore();
const boardEl = ref(null);
const refreshing = ref(false);
const activeDot = ref(0);

/* M1-5 E8: 搜索无匹配 → 引导去列表页 */
const searchEmpty = computed(() => {
  const q = store.search.trim().toLowerCase();
  if (!q || !store.board) return false;
  return !store.board.statuses.some((c) =>
    c.tasks.some((t) => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
  );
});

/* ---------- 邻页露头（P2#12）：单列模式下一列，仅移动端 ---------- */
const peekCol = computed(() => {
  if (store.boardFilter === "all" || !store.isMobile || !store.board) return null;
  const idx = STATUS_ORDER.indexOf(store.boardFilter);
  if (idx < 0) return null;
  const next = STATUS_ORDER[idx + 1];
  if (!next) return null;
  return store.board.statuses.find((c) => c.status === next) || null;
});

function onPeek() {
  const p = peekCol.value;
  if (!p) return;
  store.boardFilter = p.status;
  persistBoardFilter(p.status);
}

function updateDots() {
  if (!store.board) return;
  if (store.boardFilter !== "all") {
    const idx = store.board.statuses.findIndex((c) => c.status === store.boardFilter);
    activeDot.value = idx < 0 ? 0 : idx;
    return;
  }
  const el = boardEl.value;
  if (!el) return;
  const colEls = el.querySelectorAll(".column");
  if (!colEls.length) {
    activeDot.value = 0;
    return;
  }
  const rect = el.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  let best = 0;
  let bestDist = Infinity;
  colEls.forEach((c, i) => {
    const cr = c.getBoundingClientRect();
    const d = Math.abs(cr.left + cr.width / 2 - center);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  activeDot.value = best;
}

function onBoardScroll() {
  requestAnimationFrame(updateDots);
}

async function onRefresh() {
  /* t_3ad4fe46: 手动下拉/⟳ 刷新必须绕过 ETag，否则同秒变更被 304 短路 */
  await store.refreshBoard(true);
  refreshing.value = false;
  try {
    navigator.vibrate?.(10);
  } catch (_) {
    /* */
  }
}

/* ---------- 左右滑动切列（仅单列模式，60px 阈值） ---------- */
let startX = null;
let startY = null;

function onTouchStart(e) {
  startX = null;
  startY = null;
  if (!store.mob.swipe || store.boardFilter === "all" || e.touches.length !== 1) return;
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
}
function onTouchMove(e) {
  if (startX == null) return;
  const dx = e.touches[0].clientX - startX;
  const dy = e.touches[0].clientY - startY;
  if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) e.preventDefault();
}
function onTouchEnd(e) {
  if (startX == null) return;
  const dx = e.changedTouches[0].clientX - startX;
  const dy = e.changedTouches[0].clientY - startY;
  startX = null;
  startY = null;
  if (store.boardFilter === "all") return;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
    const idx = STATUS_ORDER.indexOf(store.boardFilter);
    if (idx < 0) return;
    /* 边缘返回（P1#9）：第一列（triage）向右滑 → 回到全部 */
    if (idx === 0 && dx > 60) {
      store.boardFilter = "all";
      persistBoardFilter("all");
      nextTick(() => updateDots());
      return;
    }
    const target = dx < 0 ? STATUS_ORDER[idx + 1] : STATUS_ORDER[idx - 1];
    if (!target) return;
    store.boardFilter = target;
    persistBoardFilter(target);
    try {
      navigator.vibrate?.(15);
    } catch (_) {
      /* */
    }
    nextTick(() => updateDots());
  }
}

/* 进入筛选态时自动展开目标列（覆盖：点筛选 chip / 只看此列 / 滑动切列 / 恢复记忆），
   保证任务列表直接可见，而不是 56px 折叠窄条。boardFilter watch 覆盖点击/滑动等交互；
   board watch 覆盖移动端恢复记忆场景（此时 loadCollapsed 已执行完毕） */
function ensureFilteredColExpanded(v) {
  if (v && v !== "all" && store.isColFolded({ status: v, count: 0 })) {
    store.setCollapsed(v, false);
  }
}
watch(
  () => store.boardFilter,
  (v) => {
    ensureFilteredColExpanded(v);
    nextTick(updateDots);
  }
);
watch(
  () => store.board,
  () => {
    ensureFilteredColExpanded(store.boardFilter);
    nextTick(updateDots);
  }
);
onMounted(() => {
  nextTick(updateDots);
  /* P1#7：移动端恢复最近使用列（校验存在性） */
  if (store.isMobile) {
    let saved = null;
    try {
      saved = localStorage.getItem("kb-board-filter");
    } catch (_) {
      /* */
    }
    if (saved && store.board?.statuses.some((c) => c.status === saved)) {
      store.boardFilter = saved;
    }
  }
});
</script>

<template>
  <section id="board-view" class="view" aria-label="看板">
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <BoardChips v-if="store.mob.chips && store.board" />

      <!-- M1-5 E8: 搜索无匹配 → 引导去列表页 -->
      <div v-if="searchEmpty" class="search-guide" role="note">
        <span>没有匹配「{{ store.search.trim() }}」的任务</span>
        <button class="btn btn-sm" @click="store.setView('list')">去列表页查看 →</button>
      </div>

      <!-- 骨架屏（P0#4） -->
      <div v-if="!store.board" class="board-loading" aria-hidden="true">
        <div v-for="n in 3" :key="n" class="skeleton-col">
          <van-skeleton title :row="3" />
        </div>
      </div>

      <div
        v-else
        ref="boardEl"
        class="board"
        :class="{ single: store.boardFilter !== 'all' }"
        @scroll="onBoardScroll"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <div v-if="!store.visibleCols.length" class="empty">没有任务</div>
        <BoardColumn v-for="col in store.visibleCols" :key="col.status" :col="col" />

        <!-- 邻页露头列（P2#12） -->
        <div
          v-if="peekCol"
          class="column peek"
          :class="'st-' + peekCol.status"
          role="button"
          :aria-label="'切到 ' + peekCol.label"
          @click="onPeek"
        >
          <div class="column-head">
            <span class="dot"></span>
            <span class="column-title">{{ peekCol.label }}</span>
          </div>
          <div class="column-body">
            <div v-for="t in peekCol.tasks.slice(0, 2)" :key="t.id" class="card peek-card">
              <div class="card-title">{{ t.title }}</div>
            </div>
          </div>
        </div>
      </div>

      <BoardDots v-if="store.mob.indicator && store.board" :active="activeDot" />
    </van-pull-refresh>
  </section>
</template>
