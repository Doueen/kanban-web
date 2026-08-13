<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useAppStore, actionForTarget, STATUS } from "../store";
import { persistBoardFilter, taskMatchesSearch } from "../utils";
import { api } from "../api";
import { stopDragGhost } from "../dragGhost";
import { fail, COPY } from "../feedback";
import TaskCard from "./TaskCard.vue";

const props = defineProps({
  col: { type: Object, required: true },
});

const store = useAppStore();
const dragOver = ref(false);
const dragInvalid = ref(false);
const showSheet = ref(false);

/* M2-4 S4: archived 列懒加载（后端不下发任务；展开时经 /api/tasks 拉取，按需刷新） */
const lazyTasks = ref(null); // null = 未加载
let archLoaded = false;
const isArchivedCol = computed(() => props.col.status === "archived");

async function loadArchived() {
  if (archLoaded || !isArchivedCol.value) return;
  try {
    const data = await api("/api/tasks?status=archived&archived=1&page_size=100");
    lazyTasks.value = data.items || [];
    archLoaded = true;
  } catch (_) {
    /* 失败保持 null，下次展开重试 */
  }
}
/* 展开时加载；加载后 count 与列表条数不符（新归档/恢复）→ 重拉 */
watch(
  () => [props.col.status, store.isColFolded(props.col), props.col.count],
  (vals) => {
    if (vals[1]) return; // 折叠中不加载
    if (lazyTasks.value !== null && vals[2] !== lazyTasks.value.length) {
      archLoaded = false;
      lazyTasks.value = null;
    }
    loadArchived();
  },
  { immediate: true }
);
const displayTasks = computed(() =>
  isArchivedCol.value && lazyTasks.value !== null ? lazyTasks.value : props.col.tasks
);

/* 拖拽结束（drop/取消）统一复位列高亮，防 dragleave 漏触发导致高亮残留 */
watch(
  () => store.draggingId,
  (v) => {
    if (!v) {
      dragOver.value = false;
      dragInvalid.value = false;
    }
  }
);

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

/* M1-5 E8: 任意页搜索 → 本列卡片按标题/ID 实时过滤（archived 懒加载列用 displayTasks） */
const searchQuery = computed(() => (store.view === "board" ? store.search.trim() : ""));
const filteredTasks = computed(() => {
  const q = searchQuery.value;
  if (!q) return displayTasks.value;
  return displayTasks.value.filter((t) => taskMatchesSearch(t, q));
});
const showEmpty = computed(() =>
  searchQuery.value
    ? !displayTasks.value.some((t) => taskMatchesSearch(t, searchQuery.value))
    : !displayTasks.value.length
);
/* M2-4 S4: archived 懒加载进行中（显示加载占位，避免「归档无记录」闪跳） */
const archLoading = computed(() => isArchivedCol.value && lazyTasks.value === null);

function toggleFold() {
  store.toggleCollapsed(props.col.status);
}

/* ---------- 拖拽目标反馈（U3：dragover 预判有效/无效，无效红晕 + dropEffect=none） ---------- */
function onDragOver(e) {
  e.preventDefault();
  const task = store.draggingId ? store.findTask(store.draggingId) : null;
  if (!task) {
    /* 外部拖入（无任务上下文）：中性高亮，允许放置 */
    dragOver.value = true;
    dragInvalid.value = false;
    e.dataTransfer.dropEffect = "move";
    return;
  }
  const ok = task.status !== props.col.status && !!actionForTarget(task, props.col.status);
  dragOver.value = ok;
  dragInvalid.value = !ok;
  e.dataTransfer.dropEffect = ok ? "move" : "none";
}

function onDragEnter(e) {
  /* 折叠列拖入自动展开，避免 56px 窄条无法落点 */
  if (store.draggingId && folded.value) store.setCollapsed(props.col.status, false);
}

function onDragLeave(e) {
  /* 进入子元素时 dragleave 也会触发——仅当真正离开整列时复位 */
  if (!e.currentTarget.contains(e.relatedTarget)) {
    dragOver.value = false;
    dragInvalid.value = false;
  }
}

async function onDrop(e) {
  e.preventDefault();
  dragOver.value = false;
  dragInvalid.value = false;
  stopDragGhost();
  const id = store.draggingId || e.dataTransfer.getData("text/plain");
  store.draggingId = null;
  if (!id) return;
  const task = store.findTask(id);
  if (!task) return;
  /* 拖回原列 = 取消手势，静默忽略（不再是错误提示） */
  if (task.status === props.col.status) return;
  const move = actionForTarget(task, props.col.status);
  if (!move) {
    fail(COPY.misc.cannotMoveTo(STATUS[props.col.status] || props.col.status));
    return;
  }
  try {
    /* M2-1 S1: 拖拽落点作为显式 targetStatus 传入 → 看板列乐观迁移 */
    await store.runAction(id, move.action, undefined, props.col.status);
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
/* M2-5 U5b: 菜单/空列 CTA 共用的「新建到此列」处理器 */
function openCreateInCol() {
  store.openCreate({ status: props.col.status });
}
function onColAction(item) {
  if (item.status) {
    store.boardFilter = item.status;
    persistBoardFilter(item.status);
  } else if (item.fold) {
    toggleFold();
  } else if (item.create) {
    openCreateInCol();
  }
}

/* ---------- 虚拟滚动（P2#15：单列模式且任务 >50 条，窗口化） ---------- */
const scrollEl = ref(null);
const ITEM_H = 96;
const virt = reactive({ start: 0, end: 0 });
const isSingle = computed(() => store.boardFilter !== "all");
/* M1-5 E8: 搜索时窗口化/计数都基于过滤后的任务列表 */
const useVirt = computed(() => isSingle.value && filteredTasks.value.length > 50);
/* 虚拟滚动窗口化时关闭卡片进出过渡（否则滚动过程中每个新挂载卡片都播动画，造成卡顿） */
const transName = computed(() => (useVirt.value ? "card-virt" : "card"));
const shownTasks = computed(() => {
  if (!useVirt.value) return filteredTasks.value;
  return filteredTasks.value.slice(virt.start, virt.end);
});
function scrollElDom() {
  /* TransitionGroup 上挂 ref 拿到的是组件实例，取 $el 才是滚动容器 */
  const v = scrollEl.value;
  return v && (v.$el || v);
}
function calcWindow() {
  const el = scrollElDom();
  if (!el) return;
  const total = filteredTasks.value.length;
  const s = Math.max(0, Math.floor(el.scrollTop / ITEM_H));
  const vis = Math.ceil(el.clientHeight / ITEM_H) + 6;
  virt.start = Math.max(0, s - 4);
  virt.end = Math.min(total, s + vis);
}
function onVirtScroll() {
  if (useVirt.value) calcWindow();
}
watch(
  () => [filteredTasks.value.length, useVirt.value],
  () => nextTick(calcWindow)
);
onMounted(() => {
  if (useVirt.value) nextTick(calcWindow);
});

/* 离开动画：把即将移除的卡片钉在原位（列内是 flex 纵向布局，absolute 元素会跑到列首，
   必须显式记下 rect 再 absolute，兄弟卡片 FLIP 上移时它原地淡出，无跳动） */
function onCardBeforeLeave(el) {
  const p = el.parentElement;
  if (!p) return;
  const r = el.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  el.style.top = `${r.top - pr.top}px`;
  el.style.left = `${r.left - pr.left}px`;
  el.style.width = `${r.width}px`;
}
</script>

<template>
  <section
    class="column"
    :class="['st-' + col.status, { folded, 'drag-over': dragOver, 'drag-invalid': dragInvalid }]"
    :data-status="col.status"
    @dragover="onDragOver"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="column-head" @click="onHeadClick">
      <span
        v-if="folded"
        class="fold-count"
        :class="{ 'has-tasks': col.count > 0, 'is-empty': col.count === 0 }"
        >{{ col.count }}</span
      >
      <span class="dot"></span>
      <span class="column-title">{{ col.label }}</span>
      <span class="column-count">{{ col.count }}</span>
      <button
        class="col-fold"
        :title="folded ? '展开' : '折叠'"
        :aria-label="folded ? '展开' : '折叠'"
        @click="toggleFold"
      >
        {{ folded ? "▸" : "▾" }}
      </button>
    </div>

    <TransitionGroup
      ref="scrollEl"
      tag="div"
      class="column-body"
      :name="transName"
      @scroll="onVirtScroll"
      @before-leave="onCardBeforeLeave"
    >
      <div v-if="showEmpty" key="empty" class="empty" style="padding: 18px 4px; font-size: 12px">
        <template v-if="archLoading">加载中…</template>
        <template v-else-if="searchQuery">
          {{ emptyText }} · 无匹配
          <button class="btn empty-cta" @click="store.setView('list')">去列表页查看</button>
        </template>
        <template v-else>
          {{ emptyText }}
          <button
            v-if="!searchQuery && !isArchivedCol && props.col.count === 0"
            class="btn empty-cta"
            @click="openCreateInCol"
          >
            新建到此列
          </button>
        </template>
      </div>
      <template v-else>
        <div
          v-if="useVirt"
          key="sp-top"
          :style="{ height: virt.start * ITEM_H + 'px', flex: '0 0 auto' }"
        ></div>
        <TaskCard
          v-for="(t, i) in shownTasks"
          :key="t.id"
          :task="t"
          :index="virt.start + i"
          :no-anim="useVirt"
          :highlight="searchQuery"
        />
        <div
          v-if="useVirt"
          key="sp-bot"
          :style="{ height: (filteredTasks.length - virt.end) * ITEM_H + 'px', flex: '0 0 auto' }"
        ></div>
      </template>
    </TransitionGroup>

    <van-action-sheet
      v-model:show="showSheet"
      :actions="colActions"
      close-on-click-action
      @select="onColAction"
    />
  </section>
</template>
