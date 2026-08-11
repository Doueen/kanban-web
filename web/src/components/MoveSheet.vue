<script setup>
import { computed } from "vue";
import { showToast } from "vant";
import { useAppStore, STATUS_ORDER, STATUS, actionForTarget } from "../store";

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

async function moveTo(st) {
  const t = task.value;
  if (!t) return;
  if (st === t.status) return;
  const move = actionForTarget(t, st);
  if (!move) {
    showToast({ message: `无法移动到「${STATUS[st] || st}」`, type: "fail" });
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
        :class="['st-' + st, { disabled: st === task?.status }]"
        :disabled="st === task?.status"
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
