<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { showToast } from "vant";
import { useAppStore, actionForTarget, STATUS } from "../store";
import { persistBoardFilter } from "../utils";
import TaskCard from "./TaskCard.vue";

const props = defineProps({
  col: { type: Object, required: true },
});

const store = useAppStore();
const dragOver = ref(false);
const showSheet = ref(false);

const EMPTY_TEXT = {
  triage: "待梳理·无积压",
  todo: "待办空空如也 🎉",
  ready: "没有就绪任务",
  running: "无运行中",
  blocked: "无阻塞 ✅",
  scheduled: "无定时任务",
  review: "无评审中",
  done: "暂无完成",
  archived: "归档无记录",
};
const emptyText = computed(() => EMPTY_TEXT[props.col.status] || "空");

const folded = computed(() => store.isColFolded(props.col));

function toggleFold() {
  store.toggleCollapsed(props.col.status);
}

async function onDrop(e) {
  e.preventDefault();
  dragOver.value = false;
  const id = store.draggingId || e.dataTransfer.getData("text/plain");
  store.draggingId = null;
  if (!id) return;
  const task = store.findTask(id);
  if (!task) return;
  const move = actionForTarget(task, props.col.status);
  if (!move) {
    showToast({ message: `无法将任务移动到「${STATUS[props.col.status] || props.col.status}」`, type: "fail" });
    return;
  }
  try {
    await store.runAction(id, move.action, undefined);
  } catch (_) {
    /* toast handled in store */
  }
}

/* ---------- 列头快捷操作（P1#8） ---------- */
const colActions = computed(() => [
  { name: "只看此列", status: props.col.status },
  { name: folded.value ? "展开此列" : "折叠此列", fold: true },
  { name: `新建到此列（${props.col.label}）`, create: true },
]);

function onHeadClick(e) {
  if (e.target.closest(".col-fold")) return;
  showSheet.value = true;
}
function onColAction(item) {
  if (item.status) {
    store.boardFilter = item.status;
    persistBoardFilter(item.status);
  } else if (item.fold) {
    toggleFold();
  } else if (item.create) {
    store.openCreate({ status: props.col.status });
  }
}

/* ---------- 虚拟滚动（P2#15：单列模式且任务 >50 条，窗口化） ---------- */
const scrollEl = ref(null);
const ITEM_H = 96;
const virt = reactive({ start: 0, end: 0 });
const isSingle = computed(() => store.boardFilter !== "all");
const useVirt = computed(() => isSingle.value && props.col.tasks.length > 50);
const shownTasks = computed(() => {
  if (!useVirt.value) return props.col.tasks;
  return props.col.tasks.slice(virt.start, virt.end);
});
function calcWindow() {
  const el = scrollEl.value;
  if (!el) return;
  const total = props.col.tasks.length;
  const s = Math.max(0, Math.floor(el.scrollTop / ITEM_H));
  const vis = Math.ceil(el.clientHeight / ITEM_H) + 6;
  virt.start = Math.max(0, s - 4);
  virt.end = Math.min(total, s + vis);
}
function onVirtScroll() {
  if (useVirt.value) calcWindow();
}
watch(
  () => [props.col.tasks.length, useVirt.value],
  () => nextTick(calcWindow)
);
onMounted(() => {
  if (useVirt.value) nextTick(calcWindow);
});
</script>

<template>
  <section
    class="column"
    :class="['st-' + col.status, { folded, 'drag-over': dragOver }]"
    :data-status="col.status"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop="onDrop"
  >
    <div class="column-head" @click="onHeadClick">
      <span v-if="folded" class="fold-count" :class="{ 'has-tasks': col.count > 0, 'is-empty': col.count === 0 }">{{ col.count }}</span>
      <span class="dot"></span>
      <span class="column-title">{{ col.label }}</span>
      <span class="column-count">{{ col.count }}</span>
      <button
        class="col-fold"
        :title="folded ? '展开' : '折叠'"
        :aria-label="folded ? '展开' : '折叠'"
        @click="toggleFold"
      >{{ folded ? "▸" : "▾" }}</button>
    </div>

    <div ref="scrollEl" class="column-body" @scroll="onVirtScroll">
      <div v-if="!col.tasks.length" class="empty" style="padding: 18px 4px; font-size: 12px">{{ emptyText }}</div>
      <template v-else>
        <div v-if="useVirt" :style="{ height: virt.start * ITEM_H + 'px', flex: '0 0 auto' }"></div>
        <TaskCard v-for="(t, i) in shownTasks" :key="t.id" :task="t" :index="virt.start + i" />
        <div v-if="useVirt" :style="{ height: (col.tasks.length - virt.end) * ITEM_H + 'px', flex: '0 0 auto' }"></div>
      </template>
    </div>

    <van-action-sheet
      v-model:show="showSheet"
      :actions="colActions"
      close-on-click-action
      @select="onColAction"
    />
  </section>
</template>
