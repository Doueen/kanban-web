// t_e564bf47 手动端到端验证脚本：创建任务 → 完成任务 → 刷新页面 → 切换看板，
// 完成列始终正确显示（done 列 store/DOM/API/DB 四方一致）。
// 附加回归断言：CLI 完成任务后页面持有的旧 ETag 条件请求必须 200（修复前 304 粘滞）。
//
// 前置：服务 :9120 已部署修复（commit 5ea85e0+）；/tmp/kb_cleanup.py 存在（测试任务清理）。
// 运行：node scripts/e2e-done-column.cjs
// 2026-08-13 实机结果：18/18 PASS（desktop 1280 + mobile 390 双视口）。
const { chromium } = require("/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const URL = "http://127.0.0.1:9120/";
const CHROME =
  "/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
const DB = "/root/.hermes/kanban.db";
const M1_DB = "/root/.hermes/kanban/boards/m1probe/kanban.db";

// 认证从服务 .env 读取（脚本不得硬编码口令）
const envText = fs.readFileSync("/opt/hermes/kanban-web/.env", "utf8");
const envUser = (envText.match(/KANBAN_WEB_USER=(.+)/) || [])[1] || "hermes";
const envPass = (envText.match(/KANBAN_WEB_PASS=(.+)/) || [])[1] || "";

function cli(args) {
  return execSync(`hermes kanban ${args}`, { encoding: "utf8", timeout: 60000 }).trim();
}
function cliCreate(title) {
  const out = cli(`create "${title}" --assignee default --json`);
  return JSON.parse(out).id;
}
function dbDone(dbPath) {
  return parseInt(
    execSync(`python3 -c "import sqlite3,sys;print(sqlite3.connect('${dbPath}').execute(\\"SELECT COUNT(*) FROM tasks WHERE status='done'\\").fetchone()[0])"`, { encoding: "utf8" }).trim(),
    10
  );
}
function dbCleanup(tids) {
  execSync(`python3 /tmp/kb_cleanup.py ${tids.join(" ")}`, { encoding: "utf8" });
}

const failures = [];
function check(name, ok, extra) {
  console.log(`${ok ? "PASS" : "FAIL"} [${name}]${extra ? " — " + extra : ""}`);
  if (!ok) failures.push(name);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(
    ({ u, p }) => {
      try {
        localStorage.setItem("kb-auth", JSON.stringify({ u, p }));
      } catch (e) {}
    },
    { u: envUser, p: envPass }
  );
  const page = await ctx.newPage();

  // ---- 请求/响应捕获：/api/board 的条件头与状态码 ----
  const boardReqs = [];
  const boardResps = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/board")) {
      boardReqs.push({ ts: Date.now(), inm: r.headers()["if-none-match"] || null });
    }
  });
  page.on("response", (r) => {
    if (r.url().endsWith("/api/board")) {
      boardResps.push({ ts: Date.now(), status: r.status() });
    }
  });

  const created = []; // 待清理任务
  const baseDone = dbDone(DB);
  console.log(`baseline done=${baseDone}`);

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(
    () => {
      const b = window.__store() && window.__store().board;
      return b && b.statuses && b.statuses.length > 0;
    },
    { timeout: 15000 }
  );
  await page.waitForTimeout(1000);

  const snap = () =>
    page.evaluate(() => {
      const b = window.__store().board;
      const c = b && b.statuses.find((x) => x.status === "done");
      const countEl = document.querySelector(".st-done .column-count");
      return {
        done: c ? { count: c.count, tasks: c.tasks.length, ids: c.tasks.map((t) => t.id) } : null,
        domCount: countEl ? parseInt(countEl.textContent, 10) : null,
        domCards: document.querySelectorAll(".st-done .column-body .card").length,
        vueErr: (window.__vueErr || []).slice(0, 3),
        slug: window.__store().currentBoard ? window.__store().currentBoard.slug : null,
      };
    });

  // 0) 基线：done 列 store==DOM==DB，无 vue 错误
  let s = await snap();
  check("基线 done列 store.count==tasks==DOM==DB", s.done && s.done.count === s.done.tasks && s.done.count === s.domCount && s.domCards === s.done.count && s.done.count === baseDone, JSON.stringify({ store: s.done && s.done.count, dom: s.domCount, db: baseDone }));
  check("基线 无vue错误", s.vueErr.length === 0, JSON.stringify(s.vueErr));

  // 1) 创建任务（CLI，模拟 worker 落库；默认初始状态 ready）→ SSE 实时上板
  const tidA = cliCreate(`E2E回归-甲-${Date.now() % 100000}`);
  created.push(tidA);
  await page.waitForFunction(
    (tid) => !!window.__store().findTask(tid),
    tidA,
    { timeout: 8000 }
  );
  s = await snap();
  const inBoard = await page.evaluate((tid) => !!window.__store().findTask(tid), tidA);
  check("创建任务后新任务上板(SSE实时)", inBoard, `tid=${tidA}`);
  check("创建任务不污染done列", s.done.count === baseDone, `done=${s.done.count}`);

  // 2) 完成任务 → done 列实时 +1 且含该任务
  cli(`complete ${tidA}`);
  await page.waitForFunction(
    (tid) => window.__store().board.statuses.find((c) => c.status === "done").tasks.some((t) => t.id === tid),
    tidA,
    { timeout: 8000 }
  );
  s = await snap();
  check("完成后 done列含任务(SSE实时上屏)", s.done.ids.includes(tidA), `done=${s.done.count}`);
  check("完成后 done列==DOM==DB", s.done.count === s.domCount && s.domCards === s.done.count && s.done.count === dbDone(DB), JSON.stringify({ store: s.done.count, dom: s.domCount, db: dbDone(DB) }));

  // 3) 同秒回归：创建+完成第二个任务（尽量同秒），页面持有的旧 ETag 条件请求必须 200
  const t0 = Math.floor(Date.now() / 1000);
  const tidB = cliCreate(`E2E回归-乙-${Date.now() % 100000}`);
  created.push(tidB);
  cli(`complete ${tidB}`);
  const t1 = Math.floor(Date.now() / 1000);
  const sameSecond = t0 === t1;
  console.log(`同秒尝试: create/complete 跨 ${t1 - t0}s（${sameSecond ? "命中同秒" : "未同秒，指纹仍应变化"}）`);
  await page.waitForFunction(
    (tid) => window.__store().board.statuses.find((c) => c.status === "done").tasks.some((t) => t.id === tid),
    tidB,
    { timeout: 8000 }
  );
  // 核心断言：完成之后页面发起的 /api/board 条件请求（带旧 If-None-Match）必须 200
  await page.waitForTimeout(1200); // 等 SSE 引发的条件请求落盘
  const recent = boardResps.filter((r) => r.ts > t0 * 1000 - 500);
  const condOk = recent.filter((r) => r.status === 200).length > 0;
  check("同秒完成 → 页面条件请求 200（修复前 304 粘滞）", condOk, JSON.stringify(recent.map((r) => r.status)));
  s = await snap();
  check("同秒完成后 done列==DOM==DB 且含两任务", s.done.count === s.domCount && s.done.count === dbDone(DB) && s.done.ids.includes(tidA) && s.done.ids.includes(tidB), JSON.stringify({ store: s.done.count, db: dbDone(DB), hasA: s.done.ids.includes(tidA), hasB: s.done.ids.includes(tidB) }));

  // 4) 刷新页面（整页 reload）→ done 列仍正确（SSE 长连接使 networkidle 永不满足，用 domcontentloaded）
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => window.__store() && window.__store().board, { timeout: 15000 });
  await page.waitForTimeout(1000);
  s = await snap();
  check("刷新页面后 done列==DOM==DB", s.done.count === s.domCount && s.domCards === s.done.count && s.done.count === dbDone(DB), JSON.stringify({ store: s.done.count, dom: s.domCount, db: dbDone(DB) }));
  check("刷新后 done列含两任务", s.done.ids.includes(tidA) && s.done.ids.includes(tidB), `hasA=${s.done.ids.includes(tidA)} hasB=${s.done.ids.includes(tidB)}`);

  // 5) 切换看板（UI：顶栏板名 → action sheet → m1probe）→ 强制拉新，done 列=该板 DB
  boardReqs.length = 0;
  await page.click('.brand-board[aria-label="切换看板"]');
  await page.waitForSelector(".van-action-sheet__item", { timeout: 5000 });
  await page.click('.van-action-sheet__item:has-text("M1probe")');
  await page.waitForFunction(() => window.__store().currentBoard && window.__store().currentBoard.slug === "m1probe", { timeout: 10000 });
  await page.waitForTimeout(800);
  s = await snap();
  const m1Done = dbDone(M1_DB);
  check("切到m1probe done列==该板DB", s.done.count === m1Done && s.done.count === s.domCount, JSON.stringify({ store: s.done.count, db: m1Done, slug: s.slug }));
  // 切板请求必须绕过 ETag（无 If-None-Match）
  const switchReqs = boardReqs.filter((r) => r.ts > Date.now() - 5000);
  check("切板后 /api/board 无 If-None-Match（force 绕过 ETag）", switchReqs.length > 0 && switchReqs.every((r) => !r.inm), JSON.stringify(switchReqs.map((r) => r.inm)));

  // 切回 default（UI 同路径）
  await page.click('.brand-board[aria-label="切换看板"]');
  await page.waitForSelector(".van-action-sheet__item", { timeout: 5000 });
  await page.click('.van-action-sheet__item:has-text("daily")');
  await page.waitForFunction(() => window.__store().currentBoard && window.__store().currentBoard.slug === "default", { timeout: 10000 });
  await page.waitForTimeout(800);
  s = await snap();
  const backDone = dbDone(DB);
  check("切回default done列==DB 且含两任务", s.done.count === backDone && s.done.count === s.domCount && s.done.ids.includes(tidA) && s.done.ids.includes(tidB), JSON.stringify({ store: s.done.count, db: backDone, slug: s.slug }));
  check("最终 无vue错误", s.vueErr.length === 0, JSON.stringify(s.vueErr));

  // 6) 移动端 390 视口：done 列一致
  const mp = await ctx.newPage();
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await mp.waitForFunction(() => window.__store() && window.__store().board, { timeout: 15000 });
  await mp.waitForTimeout(1000);
  const m = await mp.evaluate(() => {
    const b = window.__store().board;
    const c = b.statuses.find((x) => x.status === "done");
    const countEl = document.querySelector(".st-done .column-count");
    return {
      count: c ? c.count : null,
      domCount: countEl ? parseInt(countEl.textContent, 10) : null,
      vueErr: (window.__vueErr || []).slice(0, 3),
    };
  });
  check("mobile390 done列 store==DOM==DB", m.count === m.domCount && m.count === dbDone(DB), JSON.stringify(m));
  check("mobile390 无vue错误", m.vueErr.length === 0, JSON.stringify(m.vueErr));
  await mp.close();

  await browser.close();

  // 7) 清理：删除测试任务，恢复基线
  dbCleanup(created);
  const after = dbDone(DB);
  check("清理后 done 列恢复基线", after === baseDone, `after=${after} base=${baseDone}`);

  console.log(failures.length ? `\nRESULT: ${failures.length} FAILED — ${failures.join(", ")}` : "\nRESULT: ALL PASS");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
