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
    return md;
  }

  // the \kamotish{…} pieces the renderer cannot read (shown in red), with where they are in the source.
  // index = the n-th \kamotish in the document, which is also the n-th span.kamotish in the rendered page.
  function problems(md, text, Kamotish) {
    const out = [], lines = text.split('\n'); let index = 0;
    const walk = (toks, parent) => toks.forEach(t => {
      if (t.type === 'kamotish') {
        if (Kamotish.renderInline(t.content).includes('kamo-err')) {
          const src = parent.content, source = src.slice(t.meta.start, t.meta.end);
          let line = (parent.map ? parent.map[0] : 0) + (src.slice(0, t.meta.start).match(/\n/g) || []).length;
          let column = lines[line] !== undefined ? lines[line].indexOf(source) : -1;
          if (column < 0) {                                       // map missing or line shifted: search the whole text
            const at = text.indexOf(source);
            if (at >= 0) { line = (text.slice(0, at).match(/\n/g) || []).length; column = at - text.lastIndexOf('\n', at - 1) - 1; }
            else column = 0;
          }
          out.push({ index, line: line + 1, column, source, content: t.content });
        }
        index++;
      }
      if (t.children) walk(t.children, t);
    });
    walk(md.parse(text, {}), null);
    return out;
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function documentHtml(md, text, o) {
    o = Object.assign({ title: 'document', base: '', katexHref: '', paper: 'A4', fontSize: 11 }, o);
    return `<!doctype html><html lang="zh" data-kamotish="off"><head><meta charset="utf-8"><title>${esc(o.title)}</title>
${o.base ? `<base href="${esc(o.base)}">` : ''}
${o.katexHref ? `<link rel="stylesheet" href="${esc(o.katexHref)}">` : ''}
<style>
${o.Kamotish ? o.Kamotish.css : ''}
@page { size: ${o.paper}; margin: 18mm 16mm 20mm; }
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
${md.render(text)}
</body></html>`;
  }

  return { create, problems, documentHtml, MATH_FENCES };
});
