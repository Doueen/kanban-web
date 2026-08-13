<script setup>
import { computed, ref } from "vue";
import { useAppStore, STATUS, STATUS_CSS } from "../store";
import { api, jsonOpts } from "../api";
import { ago, fmtTime } from "../utils";
import { ok, fail, confirm, loading, COPY } from "../feedback";
import PagerBar from "../components/PagerBar.vue";

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
/* M2-5 U1: 批量并行 —— 每批 5 个并发 allSettled；idsOverride 为重试路径，跳过二次确认 */
async function batchAction(action, label, idsOverride) {
  const ids = idsOverride || Array.from(selected.value);
  if (!ids.length) {
    if (!idsOverride) fail(COPY.validate.batchEmpty);
    return;
  }
  if (!idsOverride) {
    const c = COPY.confirm.batch(label, ids.length);
    const confirmed = await confirm({
      title: c.title,
      message: c.message,
      confirmText: c.confirmText,
      danger: true,
    });
    if (!confirmed) return;
  }
  const total = ids.length;
  let okCount = 0;
  const failedIds = [];
  loading(`已处理 0/${total}…`);
  for (let i = 0; i < total; i += 5) {
    const batch = ids.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((id) =>
        api(`/api/tasks/${encodeURIComponent(id)}/action`, jsonOpts("POST", { action }))
      )
    );
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") okCount++;
      else failedIds.push(batch[idx]);
    });
    loading(`已处理 ${okCount}/${total}…`);
  }
  const failCount = failedIds.length;
  if (failCount) {
    fail(COPY.ok.batch(label, okCount, failCount), {
      retry: () => batchAction(action, label, failedIds),
      retryLabel: "重试失败项",
    });
  } else {
    ok(COPY.ok.batch(label, okCount, failCount));
  }
  batchMode.value = false;
  selected.value = new Set();
  await store.refreshBoard();
  await store.refreshTasks();
}
const batchCount = computed(() => selected.value.size);

const assigneeActions = computed(() => [
  { name: "全部指派", value: "" },
  ...store.assignees.map((a) => ({ name: a.name, value: a.name })),
]);

const listChips = computed(() => [
  {
    value: "",
    label: "全部",
    count: store.board ? store.board.statuses.reduce((a, c) => a + (c.count || 0), 0) : 0,
  },
  ...(store.board
    ? store.board.statuses
        .filter((s) => !store.hiddenChips.includes(s.status))
        .map((s) => ({ value: s.status, label: s.label, count: s.count || 0 }))
    : []),
]);

/* 行数据 = 服务端分页结果（store.fetchTasks 已按 status/assignee/q/archived/sort 过滤排序）。
   客户端不再过滤 board —— 过滤/排序变化经 initTasksWatch 防抖重置第 1 页并重拉。 */
const tasks = computed(() => store.tasks);
const tasksLoading = computed(() => store.tasksLoading);
const tasksError = computed(() => store.tasksError);

/* 空态：真无数据（total=0）或过滤后无匹配 —— 分页器仍可见以便翻回 */
const isEmpty = computed(
  () => !store.tasksLoading && !store.tasksError && store.tasks.length === 0
);

/* M2-5 U5a: 任一筛选激活（状态/指派/搜索/含归档）→ 空态显示「清除筛选」一键复位 */
const hasFilters = computed(
  () =>
    !!(store.listStatus || store.listAssignee || (store.search || "").trim() || store.listArchived)
);
function clearFilters() {
  store.listStatus = "";
  store.listAssignee = "";
  store.search = "";
  store.listArchived = false;
  store.refreshTasks();
}

async function onRefresh() {
  /* t_3ad4fe46: 手动刷新绕过 ETag（同秒 304 粘滞防线） */
  await store.refreshBoard(true);
  await store.refreshTasks();
  refreshing.value = false;
}

function toggleSort() {
  store.sortBy =
    store.sortBy === "status" ? "priority" : store.sortBy === "priority" ? "created" : "status";
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
        <button class="tb-chip" :class="{ active: batchMode }" @click="toggleBatch">
          ☑ {{ batchMode ? "退出批量" : "批量" }}
        </button>
        <button class="tb-chip tb-assignee" @click="showAssignee = true">
          👤 {{ store.listAssignee || "全部指派" }} ▾
        </button>
        <van-search v-model="store.search" placeholder="搜索…" shape="round" />
        <button class="tb-chip" @click="toggleSort">
          ⇅
          {{
            store.sortBy === "status" ? "状态" : store.sortBy === "priority" ? "优先级" : "创建时间"
          }}
        </button>
        <label class="check-label">
          <van-switch v-model="store.listArchived" size="18px" />
          <span>含归档</span>
        </label>
      </div>

      <!-- 批量操作条 -->
      <div v-if="batchMode" class="batch-bar">
        <span class="batch-count">已选 {{ batchCount }} 个</span>
        <van-button
          size="small"
          type="primary"
          :disabled="!batchCount"
          @click="batchAction('complete', '完成')"
          >完成</van-button
        >
        <van-button size="small" :disabled="!batchCount" @click="batchAction('archive', '归档')"
          >归档</van-button
        >
        <van-button size="small" :disabled="!batchCount" @click="batchAction('block', '阻塞')"
          >阻塞</van-button
        >
      </div>

      <div class="list-sort-note">
        {{
          store.sortBy === "status"
            ? "按任务状态排序（默认）"
            : store.sortBy === "priority"
              ? "按优先级排序"
              : "按创建时间排序"
        }}
      </div>

      <div class="list-body">
        <!-- 换页加载中：保留旧行 + 顶部细加载条 -->
        <div v-if="tasksLoading" class="list-loading-bar" role="status" aria-label="加载中"></div>

        <!-- 错误态：重试走数据层 refreshTasks -->
        <div v-if="tasksError" class="list-error" role="alert">
          <span>加载失败：{{ tasksError }}</span>
          <button class="tb-chip" @click="store.refreshTasks()">重试</button>
        </div>

        <van-empty v-else-if="isEmpty" description="没有匹配的任务" />
        <button
          v-if="isEmpty && hasFilters"
          class="tb-chip list-clear-filters"
          @click="clearFilters"
        >
          清除筛选
        </button>

        <div
          v-for="t in tasks"
          :key="t.id"
          class="list-row"
          :class="[
            'st-' + t.status,
            { 'batch-selected': batchMode && selected.has(t.id), 'row-fetching': tasksLoading },
          ]"
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
              <van-tag :color="STATUS_CSS[t.status]" text-color="#0d0f1a">{{
                STATUS[t.status]
              }}</van-tag>
              <span v-if="t.priority > 0" class="card-priority">P{{ t.priority }}</span>
              <span class="card-id">{{ t.id }}</span>
              <span v-if="t.assignee" class="card-assignee">@{{ t.assignee }}</span>
              <span class="row-time" :title="fmtTime(t.created_at)"
                >创建于 {{ ago(t.created_at) }}</span
              >
            </div>
          </div>
          <!-- M2-2 S2: 归档视图「恢复」按钮（unarchive verb，可直接在列表恢复） -->
          <button
            v-if="t.status === 'archived' && !batchMode"
            class="tb-chip row-restore"
            :disabled="!!store.pendingOps[t.id]"
            @click.stop="store.runAction(t.id, 'unarchive')"
          >
            恢复
          </button>
          <button
            v-if="!batchMode"
            class="menu-btn list-menu-btn"
            aria-label="操作菜单"
            @click="openMenu(t, $event)"
            @touchstart.stop.prevent
          >
            ⋯
          </button>
        </div>
      </div>

      <!-- 分页器：仅 total > pageSize 时显示；页码/上下页均走 store.setPage（URL 同步 + 无整页刷新） -->
      <PagerBar />

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
