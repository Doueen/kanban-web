<script setup>
import { computed } from "vue";
import { useAppStore } from "../store";

const store = useAppStore();

const chips = computed(() => {
  if (!store.board) return [];
  const total = store.board.statuses.reduce((s, c) => s + (c.count || 0), 0);
  return [
    { value: "all", label: "全部", count: total },
    ...store.board.statuses
      .filter((s) => !store.hiddenChips.includes(s.status))
      .map((s) => ({ value: s.status, label: s.label, count: s.count || 0 })),
  ];
});

function select(v) {
  store.boardFilter = v;
  if (v !== "all") {
    try { localStorage.setItem("kb-board-filter", v); } catch (_) { /* */ }
  } else {
    try { localStorage.removeItem("kb-board-filter"); } catch (_) { /* */ }
  }
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
    >
      <span class="chip-label">{{ c.label }}</span>
      <span v-if="c.count > 0" class="chip-count">{{ c.count > 99 ? "99+" : c.count }}</span>
    </button>
  </div>
</template>
