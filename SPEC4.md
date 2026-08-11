# Hermes Kanban Web — Vue 3 + Vant 重构规格书 v4

将 9120 前端从原生 JS 重构为 **Vue 3 + Vant 4 + Vite**。后端 API 层（app.py/db.py/kanban_cli.py）**完全不动**，只换前端实现与托管方式。

## 技术栈
- Vue 3（组合式 API，JS 非 TS）+ Pinia（状态）+ Vant 4（移动端组件库）+ Vite 5
- 无 vue-router（单页 4 视图用组件切换，保持简单）
- 构建产物 `dist/`，由 FastAPI StaticFiles 托管（SPA：index.html 作为 fallback）
- npm 源用默认 registry（服务器可达）；全部依赖本地安装，无 CDN

## 项目结构
```
/opt/hermes/kanban-web/web/          # Vue 项目（新目录）
  package.json  vite.config.js  index.html
  src/
    main.js            # 挂载 + Vant + Pinia + 主题初始化
    api.js             # fetch 封装（Basic Auth 头、401 → 登录态、错误归一）
    store.js           # Pinia：board/tasks/filter/theme/auth/折叠状态/移动端开关
    App.vue            # 根：登录页 OR 主框架（顶栏 + 视图切换 + Tabbar + 全局弹层）
    views/BoardView.vue   # 看板（chips + 列 + 卡片 + dots + 滑动切列 + 折叠）
    views/ListView.vue    # 列表（筛选 + 搜索 + 行操作）
    views/StatsView.vue   # 统计（分布图 + 事件流）
    views/SettingsView.vue# 设置（board 管理/通知/维护/移动端开关/主题/登出）
    components/
      LoginScreen.vue
      BoardColumn.vue      # 列：头（点/标题/计数/折叠按钮）+ 卡片列表 + 拖放目标
      TaskCard.vue         # 卡片：标题/优先级/指派/✓快捷/⋯按钮/长按
      TaskDetail.vue       # 详情 Popup：全屏，信息/时间线/描述/依赖/附件/评论/运行/事件
      CreateTaskPopup.vue  # 创建（普通/Swarm 双模式）
      MoveSheet.vue        # 长按后的「移动到」ActionSheet
      BoardChips.vue       # 状态筛选 chips
      BoardDots.vue        # 列指示圆点
      ThemeSwitcher.vue    # 主题切换
      SettingSwitch.vue    # 设置页开关行
```

## 功能映射（原生 → Vant）
| 现有功能 | Vant 组件/方案 |
|---|---|
| 底部导航 4 tab | `van-tabbar` + `van-tabbar-item`（safe-area） |
| ⋯ 操作菜单 | `van-action-sheet`（移动端）+ 桌面 Popup 菜单 |
| 长按移动到 | 自绘长按识别 → `van-action-sheet`（9 状态 + 完成/归档） |
| 创建任务弹窗 | `van-popup` 底部 + `van-field`/`van-picker`/`van-switch` 表单 |
| 详情抽屉 | `van-popup` 全屏（position=right 桌面 / 全屏移动）+ 手势下滑关闭（自绘 touch） |
| Toast/错误反馈 | `van-toast` + `van-dialog`（确认类） |
| 空状态 | `van-empty` |
| 搜索（顶栏展开/列表页） | `van-search` |
| 下拉刷新 | `van-pull-refresh`（看板/列表/统计） |
| 卡片左滑快捷操作 | `van-swipe-cell`（移动端：左滑出完成/归档） |
| 状态徽章 | `van-tag`（自定义色） |
| 开关（设置页） | `van-switch` + `van-cell` |
| 附件上传 | `van-uploader`（单文件，提交走 API） |
| 主题切换 | `van-config-provider`（theme-vars 按 4 套主题切换）+ 自定义 CSS 变量 |

## 必须保留的行为（回归清单）
1. 自定义登录页（Basic Auth 存 localStorage，401 自动回登录）；密码 hermes / Zhz155304.
2. 4 套主题（linear/bright/glass/geek）+ localStorage 记忆 + 旧值 fallback linear
3. 9 状态列 + **待梳理第一列** + 列横向折叠（56px 窄条竖排标题）+ 折叠状态记忆 + **单列模式下折叠也生效（修复 .board.single .column.folded 特异性冲突）**
4. 归档列首次默认折叠；空列自动折叠（移动端，尊重手动状态）
5. chips 单列聚焦 + 左右滑动切列（60px 阈值）+ 列指示圆点
6. 长按 400ms 移动到面板（触屏）+ 卡片 ✓ 快捷完成 + ⋯ 菜单
7. 桌面拖拽换列（HTML5 drag&drop）+ 移动端 SwipeCell
8. 任务详情全功能：评论发表、附件上传/删除、依赖添加/解除、上下文/日志/通知订阅、编辑结果、specify/decompose/claim/heartbeat（按钮按状态显示）
9. 创建任务（含 Swarm 模式 workers 动态行、triage 开关、父任务）
10. 列表页筛选（状态/指派/搜索/排序/含归档）+ 统计页（分布图 + 5s 事件流轮询）
11. 设置页：Board 管理（列表/切换/创建/重命名/工作目录/归档删除）、通知订阅管理、GC/修复、移动端 6 开关、主题、登出
12. 30s 看板轮询（页面可见时）、5s 事件轮询
13. 所有写操作走 `hermes kanban` CLI（api.js 调现有 /api/* 端点，后端不变）
14. 触控 ≥44px、safe-area、touch-action: manipulation、prefers-reduced-motion

## 构建与托管
- `npm create vite` 手动搭（不用交互式脚手架）：package.json 手写，deps: vue@^3.5 pinia vant@^4 @vitejs/plugin-vue vite@^5
- vite.config.js：`base: './'`（相对路径，便于子路径托管）、build.outDir 默认 dist
- FastAPI：`app.mount("/", StaticFiles(directory=web/dist, html=True))` 替换现有 static 挂载；静态资源引用用相对路径（./assets/...）保证 / 与 query 都能加载
- dist/ 构建后提交进仓库（服务器上构建即可，不强制 CI）
- 服务重启后 `curl /` 应返回 Vue 应用 HTML

## 验证清单
1. npm install + vite build 成功，dist/ 产物存在
2. 登录 → 看板 9 列 + 待梳理第一列 + 归档默认折叠
3. 折叠：all 模式 ✓ 单列模式 ✓（56px 窄条）刷新记忆 ✓
4. chips 单列 + 滑动切列 + dots ✓
5. 长按面板 + ✓ 快捷完成 + SwipeCell ✓
6. 详情全功能（评论/附件/依赖）✓
7. 4 主题切换 + 记忆 ✓
8. 统计页 + 5s 事件流 ✓
9. 设置页开关生效 ✓
10. 无 console 错误；v1 API 全部可调
