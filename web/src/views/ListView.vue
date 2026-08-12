<script setup>
import { computed, ref } from "vue";
import { useAppStore, STATUS, STATUS_CSS } from "../store";
import { ago, fmtTime } from "../utils";

const store = useAppStore();
const refreshing = ref(false);
const showAssignee = ref(false);

const assigneeCols = computed(() => [
  { text: "全部指派", value: "" },
  ...store.assignees.map((a) => ({ text: a.name, value: a.name })),
]);

const listChips = computed(() => [
  { value: "", label: "全部", count: store.board ? store.board.statuses.reduce((s, c) => s + (c.count || 0), 0) : 0 },
  ...(store.board ? store.board.statuses.map((s) => ({ value: s.status, label: s.label, count: s.count || 0 })) : []),
]);

const filtered = computed(() => {
  let tasks = store.board ? store.board.statuses.flatMap((c) => c.tasks) : [];
  if (store.listStatus) tasks = tasks.filter((t) => t.status === store.listStatus);
  if (store.listAssignee) tasks = tasks.filter((t) => t.assignee === store.listAssignee);
  const q = store.search.trim().toLowerCase();
  if (q) tasks = tasks.filter((t) => (t.title + " " + (t.body || "")).toLowerCase().includes(q));
  if (!store.listArchived) tasks = tasks.filter((t) => t.status !== "archived");
  if (store.sortBy === "priority") {
    tasks = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.created_at || 0) - (a.created_at || 0));
  } else {
    tasks = [...tasks].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }
  return tasks;
});

async function onRefresh() {
  await store.refreshBoard();
  refreshing.value = false;
}

function toggleSort() {
  store.sortBy = store.sortBy === "created" ? "priority" : "created";
}

function openMenu(t, e) {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  store.openMenu(t, r.left, r.bottom);
}
</script>

<template>
  <section class="view" aria-label="列表">
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div v-if="store.board" class="board-chips">
        <button
          v-for="c in listChips"
          :key="c.value"
          class="chip"
          :class="{ active: store.listStatus === c.value }"
          @click="store.listStatus = c.value"
        >
          <span class="chip-label">{{ c.label }}</span>
          <span v-if="c.count > 0" class="chip-count">{{ c.count > 99 ? "99+" : c.count }}</span>
        </button>
      </div>

      <div class="list-toolbar">
        <van-field
          class="list-assignee"
          :model-value="store.listAssignee || '全部指派'"
          label="指派"
          is-link
          readonly
          @click="showAssignee = true"
        />
        <van-search v-model="store.search" placeholder="搜索…" shape="round" />
        <van-button icon="exchange" size="small" style="flex: 0 0 auto" @click="toggleSort">
          {{ store.sortBy === "priority" ? "优先级" : "创建时间" }}
        </van-button>
        <label class="check-label">
          <van-switch v-model="store.listArchived" size="18px" />
          <span>含归档</span>
        </label>
      </div>

      <div class="list-sort-note">{{ store.sortBy === "priority" ? "按优先级排序" : "按创建时间排序" }}</div>

      <div>
        <van-empty v-if="!filtered.length" description="没有匹配的任务" />
        <div
          v-for="t in filtered"
          :key="t.id"
          class="list-row"
          :class="'st-' + t.status"
          @click="store.openDetail(t.id)"
        >
          <div class="list-row-main">
            <div class="list-row-title">{{ t.title }}</div>
            <div class="list-row-meta">
              <van-tag :color="STATUS_CSS[t.status]" text-color="#0d0f1a">{{ STATUS[t.status] }}</van-tag>
              <span v-if="t.priority > 0" class="card-priority">P{{ t.priority }}</span>
              <span class="card-id">{{ t.id }}</span>
              <span v-if="t.assignee">@{{ t.assignee }}</span>
              <span :title="fmtTime(t.created_at)">创建于 {{ ago(t.created_at) }}</span>
            </div>
          </div>
          <button class="menu-btn list-menu-btn" aria-label="操作菜单" @click="openMenu(t, $event)">⋯</button>
        </div>
      </div>

      <van-popup v-model:show="showAssignee" position="bottom" round>
        <van-picker
          :columns="assigneeCols"
          title="选择指派"
          @confirm="(v) => { const t = v.selectedOptions[0]?.text; store.listAssignee = t === '全部指派' ? '' : t; }"
          @cancel="showAssignee = false"
        />
      </van-popup>
    </van-pull-refresh>
  </section>
</template>
