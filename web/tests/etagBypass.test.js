// @vitest-environment happy-dom
/* t_e564bf47 — ETag 304 粘滞回归（前端半场，t_3ad4fe46 修复）。
 *
 * 根因：/api/board 指纹同秒不变 → 304 → api() 返回 null → _fetchBoard
 * 跳过赋值 → 完成列漏显且粘滞；SSE/轮询/手动刷新全部被短路。
 * 修复：force=true（手动刷新/切换看板）时 /api/board 走非条件请求
 * （etag:false，不发 If-None-Match → 不可能 304）+ current?force=1。
 *
 * 覆盖：
 *   1) 自动路径（SSE/轮询）保留条件请求 etag:true —— 304 优化不破坏；
 *   2) 手动刷新 refreshBoard(true) → etag:false + current?force=1；
 *   3) 304 粘滞场景：条件刷新返回 null → board 不变；force 刷新必拿新
 *      载荷，done 列出现同秒完成的任务（修复前永远漏显）；
 *   4) force 绕过 in-flight 去重（手动刷新不受进行中请求阻塞）；
 *   5) switchBoard 切换看板 → 最终强制拉新（防串板 304）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../src/api", () => ({
  api: (...args) => apiMock(...args),
  apiText: vi.fn(),
  jsonOpts: vi.fn((m, b) => ({ method: m, body: JSON.stringify(b) })),
}));

import { createPinia, setActivePinia } from "pinia";
import { useAppStore } from "../src/store";

/* 构造 /api/board 载荷：count 与 tasks 长度一致（与真实后端契约一致） */
function board(statuses) {
  return {
    assignees: [],
    statuses: statuses.map(([status, label, count]) => ({
      status,
      label,
      count,
      tasks: Array.from({ length: count }, (_, i) => ({
        id: `t_${status}_${i}`,
        title: `${label}任务${i}`,
        status,
        priority: 0,
        assignee: null,
      })),
    })),
  };
}

const CURRENT = { slug: "daily", name: "daily" };

let store;
let pinia;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  pinia = createPinia();
  setActivePinia(pinia);
  store = useAppStore();
  store.authed = true;
  store.currentBoard = { slug: "daily", name: "daily" };
  apiMock.mockReset();
});
afterEach(() => {
  apiMock.mockReset();
});

describe("ETag 条件请求路径（t_3ad4fe46）", () => {
  it("自动刷新（SSE/轮询）保留条件请求 etag:true，current 不带 force", async () => {
    apiMock
      .mockResolvedValueOnce(
        board([
          ["todo", "待办", 1],
          ["done", "完成", 1],
        ])
      )
      .mockResolvedValueOnce(CURRENT);
    await store.refreshBoard();
    expect(apiMock.mock.calls[0][0]).toBe("/api/board");
    expect(apiMock.mock.calls[0][1]).toEqual({ etag: true }); // 304 零传输保留
    expect(apiMock.mock.calls[1][0]).toBe("/api/boards/current");
  });

  it("手动刷新 force=true → /api/board 走非条件请求 etag:false + current?force=1", async () => {
    apiMock
      .mockResolvedValueOnce(
        board([
          ["todo", "待办", 1],
          ["done", "完成", 2],
        ])
      )
      .mockResolvedValueOnce(CURRENT);
    await store.refreshBoard(true);
    expect(apiMock.mock.calls[0][0]).toBe("/api/board");
    expect(apiMock.mock.calls[0][1]).toEqual({ etag: false }); // 不发 If-None-Match → 不可能 304
    expect(apiMock.mock.calls[1][0]).toBe("/api/boards/current?force=1");
  });

  it("304 粘滞场景：条件刷新命中 → board 不变；force 刷新必拿到同秒完成的新任务", async () => {
    // 1) 首次加载（条件请求路径）
    apiMock
      .mockResolvedValueOnce(
        board([
          ["todo", "待办", 1],
          ["done", "完成", 1],
        ])
      )
      .mockResolvedValueOnce(CURRENT);
    await store.refreshBoard();
    const before = store.board;
    expect(store.board.statuses.find((c) => c.status === "done").count).toBe(1);

    // 2) 同秒任务完成，但自动路径条件请求命中旧 ETag → 304 → api 返回 null
    //    → 跳过赋值：board 保持不变（不破坏数据，但用户看不到新任务 —— 这正是旧 bug）
    apiMock.mockResolvedValueOnce(null).mockResolvedValueOnce(CURRENT);
    await store.refreshBoard();
    expect(store.board).toBe(before);

    // 3) 用户手动刷新 → force → 非条件请求 → 载荷含同秒完成的新任务
    apiMock
      .mockResolvedValueOnce(
        board([
          ["todo", "待办", 1],
          ["done", "完成", 2],
        ])
      )
      .mockResolvedValueOnce(CURRENT);
    await store.refreshBoard(true);
    const doneCol = store.board.statuses.find((c) => c.status === "done");
    expect(doneCol.count).toBe(2);
    expect(doneCol.tasks).toHaveLength(2);
    // 调用序：0=board(首次) 1=current 2=board(304→null) 3=current 4=board(force) 5=current
    expect(apiMock.mock.calls).toHaveLength(6);
    expect(apiMock.mock.calls[4][1]).toEqual({ etag: false }); // 修复核心：此请求不可能 304
  });

  it("force 绕过 in-flight 去重；非 force 复用进行中的同一请求", async () => {
    let resolveBoard;
    apiMock
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveBoard = r;
          })
      ) // 1) /api/board（进行中）
      .mockResolvedValueOnce(CURRENT); // 2) /api/boards/current
    const p1 = store.refreshBoard();
    const p2 = store.refreshBoard(); // 非 force → 复用进行中请求（不发新请求）
    // 注意：async 包装使 p2 是底层请求 promise 而非 p1 的包装 promise，
    // 契约断言改为「/api/board 只被请求一次」+ 两调用都随同一请求 settle
    resolveBoard(
      board([
        ["todo", "待办", 0],
        ["done", "完成", 0],
      ])
    );
    await Promise.all([p1, p2]);
    const boardCallsBeforeForce = apiMock.mock.calls.filter((c) => c[0] === "/api/board");
    expect(boardCallsBeforeForce).toHaveLength(1); // 去重生效：第二次非 force 未发请求

    apiMock
      .mockResolvedValueOnce(
        board([
          ["todo", "待办", 0],
          ["done", "完成", 0],
        ])
      ) // 3) force 新请求
      .mockResolvedValueOnce(CURRENT); // 4) current?force=1
    const p3 = store.refreshBoard(true); // force → 必须发起新请求（不被 in-flight 阻塞）
    await p3;

    expect(apiMock.mock.calls).toHaveLength(4);
    expect(apiMock.mock.calls[2][0]).toBe("/api/board");
    expect(apiMock.mock.calls[2][1]).toEqual({ etag: false });
    expect(apiMock.mock.calls[3][0]).toBe("/api/boards/current?force=1");
  });

  it("switchBoard 切换看板后强制拉新（防旧板 ETag 串板 304）", async () => {
    store.currentBoard = { slug: "old", name: "旧板" };
    apiMock
      .mockResolvedValueOnce({}) // 1) POST /api/boards/new/switch
      .mockResolvedValueOnce([{ slug: "new", name: "新板" }]) // 2) /api/boards
      .mockResolvedValueOnce({ slug: "new", name: "新板" }) // 3) /api/boards/current
      .mockResolvedValueOnce(
        board([
          ["todo", "待办", 0],
          ["done", "完成", 1],
        ])
      ) // 4) /api/board
      .mockResolvedValueOnce({ slug: "new", name: "新板" }); // 5) /api/boards/current?force=1
    await store.switchBoard("new");

    const calls = apiMock.mock.calls;
    expect(calls).toHaveLength(5);
    expect(calls[0][0]).toBe("/api/boards/new/switch");
    expect(calls[3][0]).toBe("/api/board");
    expect(calls[3][1]).toEqual({ etag: false }); // 切板后的 board 请求必须是 force
    expect(calls[4][0]).toBe("/api/boards/current?force=1");
    expect(store.board.statuses.find((c) => c.status === "done").count).toBe(1);
  });
});
