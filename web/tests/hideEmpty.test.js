// @vitest-environment happy-dom
/* t_bcf7c7bd — 一键隐藏/恢复空列（store 动作 + BoardChips 开关组件）。
 * api() 全部 mock；折叠状态断言基于 store.collapsed / isColFolded。
 *
 * 覆盖验收点：
 *   1) 一次点击折叠所有空列（非空列不动）；
 *   2) 再次点击恢复所有空列；
 *   3) 非空列永不隐藏（数据到达/乐观迁移后折叠中的非空列立即展开）；
 *   4) 模式开启期间看板数据到达维持不变量（新变空的列折叠、手动展开被尊重）；
 *   5) 单列筛选模式的当前列不参与折叠；
 *   6) 开关持久化（kb-hide-empty）+ BoardChips 按钮态/文案/aria-pressed。
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

/* 构造 /api/board 载荷；count 与 tasks 长度保持一致（与真实后端契约一致） */
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

describe("toggleHideEmpty：一次点击折叠/恢复所有空列", () => {
  it("开启：折叠所有 count===0 的列，非空列不动；持久化 kb-hide-empty=1", () => {
    store.board = board([
      ["triage", "待梳理", 0],
      ["todo", "待办", 3],
      ["ready", "就绪", 0],
      ["running", "运行中", 1],
    ]);
    store.toggleHideEmpty();
    expect(store.hideEmpty).toBe(true);
    expect(localStorage.getItem("kb-hide-empty")).toBe("1");
    expect(store.collapsed.triage).toBe(true);
    expect(store.collapsed.ready).toBe(true);
    expect(store.collapsed.todo).toBeUndefined(); // 非空列不受影响
    expect(store.collapsed.running).toBeUndefined();
    expect(store.isColFolded({ status: "triage", count: 0 })).toBe(true);
    expect(store.isColFolded({ status: "todo", count: 3 })).toBe(false);
  });

  it("开启（force）：此前手动展开的空列也会被折叠", () => {
    store.board = board([["triage", "待梳理", 0]]);
    store.setCollapsed("triage", false); // 用户此前手动展开
    store.toggleHideEmpty();
    expect(store.collapsed.triage).toBe(true);
  });

  it("关闭：恢复所有空列；非空列的手动折叠保持原样", () => {
    store.board = board([
      ["triage", "待梳理", 0],
      ["todo", "待办", 3],
      ["running", "运行中", 1],
    ]);
    store.toggleHideEmpty(); // ON：triage 折叠
    store.setCollapsed("running", true); // 用户手动折叠非空列
    store.toggleHideEmpty(); // OFF
    expect(store.hideEmpty).toBe(false);
    expect(localStorage.getItem("kb-hide-empty")).toBe("0");
    expect(store.collapsed.triage).toBe(false); // 空列恢复
    expect(store.collapsed.running).toBe(true); // 非空列手动折叠不被触碰
    expect(store.collapsed.todo).toBeUndefined();
  });

  it("模式关闭时看板数据到达不触碰任何折叠状态", async () => {
    store.board = board([["triage", "待梳理", 0]]);
    apiMock.mockResolvedValueOnce(board([["triage", "待梳理", 2]])).mockResolvedValueOnce({
      slug: "daily",
      name: "daily",
    });
    await store.refreshBoard();
    expect(store.collapsed.triage).toBeUndefined();
  });
});

describe("_enforceHideEmpty：开启期间数据到达维持不变量", () => {
  it("新变空的列折叠；折叠中的非空列立即展开", async () => {
    store.board = board([
      ["triage", "待梳理", 2],
      ["todo", "待办", 0],
      ["ready", "就绪", 0],
    ]);
    store.toggleHideEmpty(); // ON：todo/ready 折叠，triage 不动
    expect(store.collapsed.todo).toBe(true);
    expect(store.collapsed.ready).toBe(true);

    // 数据刷新：triage 清空、todo 有新卡
    apiMock.mockResolvedValueOnce(board([["triage", "待梳理", 0], ["todo", "待办", 1], ["ready", "就绪", 0]])).mockResolvedValueOnce({
      slug: "daily",
      name: "daily",
    });
    await store.refreshBoard();
    expect(store.collapsed.triage).toBe(true); // 新变空 → 折叠
    expect(store.collapsed.todo).toBe(false); // 非空 → 展开
    expect(store.collapsed.ready).toBe(true); // 仍空 → 保持折叠
  });

  it("手动展开的空列在数据到达时被尊重（不强制回折）", async () => {
    store.board = board([
      ["triage", "待梳理", 0],
      ["todo", "待办", 1],
    ]);
    store.toggleHideEmpty(); // ON：triage 折叠
    store.setCollapsed("triage", false); // 用户手动展开
    apiMock.mockResolvedValueOnce(board([["triage", "待梳理", 0], ["todo", "待办", 1]])).mockResolvedValueOnce({
      slug: "daily",
      name: "daily",
    });
    await store.refreshBoard();
    expect(store.collapsed.triage).toBe(false); // 尊重手动展开
  });

  it("单列筛选模式的当前列不参与折叠（避免 56px 窄条）", () => {
    store.board = board([
      ["triage", "待梳理", 0],
      ["todo", "待办", 0],
    ]);
    store.boardFilter = "triage";
    store.toggleHideEmpty();
    expect(store.collapsed.triage).toBeUndefined(); // 当前列跳过
    expect(store.collapsed.todo).toBe(true); // 其他空列照常折叠
  });
});

describe("乐观迁移：移动卡片后立即维持不变量", () => {
  it("卡片移入折叠空列 → 目标列立即展开；源列清空 → 立即折叠", () => {
    store.board = board([
      ["triage", "待梳理", 0],
      ["todo", "待办", 1],
    ]);
    store.toggleHideEmpty(); // ON：triage 折叠
    store._optimisticMoveBoard("t_todo_0", "triage");
    expect(store.collapsed.triage).toBe(false); // 有卡即展
    expect(store.collapsed.todo).toBe(true); // 清空即折
    expect(store.isColFolded({ status: "todo", count: 0 })).toBe(true);
  });

  it("模式关闭时乐观迁移不触碰折叠状态", () => {
    store.board = board([
      ["triage", "待梳理", 0],
      ["todo", "待办", 1],
    ]);
    store._optimisticMoveBoard("t_todo_0", "triage");
    expect(store.collapsed.triage).toBeUndefined();
    expect(store.collapsed.todo).toBeUndefined();
  });
});

describe("BoardChips 开关组件", () => {
  it("渲染按钮；点击切换 hideEmpty、文案与 aria-pressed 同步", async () => {
    const { mount } = await import("@vue/test-utils");
    const { default: BoardChips } = await import("../src/components/BoardChips.vue");
    store.board = board([
      ["triage", "待梳理", 0],
      ["todo", "待办", 1],
    ]);
    const wrapper = mount(BoardChips, { global: { plugins: [pinia] } });
    const btn = wrapper.find("button.hide-empty-chip");
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("隐藏空列");
    expect(btn.attributes("aria-pressed")).toBe("false");
    await btn.trigger("click");
    expect(store.hideEmpty).toBe(true);
    expect(btn.text()).toContain("显示空列");
    expect(btn.attributes("aria-pressed")).toBe("true");
    expect(btn.classes()).toContain("active");
    await btn.trigger("click");
    expect(store.hideEmpty).toBe(false);
    expect(btn.text()).toContain("隐藏空列");
  });
});
