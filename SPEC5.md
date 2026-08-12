# Kanban 页手机 UX 优化 — 实施规格书 v5

项目：/opt/hermes/kanban-web/web/（Vue 3 + Vant 4 + Pinia，已上线 9120）。本次只改前端 `web/src/`，**禁止改动**：`src/store.js` 的数据获取/写操作逻辑（refreshBoard/runAction/openDetail/openMove 等 API 行为）、后端 app.py、数据库。所有样式放 `src/style.css`（追加或修改现有块），组件内联样式仅限动态值。

现有相关文件：`views/BoardView.vue`、`components/BoardColumn.vue`、`components/TaskCard.vue`、`components/BoardChips.vue`、`components/BoardDots.vue`、`components/MoveSheet.vue`、`App.vue`、`store.js`（含 `isMobile`、`mob.*` 开关、`boardFilter`、`collapsed` 折叠状态、`visibleCols`）。

## P0（6 项）

### 1. 卡片信息精简（TaskCard.vue + style.css）
- 移动端（`store.isMobile` 或 CSS media ≤619px）卡片仅显示：
  - 标题（**两行截断**：`display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden`）
  - 指派首字母圆（圆形 22px，背景色 = 状态色 var(--c)，文字 = 首字符大写）
  - 优先级 P 徽章（priority>0 时）
  - 状态色左缘条（3px，见 #6）
- 桌面端保持现状（完整 meta 行）
- 实现：TaskCard.vue 模板用 `v-if="store.isMobile"` 分支或 CSS 类 `.mob-card` 控制；不要移除桌面信息

### 2. chips 吸顶（BoardChips.vue + style.css）
- `.board-chips { position: sticky; top: 0; z-index: 20; }`（在 board-view 内吸顶）
- 背景需不透明（`background: var(--bg)` 或加 backdrop blur），滚动时不透内容
- 注意与顶栏（#topbar sticky）的层级：chips 在 main 内，topbar 在其上，z-index 20 即可

### 3. 折叠列徽章（BoardColumn.vue + style.css）
- 折叠态（folded class）下列头已有竖排标题 + ▸ 按钮；在竖排标题上方加**任务数徽章**：
  - `<span class="fold-count">{{ col.count }}</span>`，仅在 folded 时显示（v-if）
  - 样式：24px 圆角胶囊，`background: color-mix(in srgb, var(--c, #8b95ad) 18%, transparent)`，`color: var(--c)`，font 12px 等宽，margin-bottom 4px
  - `col.count > 0` 时加 `.has-tasks` 类（青色高亮：border 1px solid var(--accent)，color var(--accent)）
- 空列折叠时徽章显示 0 但弱化（opacity 0.5）

### 4. 骨架屏（BoardView.vue）
- `refreshing`/首次加载时：`store.board` 为空时显示 3 个 van-skeleton（`<van-skeleton title :row="3" />` 竖排，包在列形状容器里），替代现有"没有任务/加载中"
- 实现：`v-if="!store.board"` 分支渲染骨架；`v-else` 现有内容

### 5. 空状态升级（BoardColumn.vue）
- 每列空状态文案按状态定制：triage"待梳理·无积压"、todo"待办空空如也 🎉"、ready"没有就绪任务"、running"无运行中"、blocked"无阻塞 ✅"、scheduled"无定时任务"、review"无评审中"、done"暂无完成"、archived"归档无记录"
- 用现有 `.empty` 样式 + 对应文案（映射表放 BoardColumn.vue 内 const 对象）

### 6. 状态色左缘条（TaskCard.vue + style.css）
- 卡片 `::before` 或独立元素：`position:absolute; left:0; top:10px; bottom:10px; width:3px; border-radius:3px; background: var(--c, #8b95ad)`
- 已有 `.card` 的 st-* 类提供 --c；仅需加左缘条 CSS（全端生效，桌面也有益）
- 卡片需 `position: relative`

## P1（5 项）

### 7. 单列沉浸默认化（store.js 只加状态，BoardView.vue 改默认）
- store 加 `boardFilter` 初始值逻辑：**仅移动端**首次进入时设为"最近使用列"；记忆键 `kb-board-filter`（localStorage）
- BoardView onMounted：`if (store.isMobile) { const saved = localStorage.getItem('kb-board-filter'); if (saved && store.board?.statuses.some(c => c.status === saved)) store.boardFilter = saved; }`
- select(chip) 时：`localStorage.setItem('kb-board-filter', v)`（v !== 'all' 时；'all' 时删除）
- 桌面端默认保持 "all"（不动现有行为）
- **不改 visibleCols 等 store 核心逻辑**，只加这层记忆

### 8. 列头快捷操作（BoardColumn.vue）
- 列头点击（非折叠按钮、非 dots）→ `showToast` 引导 or 直接弹出 van-action-sheet：
  - 选项：只看此列（`store.boardFilter = col.status` + 记忆）、折叠/展开（toggleFold）、新建到此列（`store.openCreate({ parent: undefined, status 目标列 })`——若 store 有 openCreate 则用，否则跳转创建弹窗后提示）
  - 实现：`@click` 判断 `e.target.closest('.col-fold')` 时 return；否则 `showSheet = true`，`<van-action-sheet v-model:show="showSheet" :actions="colActions" @select="onColAction" />`
  - "只看此列"在桌面端也保留（有用）

### 9. 边缘返回（BoardView.vue 滑动切列逻辑内）
- 现有 onTouchEnd：单列模式左右滑动切列（60px 阈值）。增强：**当前列是 statuses 第一列（triage）且向右滑（dx>60）→ boardFilter = 'all'**
- 在现有 onTouchEnd 的 idx 计算前判断：`if (idx === 0 && dx > 60) { store.boardFilter = 'all'; return; }`
- 其他逻辑不动

### 10. 手势分区 + 触觉反馈（BoardView.vue / TaskCard.vue / store 不涉及）
- 切换列成功（onTouchEnd 实际切换）时：`navigator.vibrate?.(15)`
- 快捷完成/长按移动已带 vibrate（长按 30ms），完成操作后 `navigator.vibrate?.(10)`
- 下拉刷新成功（onRefresh 完成）：`navigator.vibrate?.(10)`
- 全部包 try（老浏览器无 vibrate）

### 11. dots 可点击（BoardDots.vue）
- 现有圆点（active 高亮）；改为可点击：`@click` → `store.boardFilter = statuses[i].status`（'all' 模式点击跳到对应列并进入单列；单列模式点击切换到该列）
- 尺寸：点击目标 ≥24px（外层 padding），active 点 16px 胶囊，其余 8px 圆点
- 记忆跟随 #7 的 kb-board-filter

## P2（4 项）

### 12. 邻页露头（BoardView.vue + style.css）
- 单列模式下列宽从 100% 改为 `calc(100% - 56px)`，右侧露出下一列 56px 边缘（板容器 overflow-x:auto 保留）
- 露头列显示：列头（状态点+名）竖向边缘 + 首张卡片边缘（可用现有 BoardColumn 渲染但加 `.edge` 类截断）
- 简化实现：单列模式渲染 `visibleCols` 当前列 + **下一列**（仅渲染列头 + 前 2 张卡片，加 `.peek` 类：width 56px、overflow hidden、pointer-events none 区域不响应（整列可点击切过去？点击露头列 → 切到该列））
- 复杂度控制：露头列点击 → `store.boardFilter = 该列`；不实现滑动跟随

### 13. 左滑三键（TaskCard.vue 现有 SwipeCell 增强）
- 现有 SwipeCell 若已有（检查 TaskCard 是否用 van-swipe-cell；若无则加）：左滑露出 3 个按钮：完成（绿）、归档（灰）、阻塞（红），各 56px 宽、44px 高、竖排图标+字
- 点击后 `store.runAction(task.id, action)`，自动收起（swipe-cell 关闭）
- 仅移动端显示（store.isMobile v-if）

### 14. 长按 FAB（App.vue 或新建组件）
- FAB 长按（400ms，touch 事件，与 #10 长按模式一致）→ 弹出 van-action-sheet：9 个状态列"新建到此列" + 关闭
- 选择后 `store.openCreate({ status: x })`——若 store 无该参数支持，则打开创建弹窗后把目标列显示在弹窗提示（尽力而为，不强行改 store 签名；若 openCreate 已支持 prefill 则传）
- 短按 FAB 行为不变（普通创建）

### 15. 虚拟滚动（仅单列模式且任务 >50 条时）
- 用简单窗口化：BoardColumn 单列模式下（boardFilter !== 'all' 且 tasks.length > 50），渲染 `slice(visibleStart, visibleEnd)`，监听容器 scroll 计算（itemHeight 固定 96px）
- 复杂度控制：若实现风险高，可降级为"性能说明"——但优先实现简单窗口化（30 行内）
- 其他模式不启用

## 主题面板修复（已完成，勿回退）
- ThemeSwitcher.vue：桌面 = 自绘 `.theme-pop-drop` 下拉（absolute 定位，无 transform）；移动端 = van-popup bottom sheet；点击外部关闭
- 验证：桌面打开面板位于按钮下方右侧、4 项完整可见、无裁剪

## 验证清单
1. npm run build 无错误；服务重启；桌面/移动无 console 错误
2. 主题面板：桌面下拉正常（位置/完整/外部点击关闭）、移动端 bottom sheet
3. P0：卡片精简（移动端两行截断+首字母圆+左缘条）、chips 吸顶、折叠徽章、骨架屏、空状态文案、左缘条
4. P1：移动端默认单列+记忆、列头 action sheet、边缘返回、vibrate、dots 可点
5. P2：邻页露头、左滑三键、长按 FAB、虚拟滚动（>50 条）
6. 回归：登录/看板 9 列/折叠（all+单列）/chips/滑动切列/长按移动/快捷完成/详情/创建/主题 4 套/统计/设置开关
7. 完成 git add -A && git commit -m "v5: mobile kanban UX overhaul"（git -c user.email=dev@local -c user.name=dev）
