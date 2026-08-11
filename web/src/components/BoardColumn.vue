<script setup>
import { computed, ref } from "vue";
import { showToast } from "vant";
import { useAppStore, actionForTarget, STATUS } from "../store";
import TaskCard from "./TaskCard.vue";

const props = defineProps({
  col: { type: Object, required: true },
});

const store = useAppStore();
const dragOver = ref(false);

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
    <div class="column-head">
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

    <div class="column-body">
      <div v-if="!col.tasks.length" class="empty" style="padding: 18px 4px; font-size: 12px">空</div>
      <TaskCard v-for="(t, i) in col.tasks" :key="t.id" :task="t" :index="i" />
    </div>
  </section>
</template>
