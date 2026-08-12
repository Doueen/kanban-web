<script setup>
import { computed } from "vue";
import { useAppStore, menuItems } from "../store";

const store = useAppStore();

const actions = computed(() => {
  if (!store.menuTask) return [];
  return menuItems(store.menuTask).map((it) => ({
    name: it.label,
    value: it.action,
  }));
});

function onSelect(item) {
  const task = store.menuTask;
  store.closeMenu();
  if (!task) return;
  store.handleTaskAction(task, item.value);
}
</script>

<template>
  <van-action-sheet
    v-model:show="store.menuVisible"
    :actions="actions"
    cancel-text="取消"
    description="任务操作"
    @select="onSelect"
    @cancel="store.closeMenu()"
  />
</template>
