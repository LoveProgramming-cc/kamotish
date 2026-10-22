/*!
 * kamotish-markdown - the one Markdown setup shared by the online tool, the local GUI and the PDF exporter, so that
 * all three render a document the same way.
 *
 *   const KM = require('kamotish-markdown.js')            // Node
 *   window.KamotishMarkdown                               // browser
 *
 *   const md = KM.create({ markdownit, texmath, katex, Kamotish, kamotishPlugin })
 *   KM.problems(md, text, Kamotish)  -> [{ index, line, column, source, content }]   unreadable \kamotish{…}
 *   KM.documentHtml(md, text, { title, base, katexHref, paper, fontSize, Kamotish })  -> a complete HTML page
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KamotishMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MATH_FENCES = ['latex', 'tex', 'math', 'katex'];

  function create(d) {
    const md = d.markdownit({ html: true, linkify: true, typographer: false })
      .use(d.texmath, { engine: d.katex, delimiters: ['dollars', 'brackets'], katexOptions: { throwOnError: false } })
      .use(d.kamotishPlugin, d.Kamotish);
    // ```latex / ```tex / ```math / ```katex code blocks are display formulas, not code
    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, i, options, env, self) => {
      const t = tokens[i];
      if (!MATH_FENCES.includes(t.info.trim().split(/\s+/)[0].toLowerCase())) return fence(tokens, i, options, env, self);
      return '<div class="math-block">' + d.katex.renderToString(t.content, { displayMode: true, throwOnError: false }) + '</div>\n';
    };
    const image = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, i, options, env, self) => {
      const t = tokens[i], src = t.attrGet('src');
      if (env.imageSources && src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) {
        const key = new URL(src, new URL(env.documentPath || '', 'https://kamotish.invalid/')).pathname;
        if (Object.prototype.hasOwnProperty.call(env.imageSources, key)) t.attrSet('src', env.imageSources[key]);
      }
      return image(tokens, i, options, env, self);
    };
    return md;
  }

  // the \kamotish{…} pieces the renderer cannot read (shown in red), with where they are in the source.
  // index = the n-th \kamotish in the document, which is also the n-th span.kamotish in the rendered page.
  function problems(md, text, Kamotish) {
    const out = [], lines = text.split('\n'); let index = 0;
    const walk = (toks, parent) => toks.forEach(t => {
      if (t.type === 'kamotish') {
        const rendered = Kamotish.renderInline(t.content);
        if (rendered.includes('kamo-err')) {
          const src = parent.content, source = src.slice(t.meta.start, t.meta.end);
          let line = (parent.map ? parent.map[0] : 0) + (src.slice(0, t.meta.start).match(/\n/g) || []).length;
          let column = lines[line] !== undefined ? lines[line].indexOf(source) : -1;
          if (column < 0) {                                       // map missing or line shifted: search the whole text
            const at = text.indexOf(source);
            if (at >= 0) { line = (text.slice(0, at).match(/\n/g) || []).length; column = at - text.lastIndexOf('\n', at - 1) - 1; }
            else column = 0;
          }
          const decode = value => value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
          const errors = [...rendered.matchAll(/<span class="kamo-err" title="([^"]*)">([\s\S]*?)<\/span>/g)]
            .map(m => ({ text: decode(m[2]), reason: decode(m[1]) }));
          out.push({ index, line: line + 1, column, source, content: t.content, errors });
        }
        index++;
      }
      if (t.children) walk(t.children, t);
    });
    walk(md.parse(text, {}), null);
    return out;
  }

  function problemReport(md, documents, Kamotish) {
    const entries = documents.map(d => ({ name: d.name, issues: problems(md, d.md, Kamotish) }));
    const total = entries.reduce((n, d) => n + d.issues.length, 0);
    const lines = ['卡谋语渲染错误报告', `检查文件：${entries.length} 个`, `无法渲染：${total} 处`, ''];
    for (const d of entries) {
      lines.push(`文件：${d.name}`, `结果：${d.issues.length ? d.issues.length + ' 处无法渲染' : '未发现无法渲染的卡谋语'}`);
      for (const q of d.issues) {
        lines.push(`第 ${q.line} 行，第 ${Math.max(0, q.column) + 1} 列`, `源码：${q.source}`);
        for (const e of q.errors) lines.push(`错误片段：${e.text}`, `原因：${e.reason === 'unknown grapheme' ? '未知字素（unknown grapheme）' : e.reason}`);
        lines.push('');
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function documentHtml(md, text, o) {
    o = Object.assign({ title: 'document', base: '', katexHref: '', paper: 'A4', fontSize: 11 }, o);
    const position = ['left', 'right'].includes(o.pageAlign) ? o.pageAlign : 'center';
    const content = o.pageFormat === 'number' ? 'counter(page)' : o.pageFormat === 'chinese'
      ? '"第 " counter(page) " 页"' : 'counter(page) " / " counter(pages)';
    const pageFooter = o.pageNumbers ? `@bottom-${position} { content: ${content};
      font-family: sans-serif; font-size: ${Math.min(16, Math.max(6, Number(o.pageSize) || 8))}pt; color: #888; }` : '';
    return `<!doctype html><html lang="zh" data-kamotish="off"><head><meta charset="utf-8"><title>${esc(o.title)}</title>
${o.base ? `<base href="${esc(o.base)}">` : ''}
${o.katexHref ? `<link rel="stylesheet" href="${esc(o.katexHref)}">` : ''}
<style>
${o.Kamotish ? o.Kamotish.css : ''}
@page { size: ${o.paper}; margin: 18mm 16mm 20mm; ${pageFooter} }
body { font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
       font-size: ${Number(o.fontSize) || 11}pt; line-height: 1.75; color: #111; background: #fff; }
@media screen { body { max-width: 46em; margin: 2em auto; padding: 0 1.5em; } }
h1, h2, h3, h4 { line-height: 1.35; break-after: avoid; }
h1 { font-size: 1.8em; } h2 { font-size: 1.45em; border-bottom: 1px solid #ccc; padding-bottom: .2em; }
h3 { font-size: 1.22em; } h4 { font-size: 1.09em; }
table { border-collapse: collapse; margin: .8em 0; break-inside: auto; }
tr { break-inside: avoid; }
th, td { border: 1px solid #bbb; padding: .3em .6em; vertical-align: top; }
th { background: #f3f3f3; }
code { font-family: Menlo, monospace; font-size: .9em; background: #f4f4f4; padding: 0 .2em; border-radius: 3px; }
pre { background: #f4f4f4; padding: .7em; overflow-wrap: anywhere; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
blockquote { margin: .8em 0; padding: .1em 1em; border-left: 3px solid #ccc; color: #444; }
hr { border: none; border-top: 1px solid #ccc; margin: 1.5em 0; }
img { max-width: 100%; }
.kamo-err { color: #c00; background: #fee; }
.kamo-flash { outline: 3px solid #f59e0b; outline-offset: 2px; border-radius: 3px; }
eq { display: inline; } eqn, .math-block { display: block; overflow-x: auto; margin: .8em 0; break-inside: avoid; }
</style></head><body>
${md.render(text, { imageSources: o.imageSources, documentPath: o.documentPath })}
</body></html>`;
  }

  return { create, problems, problemReport, documentHtml, MATH_FENCES };
});
