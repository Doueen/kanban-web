<script setup>
import { nextTick, onMounted, ref, watch } from "vue";
import { useAppStore, STATUS_ORDER } from "../store";
import BoardChips from "../components/BoardChips.vue";
import BoardDots from "../components/BoardDots.vue";
import BoardColumn from "../components/BoardColumn.vue";

const store = useAppStore();
const boardEl = ref(null);
const refreshing = ref(false);
const activeDot = ref(0);

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
  await store.refreshBoard();
  refreshing.value = false;
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
    const target = dx < 0 ? STATUS_ORDER[idx + 1] : STATUS_ORDER[idx - 1];
    if (!target) return;
    store.boardFilter = target;
    nextTick(() => updateDots());
  }
}

watch(() => store.boardFilter, () => nextTick(updateDots));
watch(() => store.board, () => nextTick(updateDots));
onMounted(() => nextTick(updateDots));
</script>

<template>
  <section id="board-view" class="view" aria-label="看板">
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <BoardChips v-if="store.mob.chips && store.board" />

      <div
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
      </div>

      <BoardDots v-if="store.mob.indicator && store.board" :active="activeDot" />
    </van-pull-refresh>
  </section>
</template>
