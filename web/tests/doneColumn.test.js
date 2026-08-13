// @vitest-environment happy-dom
/* t_f2026416 — 完成任务显示回归保护（t_03792579 用户可见现象）。
 *
 * 覆盖验收点：
 *   1) store 层：refreshBoard 拉回的 /api/board 里 done 列任务必须完整保留
 *      （id/title/status 渲染三要素），不能只留 count；任务绝不能从其他列漏掉；
 *   2) 组件层：BoardColumn 收到含已完成任务的 done 列后，必须渲染出卡片
 *      （.card 元素 + 标题），空完成列则渲染空态文案；
 *   3) 回归防护方向：修复前是 SSE 推送链缺陷导致前端拿不到新数据、看板冻结，
 *      完成列"没有任务"——本测试钉住"数据到达后渲染"这一层契约。
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
  store.sortBy = "";
  apiMock.mockReset();
});
afterEach(() => {
  apiMock.mockReset();
});

describe("store 层：refreshBoard 保留 done 列任务数据", () => {
  it("done 列任务完整保留（id/title/status），count 与 tasks 一致", async () => {
    const payload = board([
      ["todo", "待办", 1],
      ["running", "运行中", 2],
      ["done", "完成", 3],
    ]);
    apiMock
      .mockResolvedValueOnce(payload)
      .mockResolvedValueOnce({ slug: "daily", name: "daily" }); // /api/boards/current
    await store.refreshBoard();

    const doneCol = store.board.statuses.find((c) => c.status === "done");
    expect(doneCol.count).toBe(3);
    expect(doneCol.tasks).toHaveLength(3);
    for (const t of doneCol.tasks) {
      expect(t.id).toMatch(/^t_done_\d$/);
      expect(t.title).toContain("任务");
      expect(t.status).toBe("done");
    }
    // 其他列不受影响
    const todoCol = store.board.statuses.find((c) => c.status === "todo");
    expect(todoCol.tasks).toHaveLength(1);
    expect(todoCol.tasks[0].status).toBe("todo");
  });

  it("done 列在 visibleCols 中可见（不因隐藏/筛选被剔除）", async () => {
    const payload = board([
      ["todo", "待办", 1],
      ["done", "完成", 2],
    ]);
    apiMock
      .mockResolvedValueOnce(payload)
      .mockResolvedValueOnce({ slug: "daily", name: "daily" });
    await store.refreshBoard();

    const statuses = store.visibleCols.map((c) => c.status);
    expect(statuses).toContain("done");
  });

  it("done 列没有任务时 count=0 且 tasks 为空数组（空态数据契约）", async () => {
    const payload = board([
      ["todo", "待办", 1],
      ["done", "完成", 0],
    ]);
    apiMock
      .mockResolvedValueOnce(payload)
      .mockResolvedValueOnce({ slug: "daily", name: "daily" });
    await store.refreshBoard();

    const doneCol = store.board.statuses.find((c) => c.status === "done");
    expect(doneCol.count).toBe(0);
    expect(doneCol.tasks).toEqual([]);
  });
});

describe("组件层：BoardColumn 渲染完成列卡片", () => {
  it("done 列含任务 → 渲染出对应数量的卡片（含标题）", async () => {
    const { mount } = await import("@vue/test-utils");
    const { default: BoardColumn } = await import("../src/components/BoardColumn.vue");
    const doneCol = {
      status: "done",
      label: "完成",
      count: 2,
      tasks: [
        { id: "t_done_0", title: "已完成任务甲", status: "done", priority: 0, assignee: null },
        { id: "t_done_1", title: "已完成任务乙", status: "done", priority: 0, assignee: null },
      ],
    };
    const wrapper = mount(BoardColumn, {
      props: { col: doneCol },
      global: { plugins: [pinia] },
    });
    const cards = wrapper.findAll(".card");
    expect(cards).toHaveLength(2);
    const text = wrapper.text();
    expect(text).toContain("已完成任务甲");
    expect(text).toContain("已完成任务乙");
  });

  it("单列模式下超过 50 条仍完整渲染，包含最后一条长标题任务", async () => {
    const { mount } = await import("@vue/test-utils");
    const { default: BoardColumn } = await import("../src/components/BoardColumn.vue");
    store.boardFilter = "done";
    const tasks = Array.from({ length: 61 }, (_, i) => ({
      id: `t_done_${i}`,
      title:
        i === 60
          ? "最后一条已完成任务——这是会换行的长标题，用于验证大量任务时不会因固定行高窗口计算而丢失"
          : `已完成任务${i}`,
      status: "done",
      priority: i % 4,
      assignee: i % 2 ? "developer-with-a-long-name" : null,
    }));
    const wrapper = mount(BoardColumn, {
      props: {
        col: { status: "done", label: "完成", count: tasks.length, tasks },
      },
      global: { plugins: [pinia] },
    });

    const cards = wrapper.findAll(".card");
    expect(cards).toHaveLength(61);
    const swipeCells = wrapper.findAll(".column-body > .board-task-card");
    expect(swipeCells).toHaveLength(61);
    expect(swipeCells[0].attributes("style")).toContain("flex-shrink: 0");
    expect(cards.at(60).text()).toContain("最后一条已完成任务");
    expect(wrapper.find('[aria-label^="打开任务：最后一条已完成任务"]').exists()).toBe(true);
  });

  it("done 列无任务 → 渲染空态文案，不渲染卡片", async () => {
    const { mount } = await import("@vue/test-utils");
    const { default: BoardColumn } = await import("../src/components/BoardColumn.vue");
    const emptyCol = {
      status: "done",
      label: "完成",
      count: 0,
      tasks: [],
    };
    const wrapper = mount(BoardColumn, {
      props: { col: emptyCol },
      global: { plugins: [pinia] },
    });
    expect(wrapper.findAll(".card")).toHaveLength(0);
    expect(wrapper.text()).toContain("暂无完成");
  });
});
