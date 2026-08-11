<script setup>
import { computed, ref } from "vue";
import { useAppStore } from "../store";

const props = defineProps({
  task: { type: Object, required: true },
  index: { type: Number, default: 0 },
});

const store = useAppStore();

const longPressing = ref(false);
let lpTimer = null;
let lpStart = null;
let suppressClickUntil = 0;

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

function quick(action) {
  store.runAction(props.task.id, action);
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
}
function onDragEnd() {
  store.draggingId = null;
}
</script>

<template>
  <van-swipe-cell :disabled="!showSwipe">
    <div
      class="card"
      :class="['st-' + task.status, { 'long-press': longPressing, dragging: store.draggingId === task.id }]"
      draggable="true"
      :style="{ animationDelay: Math.min(index, 7) * 40 + 'ms' }"
      @click="onClick"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
    >
      <div class="card-title">{{ task.title }}</div>
      <div class="card-meta">
        <div class="card-tags">
          <span v-if="task.priority > 0" class="card-priority" :title="'优先级 ' + task.priority">P{{ task.priority }}</span>
          <span v-if="task.assignee" class="card-assignee" :title="task.assignee">@{{ task.assignee }}</span>
        </div>
        <div class="card-tags">
          <span class="card-id">{{ task.id }}</span>
          <button
            v-if="store.mob.quickact && task.status !== 'done' && task.status !== 'archived'"
            class="card-quick"
            title="完成"
            aria-label="完成"
            @click.stop="quick('complete')"
          >✓</button>
          <button class="menu-btn" aria-label="操作菜单" @click.stop="openMenu($event)">⋯</button>
        </div>
      </div>
    </div>

    <template v-if="showSwipe" #right>
      <van-button square type="success" class="swipe-btn" text="完成" @click="quick('complete')" />
      <van-button square type="warning" class="swipe-btn" text="归档" @click="quick('archive')" />
    </template>
  </van-swipe-cell>
</template>
