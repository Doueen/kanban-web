<script setup>
import { useAppStore } from "../store";

defineProps({
  active: { type: Number, default: 0 },
});

const store = useAppStore();
</script>

<template>
  <div v-if="store.board" class="board-dots">
    <span
      v-for="(c, i) in store.board.statuses"
      :key="c.status"
      class="dot-e"
      :class="{ active: i === active }"
    ></span>
  </div>
</template>
