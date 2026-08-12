<script setup>
import { computed, ref, watch } from "vue";
import { showToast } from "vant";
import { useAppStore, actionLabel } from "../store";
import { api, jsonOpts } from "../api";

const store = useAppStore();

/* ---------- 备注弹窗（block/schedule/promote/request-changes/reopen-review） ---------- */
const noteText = ref("");
const noteBusy = ref(false);

watch(
  () => store.noteTask,
  (t) => {
    noteText.value = "";
    if (t) noteBusy.value = false;
  }
);

const noteVisible = computed(() => !!store.noteTask);
const noteTitle = computed(() => (store.noteTask ? actionLabel(store.noteAction) : ""));

async function confirmNote(action) {
  if (action !== "confirm") {
    closeNote();
    return true;
  }
  const t = store.noteTask;
  if (!t) return true;
  noteBusy.value = true;
  try {
    await store.runAction(t.id, store.noteAction, noteText.value.trim());
    closeNote();
    return true;
  } catch (_) {
    return false;
  } finally {
    noteBusy.value = false;
  }
}
function closeNote() {
  store.noteTask = null;
  store.noteAction = "";
}

/* ---------- 改指派 ---------- */
const assignVisible = computed(() => !!store.assignTask);
const assignValue = ref("");
const assignBusy = ref(false);

watch(
  () => store.assignTask,
  (t) => {
    assignValue.value = t ? t.assignee || "" : "";
  }
);

const assignColumns = computed(() => [
  { text: "未指派", value: "" },
  ...store.assignees.map((a) => ({ text: a.name, value: a.name })),
]);

function onAssignPickerConfirm() {
  closeAssign();
}

async function confirmAssign() {
  const t = store.assignTask;
  if (!t) return;
  assignBusy.value = true;
  try {
    await api(`/api/tasks/${encodeURIComponent(t.id)}/assign`, jsonOpts("POST", { assignee: assignValue.value }));
    showToast({ message: "已更新指派", type: "success" });
    await store.refreshBoard();
    if (store.detailId) await store.openDetail(store.detailId);
    closeAssign();
  } catch (err) {
    showToast({ message: "失败: " + err.message, type: "fail" });
  } finally {
    assignBusy.value = false;
  }
}
function closeAssign() {
  store.assignTask = null;
}

/* ---------- 模型覆盖 ---------- */
const modelVisible = computed(() => !!store.modelTask);
const modelName = ref("");
const modelProvider = ref("");
const modelBusy = ref(false);

watch(
  () => store.modelTask,
  (t) => {
    modelName.value = t ? t.model_override || "" : "";
    modelProvider.value = t ? t.provider_override || "" : "";
  }
);

async function confirmModel(action) {
  if (action !== "confirm") {
    closeModel();
    return true;
  }
  const t = store.modelTask;
  if (!t) return true;
  modelBusy.value = true;
  try {
    await api(`/api/tasks/${encodeURIComponent(t.id)}/set-model`, jsonOpts("POST", {
      model: modelName.value.trim() || null,
      provider: modelProvider.value.trim() || null,
    }));
    showToast({ message: "已更新模型覆盖", type: "success" });
    await store.refreshBoard();
    if (store.detailId) await store.openDetail(store.detailId);
    closeModel();
    return true;
  } catch (err) {
    showToast({ message: "失败: " + err.message, type: "fail" });
    return false;
  } finally {
    modelBusy.value = false;
  }
}
function closeModel() {
  store.modelTask = null;
}

/* ---------- 编辑结果 ---------- */
const editVisible = computed(() => !!store.editTask);
const editResult = ref("");
const editSummary = ref("");
const editMetadata = ref("");
const editBusy = ref(false);

watch(
  () => store.editTask,
  (t) => {
    editResult.value = t ? t.result || "" : "";
    editSummary.value = "";
    editMetadata.value = "";
  }
);

async function confirmEdit(action) {
  if (action !== "confirm") {
    closeEdit();
    return true;
  }
  const t = store.editTask;
  if (!t) return true;
  const result = editResult.value.trim();
  if (!result) {
    showToast({ message: "结果不能为空", type: "fail" });
    return false;
  }
  let metadata = editMetadata.value.trim();
  if (metadata) {
    try {
      metadata = JSON.parse(metadata);
    } catch (_) {
      showToast({ message: "元数据不是合法 JSON", type: "fail" });
      return false;
    }
  } else {
    metadata = undefined;
  }
  const payload = { result, summary: editSummary.value.trim() || undefined };
  if (metadata !== undefined) payload.metadata = metadata;
  editBusy.value = true;
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(t.id)}/edit`, jsonOpts("POST", payload));
    showToast({ message: res.message || "已保存结果", type: "success" });
    await store.refreshBoard();
    if (store.detailId) await store.openDetail(store.detailId);
    closeEdit();
    return true;
  } catch (err) {
    showToast({ message: "保存失败: " + err.message, type: "fail" });
    return false;
  } finally {
    editBusy.value = false;
  }
}
function closeEdit() {
  store.editTask = null;
}
</script>

<template>
  <!-- 备注弹窗 -->
  <van-dialog
    :show="noteVisible"
    :title="noteTitle"
    show-cancel-button
    :before-close="confirmNote"
    close-on-click-overlay
    @update:show="(v) => { if (!v) closeNote(); }"
  >
    <div style="padding: 8px 16px 16px">
      <van-field v-model="noteText" type="textarea" rows="3" placeholder="可选备注…" :loading="noteBusy" />
    </div>
  </van-dialog>

  <!-- 改指派 -->
  <van-popup
    :show="assignVisible"
    position="bottom"
    round
    @click-overlay="closeAssign"
    @update:show="(v) => { if (!v) closeAssign(); }"
  >
    <div class="popup-title">改指派</div>
    <van-picker
      :columns="assignColumns"
      :model-value="assignValue ? [assignValue] : ['']"
      @update:model-value="(v) => (assignValue = (Array.isArray(v) ? v[0] : v) || '')"
      @confirm="onAssignPickerConfirm"
      @cancel="closeAssign"
      @click-overlay="closeAssign"
    />
    <div class="popup-actions">
      <van-button block type="primary" :loading="assignBusy" @click="confirmAssign">确认</van-button>
    </div>
  </van-popup>

  <!-- 模型覆盖 -->
  <van-dialog
    :show="modelVisible"
    title="模型覆盖"
    show-cancel-button
    :before-close="confirmModel"
    close-on-click-overlay
    @update:show="(v) => { if (!v) closeModel(); }"
  >
    <div style="padding: 8px 16px 16px">
      <van-field v-model="modelName" label="模型" placeholder="模型名，清空则清除覆盖" />
      <van-field v-model="modelProvider" label="Provider" placeholder="可选" style="margin-top: 8px" />
    </div>
  </van-dialog>

  <!-- 编辑结果 -->
  <van-dialog
    :show="editVisible"
    title="编辑结果"
    show-cancel-button
    :before-close="confirmEdit"
    close-on-click-overlay
    @update:show="(v) => { if (!v) closeEdit(); }"
  >
    <div style="padding: 8px 16px 16px">
      <van-field v-model="editResult" type="textarea" rows="3" label="结果 *" placeholder="Backfilled task result text" />
      <van-field v-model="editSummary" type="textarea" rows="2" label="摘要（可选）" placeholder="Structured handoff summary" style="margin-top: 8px" />
      <van-field v-model="editMetadata" type="textarea" rows="2" label="元数据（可选，JSON）" placeholder='{"changed_files": [...]}' style="margin-top: 8px" />
    </div>
  </van-dialog>
</template>
