<script setup>
import { computed, ref } from "vue";
import { useAppStore } from "../store";
import { highlightParts, taskMatchesSearch } from "../utils";
import { startDragGhost, stopDragGhost, transparentDragImage } from "../dragGhost";

const props = defineProps({
  task: { type: Object, required: true },
  index: { type: Number, default: 0 },
  noAnim: { type: Boolean, default: false },
  highlight: { type: String, default: "" },
});

const store = useAppStore();

/* M1-5 E8: 搜索高亮分段 + 命中态（标题/ID） */
const titleParts = computed(() => highlightParts(props.task.title, props.highlight));
const idHit = computed(() => {
  const q = (props.highlight || "").trim().toLowerCase();
  return !!q && String(props.task.id || "").toLowerCase().includes(q);
});
const searchHit = computed(() => {
  const q = (props.highlight || "").trim();
  return !!q && taskMatchesSearch(props.task, q);
});

const longPressing = ref(false);
let lpTimer = null;
let lpStart = null;
let suppressClickUntil = 0;

const swipeCell = ref(null);

const avatar = computed(() => {
  const name = props.task.assignee || "";
  return name ? name.trim().charAt(0).toUpperCase() : "";
});

const showSwipe = computed(
  () =>
    store.isMobile &&
    store.mob.swipe &&
    props.task.status !== "done" &&
    props.task.status !== "archived"
);

/* ---------- 长按 400ms → 移动到面板 ---------- */
function onTouchStart(e) {
  cancelLongPress();
  // 按钮区域（菜单/快捷键）不触发卡片长按——避免手机上点 ⋯ 被长按逻辑劫持
  if (e.target.closest?.("button")) return;
  if (!store.mob.longpress || !store.isTouch || e.touches.length !== 1) return;
  lpStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  longPressing.value = true;
  lpTimer = setTimeout(() => {
    longPressing.value = false;
    if (navigator.vibrate) navigator.vibrate(30);
    suppressClickUntil = Date.now() + 400;
    store.openMove(props.task);
  }, 400);
}
function onTouchMove(e) {
  if (!lpStart) return;
  const dx = Math.abs(e.touches[0].clientX - lpStart.x);
  const dy = Math.abs(e.touches[0].clientY - lpStart.y);
  if (dx > 12 || dy > 12) cancelLongPress();
}
function onTouchEnd() {
  cancelLongPress();
}
function cancelLongPress() {
  if (lpTimer) {
    clearTimeout(lpTimer);
    lpTimer = null;
  }
  longPressing.value = false;
  lpStart = null;
}

function onClick() {
  if (Date.now() < suppressClickUntil) return;
  store.openDetail(props.task.id);
}

/* 键盘可达性：卡片可聚焦，Enter/空格打开详情 */
function onKeydown(e) {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onClick();
  }
}

async function quick(action) {
  swipeCell.value?.close();
  try {
    await store.runAction(props.task.id, action);
    try { navigator.vibrate?.(10); } catch (_) { /* */ }
  } catch (_) {
    /* toast handled in store */
  }
}

function openMenu(e) {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  store.openMenu(props.task, r.left, r.bottom);
}
/* ---------- 桌面拖拽 ---------- */
function onDragStart(e) {
  store.draggingId = props.task.id;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", props.task.id);
  /* 减少动效模式下退回系统默认拖拽反馈；正常模式用自绘跟手幽灵卡 */
  if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    e.dataTransfer.setDragImage(transparentDragImage(), 0, 0);
    startDragGhost(props.task, "st-" + props.task.status);
  }
}
function onDragEnd() {
  store.draggingId = null;
  stopDragGhost();
}
</script>

<template>
  <van-swipe-cell :disabled="!showSwipe" ref="swipeCell">
    <div
      class="card"
      :class="['st-' + task.status, { 'long-press': longPressing, dragging: store.draggingId === task.id, 'no-anim': noAnim, 'search-hit': searchHit, 'search-id-hit': idHit }]"
      draggable="true"
      tabindex="0"
      role="button"
      :aria-label="'打开任务：' + task.title"
      :style="{ animationDelay: Math.min(index, 7) * 40 + 'ms' }"
      @click="onClick"
      @keydown="onKeydown"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
    >
      <!-- 移动端精简卡片：标题两行截断 + 指派首字母圆 + 优先级 + 快捷操作 -->
      <template v-if="store.isMobile">
        <div class="mob-head">
          <div class="card-title mob-clamp">
            <template v-for="(p, i) in titleParts" :key="i"><mark v-if="p.m" class="hl">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template>
          </div>
          <span v-if="task.assignee" class="mob-avatar" :title="task.assignee">{{ avatar }}</span>
        </div>
        <div class="mob-meta">
          <span v-if="task.priority > 0" class="card-priority" :title="'优先级 ' + task.priority">P{{ task.priority }}</span>
          <span class="mob-actions">
            <button
              v-if="store.mob.quickact && task.status !== 'done' && task.status !== 'archived'"
              class="card-quick"
              title="完成"
              aria-label="完成"
              @click.stop="quick('complete')"
            >✓</button>
            <button class="menu-btn" aria-label="操作菜单" @click.stop="openMenu($event)" @touchstart.stop.prevent>⋯</button>
          </span>
        </div>
      </template>

      <!-- 桌面端完整信息 -->
      <template v-else>
        <div class="card-title">
          <template v-for="(p, i) in titleParts" :key="i"><mark v-if="p.m" class="hl">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template>
        </div>
        <div class="card-meta">
          <div class="card-tags">
            <span v-if="task.priority > 0" class="card-priority" :title="'优先级 ' + task.priority">P{{ task.priority }}</span>
            <span v-if="task.assignee" class="card-assignee" :title="task.assignee">@{{ task.assignee }}</span>
          </div>
          <div class="card-tags">
            <span class="card-id" :class="{ 'hl-id': idHit }">{{ task.id }}</span>
            <button
              v-if="store.mob.quickact && task.status !== 'done' && task.status !== 'archived'"
              class="card-quick"
              title="完成"
              aria-label="完成"
              @click.stop="quick('complete')"
            >✓</button>
            <button class="menu-btn" aria-label="操作菜单" @click.stop="openMenu($event)" @touchstart.stop.prevent>⋯</button>
          </div>
        </div>
      </template>
    </div>

    <template v-if="showSwipe" #right>
      <button class="swipe-act swipe-complete" @click="quick('complete')">
        <van-icon name="passed" />
        <span>完成</span>
      </button>
      <button class="swipe-act swipe-archive" @click="quick('archive')">
        <van-icon name="folder-o" />
        <span>归档</span>
      </button>
      <button class="swipe-act swipe-block" @click="quick('block')">
        <van-icon name="warning-o" />
        <span>阻塞</span>
      </button>
    </template>
  </van-swipe-cell>
</template>
