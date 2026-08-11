# Hermes Kanban Web — 优化规格书 v2

在 v1（SPEC.md/AGENTS.md）基础上全面扩展。**继续遵守 v1 的核心约束**：写操作只走 `hermes kanban` CLI（`hermes` 在 PATH）、读操作只读 SQLite、无 CDN 依赖、Python FastAPI + 原生前端。项目根：/opt/hermes/kanban-web/。

## 一、多看板支持（db.py 改造 + 新 API）

### DB 路径规则（关键）
- 默认 board `default`：`/root/.hermes/kanban.db`（向后兼容）
- 其他 board：`/root/.hermes/kanban/boards/<slug>/kanban.db`
- 活跃 board 由 `hermes kanban boards show` 输出决定（启动时查询一次，`POST /api/boards/{slug}/switch` 成功后刷新，缓存 30 秒）
- db.py 增加模块级 `current_db_path()`，所有查询用它；读接口自动跟随当前 board

### 新 API
| 接口 | CLI 映射 | 说明 |
|---|---|---|
| GET /api/boards | boards list --json --all | 全部 board 列表（含归档） |
| POST /api/boards | boards create slug --name --description --icon --color | body: {slug, name?, description?, icon?, color?} |
| POST /api/boards/{slug}/switch | boards switch slug | 切换活跃 board |
| GET /api/boards/current | boards show | 当前 board slug |
| POST /api/boards/{slug}/rename | boards rename slug name | body: {name} |
| POST /api/boards/{slug}/workdir | boards set-default-workdir slug [path] | body: {path?}，省略则清除 |
| DELETE /api/boards/{slug} | boards rm slug [--delete] | body: {delete?: bool}，默认归档 |

## 二、任务补充功能（kanban_cli.py + app.py）

| 接口 | CLI 映射 | 说明 |
|---|---|---|
| POST /api/tasks/{id}/edit | edit task_id --result R [--summary S] [--metadata M] | body: {result, summary?, metadata?}，result 必填 |
| POST /api/tasks/{id}/specify | specify task_id | triage 任务细化（AI 生成规格，可能耗时 1-3 分钟，CLI 超时放宽到 300s） |
| POST /api/tasks/{id}/decompose | decompose task_id | AI 分解任务（同样放宽超时） |
| POST /api/tasks/{id}/claim | claim task_id [--ttl N] | body: {ttl?} |
| POST /api/tasks/{id}/heartbeat | heartbeat task_id [--note] | body: {note?} |
| POST /api/tasks/{id}/reassign | reassign task_id profile | body: {assignee} |
| GET /api/tasks/{id}/context | context task_id | 返回原始文本 |
| GET /api/tasks/{id}/log | log task_id [--tail N] | 返回 worker 日志文本，query: tail |
| GET /api/tasks/{id}/notify | notify-list task_id --json | 订阅列表 |
| POST /api/tasks/{id}/notify | notify-subscribe task_id --platform --chat-id [--chat-type] [--thread-id] [--user-id] [--notifier-profile] | body 同上 |
| DELETE /api/tasks/{id}/notify | notify-unsubscribe task_id --platform --chat-id [--thread-id] | body 同上 |

## 三、Swarm 与全局

| 接口 | CLI 映射 | 说明 |
|---|---|---|
| POST /api/swarm | swarm goal --worker P:T[:SKILL,SKILL] --verifier V --synthesizer S [--priority] [--json] | body: {goal, workers:[{profile,title?,skills?}], verifier, synthesizer, priority?}；worker 参数拼成 PROFILE:TITLE[:SKILL,SKILL] 格式；超时 300s |
| GET /api/diagnostics | diagnostics --json [--severity] [--task] | query: severity?, task? |
| GET /api/events | SQLite 直读 task_events | query: since(unix秒), kinds?(逗号分隔)；WHERE created_at > since AND kind IN (...)，LIMIT 100，按 created_at 升序 |
| POST /api/gc | gc [--event-retention-days N] [--log-retention-days N] | body 可选 |
| POST /api/repair | repair --json | DB 健康检查/自动修复 |
| GET /api/assignees | assignees --json | 补充 v1（board 页已有 SQLite 版，保留） |

## 四、前端全面重构（重点）

### 设计系统 —— doueen 终端 HUD 风格
- **CSS 变量驱动**，`body[data-theme]` 切换主题
- 背景 `#04060c` + **网格漂移动效**（两层 repeating-linear-gradient 背景位移动画，慢速 40s）+ **顶部扫描光束**（细青线从上到下扫过，6s 循环，纯 CSS）
- 主青 `#5ff0e0`、琥珀 `#ffb86c`、危险 `#ff5c6c`、卡片底 `#0d1220`、边框 `#1e2a44`
- **自定义所有原生控件**（这是 v1 最大短板）：
  - select → 自定义下拉（按钮 + 浮层列表，键盘可用）
  - checkbox/switch → 自绘
  - input/textarea → 深色底 + 聚焦光晕（accent 边框 + box-shadow）
  - 按钮 → 渐变描边 + hover 光晕 + active 按压
  - 滚动条 → 细窄主题色
- 卡片：hover 时边框渐变光晕（::before 渐变层 + 模糊），入场 stagger fadeIn（每卡 40ms 延迟，最多 300ms）
- 标题分隔用 `·`；数字用等宽字体
- 尊重 prefers-reduced-motion：动效全部禁用

### 多主题（5 套，顶栏切换按钮，localStorage 记忆，默认 HUD）
1. `hud` 终端 HUD（深青，默认）— bg #04060c 主青 #5ff0e0
2. `violet` 极夜紫 — bg #0a0618 主 #8b7cf6 强调 #f0abfc
3. `paper` 暖纸 — bg #f7f1e3 主 #b45309 文字 #292524（亮色主题！注意文字对比度）
4. `sakura` 樱花 — bg #fff0f5 主 #ec4899 文字 #4c1d33
5. `bay` 海湾 — bg #f0f7ff 主 #0ea5e9 文字 #0f172a
每个主题定义完整变量集：--bg --bg2 --card --border --text --muted --accent --accent-dim --warn --danger --radius 等。亮色主题需要全局重新审视颜色使用（不能用 alpha 黑叠加）。

### 布局与页面
- **顶部栏**：品牌（⟨ Hermes Kanban ⟩ · 当前 board 名）、主题切换（🎨 弹出 5 选）、搜索（桌面）、刷新
- **移动端底部导航 4 tab**（≥44px 触控）：看板 / 列表 / 统计 / 设置；桌面端 tab 放顶栏
- **看板页**：9 状态列横滑（桌面 ≥1100px 时并排 5 列 + 横滑）；列头（状态灯 + 名称 + 计数徽章）；卡片（标题、优先级 P 徽章、@指派、状态色左缘）；⋯ 菜单（与 v1 相同的状态感知操作 + 新增：细化、分解、认领、心跳、查看上下文、查看日志）；桌面拖拽换列保留
- **列表页**：筛选（状态/指派/搜索）+ 排序（创建时间/优先级）；行 = 徽章 + 标题 + 元信息；点行开详情
- **统计页**：状态分布（纯 CSS 条形图，9 色）、指派分布、最老 ready 年龄、全局事件流（**5 秒增量轮询**，GET /api/events?since=，kind 彩色标签，最多保留 100 条，自动滚动）
- **设置页**：Board 管理（当前 board 显示、切换下拉、创建表单、重命名、归档/删除、默认工作目录）、通知订阅管理（输入任务 ID 查看订阅 → 可删除）、维护（GC 按钮、DB 修复按钮、各自确认弹窗）、关于（版本/端口）
- **详情抽屉**：移动端全屏 + 底部固定操作条；新增区块：上下文（pre 文本）、日志（pre + 刷新）、通知订阅（列表 + 添加表单）、操作按钮区新增：细化 / 分解 / 认领 / 心跳 / 编辑结果（result 必填弹窗）
- **创建弹窗**：模式切换（普通任务 / Swarm）；Swarm 模式：目标 + workers 动态行（profile/title/skills）+ verifier + synthesizer + 优先级

### 移动端细节
- safe-area-inset 适配（底部导航 padding）
- 抽屉下滑关闭（touch 事件，>80px 位移关闭）
- 看板列宽 82vw + scroll-snap
- 全部触控目标 ≥44px

### 其他
- 保持 30s 看板轮询、事件页 5s
- toast 样式升级（主题色 + 图标）
- favicon：内联 SVG data URI（青绿方块 + ⟨⟩ 符号）
- v1 已实现的 API/前端功能不许回退

## 五、验证清单
1. python 语法检查 + uvicorn 启动 + 全部新 API curl 冒烟（swarm/specify/decompose 用最小输入，允许较慢）
2. 5 套主题切换正常且刷新后记忆
3. 亮色主题下文字可读
4. 移动 390px：底部导航、抽屉下滑关闭、看板横滑（用 CSS 断点 + 截图）
5. v1 功能回归：创建/评论/完成/附件/依赖/拖拽
