<script setup>
import { computed } from "vue";
import { useAppStore } from "../store";

const store = useAppStore();

const chips = computed(() => [
  { value: "all", label: "全部" },
  ...(store.board
    ? store.board.statuses.map((s) => ({ value: s.status, label: s.label }))
    : []),
]);

function select(v) {
  store.boardFilter = v;
}
</script>

<template>
  <div v-if="store.board" class="board-chips">
    <button
      v-for="c in chips"
      :key="c.value"
      class="chip"
      :class="{ active: store.boardFilter === c.value }"
      @click="select(c.value)"
    >{{ c.label }}</button>
  </div>
</template>
