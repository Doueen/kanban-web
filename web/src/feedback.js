/* feedback.js — Kanban Web 统一操作提示封装（操作提示清单 v1.0 §4）
 * 纯 JS 模块：只新增本文件，不触碰 vite.config.js / package.json / 构建链（E2 不执行）。
 * 入口：
 *   ok(msg, {duration=1500, position, type})       成功提示（绿，默认 1500ms）
 *   fail(msg, {duration=3000, retry, retryLabel})  失败提示（红，默认 3000ms；retry 时自绘带重试按钮）
 *   confirm({title, message, confirmText, danger}) 危险操作二次确认（danger 红 / 默认琥珀；取消静默返回 false）
 *   loading(msg, {duration=12000, forbidClick})    确定性等待（转圈，12s 上限）
 *   snackbar(msg, {actionText, onAction, duration=5000, danger}) 底部撤销条（自绘，含操作按钮）
 * 文案常量集中在 COPY；样式追加在 style.css 末尾的覆盖块。
 */
import { showToast, showConfirmDialog } from "vant";

/* ---------- 颜色语义（清单 §2.2：成功绿 / 失败红 / 警示琥珀 / 危险红） ---------- */
export const FB_COLORS = {
  danger: "#ff5c6c", // 不可逆操作确认按钮
  warn: "#ffb86c", // 可恢复操作确认按钮 / 警示
};

/* ---------- 文案常量（清单 §3 各条，集中管理，杜绝散落字符串） ---------- */
export const COPY = {
  ok: {
    created: (id) => `已创建 ${id}`,
    resultSaved: "结果已保存",
    assign: "已更新指派",
    model: "已更新模型覆盖",
    comment: "评论已发布",
    upload: "上传成功",
    attachDel: "附件已删除",
    linkAdd: "依赖已添加",
    linkDel: "依赖已解除",
    subscribe: "已订阅",
    unsubscribe: "已取消订阅",
    archiveTask: "已归档",
    boardArchive: "看板已归档",
    boardRestore: "看板已恢复",
    boardDelete: "看板已永久删除",
    boardCreate: "看板创建成功",
    boardRename: "重命名成功",
    workdirSet: "工作目录已设置",
    workdirClear: "工作目录已清除",
    theme: "主题已切换",
    switched: (name) => `已切换到「${name}」`,
    batch: (label, okCount, failCount) =>
      `${label} ${okCount} 个${failCount ? "，失败 " + failCount : ""}`,
    download: "下载成功",
  },
  /* 失败统一「<操作>失败: <原因>」；服务端原因透传，前端不预判（清单 §1.2-2） */
  fail: (op, reason) => `${op}失败: ${reason}`,
  failShort: (reason) => `失败: ${reason}`,
  /* 内联校验类固定文案（客户端可判定） */
  validate: {
    title: "标题不能为空",
    goal: "目标不能为空",
    workers: "至少需要一个 worker profile",
    swarmRoles: "verifier 和 synthesizer 必填",
    comment: "评论不能为空",
    file: "请选择文件",
    linkId: "请输入任务 ID",
    platform: "请选择消息平台",
    notifyTask: "请输入或选择任务",
    slug: "slug 不能为空",
    name: "名称不能为空",
    result: "结果不能为空",
    json: "元数据不是合法 JSON",
    batchEmpty: "请先选择任务",
  },
  /* 确认弹窗（清单 §3 B3/E4/E6/B4 + G1） */
  confirm: {
    archiveTask: {
      title: "归档任务",
      message: "确定要归档该任务吗？归档后可在列表页勾选「含归档」查看。",
      confirmText: "归档",
    },
    archiveBoard: (name) => ({
      title: "归档看板",
      message: `确认归档「${name}」？（可恢复）`,
      confirmText: "归档",
    }),
    deleteBoard: (name) => ({
      title: "永久删除",
      message: `确认永久删除「${name}」？此操作不可恢复！`,
      confirmText: "永久删除",
    }),
    batch: (label, n) => ({
      title: `批量${label}`,
      message: `对 ${n} 个任务执行「${label}」？`,
      confirmText: label,
    }),
  },
  /* 其它固定文案 */
  misc: {
    movedTo: (st) => `已移动到「${st}」`,
    cannotMoveTo: (st) => `无法移动到「${st}」`,
    noOtherBoard: "暂无其他看板",
    loading: {
      specify: "AI 细化中…可能需要 1-3 分钟",
      decompose: "AI 分解中…可能需要 1-3 分钟",
      claim: "认领中…",
      heartbeat: "发送心跳中…",
      default: "处理中…",
    },
  },
};

/* ---------- 自绘 Snackbar 撤销条（清单 §4.1：Vant Toast 不支持按钮，必须自绘） ---------- */
let snackEl = null;
let snackTimer = null;

function clearSnackTimer() {
  if (snackTimer) {
    clearTimeout(snackTimer);
    snackTimer = null;
  }
}

export function closeSnackbar() {
  clearSnackTimer();
  if (snackEl) {
    snackEl.remove();
    snackEl = null;
  }
}

/**
 * 底部撤销条：自动 5s 消失 + 手动关闭（✕）；actionText 存在时渲染操作按钮。
 * ARIA：role="status" aria-live="polite"；按钮为原生 button（键盘可访问）。
 */
export function snackbar(msg, { actionText, onAction, duration = 5000, danger = false } = {}) {
  closeSnackbar();
  const el = document.createElement("div");
  el.className = "fb-snackbar" + (danger ? " fb-snackbar-danger" : "");
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");

  const text = document.createElement("span");
  text.className = "fb-snack-msg";
  text.textContent = msg;
  el.appendChild(text);

  if (actionText && typeof onAction === "function") {
    const act = document.createElement("button");
    act.className = "fb-snack-action";
    act.type = "button";
    act.textContent = actionText;
    act.addEventListener("click", () => {
      closeSnackbar();
      onAction();
    });
    el.appendChild(act);
  }

  const close = document.createElement("button");
  close.className = "fb-snack-close";
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.textContent = "✕";
  close.addEventListener("click", closeSnackbar);
  el.appendChild(close);

  document.body.appendChild(el);
  if (duration > 0) snackTimer = setTimeout(closeSnackbar, duration);
  return closeSnackbar;
}

/* ---------- 自绘带重试按钮的失败提示（M2-1 乐观更新失败重试用；Vant Toast 无按钮） ---------- */
function failWithRetry(msg, retry, retryLabel) {
  closeSnackbar();
  const el = document.createElement("div");
  el.className = "fb-snackbar fb-snackbar-fail";
  el.setAttribute("role", "alert");
  el.setAttribute("aria-live", "assertive");

  const text = document.createElement("span");
  text.className = "fb-snack-msg";
  text.textContent = msg;
  el.appendChild(text);

  const act = document.createElement("button");
  act.className = "fb-snack-action";
  act.type = "button";
  act.textContent = retryLabel || "重试";
  act.addEventListener("click", () => {
    closeSnackbar();
    retry();
  });
  el.appendChild(act);

  const close = document.createElement("button");
  close.className = "fb-snack-close";
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.textContent = "✕";
  close.addEventListener("click", closeSnackbar);
  el.appendChild(close);

  document.body.appendChild(el);
  snackTimer = setTimeout(closeSnackbar, 3000);
}

/* ---------- 四个统一入口（清单 §4.1） ---------- */

/** 成功提示：绿，默认 1500ms；主题切换保持现网 1200ms（传 duration）。 */
export function ok(msg, { duration = 1500, position, type = "success" } = {}) {
  showToast({ message: msg, type, duration, position });
}

/** 失败提示：红，默认 3000ms（保证错误信息可读完）；retry 时自绘重试按钮（3000ms）。 */
export function fail(msg, { duration = 3000, retry, retryLabel } = {}) {
  if (retry) {
    failWithRetry(msg, retry, retryLabel);
    return;
  }
  showToast({ message: msg, type: "fail", duration, ariaLive: "assertive" });
}

/**
 * 危险/不可逆/批量操作二次确认（清单 §2.6：焦点移入弹窗、关闭后归还触发元素；Esc 取消）。
 * danger=true → 红色确认按钮（E6 永久删除 / B4 批量）；默认琥珀（B3 归档 / E4 看板归档）。
 * 取消静默返回 false；确认返回 true。
 */
export function confirm({
  title,
  message,
  confirmText = "确定",
  danger = false,
  confirmButtonColor,
} = {}) {
  const prevFocus = document.activeElement;
  return showConfirmDialog({
    title,
    message,
    confirmButtonText: confirmText,
    confirmButtonColor: confirmButtonColor || (danger ? FB_COLORS.danger : FB_COLORS.warn),
    closeOnClickOverlay: true,
  })
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      try {
        if (prevFocus && prevFocus.focus) prevFocus.focus();
      } catch (_) {
        /* 触发元素可能已销毁 */
      }
    });
}

/** 确定性等待：loading 转圈，12s 上限；GC/DB 检查等手动关闭场景传 duration=0（返回 toast 实例可 close()）。 */
export function loading(msg, { duration = 12000, forbidClick = false } = {}) {
  return showToast({ message: msg, type: "loading", duration, forbidClick });
}

/* 统一导出（兼容 import * as fb 与具名导入） */
export default { ok, fail, confirm, loading, snackbar, closeSnackbar, COPY, FB_COLORS };
