<script setup>
import { computed, ref, watch } from "vue";
import { useAppStore, STATUS, STATUS_CSS } from "../store";
import { api, apiText, jsonOpts } from "../api";
import { fmtTime, ago, mdToHtml, kindColor, shortPayload } from "../utils";
import { ok, fail, COPY } from "../feedback";

const store = useAppStore();

const detail = ref(null);
const loading = ref(false);
const error = ref("");
const ctxText = ref(null);
const ctxLoading = ref(false);
const logText = ref(null);
const logLoading = ref(false);
const notifySubs = ref([]);
const commentText = ref("");
const linkInput = ref("");
const notifyForm = ref({ platform: "", chat_id: "", thread_id: "" });
const innerEl = ref(null);
let swipeStartY = null;

const show = computed(() => !!store.detailId);
const isMobile = computed(() => store.isMobile);

const popupStyle = computed(() =>
  isMobile.value
    ? { width: "100%", height: "100%", borderRadius: 0 }
    : { width: "min(720px, 64vw)", height: "calc(100vh - 40px)", borderRadius: "var(--radius)" }
);
const position = computed(() => (isMobile.value ? "bottom" : "right"));

async function load() {
  const id = store.detailId;
  if (!id) return;
  loading.value = true;
  error.value = "";
  detail.value = null;
  ctxText.value = null;
  logText.value = null;
  const opts = { ...store.detailOpts };
  store.detailOpts = {};
  try {
    detail.value = await api(`/api/tasks/${encodeURIComponent(id)}`);
    await loadNotify();
    if (opts.loadContext) loadContext(id);
    if (opts.loadLog) loadLog(id, 2048);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

watch(
  () => store.detailId,
  (id) => {
    if (id) load();
  }
);

function reset() {
  detail.value = null;
  notifySubs.value = [];
  ctxText.value = null;
  logText.value = null;
  commentText.value = "";
}

/* ---------- 操作按钮（按状态显示） ---------- */
const actionButtons = computed(() => {
  const t = detail.value && detail.value.task;
  if (!t) return [];
  const btns = [];
  if (t.status === "running") { btns.push({ label: "回收运行", action: "reclaim" }); btns.push({ label: "心跳", action: "heartbeat" }); }
  if (t.status === "ready") btns.push({ label: "认领", action: "claim" });
  if (t.status === "triage") { btns.push({ label: "细化", action: "specify" }); btns.push({ label: "分解", action: "decompose" }); }
  if (t.status === "done") btns.push({ label: "编辑结果", action: "edit-result" });
  if (t.status === "todo") btns.push({ label: "提就绪", action: "promote" });
  if (t.status === "blocked") btns.push({ label: "解阻塞", action: "unblock" });
  if (t.status === "scheduled") btns.push({ label: "提就绪", action: "unblock" });
  if (t.status === "review") btns.push({ label: "重新评审", action: "reopen-review" });
  if (["todo", "blocked", "scheduled", "review"].includes(t.status)) btns.push({ label: "提评审", action: "request-review" });
  if (t.status !== "done" && t.status !== "archived") btns.push({ label: "完成", action: "complete" });
  if (t.status !== "blocked" && t.status !== "done" && t.status !== "archived") btns.push({ label: "阻塞", action: "block" });
  if (t.status !== "scheduled" && t.status !== "done" && t.status !== "archived") btns.push({ label: "定时", action: "schedule" });
  if (t.status !== "done" && t.status !== "archived") btns.push({ label: "改指派", action: "assign" });
  if (t.status !== "archived") btns.push({ label: "归档", action: "archive" });
  btns.push({ label: "子任务", action: "child" });
  /* M1-5 E10: 详情抽屉「移动到」入口（复用 MoveSheet） */
  btns.push({ label: "移动到", action: "move" });
  if (t.status !== "running") btns.push({ label: "模型覆盖", action: "model" });
  return btns;
});

function onAction(action) {
  const t = detail.value && detail.value.task;
  if (!t) return;
  if (action === "child") { store.openCreate({ parent: t.id }); return; }
  if (action === "assign") { store.assignTask = t; return; }
  if (action === "model") { store.modelTask = t; return; }
  if (action === "edit-result") { store.editTask = t; return; }
  if (action === "move") { store.openMove(t); return; }
  if (action === "specify" || action === "decompose" || action === "claim" || action === "heartbeat") { store.runExtended(t.id, action); return; }
  if (["block", "schedule", "promote", "request-changes", "reopen-review"].includes(action)) {
    store.noteTask = t;
    store.noteAction = action;
    return;
  }
  store.runAction(t.id, action);
}

function openLinked(id) {
  store.openDetail(id);
}

/* ---------- 评论 ---------- */
async function sendComment() {
  const t = detail.value.task;
  const body = commentText.value.trim();
  if (!body) { fail(COPY.validate.comment); return; }
  try {
    await api(`/api/tasks/${encodeURIComponent(t.id)}/comment`, jsonOpts("POST", { body }));
    ok(COPY.ok.comment);
    commentText.value = "";
    await load();
  } catch (err) {
    fail(COPY.failShort(err.message));
  }
}

/* ---------- 附件 ---------- */
async function uploadFile(file) {
  const t = detail.value.task;
  if (!file) { fail(COPY.validate.file); return; }
  const fd = new FormData();
  fd.append("file", file);
  try {
    await api(`/api/tasks/${encodeURIComponent(t.id)}/attachments`, { method: "POST", body: fd });
    ok(COPY.ok.upload);
    await load();
  } catch (err) {
    fail(COPY.fail("上传", err.message));
  }
}
function onUploadRead(item) {
  uploadFile(item.file);
}
async function delAttach(a) {
  const t = detail.value.task;
  try {
    await api(`/api/tasks/${encodeURIComponent(t.id)}/attachments/${a.id}`, { method: "DELETE" });
    ok(COPY.ok.attachDel);
    await load();
  } catch (err) {
    fail(COPY.fail("删除", err.message));
  }
}

/* ---------- 依赖 ---------- */
async function addLink() {
  const t = detail.value.task;
  const other = linkInput.value.trim();
  if (!other) { fail(COPY.validate.linkId); return; }
  try {
    await api(`/api/tasks/${encodeURIComponent(t.id)}/link`, jsonOpts("POST", { other_id: other, direction: "child" }));
    ok(COPY.ok.linkAdd);
    linkInput.value = "";
    await load();
  } catch (err) {
    fail(COPY.failShort(err.message));
  }
}
async function unlink(dir, other) {
  const t = detail.value.task;
  try {
    await api(`/api/tasks/${encodeURIComponent(t.id)}/link/${encodeURIComponent(other)}?direction=${dir}`, { method: "DELETE" });
    ok(COPY.ok.linkDel);
    await load();
  } catch (err) {
    fail(COPY.failShort(err.message));
  }
}

/* ---------- 上下文 / 日志 ---------- */
async function loadContext(id) {
  const tid = id || detail.value.task.id;
  ctxLoading.value = true;
  ctxText.value = null;
  try {
    ctxText.value = await apiText(`/api/tasks/${encodeURIComponent(tid)}/context`);
  } catch (err) {
    ctxText.value = "加载失败: " + err.message;
  } finally {
    ctxLoading.value = false;
  }
}
async function loadLog(id, tail) {
  const tid = id || detail.value.task.id;
  logLoading.value = true;
  logText.value = null;
  try {
    const url = tail ? `/api/tasks/${encodeURIComponent(tid)}/log?tail=${tail}` : `/api/tasks/${encodeURIComponent(tid)}/log`;
    logText.value = await apiText(url);
  } catch (err) {
    logText.value = "加载失败: " + err.message;
  } finally {
    logLoading.value = false;
  }
}

/* ---------- 通知订阅 ---------- */
const platformSheet = ref(false);
const platformActions = ref([]);

async function loadPlatforms() {
  try {
    const list = await api("/api/platforms");
    platformActions.value = list.map((p) => ({
      name: p.name + (p.chat_id ? `（${p.chat_id.slice(0, 14)}…）` : ""),
      value: p,
    }));
  } catch (_) {
    platformActions.value = [];
  }
}
function onPlatformSelect(a) {
  const p = a.value;
  notifyForm.value.platform = p.platform;
  notifyForm.value.chat_id = p.chat_id || "";
  notifyForm.value.thread_id = p.thread_id || "";
}
async function loadNotify() {
  const t = detail.value && detail.value.task;
  if (!t) return;
  try {
    notifySubs.value = await api(`/api/tasks/${encodeURIComponent(t.id)}/notify`);
  } catch (_) {
    notifySubs.value = [];
  }
}
async function addNotify() {
  const t = detail.value.task;
  const platform = notifyForm.value.platform.trim();
  const chat = notifyForm.value.chat_id.trim();
  if (!platform || !chat) { fail(COPY.validate.platform); return; }
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(t.id)}/notify`, jsonOpts("POST", {
      platform,
      chat_id: chat,
      thread_id: notifyForm.value.thread_id.trim() || undefined,
    }));
    ok(res.message || COPY.ok.subscribe);
    notifyForm.value = { platform: "", chat_id: "", thread_id: "" };
    await loadNotify();
  } catch (err) {
    fail(COPY.fail("订阅", err.message));
  }
}
async function delNotify(s) {
  const t = detail.value.task;
  try {
    await api(`/api/tasks/${encodeURIComponent(t.id)}/notify`, jsonOpts("DELETE", {
      platform: s.platform,
      chat_id: s.chat_id || s.chatId,
      thread_id: s.thread_id,
    }));
    ok(COPY.ok.unsubscribe);
    await loadNotify();
  } catch (err) {
    fail(COPY.fail("取消", err.message));
  }
}

/* ---------- 下滑关闭 ---------- */
function onTouchStart(e) {
  if (innerEl.value && innerEl.value.scrollTop <= 0) swipeStartY = e.touches[0].clientY;
  else swipeStartY = null;
}
function onTouchMove(e) {
  if (swipeStartY == null) return;
  const dy = e.touches[0].clientY - swipeStartY;
  if (dy > 80) {
    store.closeDetail();
    swipeStartY = null;
  }
}
function onTouchEnd() {
  swipeStartY = null;
}
</script>

<template>
  <van-popup
    :show="show"
    :position="position"
    :style="popupStyle"
    class="detail-popup"
    :class="detail ? 'st-' + detail.task.status : ''"
    :close-on-click-overlay="!isMobile"
    @click-overlay="store.closeDetail()"
    @closed="reset"
  >
    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="error && !detail" class="empty">加载失败: {{ error }}</div>

    <div
      v-else-if="detail"
      ref="innerEl"
      class="drawer-inner"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div class="drawer-handle"></div>

      <!-- 头部 -->
      <div class="detail-head">
        <van-tag :color="STATUS_CSS[detail.task.status]" text-color="#0d0f1a" size="medium">{{ STATUS[detail.task.status] }}</van-tag>
        <span v-if="detail.task.priority > 0" class="card-priority">P{{ detail.task.priority }}</span>
        <h2 class="detail-title">{{ detail.task.title }}</h2>
        <button class="btn btn-sm btn-ghost detail-close" aria-label="关闭" @click="store.closeDetail()">✕</button>
      </div>

      <!-- 操作 -->
      <div class="detail-actions">
        <van-button
          v-for="a in actionButtons"
          :key="a.action"
          size="small"
          plain
          type="default"
          @click="onAction(a.action)"
        >{{ a.label }}</van-button>
      </div>

      <!-- 信息 -->
      <div class="detail-section">
        <h3>信息</h3>
        <div class="kv">
          <dt>任务 ID</dt>
          <dd><code class="mono">{{ detail.task.id }}</code></dd>
          <dt>指派</dt>
          <dd>
            <template v-if="detail.task.assignee">@{{ detail.task.assignee }}</template>
            <span v-else style="color: var(--muted)">未指派</span>
          </dd>
          <dt>创建者</dt>
          <dd>{{ detail.task.created_by || "—" }}</dd>
          <dt>工作区</dt>
          <dd>{{ detail.task.workspace_kind || "" }}{{ detail.task.workspace_path ? " · " + detail.task.workspace_path : "" }}{{ detail.task.branch_name ? " · " + detail.task.branch_name : "" }}</dd>
          <dt>连续失败</dt>
          <dd>{{ detail.task.consecutive_failures || 0 }}</dd>
          <dt>模型覆盖</dt>
          <dd>
            <template v-if="detail.task.model_override">
              {{ detail.task.model_override }}<template v-if="detail.task.provider_override"> ({{ detail.task.provider_override }})</template>
            </template>
            <span v-else>—</span>
          </dd>
          <dt>结果</dt>
          <dd>
            <div v-if="detail.task.result" class="md-body" v-html="mdToHtml(detail.task.result)"></div>
            <span v-else>—</span>
          </dd>
        </div>
      </div>

      <!-- 时间线 -->
      <div class="detail-section">
        <h3>时间线</h3>
        <div class="timeline">
          <span>创建 <b>{{ fmtTime(detail.task.created_at) }}</b></span>
          <span>开始 <b>{{ fmtTime(detail.task.started_at) }}</b></span>
          <span>完成 <b>{{ fmtTime(detail.task.completed_at) }}</b></span>
          <span>心跳 <b>{{ detail.task.last_heartbeat_at ? ago(detail.task.last_heartbeat_at) : "—" }}</b></span>
        </div>
      </div>

      <!-- 描述 -->
      <div v-if="detail.task.body" class="detail-section">
        <h3>描述</h3>
        <div class="md-body" v-html="mdToHtml(detail.task.body)"></div>
      </div>

      <!-- 上下文 -->
      <div class="detail-section">
        <h3>上下文</h3>
        <div>
          <van-button v-if="ctxText === null" size="small" :loading="ctxLoading" @click="loadContext()">加载上下文</van-button>
          <pre v-else-if="ctxText !== ''" class="pre-block" style="margin: 0">{{ ctxText }}</pre>
          <div v-else class="empty" style="padding: 12px">无上下文</div>
        </div>
      </div>

      <!-- 日志 -->
      <div class="detail-section">
        <h3>日志</h3>
        <div>
          <div class="attach-upload">
            <van-button size="small" :loading="logLoading" @click="loadLog()">加载日志</van-button>
            <van-button size="small" @click="loadLog(null, 4096)">最近 4KB</van-button>
          </div>
          <pre v-if="logText !== null && logText !== ''" class="pre-block" style="margin-top: 8px">{{ logText }}</pre>
          <div v-else-if="logText === ''" class="empty" style="padding: 12px">无日志</div>
        </div>
      </div>

      <!-- 通知订阅 -->
      <div class="detail-section">
        <h3>通知订阅（{{ notifySubs.length }}）</h3>
        <div v-if="notifySubs.length">
          <div v-for="(s, i) in notifySubs" :key="i" class="notify-row">
            <span class="notify-platform">{{ s.platform || "?" }}</span>
            <span>{{ s.chat_id || s.chatId || "" }}{{ s.thread_id ? " · thread " + s.thread_id : "" }}{{ s.chat_type ? " · " + s.chat_type : "" }}</span>
            <button class="icon-del" title="取消订阅" @click="delNotify(s)">✕</button>
          </div>
        </div>
        <div v-else class="empty" style="padding: 8px; font-size: 12px">无订阅</div>
        <div class="attach-upload">
          <button class="platform-pick" @click="platformSheet = true; loadPlatforms()">
            {{ notifyForm.platform ? notifyForm.platform : "选择平台 ▾" }}
          </button>
          <input v-model="notifyForm.chat_id" placeholder="chat-id（自动填充）" style="flex: 1; min-width: 120px">
          <input v-model="notifyForm.thread_id" placeholder="thread-id(可选)" style="max-width: 110px">
          <van-button size="small" type="primary" @click="addNotify">订阅</van-button>
        </div>
        <van-action-sheet
          v-model:show="platformSheet"
          :actions="platformActions"
          title="选择已绑定的消息平台"
          cancel-text="取消"
          close-on-click-action
          @select="onPlatformSelect"
        />
      </div>

      <!-- 依赖 -->
      <div class="detail-section">
        <h3>依赖</h3>
        <div style="margin-bottom: 6px">父任务（{{ detail.parents.length }}）</div>
        <div v-if="detail.parents.length">
          <div v-for="p in detail.parents" :key="p.id" class="link-row">
            <button class="lnk" @click="openLinked(p.id)">{{ p.title || p.id }}</button>
            <span class="card-id">{{ p.id }}</span>
            <button class="icon-del" title="解除依赖" @click="unlink('parent', p.id)">✕</button>
          </div>
        </div>
        <div v-else class="empty" style="padding: 8px; font-size: 12px">无</div>

        <div style="margin: 10px 0 6px">子任务（{{ detail.children.length }}）</div>
        <div v-if="detail.children.length">
          <div v-for="c in detail.children" :key="c.id" class="link-row">
            <button class="lnk" @click="openLinked(c.id)">{{ c.title || c.id }}</button>
            <span class="card-id">{{ c.id }}</span>
            <button class="icon-del" title="解除依赖" @click="unlink('child', c.id)">✕</button>
          </div>
        </div>
        <div v-else class="empty" style="padding: 8px; font-size: 12px">无</div>

        <div class="attach-upload">
          <input v-model="linkInput" placeholder="任务 ID" style="flex: 1; min-width: 120px">
          <van-button size="small" @click="addLink">添加依赖</van-button>
        </div>
      </div>

      <!-- 附件 -->
      <div class="detail-section">
        <h3>附件（{{ detail.attachments.length }}）</h3>
        <div v-if="detail.attachments.length">
          <div v-for="a in detail.attachments" :key="a.id" class="attach-row">
            <span class="aname">{{ a.filename }}</span>
            <span class="attach-meta">{{ a.size ? Math.ceil(a.size / 1024) + " KB" : "" }} · {{ a.uploaded_by || "" }} · {{ ago(a.created_at) }}</span>
            <button class="icon-del" title="删除附件" @click="delAttach(a)">✕</button>
          </div>
        </div>
        <div v-else class="empty" style="padding: 8px; font-size: 12px">无附件</div>
        <div class="attach-upload">
          <van-uploader
            :after-read="onUploadRead"
            :max-count="1"
            :preview-image="false"
            accept="*"
          >
            <van-button size="small" type="primary">上传</van-button>
          </van-uploader>
        </div>
      </div>

      <!-- 评论 -->
      <div class="detail-section">
        <h3>评论（{{ detail.comments.length }}）</h3>
        <div v-if="detail.comments.length">
          <div v-for="c in detail.comments" :key="c.id" class="comment">
            <div class="comment-head">
              <span class="comment-author">{{ c.author }}</span>
              <span>{{ fmtTime(c.created_at) }}</span>
            </div>
            <div class="comment-body">{{ c.body }}</div>
          </div>
        </div>
        <div v-else class="empty" style="padding: 8px; font-size: 12px">暂无评论</div>
        <div class="comment-compose">
          <van-field v-model="commentText" type="textarea" rows="2" autosize placeholder="写评论…" style="flex: 1" />
          <van-button size="small" type="primary" @click="sendComment">发送</van-button>
        </div>
      </div>

      <!-- 运行记录 -->
      <div class="detail-section">
        <h3>运行记录（{{ detail.runs.length }}）</h3>
        <div v-if="detail.runs.length">
          <div v-for="r in detail.runs" :key="r.id" class="run">
            <div class="run-head">
              <span class="run-status" :class="r.status">{{ r.status }}</span>
              <span>@{{ r.profile || "?" }}</span>
              <span>{{ fmtTime(r.started_at) }} → {{ r.ended_at ? fmtTime(r.ended_at) : "进行中" }}</span>
              <span v-if="r.outcome" style="color: var(--muted)">{{ r.outcome }}</span>
            </div>
            <div v-if="r.summary" class="run-summary" v-html="mdToHtml(r.summary)"></div>
            <div v-if="r.error" style="color: var(--danger); font-size: 12px">{{ r.error }}</div>
          </div>
        </div>
        <div v-else class="empty" style="padding: 8px; font-size: 12px">暂无运行记录</div>
      </div>

      <!-- 事件流 -->
      <div class="detail-section">
        <h3>事件流（最近 {{ detail.events.length }}）</h3>
        <div v-if="detail.events.length">
          <div
            v-for="e in detail.events"
            :key="e.id"
            class="event"
            :style="{ '--evc': kindColor(e.kind) }"
          >
            <span class="event-kind">{{ e.kind }}</span>
            <span class="event-body">{{ shortPayload(e.payload) }}</span>
            <span class="event-time">{{ ago(e.created_at) }}</span>
          </div>
        </div>
        <div v-else class="empty" style="padding: 8px; font-size: 12px">无事件</div>
      </div>
    </div>
  </van-popup>
</template>
