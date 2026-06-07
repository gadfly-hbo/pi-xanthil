import { Marked } from "marked";

/**
 * Deterministic Markdown -> self-contained HTML report renderer.
 *
 * Replaces the previous LLM-based approach: weak models either timed out
 * generating thousands of lines of HTML or ignored instructions and echoed
 * garbage. A static template + markdown parser produces a polished, consistent
 * report instantly with zero failure modes.
 */

interface TocItem {
  id: string;
  text: string;
  level: number; // 2 or 3
}

function slugify(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  let slug = base;
  let i = 2;
  while (used.has(slug)) slug = `${base}-${i++}`;
  used.add(slug);
  return slug;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a Markdown report into a complete, self-contained HTML document with
 * an auto-generated sidebar table of contents and a polished CSS theme.
 */
export function renderMarkdownReportToHtml(reportName: string, markdown: string): string {
  const toc: TocItem[] = [];
  const usedSlugs = new Set<string>();
  const marked = new Marked({ gfm: true, breaks: false });

  // Inject stable ids into h2/h3 and collect them for the sidebar.
  marked.use({
    renderer: {
      heading(token) {
        const depth = token.depth;
        const text = this.parser.parseInline(token.tokens);
        if (depth === 2 || depth === 3) {
          const id = slugify(token.text, usedSlugs);
          toc.push({ id, text: token.text.replace(/<[^>]+>/g, ""), level: depth });
          return `<h${depth} id="${id}">${text}</h${depth}>\n`;
        }
        return `<h${depth}>${text}</h${depth}>\n`;
      },
    },
  });

  const body = marked.parse(markdown) as string;

  const tocHtml = toc
    .map(
      (item) =>
        `<a href="#${item.id}" class="toc-l${item.level}" data-target="${item.id}">${escapeHtml(item.text)}</a>`,
    )
    .join("\n");

  const title = escapeHtml(reportName.replace(/\.(md|markdown|txt)$/i, ""));

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{--accent:#6366f1;--accent-soft:#eef0ff;--bg:#f6f7fb;--card:#fff;--text:#1f2433;--muted:#6b7280;--border:#e5e7eb;--code-bg:#f1f5f9}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.75;font-size:15px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.layout{display:flex;max-width:1200px;margin:0 auto}
.sidebar{position:sticky;top:0;align-self:flex-start;width:240px;height:100vh;overflow-y:auto;padding:28px 14px 28px 24px;flex-shrink:0;border-right:1px solid var(--border)}
.sidebar h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 14px}
.sidebar nav{display:flex;flex-direction:column;gap:2px}
.sidebar nav a{display:block;padding:5px 10px;border-radius:7px;font-size:13px;color:var(--muted);border-left:2px solid transparent;transition:background .15s,color .15s}
.sidebar nav a:hover{background:var(--accent-soft);color:var(--accent);text-decoration:none}
.sidebar nav a.active{background:var(--accent-soft);color:var(--accent);border-left-color:var(--accent);font-weight:600}
.sidebar nav a.toc-l3{padding-left:22px;font-size:12.5px}
.content{flex:1;min-width:0;padding:40px 48px 80px;background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.04)}
.content>h1:first-child{margin-top:0}
h1{font-size:30px;font-weight:700;line-height:1.3;margin:0 0 24px;padding-bottom:14px;border-bottom:2px solid var(--accent)}
h2{font-size:21px;font-weight:650;margin:38px 0 14px;padding-left:12px;border-left:4px solid var(--accent)}
h3{font-size:17px;font-weight:600;margin:26px 0 10px;color:#374151}
h4{font-size:15px;font-weight:600;margin:20px 0 8px;color:#4b5563}
p{margin:10px 0}
ul,ol{margin:10px 0;padding-left:24px}
li{margin:4px 0}
strong{color:#111827}
hr{border:0;border-top:1px solid var(--border);margin:32px 0}
blockquote{margin:16px 0;padding:12px 18px;background:var(--accent-soft);border-left:4px solid var(--accent);border-radius:0 8px 8px 0;color:#374151}
blockquote p{margin:6px 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code-bg);padding:2px 6px;border-radius:5px;font-size:.88em;color:#be123c}
pre{background:var(--code-bg);padding:14px 16px;border-radius:8px;overflow-x:auto;margin:14px 0}
pre code{background:none;padding:0;color:var(--text)}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13.5px;display:block;overflow-x:auto}
thead{background:var(--accent)}
th{color:#fff;font-weight:600;text-align:left;padding:9px 12px;white-space:nowrap}
td{padding:8px 12px;border-bottom:1px solid var(--border)}
tbody tr:nth-child(odd){background:#fafbff}
tbody tr:hover{background:var(--accent-soft)}
.report-meta{font-size:12px;color:var(--muted);margin-bottom:28px}
@media(max-width:860px){.sidebar{display:none}.content{padding:28px 20px 60px}.layout{max-width:100%}}
</style>
</head>
<body>
<div class="layout">
<aside class="sidebar">
<h2>目录</h2>
<nav id="toc">
${tocHtml}
</nav>
</aside>
<main class="content">
<div class="report-meta">报告文件：${escapeHtml(reportName)}</div>
${body}
</main>
</div>
<script>
(function(){
  var links=[].slice.call(document.querySelectorAll('#toc a'));
  if(!links.length)return;
  var map={};links.forEach(function(a){map[a.dataset.target]=a;});
  var heads=links.map(function(a){return document.getElementById(a.dataset.target);}).filter(Boolean);
  function spy(){
    var top=window.scrollY+120,cur=heads[0];
    for(var i=0;i<heads.length;i++){if(heads[i].offsetTop<=top)cur=heads[i];}
    links.forEach(function(a){a.classList.remove('active');});
    if(cur&&map[cur.id])map[cur.id].classList.add('active');
  }
  window.addEventListener('scroll',spy,{passive:true});spy();
})();
</script>
</body>
</html>`;
}
