/* Shared by md2pdf.js (command line) and server.js (web GUI): Markdown -> HTML with Kamotish and math, HTML -> PDF. */
'use strict';
const fs = require('fs');
const MarkdownIt = require('markdown-it'), texmath = require('markdown-it-texmath'), katex = require('katex');
const Kamotish = require('../../web/kamotish.js').Kamotish;

const md = new MarkdownIt({ html: true, linkify: true, typographer: false })
  .use(texmath, { engine: katex, delimiters: ['dollars', 'brackets'], katexOptions: { throwOnError: false } })
  .use(require('../../web/markdown-it-kamotish.js'), Kamotish);

// ```latex / ```tex / ```math / ```katex code blocks are display formulas, not code
const MATH_FENCES = ['latex', 'tex', 'math', 'katex'], fence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, i, options, env, self) => {
  const t = tokens[i];
  if (!MATH_FENCES.includes(t.info.trim().split(/\s+/)[0].toLowerCase())) return fence(tokens, i, options, env, self);
  return '<div class="math-block">' + katex.renderToString(t.content, { displayMode: true, throwOnError: false }) + '</div>\n';
};

const KATEX_CSS = require.resolve('katex/dist/katex.min.css');
const KATEX_DIR = require('path').dirname(KATEX_CSS);

/* opts: title, base (URL relative links/images resolve against), katexHref, paper ('A4'|'A5'|'Letter'|'B5'), fontSize (pt) */
function toHtml(mdText, opts) {
  const o = Object.assign({ title: 'document', base: '', katexHref: 'file://' + KATEX_CSS, paper: 'A4', fontSize: 11 }, opts);
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${md.utils.escapeHtml(o.title)}</title>
${o.base ? `<base href="${md.utils.escapeHtml(o.base)}">` : ''}
<link rel="stylesheet" href="${md.utils.escapeHtml(o.katexHref)}">
<style>
${Kamotish.css}
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
eq { display: inline; } eqn, .math-block { display: block; overflow-x: auto; margin: .8em 0; break-inside: avoid; }
</style></head><body>
${md.render(mdText)}
</body></html>`;
}

// the \kamotish{…} pieces that contain something the renderer cannot read (shown in red)
function problems(mdText) {
  const out = [], env = {};
  const walk = toks => toks.forEach(t => {
    if (t.type === 'kamotish' && Kamotish.renderInline(t.content).includes('kamo-err')) out.push(t.content);
    if (t.children) walk(t.children);
  });
  walk(md.parse(mdText, env));
  return out;
}

function findChrome() {
  const c = [process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const hit = c.find(p => fs.existsSync(p));
  if (!hit) throw new Error('Chrome not found; set CHROME=/path/to/chrome');
  return hit;
}

// one headless Chrome, started on first use and kept for later PDFs (the installed Chrome is only launched, never changed)
let browserP = null;
function browser() {
  if (!browserP) browserP = require('puppeteer-core').launch({ executablePath: findChrome(), headless: true, args: ['--allow-file-access-from-files'] })
    .catch(e => { browserP = null; throw e; });
  return browserP;
}
async function closeBrowser() { if (browserP) { const b = await browserP; browserP = null; await b.close(); } }

/* html -> PDF bytes.  url: load this URL instead of setContent (needed for file:// resources) */
async function printPdf(html, opts) {
  const o = Object.assign({ paper: 'A4', pageNumbers: true, url: null }, opts);
  const page = await (await browser()).newPage();
  try {
    if (o.url) await page.goto(o.url, { waitUntil: 'networkidle0', timeout: 120000 });
    else await page.setContent(html, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({
      format: o.paper, printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: !!o.pageNumbers, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:8pt;color:#888;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    }));
  } finally { await page.close(); }
}

module.exports = { toHtml, problems, printPdf, closeBrowser, KATEX_DIR };
