# Hermes Kanban Web — 功能规格书

一个管理 Hermes Agent kanban 任务板的 Web 应用。后端 FastAPI + 前端单页应用（无构建步骤），部署为 systemd 用户服务。

## 数据层（关键约束）

- 任务数据库：`/root/.hermes/kanban.db`（SQLite，Hermes gateway 正在使用，**只允许只读查询**）
- **所有写操作必须通过 CLI 子进程执行**：`hermes kanban <verb> ...`（`hermes` 在 PATH 中）
- CLI 支持 `--json` 输出的命令：`list`、`show`、`create`、`stats`。其他命令靠 exit code 判断成败（成功=0），失败时把 stderr 返回给前端
- 读操作直接查询 SQLite（快），连接需设置 `busy_timeout` 且用只读模式打开

### tasks 表关键字段

`id`(TEXT PK, 形如 t_xxxx), `title`, `body`, `assignee`, `status`, `priority`(INT), `created_by`, `created_at`(unix 秒), `started_at`, `completed_at`, `workspace_kind`, `workspace_path`, `branch_name`, `project_id`, `tenant`, `result`, `consecutive_failures`, `max_runtime_seconds`, `last_heartbeat_at`, `current_run_id`, `skills`(JSON), `model_override`, `provider_override`, `block_kind`, `block_recurrences`, `session_id`, `workflow_template_id`, `current_step_key`

### 状态枚举（唯一合法值）

`todo`(待办) `ready`(就绪) `running`(运行中) `blocked`(阻塞) `scheduled`(定时) `review`(评审) `done`(完成) `archived`(归档) `triage`(待梳理)

### 其他表

- `task_links(parent_id, child_id)` — 父子依赖
- `task_comments(id, task_id, author, body, created_at)`
- `task_runs(id, task_id, profile, status, started_at, ended_at, outcome, summary, error)` — status: running|done|blocked|crashed|timed_out|failed|released；outcome: completed|blocked|crashed|timed_out|spawn_failed|gave_up|reclaimed|NULL
- `task_events(id, task_id, run_id, kind, payload, created_at)` — 事件流
- `task_attachments(id, task_id, filename, stored_path, content_type, size, uploaded_by, created_at)`

### 写操作 → CLI 映射（实现时可用 `hermes kanban <verb> --help` 确认参数）

| 功能 | 命令 |
|---|---|
| 建任务 | `hermes kanban create "标题" [--body 描述] [--assignee 名字] [--priority N] [--parent id] [--workspace scratch\|worktree] [--triage] [--created-by web]` |
| 改指派 | `hermes kanban assign <id> --assignee <名字>` |
| 完成 | `hermes kanban complete <id>` |
| 阻塞 | `hermes kanban block <id>`（多个 id 空格分隔） |
| 解阻塞 | `hermes kanban unblock <id>` |
| 定时 | `hermes kanban schedule <id>` |
| 提就绪 | `hermes kanban promote <id>`（todo/blocked → ready 恢复路径） |
| 评审 | `hermes kanban request-review <id>` / `request-changes <id>` / `reopen-review <id>` |
| 归档 | `hermes kanban archive <id>` |
| 加依赖 | `hermes kanban link <parent> <child>` / `unlink <parent> <child>` |
| 评论 | `hermes kanban comment <id> "内容"` |
| 附件 | `hermes kanban attach <id> --file <路径>`（上传文件先存到 /tmp/kanban-web-uploads/ 再 attach）；`hermes kanban attachments <id>`、`attach-rm <id> --attachment-id N` |
| 模型覆盖 | `hermes kanban set-model <id> [--model X] [--provider Y]` |
| 认领回收 | `hermes kanban reclaim <id>` / `reassign <id> --assignee <名字>` |
| 编辑 | `hermes kanban edit`（恢复字段，低频，UI 上做简单入口即可） |

## 后端 API（FastAPI，端口 9120）

- HTTP Basic Auth 保护所有路由（凭据来自环境变量 `KANBAN_WEB_USER` / `KANBAN_WEB_PASS`，未设置时默认 hermes / 启动时生成并打印）
- `GET /api/board` — 看板数据：按状态分组的任务数组 + 每状态计数 + assignees 列表。返回 `{statuses: [{status, label, count, tasks: [...]}], assignees: [...]}`
- `GET /api/tasks?status=&assignee=&q=&archived=` — 列表（SQLite 直读，q 模糊匹配 title/body，默认排除 archived）
- `GET /api/tasks/{id}` — 详情：任务 + comments + links（parent/child）+ runs + attachments + 最近 events（SQLite 直读）
- `GET /api/stats` — 每状态/每 assignee 计数 + 最老 ready 任务年龄（调用 `hermes kanban stats --json`，失败则 SQLite 兜底）
- `POST /api/tasks` — 创建（body: title/body/assignee/priority/parent/workspace/triage）
- `POST /api/tasks/{id}/action` — 通用操作（body: `{action: "complete|block|unblock|schedule|promote|request-review|reopen-review|request-changes|archive|reclaim", note?}`）
- `POST /api/tasks/{id}/assign` — `{assignee}`
- `POST /api/tasks/{id}/comment` — `{body}`
- `POST /api/tasks/{id}/link` — `{other_id}`；`DELETE /api/tasks/{id}/link/{other_id}`（区分方向：link parent→child，由前端传 direction 或按 id 顺序）
- `POST /api/tasks/{id}/set-model` — `{model?, provider?}`
- `POST /api/tasks/{id}/attachments` — multipart 文件上传
- `GET /api/tasks/{id}/attachments` / `DELETE /api/tasks/{id}/attachments/{aid}`
- 所有写接口：执行 CLI 子进程（超时 60s），成功返回 CLI 输出摘要，失败返回 400 + stderr
- CLI 执行辅助函数：`subprocess.run([...], capture_output=True, text=True, timeout=60)`；`hermes kanban` 首次调用可能慢（Python 启动），可接受

## 前端（单页，无构建步骤）

`static/index.html` + `static/app.js` + `static/style.css`，原生 HTML/CSS/JS（fetch + 模板字符串），不引入 CDN 依赖（服务器可能无法访问外网 CDN，全部本地）。

### 布局（移动端优先，响应式）

- **看板视图（默认）**：状态列横向排列。桌面 ≥1100px 全列并排；平板/手机为横向滚动容器（每列固定宽度 82vw），左右边缘视觉提示可滚动
- **列表视图**：切换按钮，表格/卡片行，可按状态/指派筛选 + 搜索框
- **任务详情**：底部抽屉（移动端全屏）/ 右侧面板（桌面），包含：标题、状态徽章、优先级、指派、时间线（created/started/completed）、描述 body（markdown 简单渲染：换行、代码块、粗体，不引外部库）、评论列表+输入框、事件流（最近 20 条）、运行记录、依赖关系（父/子，可点击跳转）、附件列表+上传
- **创建任务**：浮动按钮 → 全屏/弹窗表单（标题必填、描述、指派下拉、优先级、父任务、workspace 选择、triage 开关）
- **卡片操作**：每张卡片上 ⋯ 菜单：查看/完成/阻塞/解阻塞/定时/提就绪/评审/归档/改指派（桌面端也支持 HTML5 拖拽换列，拖到目标列调用对应 action；移动端不做拖拽只做菜单）
- **自动刷新**：看板数据 30 秒轮询一次（页面可见时），手动刷新按钮
- **状态徽章配色**：todo 灰、ready 青、running 蓝、blocked 红、scheduled 橙、review 紫、done 绿、archived 暗灰、triage 黄

### 视觉风格

深色终端风（与 doueen 品牌一致）：背景 `#04060c`、主色 `#5ff0e0`、强调 `#ffb86c`、卡片 `#0d1220` 带 1px `#1e2a44` 边框和微光晕。中文界面，圆角 10px，无衬线字体栈 `-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`。移动端触控目标 ≥44px。

## 部署

- Python venv：`/opt/hermes/kanban-web/venv`（依赖 fastapi uvicorn）
- systemd 用户服务：`hermes-kanban-web.service`，`ExecStart=/opt/hermes/kanban-web/venv/bin/uvicorn app:app --host 0.0.0.0 --port 9120`，`EnvironmentFile=/opt/hermes/kanban-web/.env`，Restart=always
- 代码结构：`/opt/hermes/kanban-web/app.py`（FastAPI 入口+路由）、`/opt/hermes/kanban-web/kanban_cli.py`（CLI 封装）、`/opt/hermes/kanban-web/db.py`（只读 SQLite 查询）、`/opt/hermes/kanban-web/static/`（前端）
- 服务器内存仅 1.6G：uvicorn 单 worker，无额外依赖

## 验证清单（完成后逐项自查）

1. `python -c "import app"` 无语法错误；`uvicorn` 能启动
2. `GET /api/board` 返回 200 且 statuses 覆盖 9 个状态
3. 创建任务 → 出现在 board → 评论 → 完成 → 归档 全流程走通（用 CLI 对照验证）
4. 移动端 375px 视口下：看板可横滑、菜单可点、抽屉全屏正常
