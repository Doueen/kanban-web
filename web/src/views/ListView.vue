<script setup>
import { computed, ref } from "vue";
import { showConfirmDialog, showToast } from "vant";
import { useAppStore, STATUS, STATUS_CSS, STATUS_ORDER } from "../store";
import { api, jsonOpts } from "../api";
import { ago, fmtTime } from "../utils";

const store = useAppStore();
const refreshing = ref(false);
const showAssignee = ref(false);

/* ---------- 批量操作 ---------- */
const batchMode = ref(false);
const selected = ref(new Set());

function toggleBatch() {
  batchMode.value = !batchMode.value;
  selected.value = new Set();
}
function toggleSelect(id) {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  selected.value = s;
}
async function batchAction(action, label) {
  const ids = Array.from(selected.value);
  if (!ids.length) { showToast({ message: "请先选择任务", type: "fail" }); return; }
  try {
    await showConfirmDialog({
      title: `批量${label}`,
      message: `对 ${ids.length} 个任务执行「${label}」？`,
      confirmButtonText: label,
    });
  } catch (_) { return; }
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      await api(`/api/tasks/${encodeURIComponent(id)}/action`, jsonOpts("POST", { action }));
      ok++;
    } catch (_) { fail++; }
  }
  showToast({ message: `${label}完成 ${ok} 个${fail ? "，失败 " + fail : ""}`, type: fail ? "fail" : "success" });
  batchMode.value = false;
  selected.value = new Set();
  await store.refreshBoard();
}
const batchCount = computed(() => selected.value.size);

const assigneeActions = computed(() => [
  { name: "全部指派", value: "" },
  ...store.assignees.map((a) => ({ name: a.name, value: a.name })),
]);

const listChips = computed(() => [
  { value: "", label: "全部", count: store.board ? store.board.statuses.reduce((a, c) => a + (c.count || 0), 0) : 0 },
  ...(store.board
    ? store.board.statuses
        .filter((s) => !store.hiddenChips.includes(s.status))
        .map((s) => ({ value: s.status, label: s.label, count: s.count || 0 }))
    : []),
]);

const filtered = computed(() => {
  let tasks = store.board ? store.board.statuses.flatMap((c) => c.tasks) : [];
  if (store.listStatus) tasks = tasks.filter((t) => t.status === store.listStatus);
  if (store.listAssignee) tasks = tasks.filter((t) => t.assignee === store.listAssignee);
  const q = store.search.trim().toLowerCase();
  if (q) tasks = tasks.filter((t) => (t.title + " " + (t.body || "")).toLowerCase().includes(q));
  if (!store.listArchived) tasks = tasks.filter((t) => t.status !== "archived");
  if (store.sortBy === "status") {
    tasks = [...tasks].sort(
      (a, b) =>
        (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) ||
        (b.priority || 0) - (a.priority || 0) ||
        (b.created_at || 0) - (a.created_at || 0)
    );
  } else if (store.sortBy === "priority") {
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
  store.sortBy = store.sortBy === "status" ? "priority" : store.sortBy === "priority" ? "created" : "status";
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
        <van-button
          icon="checked"
          size="small"
          style="flex: 0 0 auto"
          :type="batchMode ? 'primary' : 'default'"
          @click="toggleBatch"
        >{{ batchMode ? "退出批量" : "批量" }}</van-button>
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
          {{ store.sortBy === "status" ? "状态" : store.sortBy === "priority" ? "优先级" : "创建时间" }}
        </van-button>
        <label class="check-label">
          <van-switch v-model="store.listArchived" size="18px" />
          <span>含归档</span>
        </label>
      </div>

      <!-- 批量操作条 -->
      <div v-if="batchMode" class="batch-bar">
        <span class="batch-count">已选 {{ batchCount }} 个</span>
        <van-button size="small" type="primary" :disabled="!batchCount" @click="batchAction('complete', '完成')">完成</van-button>
        <van-button size="small" :disabled="!batchCount" @click="batchAction('archive', '归档')">归档</van-button>
        <van-button size="small" :disabled="!batchCount" @click="batchAction('block', '阻塞')">阻塞</van-button>
      </div>

      <div class="list-sort-note">{{ store.sortBy === "status" ? "按任务状态排序（默认）" : store.sortBy === "priority" ? "按优先级排序" : "按创建时间排序" }}</div>

      <div>
        <van-empty v-if="!filtered.length" description="没有匹配的任务" />
        <div
          v-for="t in filtered"
          :key="t.id"
          class="list-row"
          :class="['st-' + t.status, { 'batch-selected': batchMode && selected.has(t.id) }]"
          @click="batchMode ? toggleSelect(t.id) : store.openDetail(t.id)"
        >
          <van-checkbox
            v-if="batchMode"
            :model-value="selected.has(t.id)"
            class="batch-check"
            @click.stop="toggleSelect(t.id)"
          />
          <div class="list-row-main">
            <div class="list-row-title">{{ t.title }}</div>
            <div class="list-row-meta">
              <van-tag :color="STATUS_CSS[t.status]" text-color="#0d0f1a">{{ STATUS[t.status] }}</van-tag>
              <span v-if="t.priority > 0" class="card-priority">P{{ t.priority }}</span>
              <span class="card-id">{{ t.id }}</span>
              <span v-if="t.assignee" class="card-assignee">@{{ t.assignee }}</span>
              <span class="row-time" :title="fmtTime(t.created_at)">创建于 {{ ago(t.created_at) }}</span>
            </div>
          </div>
          <button v-if="!batchMode" class="menu-btn list-menu-btn" aria-label="操作菜单" @click="openMenu(t, $event)" @touchstart.stop.prevent>⋯</button>
        </div>
      </div>

      <van-action-sheet
        v-model:show="showAssignee"
        :actions="assigneeActions"
        title="选择指派"
        cancel-text="取消"
        close-on-click-action
        @select="(a) => (store.listAssignee = a.value)"
      />
    </van-pull-refresh>
  </section>
</template>
