/* sse.js — fetch 型 SSE 客户端（M2-3 S3）
 * 原生 EventSource 无法携带 Authorization 头（本应用走 localStorage Basic Auth），
 * 因此用 fetch + ReadableStream 手动解析 SSE 帧，接口对齐 EventSource 语义：
 *   createEventSource({ url, onEvent, onError }) → { close() }
 * 断线/HTTP 错误由调用方决定重连策略（store 里降级到 60s 轮询 + 定时重连）。
 */
import { authHeader } from "./api";

export function createEventSource({
  url = "/api/events/stream",
  onEvent = null,
  onError = null,
  onOpen = null,
  retryMs = 5000,
} = {}) {
  let closed = false;
  let controller = null;
  let timer = null;
  let lastEventId = 0;

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
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
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
            if (Number.isFinite(n)) lastEventId = n;
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
      // 服务端关闭流（done）→ 走重连
      if (!closed) scheduleRetry();
    } catch (err) {
      if (closed) return;
      if (onError) onError(err);
      scheduleRetry();
    }
  }

  connect();

  return {
    close() {
      closed = true;
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
