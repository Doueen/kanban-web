<script setup>
/* 分页器：上一页/下一页 + 页码按钮（窗口化，页多时省略号折叠）。
 * 数据层：store.setPage()（钳制 1..totalPages + history.replaceState URL 同步 + fetchTasks）。
 * 可见条件：total > pageSize 才显示（单页不出现）。
 * 无障碍：role=navigation + aria-label；页码按钮 aria-current="page"；
 *   翻页后焦点回到分页器容器（tabindex=-1，键盘用户不丢位置）；
 *   容器内 ←/→ 键 = 上一页/下一页。 */
import { computed, nextTick, ref, watch } from "vue";
import { useAppStore } from "../store";

const store = useAppStore();
const navEl = ref(null);

const showPager = computed(() => store.total > store.pageSize && store.totalPages > 1);
const isFirst = computed(() => store.page <= 1);
const isLast = computed(() => store.page >= store.totalPages);

/* 页码窗口：总页数 ≤7 全显示；否则 1 … cur-1 cur cur+1 … N（省略号折叠） */
const pageItems = computed(() => {
  const tp = store.totalPages;
  const cur = store.page;
  if (tp <= 7) {
    return Array.from({ length: tp }, (_, i) => i + 1);
  }
  const items = [1];
  if (cur > 3) items.push("…");
  const start = Math.max(2, cur - 1);
  const end = Math.min(tp - 1, cur + 1);
  for (let p = start; p <= end; p++) items.push(p);
  if (cur < tp - 2) items.push("…");
  items.push(tp);
  return items;
});

async function go(p) {
  if (store.tasksLoading || p === store.page) return;
  await store.setPage(p); // 数据层：改 state + URL ?page=N + 拉取，无整页刷新
}

function onKeydown(e) {
  if (store.tasksLoading) return;
  if (e.key === "ArrowLeft" && !isFirst.value) {
    e.preventDefault();
    go(store.page - 1);
  } else if (e.key === "ArrowRight" && !isLast.value) {
    e.preventDefault();
    go(store.page + 1);
  }
}

/* 翻页完成后把焦点移到分页器（键盘导航连续），仅当用户经由分页器操作时 */
watch(
  () => store.page,
  async () => {
    if (navEl.value && document.activeElement && navEl.value.contains(document.activeElement)) {
      await nextTick();
      navEl.value.focus({ preventScroll: true });
    }
  }
);
</script>

<template>
  <nav
    v-if="showPager"
    ref="navEl"
    class="pager"
    role="navigation"
    aria-label="分页"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <button
      class="pager-btn pager-prev"
      :disabled="isFirst || store.tasksLoading"
      aria-label="上一页"
      @click="go(store.page - 1)"
    >
      ‹ 上一页
    </button>
    <template v-for="(p, i) in pageItems" :key="i">
      <span v-if="p === '…'" class="pager-ellipsis" aria-hidden="true">…</span>
      <button
        v-else
        class="pager-btn"
        :class="{ active: p === store.page }"
        :aria-label="`第 ${p} 页`"
        :aria-current="p === store.page ? 'page' : undefined"
        :disabled="store.tasksLoading"
        @click="go(p)"
      >
        {{ p }}
      </button>
    </template>
    <button
      class="pager-btn pager-next"
      :disabled="isLast || store.tasksLoading"
      aria-label="下一页"
      @click="go(store.page + 1)"
    >
      下一页 ›
    </button>
    <span class="pager-meta" aria-live="polite">
      <template v-if="store.tasksLoading">加载中…</template>
      <template v-else
        >第 {{ store.page }} / {{ store.totalPages }} 页 · {{ store.total }} 条</template
      >
    </span>
  </nav>
</template>
