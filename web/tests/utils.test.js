/* M1-6 E11: vitest 骨架 —— utils.js 纯函数
 * esc / fmtTime / ago / dur / mdToHtml / linkifyFilePaths
 * 外加 M1-5 E8 搜索辅助：highlightParts / taskMatchesSearch
 */
import { describe, it, expect } from "vitest";
import {
  esc,
  highlightParts,
  taskMatchesSearch,
  fmtTime,
  ago,
  dur,
  linkifyFilePaths,
  mdToHtml,
} from "../src/utils";

describe("esc", () => {
  it("escapes HTML special chars", () => {
    expect(esc(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });
  it("handles null/undefined/numbers", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    expect(esc(42)).toBe("42");
  });
});

describe("highlightParts (M1-5 E8)", () => {
  it("single non-match part when no query", () => {
    expect(highlightParts("hello", "")).toEqual([{ t: "hello", m: false }]);
    expect(highlightParts("hello", null)).toEqual([{ t: "hello", m: false }]);
  });
  it("case-insensitive match with plain part", () => {
    expect(highlightParts("Hello world", "HELLO")).toEqual([
      { t: "Hello", m: true },
      { t: " world", m: false },
    ]);
  });
  it("multiple matches", () => {
    expect(highlightParts("aba", "a")).toEqual([
      { t: "a", m: true },
      { t: "b", m: false },
      { t: "a", m: true },
    ]);
  });
  it("no match returns whole text non-match", () => {
    expect(highlightParts("abc", "z")).toEqual([{ t: "abc", m: false }]);
  });
});

describe("taskMatchesSearch (M1-5 E8)", () => {
  it("matches by title", () => {
    expect(taskMatchesSearch({ title: "修复 bug", id: "t_1" }, "bug")).toBe(true);
    expect(taskMatchesSearch({ title: "修复 BUG", id: "t_1" }, "bug")).toBe(true);
  });
  it("matches by id, case-insensitive", () => {
    expect(taskMatchesSearch({ title: "x", id: "t_123" }, "123")).toBe(true);
    expect(taskMatchesSearch({ title: "x", id: "T_123" }, "t_123")).toBe(true);
  });
  it("empty query matches everything", () => {
    expect(taskMatchesSearch({ title: "", id: "" }, "")).toBe(true);
    expect(taskMatchesSearch({ title: "x", id: "t_1" }, "  ")).toBe(true);
  });
  it("no match", () => {
    expect(taskMatchesSearch({ title: "x", id: "t_1" }, "zzz")).toBe(false);
  });
});

describe("fmtTime", () => {
  it("falsy → —", () => {
    expect(fmtTime(0)).toBe("—");
    expect(fmtTime(null)).toBe("—");
  });
  it("formats YYYY-MM-DD HH:mm with zero padding (local tz)", () => {
    const ts = 1750000000;
    const d = new Date(ts * 1000);
    const p = (n) => String(n).padStart(2, "0");
    const want = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    expect(fmtTime(ts)).toBe(want);
  });
});

describe("ago", () => {
  it("falsy → empty", () => {
    expect(ago(0)).toBe("");
    expect(ago(null)).toBe("");
  });
  it("seconds / minutes / hours / days", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(ago(now)).toBe("0秒前");
    expect(ago(now - 90)).toBe("1分钟前");
    expect(ago(now - 7200)).toBe("2小时前");
    expect(ago(now - 3 * 86400)).toBe("3天前");
  });
});

describe("dur", () => {
  it("null/undefined → —", () => {
    expect(dur(null)).toBe("—");
    expect(dur(undefined)).toBe("—");
  });
  it("units", () => {
    expect(dur(30)).toBe("30秒");
    expect(dur(120)).toBe("2分钟");
    expect(dur(7200)).toBe("2.0小时");
    expect(dur(2 * 86400)).toBe("2.0天");
  });
});

describe("linkifyFilePaths (交付产物下载链接)", () => {
  it("empty → empty", () => {
    expect(linkifyFilePaths("")).toBe("");
    expect(linkifyFilePaths(null)).toBe("");
  });
  it("injects dl-link anchor for 报告/文档/产物 paths", () => {
    const out = linkifyFilePaths("报告：/tmp/r.md");
    expect(out).toContain('class="dl-link"');
    expect(out).toContain('href="/api/download?path=%2Ftmp%2Fr.md"');
    expect(out).toContain("📄 r.md");
  });
});

describe("mdToHtml", () => {
  it("empty → empty", () => {
    expect(mdToHtml("")).toBe("");
    expect(mdToHtml(null)).toBe("");
  });
  it("escapes HTML, renders bold/inline-code/newline", () => {
    expect(mdToHtml("**加粗** and `代码`\n下一行")).toBe(
      "<strong>加粗</strong> and <code>`代码`</code><br>下一行"
    );
  });
  it("escapes raw HTML", () => {
    expect(mdToHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });
  it("code block placeholder round-trip", () => {
    expect(mdToHtml("前\n```\nconst x = 1;\n```\n后")).toBe(
      "前<br><pre><code>const x = 1;</code></pre><br>后"
    );
  });
  it("deliverable path → download link", () => {
    expect(mdToHtml("交付文档：/opt/hermes/kanban/daily/a.md")).toBe(
      '<a class="dl-link" href="/api/download?path=%2Fopt%2Fhermes%2Fkanban%2Fdaily%2Fa.md" target="_blank" rel="noopener">📄 a.md</a>'
    );
  });
});
