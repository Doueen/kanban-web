<script setup>
import { computed, reactive, ref, watch } from "vue";
import { showToast } from "vant";
import { useAppStore, STATUS } from "../store";
import { api, jsonOpts } from "../api";

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
  workspace: "scratch",
  parent: "",
  triage: false,
});

const pickers = reactive({
  assignee: false,
  priority: false,
  workspace: false,
});

const PRIORITY_COLS = ["P0 普通", "P1", "P2", "P3 最高"].map((t, i) => ({ text: t, value: i }));
const WORKSPACE_COLS = ["scratch", "worktree", "dir"].map((t) => ({ text: t, value: t }));
const assigneeCols = computed(() => [
  { text: "未指派", value: "" },
  ...store.assignees.map((a) => ({ text: a.name, value: a.name })),
]);

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
    showToast({ message: "标题不能为空", type: "fail" });
    return;
  }
  submitting.value = true;
  try {
    const payload = {
      title,
      body: form.body,
      assignee: form.assignee || undefined,
      priority: form.priority,
      workspace: form.workspace,
      triage: form.triage,
    };
    if (form.parent.trim()) payload.parent = [form.parent.trim()];
    const res = await api("/api/tasks", jsonOpts("POST", payload));
    showToast({ message: "已创建 " + (res.id || ""), type: "success" });
    store.showCreate = false;
    await store.refreshBoard();
    if (res.id) store.openDetail(res.id);
  } catch (err) {
    showToast({ message: "创建失败: " + err.message, type: "fail" });
  } finally {
    submitting.value = false;
  }
}

async function submitSwarm() {
  const goal = swarm.goal.trim();
  if (!goal) {
    showToast({ message: "目标不能为空", type: "fail" });
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
    showToast({ message: "至少需要一个 worker profile", type: "fail" });
    return;
  }
  if (!swarm.verifier.trim() || !swarm.synthesizer.trim()) {
    showToast({ message: "verifier 和 synthesizer 必填", type: "fail" });
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
  showToast({ message: "Swarm 创建中…可能需要 1-3 分钟", type: "loading", duration: 12000, forbidClick: false });
  try {
    const res = await api("/api/swarm", jsonOpts("POST", payload));
    showToast({ message: res.message || "Swarm 已创建", type: "success" });
    store.showCreate = false;
    await store.refreshBoard();
  } catch (err) {
    showToast({ message: "创建失败: " + err.message, type: "fail" });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round style="height: 88vh">
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
        :model-value="PRIORITY_COLS[form.priority]?.text"
        label="优先级"
        placeholder="P0 普通"
        is-link
        readonly
        @click="pickers.priority = true"
      />
      <van-field
        v-model="form.workspace"
        label="工作区"
        placeholder="scratch"
        is-link
        readonly
        @click="pickers.workspace = true"
      />
      <van-field v-model="form.parent" label="父任务 ID" placeholder="t_xxxx（可选）" clearable />
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
        :model-value="PRIORITY_COLS[swarm.priority]?.text"
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

    <div class="popup-actions">
      <van-button block type="primary" :loading="submitting" @click="submit">
        {{ mode === 0 ? "创建" : "创建 Swarm" }}
      </van-button>
    </div>

    <van-picker
      v-model:show="pickers.assignee"
      :columns="assigneeCols"
      title="选择"
      @confirm="(v) => { if (mode === 0) form.assignee = v.selectedOptions[0]?.text === '未指派' ? '' : v.selectedOptions[0]?.text; else swarm.createdBy = v.selectedOptions[0]?.text === '未指派' ? '' : v.selectedOptions[0]?.text; }"
    />
    <van-picker
      v-model:show="pickers.priority"
      :columns="PRIORITY_COLS"
      title="选择优先级"
      @confirm="(v) => { const t = v.selectedOptions[0]?.text; const i = PRIORITY_COLS.findIndex((c) => c.text === t); if (mode === 0) form.priority = i < 0 ? 0 : i; else swarm.priority = i < 0 ? 0 : i; }"
    />
    <van-picker
      v-model:show="pickers.workspace"
      :columns="WORKSPACE_COLS"
      title="选择工作区"
      @confirm="(v) => (form.workspace = v.selectedOptions[0]?.text || 'scratch')"
    />
  </van-popup>
</template>
