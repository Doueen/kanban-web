// @vitest-environment happy-dom
/* t_c4de700c — 分页 store 动作单测（happy-dom：URL 同步/防抖可断言）。
 * api() 全部 mock（信封契约由后端 pytest 覆盖）；URL 断言基于
 * history.replaceState 后的 window.location（无 router 的真实同步机制）。
 *
 * 覆盖：fetchTasks 带 page+page_size 拉取并解析信封、
 *       setPage 拉正确页 + URL 同步、同页去重、越界钳制、
 *       空页回退重拉、setPageSize 重置第 1 页、过滤变化防抖重置第 1 页、
 *       ?page= 重载恢复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../src/api", () => ({
  api: (...args) => apiMock(...args),
  apiText: vi.fn(),
  jsonOpts: vi.fn((m, b) => ({ method: m, body: JSON.stringify(b) })),
}));

import { useAppStore } from "../src/store";

/* 构造后端信封响应；items 默认生成该页应有的条数（id 形如 t_p<page>_<i>） */
function envelope(page, pageSize, total, items = null) {
  const totalPages = total ? Math.ceil(total / pageSize) : 0;
  const inPage = Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
  return {
    items: items ?? Array.from({ length: inPage }, (_, i) => ({ id: `t_p${page}_${i}` })),
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  };
}

let store;
beforeEach(() => {
  window.history.replaceState(null, "", "/"); // 每个用例干净的 URL
  setActivePinia(createPinia());
  store = useAppStore();
  store.authed = true;
  store.sortBy = ""; // 默认 sort=status 会进 URL，本文件聚焦分页参数，先清掉
  apiMock.mockReset();
});
afterEach(() => {
  apiMock.mockReset();
});

const pageParam = () => new URL(window.location.href).searchParams.get("page");

describe("fetchTasks：信封解析", () => {
  it("每次拉取必带 page+page_size，并写入 tasks/page/total/totalPages", async () => {
    apiMock.mockResolvedValue(envelope(2, 20, 50));
    store.page = 2;
    await store.fetchTasks();
    expect(apiMock).toHaveBeenCalledWith("/api/tasks?page=2&page_size=20");
    expect(store.tasks).toHaveLength(20);
    expect(store.page).toBe(2);
    expect(store.pageSize).toBe(20);
    expect(store.total).toBe(50);
    expect(store.totalPages).toBe(3);
    expect(store.tasksLoading).toBe(false);
    expect(store.tasksError).toBe("");
  });

  it("带 status/assignee/q/archived/sort 过滤参数", async () => {
    apiMock.mockResolvedValue(envelope(1, 20, 6));
    Object.assign(store, {
      listStatus: "todo",
      listAssignee: "alice",
      search: "分页",
      listArchived: true,
      sortBy: "created",
    });
    await store.fetchTasks();
    const url = apiMock.mock.calls[0][0];
    expect(url).toContain("page=1");
    expect(url).toContain("page_size=20");
    expect(url).toContain("status=todo");
    expect(url).toContain("assignee=alice");
    expect(url).toContain("q=%E5%88%86%E9%A1%B5"); // URLSearchParams 编码
    expect(url).toContain("archived=1");
    expect(url).toContain("sort=created");
  });

  it("请求失败：tasksError 落盘、loading 复位", async () => {
    apiMock.mockRejectedValue(new Error("boom"));
    await store.fetchTasks();
    expect(store.tasksError).toBe("boom");
    expect(store.tasksLoading).toBe(false);
  });
});

describe("setPage：拉正确页 + URL 同步", () => {
  beforeEach(() => {
    // 真实流程中 totalPages 由 fetchTasks 先填充；setPage 依赖它做钳制
    Object.assign(store, { page: 1, total: 50, pageSize: 20, totalPages: 3 });
  });

  it("setPage(2) → 请求 page=2、state 更新、URL ?page=2", async () => {
    apiMock.mockResolvedValue(envelope(2, 20, 50));
    await store.setPage(2);
    expect(apiMock).toHaveBeenCalledWith("/api/tasks?page=2&page_size=20");
    expect(store.page).toBe(2);
    expect(pageParam()).toBe("2");
  });

  it("已在该页 → 不重复拉取", async () => {
    store.page = 2;
    await store.setPage(2);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("越界钳制：0→第 1 页、999→最后一页（totalPages）", async () => {
    store.page = 2; // 让 setPage(0) 真的触发变更
    apiMock.mockResolvedValueOnce(envelope(1, 20, 50));
    await store.setPage(0);
    expect(store.page).toBe(1);
    apiMock.mockResolvedValueOnce(envelope(3, 20, 50));
    await store.setPage(999);
    expect(store.page).toBe(3);
    expect(apiMock).toHaveBeenLastCalledWith("/api/tasks?page=3&page_size=20");
  });

  it("空页回退：越界页返回空列表 → 钳制到最后有效页重拉", async () => {
    apiMock.mockResolvedValueOnce(envelope(99, 20, 50, [])); // items=[] total=50 → 99>3
    apiMock.mockResolvedValueOnce(envelope(3, 20, 50));
    store.page = 99;
    await store.fetchTasks();
    expect(store.page).toBe(3);
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[1][0]).toBe("/api/tasks?page=3&page_size=20");
    expect(pageParam()).toBe("3");
  });
});

describe("setPageSize：改每页条数 → 重置第 1 页", () => {
  it("setPageSize(50)：page 回 1、请求 page_size=50", async () => {
    apiMock.mockResolvedValue(envelope(1, 50, 120));
    store.page = 2;
    await store.setPageSize(50);
    expect(store.page).toBe(1);
    expect(store.pageSize).toBe(50);
    expect(apiMock).toHaveBeenCalledWith("/api/tasks?page=1&page_size=50");
    expect(pageParam()).toBe("1");
  });

  it("钳制 1..100", async () => {
    apiMock.mockResolvedValue(envelope(1, 100, 200));
    await store.setPageSize(500);
    expect(store.pageSize).toBe(100);
    apiMock.mockResolvedValue(envelope(1, 1, 200));
    await store.setPageSize(0);
    expect(store.pageSize).toBe(1);
  });
});

describe("initTasksWatch：过滤变化重置第 1 页", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("第 3 页时切换状态过滤 → 防抖 300ms 后 page=1 + 带新过滤拉取 + URL 同步", async () => {
    apiMock.mockResolvedValue(envelope(1, 20, 3));
    store.initTasksWatch();
    store.listStatus = "todo"; // 首次回调：建立基线（只记录，不重置）
    await vi.advanceTimersByTimeAsync(300); // 基线拉取
    expect(store.page).toBe(1);
    apiMock.mockClear();
    store.page = 3;
    store._syncPageUrl();
    store.listStatus = "done"; // 第二次变化：filterChanged → 重置第 1 页
    await vi.advanceTimersByTimeAsync(300);
    expect(store.page).toBe(1);
    expect(apiMock).toHaveBeenCalledWith("/api/tasks?page=1&page_size=20&status=done");
    expect(pageParam()).toBe("1");
  });

  it("已在第 1 页时过滤变化不重置（仍重拉）", async () => {
    apiMock.mockResolvedValue(envelope(1, 20, 50));
    store.initTasksWatch();
    store.listStatus = "done"; // 基线
    await vi.advanceTimersByTimeAsync(300);
    apiMock.mockClear();
    store.listStatus = "ready"; // 第 2 次变化：page 已是 1 → 不重置但重拉
    await vi.advanceTimersByTimeAsync(300);
    expect(store.page).toBe(1);
    expect(apiMock).toHaveBeenCalledWith("/api/tasks?page=1&page_size=20&status=ready");
  });

  it("重载场景：?page=2 恢复后，基线回调不重置页码（恢复值保留）", async () => {
    window.history.replaceState(null, "", "/?page=2");
    apiMock.mockResolvedValue(envelope(2, 20, 50));
    store.initTasksWatch();
    expect(store.page).toBe(2); // initPageFromUrl 恢复
    store.listStatus = "todo"; // 首次回调 = 基线：只记录不重置
    await vi.advanceTimersByTimeAsync(300);
    expect(store.page).toBe(2); // 未被重置到 1
    expect(apiMock).toHaveBeenCalledWith("/api/tasks?page=2&page_size=20&status=todo");
  });
});
