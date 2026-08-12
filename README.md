# Hermes Kanban Web

Hermes Agent 任务看板的 Web 端——Vue 3 + Vant 4 移动优先实现，覆盖 CLI 全功能。

## 功能

- **看板**：9 状态列（待梳理→归档）、列折叠/展开、状态 chips 筛选（带任务数角标）、单列沉浸模式（记忆）、横向泳道滑动、空列自动折叠、列头操作菜单
- **任务**：创建（父任务/优先级/指派/工作区选择器）、长按移动到面板、左滑快捷操作、拖拽（桌面）、批量操作（列表页多选）、归档二次确认
- **详情**：Markdown 渲染、评论、附件上传、通知订阅（已绑定平台直选）、依赖、运行记录、日志
- **列表**：状态/指派/搜索筛选、三态排序（状态默认/优先级/创建时间）、含归档开关
- **统计**：7 天完成趋势图（纯 CSS）、状态分布、指派排行、事件流
- **设置**：Board 卡片化管理（切换/重命名/工作目录/归档恢复/删除）、分类显示开关、通知订阅管理、主题（4 套 + 跟随系统深色）、移动端 UX 开关、GC 维护
- **系统**：自定义登录页、Basic Auth、PWA（添加到主屏幕 + 离线壳）、交付产物下载（白名单 + 认证）、多看板快速切换（顶栏点击）

## 技术栈

- 前端：Vue 3 + Pinia + Vant 4 + Vite（无 CDN，本地打包）
- 后端：FastAPI + SQLite 只读 + CLI 封装（写操作全部走 `hermes kanban` CLI，语义与命令行一致）
- 部署：systemd 用户服务 + nginx 反代

## 快速开始

```bash
# 依赖
cd web && npm install

# 构建
npm run build        # 产物 web/dist/

# 后端（需要 hermes 环境 + .env 提供凭据）
cp .env.example .env
uvicorn app:app --host 0.0.0.0 --port 9120

# 一键部署（含重启服务）
./deploy.sh
```

## 目录结构

```
app.py            # FastAPI 后端（静态托管 web/dist + /api/*）
db.py             # SQLite 只读层
kanban_cli.py     # hermes kanban CLI 封装
web/              # Vue 3 前端源码 + 构建产物
  src/            # 组件/视图/store/api
  public/         # PWA manifest / sw.js / 图标
SPEC*.md          # v1→v5 规格演进文档
deploy.sh         # 一键构建部署
```

## 数据与约束

- 生产库：`~/.hermes/kanban.db`（**只读**，Web 不直接写库）
- 写操作语义与 CLI 一致（业务约束如实传递：未运行任务不能发 heartbeat、父依赖未满足时拒绝 promote 等）
- 多 board：`~/.hermes/kanban/boards/<slug>/kanban.db`，切换走 CLI

## 质量门禁（M1-6 E11）

- 前端静态检查 + 单元测试 + 构建（`cd web`）：

  ```bash
  npm run lint       # ESLint 9 flat config + eslint-plugin-vue（0 error 门槛）
  npm run test:unit  # Vitest 纯函数骨架（utils.js / store.js）
  npm run build      # Vite 构建 → web/dist/
  ```

- 后端测试：`python -m pytest tests/ -q`（db.py 查询 / kanban_cli.py 参数构造 / 分页契约 / scheduler API）
- pre-commit 钩子（husky + lint-staged）：只检查暂存文件，eslint --fix + prettier 格式化后通过
- GitHub Actions `.github/workflows/ci.yml`：push/PR → npm ci → lint → vitest → build → pytest；CI 不接触生产服务器
- 部署前先跑 `./deploy.sh`（构建后校验 `dist/index.html` + assets 存在才 restart 服务）

## API 契约（任务列表分页）

`GET /api/tasks`（HTTP Basic Auth；SQLite 直读，q 模糊匹配 title/body，默认排除 archived）

| 参数 | 默认 | 说明 |
|---|---|---|
| `status` / `assignee` / `q` / `archived` | — | 原有筛选保持不变（`archived=1/true/yes` 包含归档） |
| `page` | `1` | 页码；非数字或 ≤0 回退默认值 |
| `page_size` | `20` | 每页条数；非数字或 ≤0 回退默认值，>100 钳制为 100 |
| `sort` | `priority` | `status`（看板列序，tiebreak 优先级/创建时间）/ `priority`（优先级降序）/ `created`（创建时间降序）；非法值回退默认排序 |

- 默认排序 `priority DESC, created_at DESC`（分页切片稳定，与 CLI `list` 一致）；`sort=status` 按看板列序
  triage→todo→ready→running→blocked→scheduled→review→done→archived 排列
- 页码超界返回 `items: []`（不报错），`total` 仍为真实总数
- 非法 `status` 依旧返回 400（校验保留）

响应信封（**前端须解包 `items`**，不再直接返回数组）：

```json
GET /api/tasks?page=2&page_size=20  →  200
{
  "items": [ /* 第 21–40 条（共 50 条时） */ ],
  "page": 2,
  "page_size": 20,
  "total": 50,
  "total_pages": 3
}
```

## License

MIT
