<script setup>
import { computed, reactive, ref } from "vue";
import { showToast, showConfirmDialog } from "vant";
import { useAppStore, MOB_SWITCHES, THEMES } from "../store";
import { api, jsonOpts } from "../api";
import SettingSwitch from "../components/SettingSwitch.vue";

const store = useAppStore();

/* ---------- Board 管理 ---------- */
const boards = computed(() => (store.boards || []).filter((b) => !b.archived));
const cur = computed(() => store.currentBoard);
const boardOpts = computed(() => boards.value.map((b) => ({ text: b.slug + (b.is_current ? " ●" : ""), value: b.slug })));

const switchSel = ref("");
const renameSel = ref("");
const renameName = ref("");
const workdirSel = ref("");
const workdirPath = ref("");
const rmSel = ref("");

const showSwitchPicker = ref(false);
const showRenamePicker = ref(false);
const showWorkdirPicker = ref(false);
const showRmPicker = ref(false);

const newBoard = reactive({ slug: "", name: "", description: "", icon: "", color: "#5ff0e0" });

async function boardOp(label, fn) {
  try {
    const res = await fn();
    showToast({ message: (res && res.message) || label + "成功", type: "success" });
    await store.loadBoards();
    await store.refreshBoard();
  } catch (err) {
    showToast({ message: label + "失败: " + err.message, type: "fail" });
  }
}

async function doSwitch() {
  if (!switchSel.value) { showToast({ message: "请先选择 board", type: "fail" }); return; }
  await boardOp("切换", () => api(`/api/boards/${encodeURIComponent(switchSel.value)}/switch`, jsonOpts("POST", {})));
}
async function doCreate() {
  const slug = newBoard.slug.trim();
  if (!slug) { showToast({ message: "slug 不能为空", type: "fail" }); return; }
  await boardOp("创建", () =>
    api("/api/boards", jsonOpts("POST", {
      slug,
      name: newBoard.name.trim() || undefined,
      description: newBoard.description.trim() || undefined,
      icon: newBoard.icon.trim() || undefined,
      color: newBoard.color || undefined,
    }))
  );
  newBoard.slug = "";
  newBoard.name = "";
  newBoard.description = "";
  newBoard.icon = "";
}
async function doRename() {
  if (!renameSel.value) { showToast({ message: "请先选择 board", type: "fail" }); return; }
  const name = renameName.value.trim();
  if (!name) { showToast({ message: "名称不能为空", type: "fail" }); return; }
  await boardOp("重命名", () => api(`/api/boards/${encodeURIComponent(renameSel.value)}/rename`, jsonOpts("POST", { name })));
  renameName.value = "";
}
async function doWorkdir(path) {
  if (!workdirSel.value) { showToast({ message: "请先选择 board", type: "fail" }); return; }
  await boardOp("设置工作目录", () =>
    api(`/api/boards/${encodeURIComponent(workdirSel.value)}/workdir`, jsonOpts("POST", { path: path || null }))
  );
  if (!path) workdirPath.value = "";
}
async function doArchive() {
  if (!rmSel.value) { showToast({ message: "请先选择 board", type: "fail" }); return; }
  try {
    await showConfirmDialog({ title: "确认操作", message: `确认归档 board「${rmSel.value}」？（可恢复）` });
  } catch (_) {
    return;
  }
  await boardOp("归档", () => api(`/api/boards/${encodeURIComponent(rmSel.value)}`, { method: "DELETE" }));
}
async function doDelete() {
  if (!rmSel.value) { showToast({ message: "请先选择 board", type: "fail" }); return; }
  try {
    await showConfirmDialog({
      title: "确认操作",
      message: `确认永久删除 board「${rmSel.value}」？此操作不可恢复！`,
    });
  } catch (_) {
    return;
  }
  await boardOp("删除", () => api(`/api/boards/${encodeURIComponent(rmSel.value)}`, jsonOpts("DELETE", { delete: true })));
}

/* ---------- 通知订阅管理 ---------- */
const notifyTask = ref("");
const notifySubs = ref(null);
const notifyLoading = ref(false);

async function loadNotifySubs() {
  const tid = notifyTask.value.trim();
  if (!tid) { showToast({ message: "请输入任务 ID", type: "fail" }); return; }
  notifyLoading.value = true;
  notifySubs.value = null;
  try {
    notifySubs.value = await api(`/api/tasks/${encodeURIComponent(tid)}/notify`);
  } catch (err) {
    showToast({ message: "加载失败: " + err.message, type: "fail" });
    notifySubs.value = [];
  } finally {
    notifyLoading.value = false;
  }
}

async function delNotifySub(s) {
  const tid = notifyTask.value.trim();
  try {
    await api(`/api/tasks/${encodeURIComponent(tid)}/notify`, jsonOpts("DELETE", {
      platform: s.platform,
      chat_id: s.chat_id || s.chatId,
      thread_id: s.thread_id,
    }));
    showToast({ message: "已取消订阅", type: "success" });
    loadNotifySubs();
  } catch (err) {
    showToast({ message: "取消失败: " + err.message, type: "fail" });
  }
}

/* ---------- 维护 ---------- */
const gcShow = ref(false);
const gcEvents = ref(30);
const gcLogs = ref(30);
const maintainOut = ref("");

async function runGc(action) {
  if (action !== "confirm") {
    gcShow.value = false;
    return true;
  }
  const ev = parseInt(gcEvents.value, 10);
  const lg = parseInt(gcLogs.value, 10);
  gcShow.value = false;
  showToast({ message: "GC 执行中…", type: "loading", duration: 0, forbidClick: false });
  try {
    const res = await api("/api/gc", jsonOpts("POST", {
      event_retention_days: isNaN(ev) ? undefined : ev,
      log_retention_days: isNaN(lg) ? undefined : lg,
    }));
    maintainOut.value = res.message || "GC 完成";
    showToast({ message: res.message || "GC 完成", type: "success" });
    return true;
  } catch (err) {
    showToast({ message: "GC 失败: " + err.message, type: "fail" });
    return true;
  }
}

async function runRepair() {
  showToast({ message: "DB 检查中…", type: "loading", duration: 0, forbidClick: false });
  try {
    const res = await api("/api/repair", { method: "POST" });
    maintainOut.value = JSON.stringify(res, null, 2);
    showToast({ message: "检查完成", type: "success" });
  } catch (err) {
    showToast({ message: "检查失败: " + err.message, type: "fail" });
  }
}

function onMobChange(key, val) {
  store.setMob(key, val);
  showToast({ message: "已更新", duration: 1200 });
}

function logout() {
  showToast({ message: "已退出登录", type: "info", duration: 800 });
  setTimeout(() => store.logout(), 400);
}
</script>

<template>
  <section class="view" aria-label="设置">
    <!-- Board 管理 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>Board 管理</h3></div>

      <div class="settings-block">
        <h4>当前 Board</h4>
        <div class="kv">
          <dt>Slug</dt>
          <dd><code class="mono">{{ cur ? cur.slug : "…" }}</code></dd>
          <dt>名称</dt>
          <dd>{{ cur ? cur.name : "…" }}</dd>
        </div>
      </div>

      <div class="settings-block">
        <h4>切换 Board</h4>
        <div class="settings-actions">
          <van-field
            :model-value="switchSel"
            placeholder="选择 board"
            is-link
            readonly
            style="flex: 1; min-width: 160px"
            @click="showSwitchPicker = true"
          />
          <van-button type="primary" @click="doSwitch">切换</van-button>
        </div>
      </div>

      <div class="settings-block">
        <h4>创建 Board</h4>
        <div class="settings-form">
          <van-field v-model="newBoard.slug" label="Slug" placeholder="my-project（kebab-case）*" clearable />
          <van-field v-model="newBoard.name" label="名称" placeholder="可选" clearable />
          <van-field v-model="newBoard.description" label="描述" placeholder="可选" clearable />
          <van-field v-model="newBoard.icon" label="Icon" placeholder="可选，emoji" clearable />
          <van-field v-model="newBoard.color" label="颜色" type="color" />
        </div>
        <div class="settings-actions">
          <van-button type="primary" @click="doCreate">创建</van-button>
        </div>
      </div>

      <div class="settings-block">
        <h4>重命名</h4>
        <div class="settings-actions">
          <van-field
            :model-value="renameSel"
            placeholder="选择 board"
            is-link
            readonly
            style="flex: 1; min-width: 140px"
            @click="showRenamePicker = true"
          />
          <van-field v-model="renameName" placeholder="新名称 *" style="flex: 1; min-width: 120px" />
          <van-button @click="doRename">重命名</van-button>
        </div>
      </div>

      <div class="settings-block">
        <h4>默认工作目录</h4>
        <div class="settings-actions">
          <van-field
            :model-value="workdirSel"
            placeholder="选择 board"
            is-link
            readonly
            style="flex: 1; min-width: 140px"
            @click="showWorkdirPicker = true"
          />
          <van-field v-model="workdirPath" placeholder="绝对路径（留空清除）" style="flex: 1; min-width: 160px" />
          <van-button @click="doWorkdir(workdirPath)">设置</van-button>
          <van-button @click="doWorkdir(null)">清除</van-button>
        </div>
      </div>

      <div class="settings-block">
        <h4>归档 / 删除</h4>
        <div class="settings-actions">
          <van-field
            :model-value="rmSel"
            placeholder="选择 board"
            is-link
            readonly
            style="flex: 1; min-width: 140px"
            @click="showRmPicker = true"
          />
          <van-button type="warning" @click="doArchive">归档</van-button>
          <van-button type="danger" @click="doDelete">删除（不可恢复）</van-button>
        </div>
      </div>
    </div>

    <!-- 通知订阅管理 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>通知订阅管理</h3></div>
      <div class="settings-block">
        <div class="settings-actions">
          <van-field v-model="notifyTask" placeholder="任务 ID (t_xxxx)" style="flex: 1; max-width: 280px" />
          <van-button type="primary" :loading="notifyLoading" @click="loadNotifySubs">查看</van-button>
        </div>
        <div v-if="notifySubs" style="margin-top: 8px">
          <div v-if="notifySubs.length">
            <div v-for="(s, i) in notifySubs" :key="i" class="notify-row">
              <span class="notify-platform">{{ s.platform || "?" }}</span>
              <span>{{ s.chat_id || s.chatId || "" }}{{ s.thread_id ? " · thread " + s.thread_id : "" }}</span>
              <button class="icon-del" title="取消订阅" @click="delNotifySub(s)">✕</button>
            </div>
          </div>
          <div v-else class="empty" style="padding: 12px">该任务无订阅</div>
        </div>
      </div>
    </div>

    <!-- 移动端看板 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>移动端看板</h3></div>
      <div>
        <SettingSwitch
          v-for="s in MOB_SWITCHES"
          :key="s.key"
          :label="s.label"
          :desc="s.desc"
          :model-value="store.mob[s.key]"
          @update:model-value="(v) => onMobChange(s.key, v)"
        />
      </div>
    </div>

    <!-- 维护 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>维护</h3></div>
      <div class="settings-block">
        <h4>垃圾回收（GC）</h4>
        <div class="settings-actions">
          <van-button @click="gcShow = true">运行 GC</van-button>
          <span class="panel-note">清理过期事件与日志（默认保留 30 天）</span>
        </div>
      </div>
      <div class="settings-block">
        <h4>数据库检查 / 修复</h4>
        <div class="settings-actions">
          <van-button @click="runRepair">运行检查</van-button>
        </div>
      </div>
      <pre v-if="maintainOut" class="pre-block maintain-out">{{ maintainOut }}</pre>
    </div>

    <!-- 关于 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>关于</h3></div>
      <div class="about">
        <div><b>Hermes Kanban Web</b> · v4（Vue 3 + Vant 重构）</div>
        <div class="kv" style="margin-top: 6px">
          <dt>端口</dt><dd><code class="mono">9120</code></dd>
          <dt>数据层</dt><dd>只读 SQLite + <code class="mono">hermes kanban</code> CLI 写操作</dd>
          <dt>主题</dt><dd>{{ THEMES.map((t) => t.label).join(" · ") }}</dd>
          <dt>轮询</dt><dd>看板 30s · 事件 5s</dd>
        </div>
        <div class="settings-actions" style="margin-top: 12px">
          <van-button type="danger" @click="logout">退出登录</van-button>
        </div>
      </div>
    </div>

    <!-- pickers -->
    <van-picker
      v-model:show="showSwitchPicker"
      :columns="boardOpts"
      title="选择 board"
      @confirm="(v) => (switchSel = v.selectedOptions[0]?.value || '')"
    />
    <van-picker
      v-model:show="showRenamePicker"
      :columns="boardOpts"
      title="选择 board"
      @confirm="(v) => (renameSel = v.selectedOptions[0]?.value || '')"
    />
    <van-picker
      v-model:show="showWorkdirPicker"
      :columns="boardOpts"
      title="选择 board"
      @confirm="(v) => (workdirSel = v.selectedOptions[0]?.value || '')"
    />
    <van-picker
      v-model:show="showRmPicker"
      :columns="boardOpts"
      title="选择 board"
      @confirm="(v) => (rmSel = v.selectedOptions[0]?.value || '')"
    />

    <!-- GC 弹窗 -->
    <van-dialog v-model:show="gcShow" title="运行 GC" show-cancel-button :before-close="runGc" close-on-click-overlay>
      <div style="padding: 8px 16px 16px">
        <van-field v-model="gcEvents" type="number" label="事件保留天数" placeholder="30" />
        <van-field v-model="gcLogs" type="number" label="日志保留天数" placeholder="30" style="margin-top: 8px" />
      </div>
    </van-dialog>
  </section>
</template>
