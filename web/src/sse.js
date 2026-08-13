/* sse.js — fetch 型 SSE 客户端（M2-3 S3）
 * 原生 EventSource 无法携带 Authorization 头（本应用走 localStorage Basic Auth），
 * 因此用 fetch + ReadableStream 手动解析 SSE 帧，接口对齐 EventSource 语义：
 *   createEventSource({ url, onEvent, onError }) → { close() }
 * 断线/HTTP 错误由调用方决定重连策略（store 里降级到 60s 轮询 + 定时重连）。
 *
 * M2-3 S3 加固（2026-08-13, t_b294acba）：
 * 1) 静默看门狗：连接打开后若 >30s 未收到任何数据（事件或 `: ping` 保活行），
 *    强制 abort 当前连接 → 走 onError（store 降级 60s 轮询）→ 自动重连。
 *    防止"连接活着但无事件"的假活流永久冻结看板（历史事故：游标卡在 heartbeat 洪峰）。
 * 2) lastEventId 持久化到 localStorage（kb-sse-last-id）：页面刷新后续传，
 *    不依赖后端兜底（后端对无游标客户端从尾部开始，但持久化可跨刷新精确续传）。
 */
import { authHeader } from "./api";

const LS_LAST_ID_KEY = "kb-sse-last-id";
const SILENT_TIMEOUT_MS = 30000; // 静默阈值：>30s 无任何数据视为假活
const WATCHDOG_TICK_MS = 5000; // 看门狗检查周期

function lsGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}
function lsSet(key, val) {
  try {
    window.localStorage.setItem(key, val);
  } catch (_) {
    /* 隐私模式等场景静默失败 */
  }
}

export function createEventSource({
  url = "/api/events/stream",
  onEvent = null,
  onError = null,
  onOpen = null,
  retryMs = 5000,
  silentTimeoutMs = SILENT_TIMEOUT_MS,
} = {}) {
  let closed = false;
  let controller = null;
  let timer = null;
  let watchdog = null;
  let lastActivity = 0;
  let lastEventId = parseInt(lsGet(LS_LAST_ID_KEY) || "0", 10) || 0;

  function stopWatchdog() {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }
  function startWatchdog() {
    stopWatchdog();
    lastActivity = Date.now();
    watchdog = setInterval(() => {
      if (closed) {
        stopWatchdog();
        return;
      }
      if (Date.now() - lastActivity > silentTimeoutMs) {
        // 假活流：连接在但无任何数据 → 强制断开，走 onError 降级 + 自动重连
        if (controller) controller.abort();
      }
    }, WATCHDOG_TICK_MS);
  }

  function scheduleRetry() {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, retryMs);
  }

  async function connect() {
    if (closed) return;
    controller = new AbortController();
    try {
      const headers = { Authorization: authHeader(), "Cache-Control": "no-cache" };
      if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) {
        throw new Error("SSE HTTP " + res.status);
      }
      /* 每次重连成功都通知（幂等：store 置 sseActive=true 恢复推送模式） */
      if (onOpen) onOpen();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      startWatchdog();
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        lastActivity = Date.now(); // 任何字节都算活动（含 `: ping` 保活行）
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let id = null;
          let data = null;
          for (const line of block.split("\n")) {
            if (line.startsWith("id:")) id = line.slice(3).trim();
            else if (line.startsWith("data:")) data = line.slice(5).trim();
          }
          if (id) {
            const n = parseInt(id, 10);
            if (Number.isFinite(n)) {
              lastEventId = n;
              lsSet(LS_LAST_ID_KEY, String(n)); // 持久化游标，刷新后续传
            }
          }
          if (data && data.startsWith("{")) {
            try {
              if (onEvent) onEvent(JSON.parse(data));
            } catch (_) {
              /* 单条事件解析失败不影响流 */
            }
          }
        }
      }
      stopWatchdog();
      // 服务端关闭流（done）→ 走重连
      if (!closed) scheduleRetry();
    } catch (err) {
      stopWatchdog();
      if (closed) return;
      if (onError) onError(err);
      scheduleRetry();
    }
  }

  connect();

  return {
    close() {
      closed = true;
      stopWatchdog();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (controller) controller.abort();
    },
    get lastEventId() {
      return lastEventId;
    },
  };
}
