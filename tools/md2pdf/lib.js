/* Node side of the Markdown -> PDF tool (md2pdf.js, server.js).  The Markdown setup itself is web/kamotish-markdown.js,
 * shared with the browser app in site/, so the PDF looks exactly like the preview. */
'use strict';
const fs = require('fs'), path = require('path');
const KM = require('../../web/kamotish-markdown.js');
const Kamotish = require('../../web/kamotish.js').Kamotish;

const md = KM.create({ markdownit: require('markdown-it'), texmath: require('markdown-it-texmath'), katex: require('katex'),
  Kamotish, kamotishPlugin: require('../../web/markdown-it-kamotish.js') });

const KATEX_CSS = require.resolve('katex/dist/katex.min.css');
const KATEX_DIR = path.dirname(KATEX_CSS);
// browser copies of the libraries, served by server.js under /vendor/ (and copied to the online site the same way)
const VENDOR = {
  'markdown-it.min.js': require.resolve('markdown-it/dist/markdown-it.min.js'),
  'texmath.js': require.resolve('markdown-it-texmath/texmath.js'),
  'katex': KATEX_DIR
};

/* opts: title, base (URL relative links/images resolve against), katexHref, paper ('A4'|'A5'|'Letter'|'B5'), fontSize (pt) */
function toHtml(mdText, opts) {
  return KM.documentHtml(md, mdText, Object.assign({ katexHref: 'file://' + KATEX_CSS, Kamotish }, opts));
}
const problems = mdText => KM.problems(md, mdText, Kamotish);

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

/* html -> PDF bytes.  url: load this URL instead of setContent (much faster for big documents, and needed for file://) */
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

module.exports = { toHtml, problems, printPdf, closeBrowser, KATEX_DIR, VENDOR };
