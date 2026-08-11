<script setup>
import { useAppStore } from "../store";

const store = useAppStore();

function select(v) {
  store.boardFilter = v;
}
</script>

<template>
  <div v-if="store.board" class="board-chips">
    <button
      v-for="c in [{ value: 'all', label: '全部' }, ...store.board.statuses]"
      :key="c.value"
      class="chip"
      :class="{ active: store.boardFilter === c.value }"
      @click="select(c.value)"
    >{{ c.label }}</button>
  </div>
</template>
