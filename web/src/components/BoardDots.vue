<script setup>
import { useAppStore } from "../store";
import { persistBoardFilter } from "../utils";

defineProps({
  active: { type: Number, default: 0 },
});

const store = useAppStore();

function go(i) {
  const st = store.visibleCols[i]?.status;
  if (!st) return;
  store.boardFilter = st;
  persistBoardFilter(st);
}
</script>

<template>
  <div v-if="store.board && store.visibleCols.length" class="board-dots">
    <button
      v-for="(c, i) in store.visibleCols"
      :key="c.status"
      class="dot-e"
      :class="{ active: i === active }"
      :aria-label="c.label"
      @click="go(i)"
    ></button>
  </div>
</template>
