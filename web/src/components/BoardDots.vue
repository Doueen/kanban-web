<script setup>
import { useAppStore } from "../store";
import { persistBoardFilter } from "../utils";

defineProps({
  active: { type: Number, default: 0 },
});

const store = useAppStore();

function go(i) {
  const st = store.board?.statuses[i]?.status;
  if (!st) return;
  store.boardFilter = st;
  persistBoardFilter(st);
}
</script>

<template>
  <div v-if="store.board" class="board-dots">
    <button
      v-for="(c, i) in store.board.statuses"
      :key="c.status"
      class="dot-e"
      :class="{ active: i === active }"
      :aria-label="c.label"
      @click="go(i)"
    ></button>
  </div>
</template>
