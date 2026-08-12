<script setup>
import { computed, reactive, ref } from "vue";
import { useAppStore, MOB_SWITCHES, THEMES, STATUS_ORDER, STATUS, STATUS_CSS } from "../store";
import { api, jsonOpts } from "../api";
import { ok, fail, confirm, loading, COPY } from "../feedback";
import SettingSwitch from "../components/SettingSwitch.vue";

const store = useAppStore();

/* ---------- Board 管理 ---------- */
const boards = computed(() => (store.boards || []).filter((b) => !b.archived));
const archivedBoards = computed(() => (store.boards || []).filter((b) => b.archived));
const cur = computed(() => store.currentBoard);
const boardOpts = computed(() => boards.value.map((b) => ({ name: b.slug + (b.is_current ? " ●（当前）" : ""), value: b.slug })));

const newBoard = reactive({ slug: "", name: "", description: "", icon: "", color: "#5ff0e0" });

async function boardOp(label, fn) {
  try {
    const res = await fn();
    ok((res && res.message) || label + "成功");
    await store.loadBoards();
    await store.refreshBoard();
  } catch (err) {
    fail(COPY.fail(label, err.message));
  }
}

async function doSwitch(slug) {
  await boardOp("切换", () => api(`/api/boards/${encodeURIComponent(slug)}/switch`, jsonOpts("POST", {})));
}
async function doCreate() {
  const slug = newBoard.slug.trim();
  if (!slug) { fail(COPY.validate.slug); return; }
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
/* ---------- board 卡片行操作 ---------- */
const boardMenuShow = ref(false);
const boardMenuTarget = ref(null);
const boardMenuActions = computed(() => {
  const b = boardMenuTarget.value;
  if (!b) return [];
  const acts = [
    { name: "重命名", op: "rename" },
    { name: b.default_workdir ? "修改工作目录" : "设置工作目录", op: "workdir" },
  ];
  if (b.default_workdir) acts.push({ name: "清除工作目录", op: "clearwd" });
  acts.push({ name: "归档（可恢复）", op: "archive", color: "#ffb86c" });
  acts.push({ name: "永久删除（不可恢复）", op: "delete", color: "#ff5c6c" });
  return acts;
});
const renameShow = ref(false);
const renameInput = ref("");
const workdirShow = ref(false);
const workdirInput = ref("");

function openBoardMenu(b) {
  boardMenuTarget.value = b;
  boardMenuShow.value = true;
}
async function onBoardMenuSelect(a) {
  const b = boardMenuTarget.value;
  if (!b) return;
  if (a.op === "rename") {
    renameInput.value = b.name || b.slug;
    renameShow.value = true;
  } else if (a.op === "workdir") {
    workdirInput.value = b.default_workdir || "";
    workdirShow.value = true;
  } else if (a.op === "clearwd") {
    await doWorkdir(b.slug, null);
  } else if (a.op === "archive") {
    const c = COPY.confirm.archiveBoard(b.name || b.slug);
    const confirmed = await confirm({ title: c.title, message: c.message, confirmText: c.confirmText });
    if (!confirmed) return;
    await doArchive(b.slug);
  } else if (a.op === "delete") {
    const c = COPY.confirm.deleteBoard(b.name || b.slug);
    const confirmed = await confirm({ title: c.title, message: c.message, confirmText: c.confirmText, danger: true });
    if (!confirmed) return;
    await doDelete(b.slug);
  }
}
async function confirmRename() {
  const name = renameInput.value.trim();
  if (!name) { fail(COPY.validate.name); return; }
  renameShow.value = false;
  await boardOp("重命名", () => api(`/api/boards/${encodeURIComponent(boardMenuTarget.value.slug)}/rename`, jsonOpts("POST", { name })));
}
async function confirmWorkdir() {
  const b = boardMenuTarget.value;
  workdirShow.value = false;
  await doWorkdir(b.slug, workdirInput.value.trim() || null);
}
async function doWorkdir(slug, path) {
  await boardOp("设置工作目录", () =>
    api(`/api/boards/${encodeURIComponent(slug)}/workdir`, jsonOpts("POST", { path: path || null }))
  );
}
async function doArchive(slug) {
  await boardOp("归档", () => api(`/api/boards/${encodeURIComponent(slug)}`, { method: "DELETE" }));
}
async function doDelete(slug) {
  await boardOp("删除", () => api(`/api/boards/${encodeURIComponent(slug)}`, jsonOpts("DELETE", { delete: true })));
}
async function doRestore(slug) {
  await boardOp("恢复", () => api(`/api/boards/${encodeURIComponent(slug)}/restore`, jsonOpts("POST", {})));
}

/* ---------- 通知订阅管理 ---------- */
const notifyTask = ref("");
const notifySubs = ref(null);
const notifyLoading = ref(false);
const showNotifyPicker = ref(false);

/* 任务选择器（全部任务，非归档在前） */
const notifyTaskActions = computed(() => {
  if (!store.board) return [];
  const tasks = [
    ...store.board.statuses.filter((c) => c.status !== "archived").flatMap((c) => c.tasks),
    ...store.board.statuses.filter((c) => c.status === "archived").flatMap((c) => c.tasks),
  ];
  return tasks.map((t) => ({
    name: `${t.title.slice(0, 24)}${t.title.length > 24 ? "…" : ""}（${t.id}）`,
    value: t.id,
  }));
});

function onNotifyTaskSelect(a) {
  notifyTask.value = a.value;
  loadNotifySubs();
}

async function loadNotifySubs() {
  const tid = notifyTask.value.trim();
  if (!tid) { fail(COPY.validate.notifyTask); return; }
  notifyLoading.value = true;
  notifySubs.value = null;
  try {
    notifySubs.value = await api(`/api/tasks/${encodeURIComponent(tid)}/notify`);
  } catch (err) {
    fail(COPY.fail("加载", err.message));
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
    ok(COPY.ok.unsubscribe);
    loadNotifySubs();
  } catch (err) {
    fail(COPY.fail("取消", err.message));
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
  loading("GC 执行中…", { duration: 0 });
  try {
    const res = await api("/api/gc", jsonOpts("POST", {
      event_retention_days: isNaN(ev) ? undefined : ev,
      log_retention_days: isNaN(lg) ? undefined : lg,
    }));
    maintainOut.value = res.message || "GC 完成";
    ok(res.message || "GC 完成");
    return true;
  } catch (err) {
    fail(COPY.fail("GC", err.message));
    return true;
  }
}

async function runRepair() {
  loading("DB 检查中…", { duration: 0 });
  try {
    const res = await api("/api/repair", { method: "POST" });
    maintainOut.value = JSON.stringify(res, null, 2);
    ok("检查完成");
  } catch (err) {
    fail(COPY.fail("检查", err.message));
  }
}

/* ---------- 主动触发调度器 ---------- */
const schedRunning = ref(false);

async function runScheduler() {
  if (schedRunning.value) return; // 防重复点击：请求进行中忽略再次点击
  schedRunning.value = true;
  try {
    const res = await api("/api/scheduler/run", { method: "POST" });
    const tid = res && (res.task_id || res.taskId);
    const spawned = res && Array.isArray(res.task_ids) ? res.task_ids.length : null;
    ok(
      res && res.message
        ? res.message
        : spawned != null
          ? `调度已触发 · 新调度 ${spawned} 个任务`
          : tid
            ? `调度已触发 · ${tid}`
            : "调度已触发"
    );
  } catch (err) {
    if (err.message === "Unauthorized") return; // 401：api() 已切登录页，不再重复提示
    fail(COPY.fail("触发调度", err.message));
  } finally {
    schedRunning.value = false;
  }
}

function onMobChange(key, val) {
  store.setMob(key, val);
  ok("已更新", { duration: 1200 });
}

/* ---------- 外观：跟随系统深色 ---------- */
const sysDarkOn = ref(false);
try { sysDarkOn.value = localStorage.getItem("kb-sys-dark") === "1"; } catch (_) { /* */ }

function onSysDark(val) {
  sysDarkOn.value = val;
  try { localStorage.setItem("kb-sys-dark", val ? "1" : "0"); } catch (_) { /* */ }
  if (val) {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    store.applyTheme(mq.matches ? "linear" : "bright", true);
  } else {
    store.applyTheme(store.theme);
  }
  ok(val ? "已开启跟随系统" : "已关闭跟随系统", { duration: 1200 });
}

/* ---------- 看板分类显示开关 ---------- */
function onChipToggle(st) {
  store.toggleChip(st);
  ok(store.hiddenChips.includes(st) ? "已隐藏「" + STATUS[st] + "」" : "已显示「" + STATUS[st] + "」", { duration: 1200 });
}

function logout() {
  ok("已退出登录", { duration: 800, type: "info" });
  setTimeout(() => store.logout(), 400);
}
</script>

<template>
  <section class="view" aria-label="设置">
    <!-- Board 管理 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>Board 管理</h3></div>

      <div class="settings-block">
        <h4>看板列表（点击 ⋯ 管理）</h4>
        <div v-if="boards.length" class="board-list">
          <div
            v-for="b in boards"
            :key="b.slug"
            class="board-item"
            :class="{ current: b.slug === cur?.slug }"
          >
            <span class="board-item-dot" :style="{ background: b.color || 'var(--accent)' }"></span>
            <div class="board-item-main">
              <div class="board-item-name">
                {{ b.icon ? b.icon + " " : "" }}{{ b.name || b.slug }}
                <span v-if="b.slug === cur?.slug" class="board-item-badge">当前</span>
              </div>
              <div class="board-item-sub">
                <code class="mono">{{ b.slug }}</code>
                <span v-if="b.total != null">· {{ b.total }} 任务</span>
                <span v-if="b.default_workdir" class="board-item-wd" :title="b.default_workdir">· {{ b.default_workdir }}</span>
              </div>
            </div>
            <button
              v-if="b.slug !== cur?.slug"
              class="board-item-switch"
              @click="doSwitch(b.slug)"
            >切换</button>
            <button class="board-item-menu" aria-label="管理 board" @click="openBoardMenu(b)">⋯</button>
          </div>
        </div>
        <div v-else class="empty" style="padding: 12px">暂无 board</div>

        <template v-if="archivedBoards.length">
          <h4>已归档（可恢复）</h4>
          <div class="board-list">
            <div
              v-for="b in archivedBoards"
              :key="b.slug"
              class="board-item archived"
            >
              <span class="board-item-dot" :style="{ background: b.color || 'var(--muted)' }"></span>
              <div class="board-item-main">
                <div class="board-item-name">{{ b.icon ? b.icon + " " : "" }}{{ b.name || b.slug }}</div>
                <div class="board-item-sub"><code class="mono">{{ b.slug }}</code></div>
              </div>
              <button class="board-item-switch" @click="doRestore(b.slug)">恢复</button>
            </div>
          </div>
        </template>
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
    </div>

    <!-- 通知订阅管理 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>通知订阅管理</h3></div>
      <div class="settings-block">
        <div class="settings-actions">
          <van-field v-model="notifyTask" placeholder="任务 ID (t_xxxx)" style="flex: 1; max-width: 280px" />
          <van-button @click="showNotifyPicker = true">选择任务</van-button>
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

    <!-- 外观 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>外观</h3></div>
      <SettingSwitch
        label="跟随系统深色模式"
        desc="系统深色时自动用线性精修，浅色时用明亮现代（手动选主题后自动关闭）"
        :model-value="sysDarkOn"
        @update:model-value="onSysDark"
      />
    </div>

    <!-- 看板分类显示 -->
    <div class="panel settings-panel">
      <div class="panel-head"><h3>看板分类显示</h3></div>
      <div class="settings-block">
        <p class="settings-hint">控制看板页 / 列表页顶部分类按钮的显示（「全部」固定显示）</p>
        <div v-for="st in STATUS_ORDER" :key="st" class="chip-toggle-row">
          <span class="chip-toggle-label">
            <span class="dot" :style="{ background: STATUS_CSS[st] }"></span>
            {{ STATUS[st] }}
          </span>
          <van-switch
            :model-value="!store.hiddenChips.includes(st)"
            size="20px"
            @update:model-value="() => onChipToggle(st)"
          />
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
      <div class="settings-block">
        <h4>调度器</h4>
        <div class="settings-actions">
          <van-button
            type="primary"
            :loading="schedRunning"
            :disabled="schedRunning"
            @click="runScheduler"
          >立即调度</van-button>
          <span class="panel-note">触发一次调度器运行，立即拾取待调度任务</span>
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

    <!-- board ⋯ 管理菜单 -->
    <van-action-sheet
      v-model:show="boardMenuShow"
      :actions="boardMenuActions"
      title="管理 board"
      cancel-text="取消"
      close-on-click-action
      @select="onBoardMenuSelect"
    />

    <!-- 重命名 / 工作目录对话框 -->
    <van-dialog v-model:show="renameShow" title="重命名 board" show-cancel-button :before-close="(a) => { if (a === 'confirm') confirmRename(); return true; }">
      <div style="padding: 8px 16px 16px">
        <van-field v-model="renameInput" label="名称" placeholder="新名称" />
      </div>
    </van-dialog>
    <van-dialog v-model:show="workdirShow" title="设置工作目录" show-cancel-button :before-close="(a) => { if (a === 'confirm') confirmWorkdir(); return true; }">
      <div style="padding: 8px 16px 16px">
        <van-field v-model="workdirInput" label="路径" placeholder="/abs/path（留空清除）" />
      </div>
    </van-dialog>

    <!-- 通知订阅任务选择 -->
    <van-action-sheet
      v-model:show="showNotifyPicker"
      :actions="notifyTaskActions"
      title="选择任务（通知订阅）"
      cancel-text="取消"
      close-on-click-action
      @select="onNotifyTaskSelect"
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
