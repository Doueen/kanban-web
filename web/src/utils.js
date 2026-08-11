/* shared formatting helpers */

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
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
export function mdToHtml(text) {
  if (!text) return "";
  let html = esc(text);
  const blocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\w`])(`[^`]+`)([^\w`]|$)/g, "$1<code>$2</code>$3");
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  html = html.replace(/\n/g, "<br>");
  return html;
}
