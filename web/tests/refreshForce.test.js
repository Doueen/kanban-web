// @vitest-environment happy-dom
/* t_e564bf47 — 组件级回归：手动下拉/⟳ 刷新必须走 force=true（绕过 ETag）。
 *
 * t_3ad4fe46 修复：BoardView.onRefresh / ListView.onRefresh 从
 * refreshBoard() 改为 refreshBoard(true) —— 否则同秒变更被 304 短路，
 * 完成列（及所有列）漏显。
 * 钉住组件 → 事件 → store 的接线：从真实用户手势（van-pull-refresh 的
 * refresh 事件）触发，验证 store.refreshBoard 收到 force=true。
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
import { flushPromises, mount } from "@vue/test-utils";

/* van-pull-refresh 桩：渲染插槽并透出 refresh 事件（组件本身由 Vant 全局注册，
   测试环境不装 Vant 插件，以最小桩替代，保持手势接线可测） */
const PullRefreshStub = {
  name: "van-pull-refresh",
  template: "<div><slot /></div>",
  emits: ["refresh"],
};
const SkeletonStub = { name: "van-skeleton", template: "<div />" };

let store;
let pinia;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  pinia = createPinia();
  setActivePinia(pinia);
  store = useAppStore();
  apiMock.mockReset();
});
afterEach(() => {
  apiMock.mockReset();
  vi.restoreAllMocks();
});

async function mountView(path) {
  const { default: View } = await import(path);
  const wrapper = mount(View, {
    global: {
      plugins: [pinia],
      stubs: {
        "van-pull-refresh": PullRefreshStub,
        "van-skeleton": SkeletonStub,
        BoardChips: true,
        BoardDots: true,
        BoardColumn: true,
        PagerBar: true,
      },
    },
  });
  const pull = wrapper.findComponent({ name: "van-pull-refresh" });
  return { wrapper, pull };
}

describe("组件接线：下拉刷新 → refreshBoard(true)", () => {
  it("BoardView：用户下拉刷新触发 force 拉新（done 列同秒变更不漏显）", async () => {
    const refreshSpy = vi.spyOn(store, "refreshBoard").mockResolvedValue(undefined);
    const { pull } = await mountView("../src/views/BoardView.vue");

    pull.vm.$emit("refresh"); // 等价于用户下拉
    await flushPromises();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(true); // 修复前为 refreshBoard() → false
  });

  it("ListView：下拉刷新先 force 拉 board，再重拉任务列表", async () => {
    const refreshSpy = vi.spyOn(store, "refreshBoard").mockResolvedValue(undefined);
    const tasksSpy = vi.spyOn(store, "refreshTasks").mockResolvedValue(undefined);
    const { pull } = await mountView("../src/views/ListView.vue");

    pull.vm.$emit("refresh");
    await flushPromises();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(true);
    expect(tasksSpy).toHaveBeenCalledTimes(1);
  });
});
