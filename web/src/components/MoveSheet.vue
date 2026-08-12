<script setup>
import { computed } from "vue";
import { useAppStore, STATUS_ORDER, STATUS, actionForTarget } from "../store";
import { fail, COPY } from "../feedback";

const store = useAppStore();

const show = computed({
  get: () => !!store.moveTask,
  set: (v) => {
    if (!v) store.closeMove();
  },
});

const task = computed(() => store.moveTask);

const actions = computed(() => {
  const t = task.value;
  if (!t) return [];
  const list = [];
  if (t.status !== "done" && t.status !== "archived") list.push({ action: "complete", label: "完成" });
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
    fail(COPY.misc.cannotMoveTo(STATUS[st] || st));
    return;
  }
  store.closeMove();
  try {
    await store.runAction(t.id, move.action);
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
        v-for="st in STATUS_ORDER"
        :key="st"
        class="move-item"
        :class="['st-' + st, { disabled: targetDisabled(st) }]"
        :disabled="targetDisabled(st)"
        @click="moveTo(st)"
      >
        <span class="dot"></span>
        <span>{{ STATUS[st] }}</span>
        <span v-if="st === task?.status" class="move-cur">✓</span>
      </button>
    </div>
    <div v-if="actions.length" class="move-actions">
      <van-button size="small" type="success" @click="doAction(actions[0].action)">{{ actions[0].label }}</van-button>
      <van-button v-if="actions[1]" size="small" type="warning" @click="doAction(actions[1].action)">{{ actions[1].label }}</van-button>
    </div>
  </van-action-sheet>
</template>
