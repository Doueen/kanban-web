/* 自定义拖拽幽灵卡：跟随指针（translate3d + rAF 节流）+ 看板边缘自动横滚/列内纵滚。
   仅桌面 HTML5 拖拽使用（触屏端走长按 MoveSheet，不经过这里）。
   性能：只用 transform 定位，无 layout 触发；document 级 dragover 仅记录坐标，渲染集中在 rAF 循环。 */

let ghost = null;
let rafId = 0;
let active = false;
let lastX = 0;
let lastY = 0;

const EDGE = 64; // 边缘触发区宽度
const MAX_SPEED = 9; // 每帧最大滚动像素（~540px/s @60fps）

/** 1x1 透明画布，作为 setDragImage 的占位，隐藏系统默认拖拽缩略图（跟手性由自绘幽灵卡接管） */
export function transparentDragImage() {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  return c;
}

/** 开始跟手幽灵卡。statusClass 形如 "st-running"（提供 --c 状态色）。 */
export function startDragGhost(task, statusClass) {
  stopDragGhost();
  active = true;
  ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  if (statusClass) ghost.classList.add(statusClass);

  const title = document.createElement("span");
  title.className = "dg-title";
  title.textContent = task.title;

  const badge = document.createElement("span");
  badge.className = "dg-badge";
  badge.textContent = task.id;

  ghost.append(title, badge);
  document.body.appendChild(ghost);
  document.addEventListener("dragover", onDocDragOver, true);
  rafId = requestAnimationFrame(tick);
}

function onDocDragOver(e) {
  lastX = e.clientX;
  lastY = e.clientY;
}

function tick() {
  if (!active || !ghost) return;
  /* 跟手：偏移 (14,10) 让光标不遮住文字；2deg 微倾斜增加"抓取"手感 */
  ghost.style.transform = `translate3d(${lastX + 14}px, ${lastY + 10}px, 0) rotate(2deg)`;
  autoScroll();
  rafId = requestAnimationFrame(tick);
}

function autoScroll() {
  /* 看板横向边缘自动滚动 */
  const board = document.querySelector("#board-view .board");
  if (board) {
    const r = board.getBoundingClientRect();
    let dx = 0;
    if (lastX < r.left + EDGE && board.scrollLeft > 0) {
      dx = -((EDGE - (lastX - r.left)) / EDGE) * MAX_SPEED;
    } else if (lastX > r.right - EDGE) {
      dx = ((EDGE - (r.right - lastX)) / EDGE) * MAX_SPEED;
    }
    if (dx) board.scrollLeft += dx;
  }

  /* 指针所在列的纵向边缘自动滚动（长列表） */
  const under = document.elementFromPoint(lastX, lastY)?.closest?.(".column-body");
  if (under) {
    const cr = under.getBoundingClientRect();
    let dy = 0;
    if (lastY < cr.top + EDGE && under.scrollTop > 0) {
      dy = -((EDGE - (lastY - cr.top)) / EDGE) * MAX_SPEED;
    } else if (lastY > cr.bottom - EDGE) {
      dy = ((EDGE - (cr.bottom - lastY)) / EDGE) * MAX_SPEED;
    }
    if (dy) under.scrollTop += dy;
  }
}

export function stopDragGhost() {
  active = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  document.removeEventListener("dragover", onDocDragOver, true);
  if (ghost) {
    ghost.remove();
    ghost = null;
  }
}
