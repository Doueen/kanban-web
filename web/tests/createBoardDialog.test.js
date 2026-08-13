// @vitest-environment happy-dom
/* t_a64d5aa5 — 设置页「创建 Board」由内联表单改为 van-dialog 弹窗。
 * api() / vant 全部 mock；van-dialog / van-field / van-button 用可控 stub
 * （stub 的 before-close 语义与 Vant 一致：resolve false 保持弹窗打开）。
 *
 * 覆盖验收点：
 *   1) 设置页不再渲染内联表单，点击「新建 Board」打开弹窗；
 *   2) 弹窗内保留全部 5 个字段（Slug/名称/描述/Icon/颜色）；
 *   3) 空 slug 提交 → 校验提示（COPY.validate.slug）+ 弹窗保持打开、不发请求；
 *   4) 有效提交 → POST /api/boards 载荷正确（trim + 空串转 undefined）、
 *      成功后弹窗关闭、表单重置；
 *   5) 创建失败（API 报错）→ 失败提示 + 弹窗保持打开可重试；
 *   6) 取消 / 点遮罩 → 不发请求、弹窗关闭。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../src/api", () => ({
  api: (...args) => apiMock(...args),
  apiText: vi.fn(),
  jsonOpts: (m, b) => ({ method: m, body: JSON.stringify(b) }),
}));
vi.mock("vant", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, showToast: vi.fn(), showConfirmDialog: vi.fn() };
});
/* 保留真实 COPY 文案，ok/fail 换 mock（断言提示调用） */
vi.mock("../src/feedback", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, ok: vi.fn(), fail: vi.fn() };
});

import { useAppStore } from "../src/store";
import { COPY, fail, ok } from "../src/feedback";
import SettingsView from "../src/views/SettingsView.vue";

/* Vant 组件 stub：before-close 返回 false 时不关闭（与 Vant 语义一致） */
const stubs = {
  "van-dialog": {
    props: ["show", "beforeClose"],
    emits: ["update:show"],
    template: `<div class="dlg" v-if="show"><slot />
      <button class="dlg-confirm" @click="fire('confirm')">确认</button>
      <button class="dlg-cancel" @click="fire('cancel')">取消</button>
      <button class="dlg-overlay" @click="fire('overlay')">遮罩</button>
    </div>`,
    methods: {
      async fire(a) {
        const r = await this.beforeClose(a);
        if (r !== false) this.$emit("update:show", false);
      },
    },
  },
  "van-field": {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<input class="fld" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  "van-button": {
    template: `<button @click="$emit('click')"><slot /></button>`,
  },
};

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
  vi.mocked(fail).mockClear();
  vi.mocked(ok).mockClear();
});
afterEach(() => {
  apiMock.mockReset();
});

function mountView() {
  return mount(SettingsView, { global: { plugins: [pinia], stubs } });
}

/* trigger() 只 flush 微任务，async 链（boardOp→loadBoards→refreshBoard）需额外等待 */
const settle = () => new Promise((r) => setTimeout(r, 30));

/* 成功创建的 API 应答链：POST /api/boards → loadBoards(/api/boards + current) → refreshBoard(/api/board + current) */
function successChain() {
  apiMock
    .mockResolvedValueOnce({ message: "看板创建成功" })
    .mockResolvedValueOnce([{ slug: "daily", name: "daily", default_workdir: null }])
    .mockResolvedValueOnce({ slug: "daily", name: "daily" })
    .mockResolvedValueOnce({ assignees: [], statuses: [] })
    .mockResolvedValueOnce({ slug: "daily" });
}

describe("设置页创建 Board 弹窗", () => {
  it("点击「新建 Board」打开弹窗，内含全部 5 个字段（不再是内联表单）", async () => {
    const wrapper = mountView();
    expect(wrapper.find(".create-board-btn").exists()).toBe(true);
    expect(wrapper.find(".settings-form").exists()).toBe(false); // 内联表单已移除
    await wrapper.find(".create-board-btn").trigger("click");
    expect(wrapper.find(".dlg").exists()).toBe(true);
    expect(wrapper.findAll(".dlg .fld")).toHaveLength(5); // slug/名称/描述/Icon/颜色
  });

  it("空 slug 提交 → 校验提示，弹窗保持打开，不发请求", async () => {
    const wrapper = mountView();
    await wrapper.find(".create-board-btn").trigger("click");
    await wrapper.find(".dlg .dlg-confirm").trigger("click");
    expect(fail).toHaveBeenCalledWith(COPY.validate.slug);
    expect(wrapper.find(".dlg").exists()).toBe(true);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("有效提交 → 载荷正确、成功后弹窗关闭、表单重置、列表刷新", async () => {
    const wrapper = mountView();
    await wrapper.find(".create-board-btn").trigger("click");
    const flds = wrapper.findAll(".dlg .fld");
    await flds[0].setValue("test-modal-board");
    await flds[1].setValue("  测试弹窗看板  ");
    await flds[2].setValue("描述");
    await flds[3].setValue("📋");
    await flds[4].setValue("#112233");
    successChain();
    await wrapper.find(".dlg .dlg-confirm").trigger("click");
    await settle();

    const [path, opts] = apiMock.mock.calls[0];
    expect(path).toBe("/api/boards");
    expect(JSON.parse(opts.body)).toEqual({
      slug: "test-modal-board",
      name: "测试弹窗看板", // trim 后提交
      description: "描述",
      icon: "📋",
      color: "#112233",
    });
    expect(ok).toHaveBeenCalled(); // 成功反馈
    expect(apiMock).toHaveBeenCalledTimes(5); // 创建 + loadBoards×2 + refreshBoard×2
    expect(wrapper.find(".dlg").exists()).toBe(false); // 弹窗关闭

    // 表单已重置：重新打开后 slug 为空
    await wrapper.find(".create-board-btn").trigger("click");
    expect(wrapper.findAll(".dlg .fld")[0].element.value).toBe("");
  });

  it("创建失败（API 报错）→ 失败提示，弹窗保持打开便于重试", async () => {
    const wrapper = mountView();
    await wrapper.find(".create-board-btn").trigger("click");
    await wrapper.findAll(".dlg .fld")[0].setValue("dup-slug");
    apiMock.mockRejectedValueOnce(new Error("slug 已存在"));
    await wrapper.find(".dlg .dlg-confirm").trigger("click");
    expect(fail).toHaveBeenCalledWith("创建失败: slug 已存在");
    expect(wrapper.find(".dlg").exists()).toBe(true);
  });

  it("取消 → 不发请求、弹窗关闭", async () => {
    const wrapper = mountView();
    await wrapper.find(".create-board-btn").trigger("click");
    await wrapper.findAll(".dlg .fld")[0].setValue("cancelled-board");
    await wrapper.find(".dlg .dlg-cancel").trigger("click");
    expect(apiMock).not.toHaveBeenCalled();
    expect(wrapper.find(".dlg").exists()).toBe(false);
  });

  it("点击遮罩（overlay）→ 不发请求、弹窗关闭", async () => {
    const wrapper = mountView();
    await wrapper.find(".create-board-btn").trigger("click");
    await wrapper.findAll(".dlg .fld")[0].setValue("overlay-board");
    await wrapper.find(".dlg .dlg-overlay").trigger("click");
    expect(apiMock).not.toHaveBeenCalled();
    expect(wrapper.find(".dlg").exists()).toBe(false);
  });
});
