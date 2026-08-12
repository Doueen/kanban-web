<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useAppStore, STATUS } from "../store";
import { api, jsonOpts } from "../api";
import { ok, fail, loading, COPY } from "../feedback";

const store = useAppStore();

const show = computed({
  get: () => store.showCreate,
  set: (v) => {
    store.showCreate = v;
  },
});

const createStatus = ref("");
const mode = ref(0);

const form = reactive({
  title: "",
  body: "",
  assignee: "",
  priority: 0,
  workspace: "",
  parent: "",
  triage: true,
});

const pickers = reactive({
  assignee: false,
  priority: false,
  workspace: false,
  parent: false,
});

const PRIORITY_ACTIONS = [
  { name: "P0 普通", value: 0 },
  { name: "P1", value: 1 },
  { name: "P2", value: 2 },
  { name: "P3 最高", value: 3 },
];
const WORKSPACE_ACTIONS = ["scratch", "worktree", "dir"].map((t) => ({ name: t, value: t }));
/* 工作区选择：优先提供「当前 board 工作目录」选项 */
const workspaceActions = computed(() => {
  const wd = store.currentBoard?.default_workdir;
  if (!wd) return WORKSPACE_ACTIONS;
  return [{ name: `当前工作目录（${wd}）`, value: "dir:" + wd }, ...WORKSPACE_ACTIONS];
});
const assigneeActions = computed(() => [
  { name: "未指派", value: "" },
  ...store.assignees.map((a) => ({ name: a.name, value: a.name })),
]);
/* 父任务选择：全部任务（非归档在前，归档在后） */
const parentActions = computed(() => {
  if (!store.board) return [{ name: "无父任务", value: "" }];
  const tasks = [
    ...store.board.statuses.filter((c) => c.status !== "archived").flatMap((c) => c.tasks),
    ...store.board.statuses.filter((c) => c.status === "archived").flatMap((c) => c.tasks),
  ];
  return [
    { name: "无父任务", value: "" },
    ...tasks.map((t) => ({
      name: `${t.title.slice(0, 24)}${t.title.length > 24 ? "…" : ""}（${t.id}）`,
      value: t.id,
    })),
  ];
});
const parentLabel = computed(() => {
  if (!form.parent) return "";
  const hit = parentActions.value.find((c) => c.value === form.parent);
  return hit ? hit.name : form.parent;
});

function onAssigneeSelect(a) {
  if (mode.value === 0) form.assignee = a.value;
  else swarm.createdBy = a.value;
}
function onPrioritySelect(a) {
  const i = a.value;
  if (mode.value === 0) form.priority = i;
  else swarm.priority = i;
}
function onWorkspaceSelect(a) {
  form.workspace = a.value;
}
function onParentSelect(a) {
  form.parent = a.value;
}

watch(
  () => store.createPrefill,
  (p) => {
    createStatus.value = p.status ? STATUS[p.status] || p.status : "";
    if (p.title) form.title = p.title;
    if (p.body) form.body = p.body;
    if (p.parent) form.parent = p.parent;
    if (p.swarmWorkers) {
      swarm.workers = p.swarmWorkers.map((w) => ({ profile: w.profile || "", title: w.title || "", skills: w.skills || "" }));
    }
  },
  { immediate: true }
);

watch(show, (v) => {
  if (v) {
    form.title = store.createPrefill.title || "";
    form.body = store.createPrefill.body || "";
    form.parent = store.createPrefill.parent || "";
    /* 工作区默认：当前 board 配置了工作目录 → 直接用；否则跟随 kanban 默认 */
    form.workspace = store.currentBoard?.default_workdir ? "dir:" + store.currentBoard.default_workdir : "";
    /* 默认放入待梳理；"新建到此列"（指定了 status）时跟随指定列 */
    form.triage = store.createPrefill.status ? store.createPrefill.status === "triage" : true;
    swarm.goal = store.createPrefill.body || "";
    mode.value = 0;
  } else {
    store.createPrefill = {};
  }
});

/* ---------- Swarm ---------- */
const swarm = reactive({
  goal: "",
  verifier: "",
  synthesizer: "",
  priority: 0,
  createdBy: "",
  workers: [{ profile: "", title: "", skills: "" }],
});

function addWorker() {
  swarm.workers.push({ profile: "", title: "", skills: "" });
}
function delWorker(i) {
  swarm.workers.splice(i, 1);
  if (!swarm.workers.length) swarm.workers.push({ profile: "", title: "", skills: "" });
}

const submitting = ref(false);

async function submit() {
  if (mode.value === 0) {
    await submitNormal();
  } else {
    await submitSwarm();
  }
}

async function submitNormal() {
  const title = form.title.trim();
  if (!title) {
    fail(COPY.validate.title);
    return;
  }
  submitting.value = true;
  try {
    const payload = {
      title,
      body: form.body,
      assignee: form.assignee || undefined,
      priority: form.priority,
      workspace: form.workspace || undefined,
      triage: form.triage,
    };
    if (form.parent.trim()) payload.parent = [form.parent.trim()];
    const res = await api("/api/tasks", jsonOpts("POST", payload));
    ok(COPY.ok.created(res.id || ""));
    store.showCreate = false;
    await store.refreshBoard();
    if (res.id) store.openDetail(res.id);
  } catch (err) {
    fail(COPY.fail("创建", err.message));
  } finally {
    submitting.value = false;
  }
}

async function submitSwarm() {
  const goal = swarm.goal.trim();
  if (!goal) {
    fail(COPY.validate.goal);
    return;
  }
  const workers = swarm.workers
    .map((w) => ({
      profile: w.profile.trim(),
      title: w.title.trim(),
      skills: w.skills.trim(),
    }))
    .filter((w) => w.profile);
  if (!workers.length) {
    fail(COPY.validate.workers);
    return;
  }
  if (!swarm.verifier.trim() || !swarm.synthesizer.trim()) {
    fail(COPY.validate.swarmRoles);
    return;
  }
  const payload = {
    goal,
    workers: workers.map((w) => ({
      profile: w.profile,
      title: w.title || undefined,
      skills: w.skills ? w.skills.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    })),
    verifier: swarm.verifier.trim(),
    synthesizer: swarm.synthesizer.trim(),
    priority: swarm.priority,
  };
  if (swarm.createdBy) payload.created_by = swarm.createdBy;
  submitting.value = true;
  loading("Swarm 创建中…可能需要 1-3 分钟");
  try {
    const res = await api("/api/swarm", jsonOpts("POST", payload));
    ok(res.message || "Swarm 已创建");
    store.showCreate = false;
    await store.refreshBoard();
  } catch (err) {
    fail(COPY.fail("创建", err.message));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <van-popup
    v-model:show="show"
    position="bottom"
    round
    closeable
    close-icon="cross"
    close-on-click-overlay
    style="height: 88vh"
  >
    <div class="popup-title">新建任务</div>
    <div v-if="createStatus" class="create-status-note">目标列：{{ createStatus }}</div>

    <van-tabs v-model:active="mode" sticky offset-top="0">
      <van-tab title="普通任务" />
      <van-tab title="Swarm" />
    </van-tabs>

    <!-- 普通任务 -->
    <div v-if="mode === 0" class="popup-body create-form">
      <van-field v-model="form.title" label="标题" placeholder="任务标题" required clearable />
      <van-field v-model="form.body" type="textarea" rows="3" autosize label="描述" placeholder="任务描述（支持换行 / 代码块 / 粗体）" />
      <van-field
        v-model="form.assignee"
        label="指派"
        placeholder="未指派"
        is-link
        readonly
        @click="pickers.assignee = true"
      />
      <van-field
        :model-value="PRIORITY_ACTIONS[form.priority]?.name"
        label="优先级"
        placeholder="P0 普通"
        is-link
        readonly
        @click="pickers.priority = true"
      />
      <van-field
        :model-value="form.workspace"
        label="工作区"
        placeholder="默认（跟随 kanban）"
        is-link
        readonly
        @click="pickers.workspace = true"
      />
      <van-field
        :model-value="parentLabel"
        label="父任务"
        placeholder="选择父任务（可选）"
        is-link
        readonly
        @click="pickers.parent = true"
      />
      <van-cell title="放入待梳理（triage）" center>
        <template #right-icon>
          <van-switch v-model="form.triage" size="20px" />
        </template>
      </van-cell>
    </div>

    <!-- Swarm -->
    <div v-else class="popup-body create-form">
      <van-field v-model="swarm.goal" type="textarea" rows="3" autosize label="目标（goal）*" placeholder="Swarm 最终要达成的结果" />
      <div style="margin: 6px 0">
        <div style="font-size: 13px; color: var(--muted); margin-bottom: 6px">Workers</div>
        <div v-for="(w, i) in swarm.workers" :key="i" class="worker-row">
          <input v-model="w.profile" placeholder="profile *" aria-label="profile">
          <input v-model="w.title" placeholder="title(可选)" aria-label="title">
          <input v-model="w.skills" class="ww-skills" placeholder="skills,逗号分隔(可选)" aria-label="skills">
          <button class="btn btn-sm worker-del" type="button" aria-label="移除" @click="delWorker(i)">✕</button>
        </div>
        <van-button size="small" icon="plus" style="margin-top: 4px" @click="addWorker">添加 Worker</van-button>
      </div>
      <van-field v-model="swarm.verifier" label="Verifier" placeholder="评审 profile" clearable />
      <van-field v-model="swarm.synthesizer" label="Synthesizer" placeholder="汇总 profile" clearable />
      <van-field
        :model-value="PRIORITY_ACTIONS[swarm.priority]?.name"
        label="优先级"
        placeholder="P0 普通"
        is-link
        readonly
        @click="pickers.priority = true"
      />
      <van-field
        v-model="swarm.createdBy"
        label="创建者"
        placeholder="默认"
        is-link
        readonly
        @click="pickers.assignee = true"
      />
    </div>

    <div class="popup-actions" style="display: flex; gap: 10px">
      <van-button style="flex: 1" @click="store.showCreate = false">取消</van-button>
      <van-button block type="primary" style="flex: 2" :loading="submitting" @click="submit">
        {{ mode === 0 ? "创建" : "创建 Swarm" }}
      </van-button>
    </div>

    <van-action-sheet
      v-model:show="pickers.assignee"
      :actions="assigneeActions"
      title="选择指派"
      cancel-text="取消"
      close-on-click-action
      @select="onAssigneeSelect"
    />
    <van-action-sheet
      v-model:show="pickers.priority"
      :actions="PRIORITY_ACTIONS"
      title="选择优先级"
      cancel-text="取消"
      close-on-click-action
      @select="onPrioritySelect"
    />
    <van-action-sheet
      v-model:show="pickers.workspace"
      :actions="workspaceActions"
      title="选择工作区"
      cancel-text="取消"
      close-on-click-action
      @select="onWorkspaceSelect"
    />
    <van-action-sheet
      v-model:show="pickers.parent"
      :actions="parentActions"
      title="选择父任务"
      cancel-text="取消"
      close-on-click-action
      @select="onParentSelect"
    />
  </van-popup>
</template>
