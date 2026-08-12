/* shared formatting helpers */

/* 单列看板筛选记忆（kb-board-filter），'all' 时删除 */
export function persistBoardFilter(v) {
  try {
    if (v && v !== "all") localStorage.setItem("kb-board-filter", v);
    else localStorage.removeItem("kb-board-filter");
  } catch (_) {
    /* best-effort */
  }
}

export function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

/* M1-5 E8: 搜索高亮分段 —— 返回 [{t, m}]，m=true 的段应包 <mark>（大小写不敏感） */
export function highlightParts(text, q) {
  const s = String(text ?? "");
  if (!q) return [{ t: s, m: false }];
  const needle = String(q).toLowerCase();
  if (!needle) return [{ t: s, m: false }];
  const low = s.toLowerCase();
  const parts = [];
  let i = 0;
  while (i < s.length) {
    const idx = low.indexOf(needle, i);
    if (idx < 0) {
      parts.push({ t: s.slice(i), m: false });
      break;
    }
    if (idx > i) parts.push({ t: s.slice(i, idx), m: false });
    parts.push({ t: s.slice(idx, idx + needle.length), m: true });
    i = idx + needle.length;
  }
  return parts.length ? parts : [{ t: s, m: false }];
}

/* M1-5 E8: 任务是否命中搜索（标题/ID） */
export function taskMatchesSearch(task, q) {
  const needle = String(q || "")
    .trim()
    .toLowerCase();
  if (!needle) return true;
  return (
    String(task.title || "")
      .toLowerCase()
      .includes(needle) ||
    String(task.id || "")
      .toLowerCase()
      .includes(needle)
  );
}

export function fmtTime(unix) {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ago(unix) {
  if (!unix) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

export function dur(secs) {
  if (secs === null || secs === undefined) return "—";
  if (secs < 60) return `${Math.floor(secs)}秒`;
  if (secs < 3600) return `${Math.floor(secs / 60)}分钟`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}小时`;
  return `${(secs / 86400).toFixed(1)}天`;
}

export function kindColor(kind) {
  let h = 0;
  const k = String(kind || "event");
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 360;
  return `hsl(${h} 68% 55%)`;
}

export function shortPayload(p) {
  let s = "";
  if (p === null || p === undefined) return "";
  if (typeof p === "string") s = p;
  else {
    try {
      s = JSON.stringify(p);
    } catch (_) {
      s = String(p);
    }
  }
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

/* minimal markdown: newline / code block / bold / inline code (no external lib) */
/* 交付产物路径：`关键词：/abs/path` → 下载链接 */
const DL_RE =
  /(?:交付文档|文档|成果|产物|文件|输出|报告|结果)\s*[:：]\s*(\/(?:[^\s，。、；;'"）)】\]]+))/g;

function injectDlLinks(src) {
  const links = [];
  const out = src.replace(DL_RE, (m, path) => {
    const name = decodeURIComponent(path).split("/").pop() || path;
    links.push(
      `<a class="dl-link" href="/api/download?path=${encodeURIComponent(path)}" target="_blank" rel="noopener">📄 ${esc(name)}</a>`
    );
    return `\u0001${links.length - 1}\u0001`;
  });
  return { out, links };
}

export function linkifyFilePaths(text) {
  if (!text) return "";
  return injectDlLinks(text).out.replace(/\u0001(\d+)\u0001/g, (_, i) => linksOf(text)[+i] || "");
}
function linksOf(text) {
  return injectDlLinks(text).links;
}

export function mdToHtml(text) {
  if (!text) return "";
  const { out: src, links } = injectDlLinks(text);
  let html = esc(src);
  const blocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    /* 去掉围栏内首尾换行，避免 <pre> 内出现多余空行 */
    blocks.push(`<pre><code>${code.replace(/^\n|\n$/g, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\w`])(`[^`]+`)([^\w`]|$)/g, "$1<code>$2</code>$3");
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  html = html.replace(/\u0001(\d+)\u0001/g, (_, i) => links[+i] || "");
  html = html.replace(/\n/g, "<br>");
  return html;
}
