/* M1-6 E11: vitest 骨架 —— store.js 纯函数
 * actionLabel / actionForTarget / menuItems
 *
 * actionForTarget 的映射与 CLI 动词集一一对应（CLI 是写操作权威）：
 *   无 triage / done→todo 动词 → 对应目标状态返回 null → MoveSheet 灰化禁用。
 */
import { describe, it, expect } from "vitest";
import { actionLabel, actionForTarget, menuItems } from "../src/store";

describe("actionLabel", () => {
  it("maps known actions to Chinese labels", () => {
    expect(actionLabel("complete")).toBe("完成");
    expect(actionLabel("block")).toBe("阻塞");
    expect(actionLabel("unblock")).toBe("解阻塞");
    expect(actionLabel("schedule")).toBe("定时");
    expect(actionLabel("promote")).toBe("提就绪");
    expect(actionLabel("request-review")).toBe("提评审");
    expect(actionLabel("request-changes")).toBe("退回修改");
    expect(actionLabel("reopen-review")).toBe("重新评审");
    expect(actionLabel("archive")).toBe("归档");
    expect(actionLabel("reclaim")).toBe("回收运行");
    expect(actionLabel("claim")).toBe("认领");
    expect(actionLabel("heartbeat")).toBe("心跳");
    expect(actionLabel("specify")).toBe("AI 细化");
    expect(actionLabel("decompose")).toBe("AI 分解");
  });
  it("unknown action passes through", () => {
    expect(actionLabel("nosuch")).toBe("nosuch");
  });
});

describe("actionForTarget (M1-5 E10 迁移映射，对齐 CLI 动词集)", () => {
  const t = (status) => ({ id: "t_x", title: "x", status });
  it.each([
    // [任务状态, 目标状态, 期望动作]
    ["ready", "done", "complete"],
    ["ready", "blocked", "block"],
    ["ready", "review", "request-review"],
    ["ready", "scheduled", "schedule"],
    ["todo", "ready", "promote"],
    ["scheduled", "ready", "unblock"],
    ["blocked", "ready", "unblock"],
    ["review", "ready", "reopen-review"],
    ["blocked", "todo", "unblock"],
    ["scheduled", "todo", "unblock"],
    ["review", "todo", "reopen-review"],
    ["todo", "archived", "archive"],
    ["done", "archived", "archive"],
  ])("%s → %s ⇒ %s", (from, to, action) => {
    expect(actionForTarget(t(from), to)).toEqual({ action });
  });
  it.each([
    // CLI 无对应动词 → null → 灰化禁用
    ["ready", "triage"],
    ["todo", "triage"],
    ["done", "todo"],
    ["done", "ready"],
    ["done", "blocked"], // block 仅 running|ready
    ["done", "scheduled"], // schedule 不含 done
    ["archived", "done"], // complete 不含 archived
    ["archived", "ready"],
    ["archived", "scheduled"],
    ["todo", "blocked"], // block 仅 running|ready
    ["triage", "done"], // complete 不含 triage
    ["triage", "scheduled"], // schedule 不含 triage
    ["triage", "blocked"],
    ["running", "ready"],
    ["running", "todo"],
    ["ready", "ready"], // 同状态
    ["todo", "todo"],
  ])("%s → %s ⇒ null（禁用）", (from, to) => {
    expect(actionForTarget(t(from), to)).toBeNull();
  });
  it("unknown target status → null", () => {
    expect(actionForTarget(t("ready"), "nope")).toBeNull();
  });
});

describe("menuItems", () => {
  it("base items always present", () => {
    const items = menuItems({ id: "t_x", status: "todo" });
    const actions = items.map((i) => i.action);
    for (const a of ["view", "move", "assign", "child", "context", "log"]) {
      expect(actions).toContain(a);
    }
  });
  it("running: reclaim + heartbeat, no claim/specify/promote", () => {
    const actions = menuItems({ id: "t_x", status: "running" }).map((i) => i.action);
    expect(actions).toContain("reclaim");
    expect(actions).toContain("heartbeat");
    expect(actions).not.toContain("claim");
    expect(actions).not.toContain("specify");
    expect(actions).not.toContain("promote");
  });
  it("ready: claim only", () => {
    const actions = menuItems({ id: "t_x", status: "ready" }).map((i) => i.action);
    expect(actions).toContain("claim");
    expect(actions).not.toContain("reclaim");
  });
  it("triage: specify + decompose", () => {
    const actions = menuItems({ id: "t_x", status: "triage" }).map((i) => i.action);
    expect(actions).toContain("specify");
    expect(actions).toContain("decompose");
  });
  it("todo: promote only (not unblock)", () => {
    const actions = menuItems({ id: "t_x", status: "todo" }).map((i) => i.action);
    expect(actions).toContain("promote");
    expect(actions).not.toContain("unblock");
  });
  it("blocked: unblock + request-review", () => {
    const actions = menuItems({ id: "t_x", status: "blocked" }).map((i) => i.action);
    expect(actions).toContain("unblock");
    expect(actions).toContain("request-review");
    expect(actions).not.toContain("block");
  });
  it("scheduled: unblock + request-review, no schedule", () => {
    const actions = menuItems({ id: "t_x", status: "scheduled" }).map((i) => i.action);
    expect(actions).toContain("unblock");
    expect(actions).toContain("request-review");
    expect(actions).not.toContain("schedule");
  });
  it("review: request-changes + request-review（complete 保留：CLI 允许 review→done 审批）", () => {
    const actions = menuItems({ id: "t_x", status: "review" }).map((i) => i.action);
    expect(actions).toContain("request-changes");
    expect(actions).toContain("request-review");
  });
  it("done: edit-result only; no complete/block/schedule/archive", () => {
    const actions = menuItems({ id: "t_x", status: "done" }).map((i) => i.action);
    expect(actions).toContain("edit-result");
    for (const a of ["complete", "block", "schedule", "archive"]) {
      expect(actions).not.toContain(a);
    }
  });
  it("archived: no complete/block/schedule/archive (terminal)", () => {
    const actions = menuItems({ id: "t_x", status: "archived" }).map((i) => i.action);
    for (const a of ["complete", "block", "schedule", "archive"]) {
      expect(actions).not.toContain(a);
    }
  });
});
