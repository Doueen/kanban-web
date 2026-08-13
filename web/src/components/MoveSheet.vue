<script setup>
import { computed } from "vue";
import { useAppStore, actionForTarget } from "../store";
import { fail, COPY } from "../feedback";

const store = useAppStore();

const show = computed({
  get: () => !!store.moveTask,
  set: (v) => {
    if (!v) store.closeMove();
  },
});

const task = computed(() => store.moveTask);

/* M2-1 S1: 同步中（乐观 pending）→ 目标按钮禁用，避免同任务重复提交 */
const syncing = computed(() => !!store.pendingOps[task.value?.id]);

/* M1-6 E11: 状态顺序/文案由 /api/board 派生（db.py 权威），未加载时回退硬编码 */
const statusOrder = computed(() => store.statusOrder);
const statusLabels = computed(() => store.statusLabels);
const statusLabel = (st) => statusLabels.value[st] || st;

const actions = computed(() => {
  const t = task.value;
  if (!t) return [];
  const list = [];
  if (t.status !== "done" && t.status !== "archived")
    list.push({ action: "complete", label: "完成" });
  if (t.status !== "archived") list.push({ action: "archive", label: "归档" });
  return list;
});

/* M1-5 E10: 无效目标预判灰化禁用（actionForTarget 为空 / 归档任务无合法迁移） */
function targetDisabled(st) {
  const t = task.value;
  if (!t) return true;
  if (st === t.status) return true;
  if (t.status === "archived") return true;
  return !actionForTarget(t, st);
}

async function moveTo(st) {
  const t = task.value;
  if (!t) return;
  if (st === t.status) return;
  const move = actionForTarget(t, st);
  if (!move) {
    fail(COPY.misc.cannotMoveTo(statusLabel(st)));
    return;
  }
  store.closeMove();
  try {
    /* M2-1 S1: 显式目标状态传入 → 看板列乐观迁移 + 同步中微标 */
    await store.runAction(t.id, move.action, undefined, st);
  } catch (_) {
    /* toast handled in store */
  }
}

async function doAction(action) {
  const t = task.value;
  if (!t) return;
  store.closeMove();
  try {
    await store.runAction(t.id, action);
  } catch (_) {
    /* toast handled in store */
  }
}
</script>

<template>
  <van-action-sheet v-model:show="show" title="移动到" close-on-click-action>
    <div class="move-grid">
      <button
        v-for="st in statusOrder"
        :key="st"
        class="move-item"
        :class="['st-' + st, { disabled: targetDisabled(st) || syncing }]"
        :disabled="targetDisabled(st) || syncing"
        @click="moveTo(st)"
      >
        <span class="dot"></span>
        <span>{{ statusLabel(st) }}</span>
        <span v-if="st === task?.status" class="move-cur">✓</span>
      </button>
    </div>
    <div v-if="actions.length" class="move-actions">
      <van-button
        size="small"
        type="success"
        :disabled="syncing"
        @click="doAction(actions[0].action)"
        >{{ actions[0].label }}</van-button
      >
      <van-button
        v-if="actions[1]"
        size="small"
        type="warning"
        :disabled="syncing"
        @click="doAction(actions[1].action)"
        >{{ actions[1].label }}</van-button
      >
    </div>
  </van-action-sheet>
</template>
