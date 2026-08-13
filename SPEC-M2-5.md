# SPEC-M2-5.md — 看板Web M2-5：U1 批量并行 + U5 空态/加载态

实现位置：`/opt/hermes/kanban-web/web/src/`。先读 AGENTS.md 了解项目约定。

## 红线（绝对禁止）
- 禁止改动：vite.config.js、package.json、index.html、main.js（Vant 导入方式）、web/dist/、app.py、db.py、tests/。
- 样式一律「追加覆盖块」：在 `web/src/style.css` **文件末尾**追加新选择器，禁止改写既有选择器。
- 不引入任何新 npm 依赖。
- 不新增 van-picker；弹层/选择一律沿用现有 `v-model:show` 写法。

## 任务 1 — U1 批量并行（web/src/views/ListView.vue）
现有 `batchAction(action, label)` 是串行 for 循环逐任务 await。改为：
1. 函数签名改为 `batchAction(action, label, idsOverride)`：`idsOverride` 存在时（重试路径）直接用传入 id 列表且**跳过二次确认弹窗**；否则用 `selected` 并保留现有 confirm 弹窗。
2. 分批并发：把 ids 切成每批 5 个，每批 `Promise.allSettled(ids.map(id => api(\`/api/tasks/${encodeURIComponent(id)}/action\`, jsonOpts("POST", { action }))))`。
3. 进度提示：从 `../feedback` 导入 `loading`；第一批前调用 `loading(\`已处理 0/${total}…\`)`，每完成一批再调用 `loading(\`已处理 ${done}/${total}…\`)`（done 为已完成的批内数量累计）。
4. 收尾：统计 okCount 与失败 id 列表 failedIds。若 failCount>0 → `fail(COPY.ok.batch(label, okCount, failCount), { retry: () => batchAction(action, label, failedIds), retryLabel: "重试失败项" })`；否则 `ok(COPY.ok.batch(label, okCount, failCount))`。
5. 保持：结束后 `batchMode.value = false; selected.value = new Set(); await store.refreshBoard(); await store.refreshTasks();`。

## 任务 2 — U5a 空列表「清除筛选」一键（web/src/views/ListView.vue）
现有空态是 `<van-empty v-else-if="isEmpty" description="没有匹配的任务" />`。当列表为空 **且** 任一筛选激活（`store.listStatus`、`store.listAssignee`、`store.search` 非空，以及归档勾选 ref 若存在）时，在 van-empty 下方显示「清除筛选」按钮（复用 `tb-chip` 类），点击将上述筛选全部置空/'' 并调用 `store.refreshTasks()`。加一个 computed `hasFilters` 控制显示。

## 任务 3 — U5b 空列「新建到此列」CTA（web/src/components/BoardColumn.vue）
空态块（`<template v-else>{{ emptyText }}</template>` 分支）：当 `!searchQuery`、非 archived 列、`props.col.count === 0` 时，追加按钮「新建到此列」（复用现有 `btn empty-cta` 类）。点击复用列头 ⋯ 菜单里 `{ name: \`新建到此列（${props.col.label}）\`, create: true }` 的**同一个处理器**（在 onColAction 里找 create:true 的分支，提取成可复用函数，菜单与 CTA 都调它）。注意：`archLoading` computed 已存在于该文件，不要重复定义。

## 任务 4 — U5c van-skeleton（web/src/components/TaskDetail.vue + web/src/views/StatsView.vue）
1. TaskDetail.vue：把 `<div v-if="loading" class="empty">加载中…</div>` 替换为 `<div v-if="loading" class="detail-skeleton"><van-skeleton title :row="6" /></div>`。
2. StatsView.vue：检查其数据加载流程——若没有 loading 态，加 `loading` ref（请求期间 true，完成后 false），加载中渲染 `<div class="stats-skeleton"><van-skeleton title :row="8" /></div>` 替代统计内容；若已有 loading 态则同样换成 van-skeleton。
3. style.css 末尾追加：`.detail-skeleton, .stats-skeleton { padding: 16px; }`。

## 验证（按顺序执行并把输出贴到回复里）
1. `cd /opt/hermes/kanban-web/web && npm run lint` — 0 新增 error（既有 warning 可保留）。
2. `npm run test:unit` — 全绿；若既有测试断言了旧的串行行为，允许同步更新测试以匹配新行为。
3. `npm run build` — 必须成功。

回复格式：改动文件清单 + 三个验证命令的末尾输出。**不要 git commit。**
