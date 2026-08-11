# Hermes Kanban Web — 移动端交互优化规格书 v3

在 v1/v2 基础上做**移动端全功能交互优化**。项目根：/opt/hermes/kanban-web/。继续遵守核心约束：写操作只走 `hermes kanban` CLI、读操作只读 SQLite、无 CDN 依赖。

## 一、主题系统 v3（删除旧 5 套，4 套全新风格）

### 删除
- app.js `THEMES` 数组：删除 hud/violet/paper/sakura/bay 5 项
- style.css：删除 `body[data-theme="violet|paper|sakura|bay"]` 四个变量块；`:root, body[data-theme="hud"]` 块替换为新的默认主题（linear）
- index.html：`<body data-theme="hud">` → `data-theme="linear"`
- applyTheme fallback：`THEMES.some(...) ? id : "hud"` 中的 "hud" → "linear"；init 里 `applyTheme(saved || "hud")` → `"linear"`
- 兼容：localStorage 里旧主题 id 会 fallback 到 linear，无需额外迁移

### 新 4 套主题（CSS 变量 + data-theme 选择器，认真做）

**1. linear 线性精修（默认）** — Linear 式高级暗色
```
color-scheme: dark
--bg:#08090a --bg2:#0f1011 --card:#141516 --card-hover:#1a1b1d
--border:rgba(255,255,255,0.08) --border-strong:rgba(255,255,255,0.14)
--text:#f7f8f8 --muted:#8a8f98 --accent:#45e0cd --warn:#ffb86c --danger:#ff5c6c
--on-accent:#052e28 --radius:10px --scrim:rgba(0,0,0,0.7)
--grid-a:transparent --grid-b:transparent
--shadow:0 0 0 1px rgba(255,255,255,0.05), 0 8px 28px rgba(0,0,0,0.5)
--glow:0 0 18px color-mix(in srgb, var(--accent) 12%, transparent)
```
组件差异：`.bg-grid { display:none }`；`.card { background:var(--card) }`；`.card::before,.btn::before { display:none }`（去掉渐变边框）

**2. bright 现代明亮（果冻风）** — 浅色大圆角
```
color-scheme: light
--bg:#f5f7fb --bg2:#eef1f7 --card:#ffffff --card-hover:#f8fafd
--border:#e2e8f0 --border-strong:#cbd5e1
--text:#1a2233 --muted:#64748b --accent:#3b82f6 --warn:#f59e0b --danger:#ef4444
--on-accent:#ffffff --radius:14px --scrim:rgba(30,41,59,0.4)
--grid-a:transparent --grid-b:transparent
--shadow:0 1px 3px rgba(15,30,60,0.06), 0 4px 16px rgba(15,30,60,0.08)
--glow:0 0 16px color-mix(in srgb, var(--accent) 14%, transparent)
```
组件差异：`.bg-grid { display:none }`；`.card::before,.btn::before { display:none }`；`.card { box-shadow:0 1px 3px rgba(15,30,60,0.06) }`；`.card:hover { box-shadow:0 4px 16px rgba(15,30,60,0.1) }`；`.column { background:rgba(255,255,255,0.8) }`；`.modal-box,.menu { box-shadow:0 8px 30px rgba(15,30,60,0.15) }`

**3. glass 玻璃拟态** — 深色渐变背景 + 毛玻璃卡片
```
color-scheme: dark
--bg:#0a0f1e --bg2:rgba(255,255,255,0.05) --card:rgba(255,255,255,0.07) --card-hover:rgba(255,255,255,0.11)
--border:rgba(255,255,255,0.12) --border-strong:rgba(255,255,255,0.2)
--text:#eef2ff --muted:#9aa4c7 --accent:#8ab4ff --warn:#ffd08a --danger:#ff8fa3
--on-accent:#0b1526 --radius:14px --scrim:rgba(5,10,25,0.6)
--grid-a:transparent --grid-b:transparent
--shadow:0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)
--glow:0 0 26px color-mix(in srgb, var(--accent) 16%, transparent)
```
组件差异：
- `.bg-grid { display:none }`
- `body[data-theme="glass"]::before`：fixed 渐变背景层（z-index:-1）——三个径向渐变光斑（蓝/紫/青，透明度 0.1-0.16）+ var(--bg) 基底
- 毛玻璃组：`.card,.column,.panel,.detail-section,.login-card,.modal-box,.menu,.list-row { backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px) }`
- `.card::before,.btn::before { display:none }`
- `#topbar,#bottom-nav { background:rgba(10,15,30,0.55); backdrop-filter:blur(20px) }`

**4. geek 终端极客** — HUD 精致版（保留网格但更淡）
```
color-scheme: dark
--bg:#05070c --bg2:#0a0e16 --card:#0c111c --card-hover:#111827
--border:#1a2438 --border-strong:#27344f
--text:#c9d6ea --muted:#64748f --accent:#5ff0e0 --warn:#ffb86c --danger:#ff5c6c
--on-accent:#04231f --radius:8px --scrim:rgba(2,4,10,0.78)
--grid-a:rgba(95,240,224,0.035) --grid-b:rgba(255,184,108,0.028)
--shadow:0 0 0 1px rgba(95,240,224,0.05), 0 8px 24px rgba(0,0,0,0.5)
--glow:0 0 14px color-mix(in srgb, var(--accent) 14%, transparent)
```
组件差异：`.card::before { opacity:0.35 }`（渐变边框减弱保留）；`.column-title,.card-title,.column-count,.brand-name,.detail-title { font-family:var(--mono); letter-spacing:0.02em }`（终端等宽感）

### 主题 pop 面板
- renderThemePop 自动用 THEMES 数组（4 项），无需改逻辑
- 设置页「关于」里的主题列表文案自动更新

## 二、移动端看板交互（A-F 全套）

所有功能在**设置页新增「移动端看板」区块**提供开关（自绘 switch 组件，localStorage 记忆，键 `kb-mob-<name>`，默认值见各项），开关变更立即生效（重新渲染看板）。

### A. 状态筛选 Chips（默认开）
- index.html 已加 `#board-chips` 容器（看板视图内、board 上方）
- app.js：state 加 `boardFilter`（"all" 或状态名，默认 "all"）
- 渲染：`renderBoardChips()` —— "全部" + 9 个状态 chip；选中态高亮；点击 → state.boardFilter = status → renderBoard()
- 渲染看板：boardFilter==="all" → 所有列（原逻辑）；否则 → **只渲染该列**，board 加 `.single` 类，列宽 100%（移动端），卡片大间距
- chips 显示：全部设备显示（桌面也能聚焦单列）；`#board-chips` 初始 hidden，有数据后显示
- 单列模式下隐藏 `#board-dots`？不——dots 继续显示（指示当前状态位置）

### B. 左右滑动切列（默认开，仅单列模式）
- board 容器监听 touchstart/touchmove/touchend（仅 boardFilter!=="all" 时启用）
- 水平位移 > 60px 且 |dx|>|dy| → 切到相邻状态（按 STATUS_LABELS 顺序，边界不切换）
- 切换动画：列内容 slide 入场（CSS：.board.single .column { animation: slideIn 0.2s ease }）
- 切换后更新 chips 选中态 + dots
- 注意：touchmove 时 e.preventDefault() 阻止浏览器横滑刷新；与抽屉手势（drawer-inner 上）不冲突

### C. 空列自动折叠（默认开，仅移动端 + "all" 模式）
- 渲染时：`matchMedia("(max-width: 619px)").matches && 开关开 && boardFilter==="all"` 且该列 count===0 → 加 folded class
- 尊重手动状态：localStorage `kb-collapsed` 里有该列显式记录（true 或 false）时以手动为准，不自动覆盖
- **改造 setCollapsed**：val=false 时存 `c[status]=false`（不再 delete），getCollapsed 返回原样；folded 判断：`collapsed[s]===true || (collapsed[s]===undefined && autoFold && count===0)`
- 折叠列保持现有窄条样式（56px 竖排标题）

### D. 长按卡片 → 底部「移动到」面板（默认开，仅触屏设备）
- 检测：`matchMedia("(pointer: coarse)").matches` 或 'ontouchstart' in window
- 卡片 touchstart 起 400ms 计时 → 触发（touchmove >12px 或 touchend 取消计时）
- 触发：`navigator.vibrate && navigator.vibrate(30)`；打开新面板 `#move-panel`（复用 modal 底部式：fixed bottom，圆角顶，安全区 padding）
- 面板内容：标题「移动到」+ 9 个状态按钮（当前状态禁用态）+ 分隔 + 完成/归档 两个操作按钮
- 点击状态 → actionForTarget 得到 action → runAction → 关面板 + 刷新
- 面板按钮：44px 高、左侧状态点 + 状态名 + 选中箭头提示
- 同时给长按卡片加视觉反馈：卡片 400ms 内 scale(0.97) + 边框高亮（.card.long-press 类）

### E. 列进度指示器（默认开）
- index.html 已加 `#board-dots` 容器（board 下方）
- 渲染：9 个圆点（或状态数），当前列高亮（宽 16px 胶囊形，其余 6px 圆点）
- 更新时机：boardFilter 切换、board scroll 事件（scrollLeft / 单列宽 → 当前列 index，throttle 100ms）
- "all" 模式：横滑时指示当前可视列；单列模式：指示选中状态的位置

### F. 卡片快捷操作（默认开，仅移动端显示）
- cardHtml：meta 区加 `✓` 按钮（class="card-quick" data-quick-complete），仅非 done/archived 状态显示；⋯ 菜单按钮保留
- 点击 ✓ → runAction(id, "complete")，事件委托在 board click 里处理（在折叠按钮/卡片打开逻辑之前判断）
- 触控 ≥40px，圆形，hover 态变色
- 桌面端隐藏（.card-quick { display:none } @media min-width 620px 恢复？不——桌面也保留，hover 显示。简化：全端显示，桌面 hover 微亮）

## 三、全功能移动端交互优化

### 全局
1. 触控目标：所有可点元素 ≥44px（.btn-sm 移动端 min-height:44px；menu 项 44px；theme-item 44px；list-row 全行可点已有）
2. safe-area：底部导航、FAB、toast、modal-box、drawer-inner、move-panel 均加 env(safe-area-inset-bottom)（大部分已有，检查 move-panel/toast）
3. 点击反馈：所有 button/可点元素 :active 缩放或暗化（v3 polish 已有，补齐 .list-row:active、.menu button:active、.nav-btn:active）
4. 防止双击缩放：`touch-action: manipulation` 加到 body、button、input、.card
5. 滚动容器：-webkit-overflow-scrolling: touch 补齐（.column-body、.drawer-inner、.events-list 已有；#board 已有）

### 顶部栏（移动端）
6. 搜索框：≤619px 已隐藏——改为**下拉展开式**：顶栏右侧放大镜按钮，点击展开全宽搜索条（覆盖顶栏第二行，带取消按钮）；输入时若在看板视图 → 切换到列表视图显示结果（与现有 state.search 联动）
7. 品牌区：≤619px 只显示「⟨ Kanban ⟩」+ board 名截断（.brand-name 隐藏，"Hermes" 省略）

### 看板
8. 列头折叠按钮触控 ≥36px（已有 30px，改 36px）
9. 卡片间距 gap 10px→8px（移动端更紧凑），卡片 padding 移动端 10px
10. 看板横滑惯性 + 吸附已有；补 `scroll-snap-stop: always`

### 列表页
11. 筛选区：状态/指派 select 已自绘；移动端改为**两行**（状态一行、指派+排序一行），或 chips 化状态筛选（复用 chips 组件样式，列表页顶部显示状态 chips，点击过滤 + 高亮）
12. 列表行：移动端右侧加「⋯」快捷菜单按钮（同一 menuFor）；行内徽章保留
13. 搜索：顶栏搜索联动（见 6）

### 统计页
14. 面板间距移动端 12px；条形图高度 18px→20px（触控可点？条形图不交互，保持）
15. 事件流：移动端行内 kind 标签 + 时间右对齐已有；补事件行 :active 背景反馈
16. 大数字块（big-number）：移动端两列 grid（状态分布/指派分布各半屏？保持单列，不复杂化）

### 详情抽屉（移动端）
17. 头部：标题 + 关闭按钮（44px）；badge 移入标题行
18. 操作按钮区：**横向滚动胶囊条**（.detail-actions 改 flex-nowrap + overflow-x:auto + 圆角胶囊按钮），避免换行挤压
19. 评论输入区：**吸底**（position:sticky bottom:0，drawer-inner 内），输入框 44px + 发送按钮
20. 附件上传：文件输入整行可点（label 包 input，44px）
21. 依赖区「添加依赖」输入：44px 输入框
22. 区块标题：左侧加 2px 状态色条（detail-section h3::before）
23. 抽屉关闭：下滑手势已有（>80px）；补右上角 ✕ 按钮（现有「✕ 关闭」）

### 创建/编辑弹窗（移动端）
24. 表单控件 44px；标签字号 12px→13px
25. 「放入待梳理」switch 行：整行可点（label 包 input）
26. Swarm workers 动态行：删除按钮 44px 触控
27. 弹窗按钮区：主操作按钮 flex:1（「创建」占满），取消按钮等宽

### 菜单（⋯）——移动端改 Action Sheet
28. ≤619px：`.menu` 改为底部弹出面板（fixed bottom、圆角顶、宽度 100%、安全区、滑入动画），按钮 48px 高、文字左对齐 + 图标
29. 菜单打开时背景遮罩（半透明，点击关闭）——复用 modal-scrim 方案或 .menu-scrim

### 设置页（移动端）
30. Board 管理表单：slug/name 输入 44px，按钮行 flex-wrap
31. 通知订阅：表单 44px
32. 「移动端看板」区块：6 个开关（chips/swipe/autofold/longpress/indicator/quickact），每个开关行 = label(名称+说明) + switch，整行可点
33. 维护按钮：44px

### 登录页（移动端）
34. 卡片 padding 移动端 20px；输入框 48px；按钮 48px；键盘弹起时卡片不被遮挡（login-screen align-items 移动端改为 flex-start + padding-top:12vh）

## 四、验证清单
1. 4 套主题切换正常、刷新记忆、旧 localStorage 值 fallback linear 不报错
2. chips 筛选单列模式正常；滑动切列边界正确；dots 同步
3. 空列自动折叠（移动视口）与手动展开状态互不覆盖
4. 长按 400ms 出 move-panel，9 状态可点、完成/归档可用
5. 卡片 ✓ 快捷完成可用
6. 菜单移动端 Action Sheet 样式
7. 顶部搜索展开/收起
8. 详情抽屉吸底评论、横向操作条
9. 全部开关记忆 + 关闭后功能失效
10. 语法检查通过、服务重启正常、v1/v2 功能回归（创建/完成/评论/附件/依赖/拖拽/登录）
