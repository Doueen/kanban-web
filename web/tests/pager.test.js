// @vitest-environment happy-dom
/* t_c4de700c — PagerBar.vue 组件测试（@vue/test-utils + happy-dom）。
 * 覆盖验收点：total<=pageSize 隐藏 / total>pageSize 显示、
 *       当前页高亮（.active + aria-current="page"）、
 *       首页禁用上一页、末页禁用下一页、loading 全禁用、
 *       页码点击走 store.setPage、键盘 ←/→、页码窗口折叠、meta 文案。
 * store.setPage 全部 spy：翻页副作用（URL/拉取）由 pagination.store.test.js 覆盖。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PagerBar from "../src/components/PagerBar.vue";
import { useAppStore } from "../src/store";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../src/api", () => ({
  api: (...args) => apiMock(...args),
  apiText: vi.fn(),
  jsonOpts: vi.fn(),
}));

function mountPager(state = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useAppStore();
  store.authed = true;
  store.sortBy = "";
  Object.assign(store, {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    tasksLoading: false,
    ...state,
  });
  const wrapper = mount(PagerBar, { global: { plugins: [pinia] } });
  return { wrapper, store };
}

const btn = (wrapper, label) => wrapper.find(`button[aria-label="${label}"]`);

describe("可见性：total 与 pageSize 的关系", () => {
  it("total <= pageSize（单页）→ 分页器不渲染", () => {
    const { wrapper } = mountPager({ total: 10, pageSize: 20, totalPages: 1 });
    expect(wrapper.find("nav.pager").exists()).toBe(false);
  });

  it("total = 0（无结果）→ 不渲染", () => {
    const { wrapper } = mountPager({ total: 0, pageSize: 20, totalPages: 0 });
    expect(wrapper.find("nav.pager").exists()).toBe(false);
  });

  it("total > pageSize（多页）→ 渲染，带 role=navigation + aria-label", () => {
    const { wrapper } = mountPager({ total: 64, pageSize: 20, totalPages: 4 });
    const nav = wrapper.find("nav.pager");
    expect(nav.exists()).toBe(true);
    expect(nav.attributes("role")).toBe("navigation");
    expect(nav.attributes("aria-label")).toBe("分页");
  });
});

describe("当前页高亮", () => {
  it("第 2 页：按钮 .active + aria-current=page，其他页无", () => {
    const { wrapper } = mountPager({ page: 2, total: 64, pageSize: 20, totalPages: 4 });
    const cur = btn(wrapper, "第 2 页");
    expect(cur.classes()).toContain("active");
    expect(cur.attributes("aria-current")).toBe("page");
    expect(btn(wrapper, "第 1 页").attributes("aria-current")).toBeUndefined();
    expect(btn(wrapper, "第 1 页").classes()).not.toContain("active");
  });
});

describe("边界禁用", () => {
  it("第 1 页：上一页禁用、下一页可用", () => {
    const { wrapper } = mountPager({ page: 1, total: 64, pageSize: 20, totalPages: 4 });
    expect(btn(wrapper, "上一页").attributes("disabled")).toBeDefined();
    expect(btn(wrapper, "下一页").attributes("disabled")).toBeUndefined();
  });

  it("最后一页：下一页禁用、上一页可用", () => {
    const { wrapper } = mountPager({ page: 4, total: 64, pageSize: 20, totalPages: 4 });
    expect(btn(wrapper, "下一页").attributes("disabled")).toBeDefined();
    expect(btn(wrapper, "上一页").attributes("disabled")).toBeUndefined();
  });

  it("loading 中：所有按钮禁用", () => {
    const { wrapper } = mountPager({
      page: 2,
      total: 64,
      pageSize: 20,
      totalPages: 4,
      tasksLoading: true,
    });
    for (const b of wrapper.findAll("button")) {
      expect(b.attributes("disabled")).toBeDefined();
    }
  });
});

describe("翻页交互走 store.setPage", () => {
  it("点页码按钮 → setPage(该页)", async () => {
    const { wrapper, store } = mountPager({ page: 2, total: 64, pageSize: 20, totalPages: 4 });
    const spy = vi.spyOn(store, "setPage").mockResolvedValue(undefined);
    await btn(wrapper, "第 3 页").trigger("click");
    expect(spy).toHaveBeenCalledWith(3);
  });

  it("点下一页/上一页 → setPage(page±1)", async () => {
    const { wrapper, store } = mountPager({ page: 2, total: 64, pageSize: 20, totalPages: 4 });
    const spy = vi.spyOn(store, "setPage").mockResolvedValue(undefined);
    await btn(wrapper, "下一页").trigger("click");
    expect(spy).toHaveBeenCalledWith(3);
    await btn(wrapper, "上一页").trigger("click");
    expect(spy).toHaveBeenCalledWith(1);
  });

  it("点当前页按钮 → 不调用（go 幂等）", async () => {
    const { wrapper, store } = mountPager({ page: 2, total: 64, pageSize: 20, totalPages: 4 });
    const spy = vi.spyOn(store, "setPage").mockResolvedValue(undefined);
    await btn(wrapper, "第 2 页").trigger("click");
    expect(spy).not.toHaveBeenCalled();
  });

  it("键盘 ←/→：容器内 ArrowRight 翻下一页、ArrowLeft 翻上一页", async () => {
    const { wrapper, store } = mountPager({ page: 2, total: 64, pageSize: 20, totalPages: 4 });
    const spy = vi.spyOn(store, "setPage").mockResolvedValue(undefined);
    const nav = wrapper.find("nav.pager");
    await nav.trigger("keydown", { key: "ArrowRight" });
    expect(spy).toHaveBeenCalledWith(3);
    await nav.trigger("keydown", { key: "ArrowLeft" });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it("第 1 页按 ← 不翻页（边界守卫）", async () => {
    const { wrapper, store } = mountPager({ page: 1, total: 64, pageSize: 20, totalPages: 4 });
    const spy = vi.spyOn(store, "setPage").mockResolvedValue(undefined);
    await wrapper.find("nav.pager").trigger("keydown", { key: "ArrowLeft" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("页码窗口折叠（>7 页）", () => {
  it("10 页第 5 页：1 … 4 5 6 … 10，省略号为 aria-hidden span", () => {
    const { wrapper } = mountPager({ page: 5, total: 200, pageSize: 20, totalPages: 10 });
    // 页码按钮 = 排除上一页/下一页（.pager-prev/.pager-next）
    const labels = wrapper
      .findAll("button.pager-btn:not(.pager-prev):not(.pager-next)")
      .map((b) => b.attributes("aria-label"));
    expect(labels).toEqual(["第 1 页", "第 4 页", "第 5 页", "第 6 页", "第 10 页"]);
    const ellipses = wrapper.findAll("span.pager-ellipsis");
    expect(ellipses).toHaveLength(2);
    expect(ellipses[0].attributes("aria-hidden")).toBe("true");
  });
});

describe("meta 文案", () => {
  it("显示 第 x / y 页 · z 条", () => {
    const { wrapper } = mountPager({ page: 2, total: 64, pageSize: 20, totalPages: 4 });
    expect(wrapper.find(".pager-meta").text()).toContain("第 2 / 4 页 · 64 条");
  });

  it("loading 时显示「加载中…」", () => {
    const { wrapper } = mountPager({
      page: 2,
      total: 64,
      pageSize: 20,
      totalPages: 4,
      tasksLoading: true,
    });
    expect(wrapper.find(".pager-meta").text()).toContain("加载中");
  });
});
