#!/usr/bin/env node
/* Local version of the Kamotish tool:  node server.js [port]   then open http://127.0.0.1:4747
 * Serves the same app as the online version (site/) and adds what a web page cannot do on its own: load a folder by
 * path, save edits back to the file, print PDFs with page numbers through Chrome, write PDFs into a folder.
 * Only listens on 127.0.0.1.  Writes only .md files that were loaded by path, and PDFs into the folder you name.
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const L = require('./lib');

const PORT = Number(process.argv[2]) || 4747, HOST = '127.0.0.1', ORIGIN = `http://${HOST}:${PORT}`;
const ROOT = path.join(__dirname, '..', '..'), SITE = path.join(ROOT, 'site'), WEB = path.join(ROOT, 'web');
const WEB_FILES = ['kamotish.js', 'markdown-it-kamotish.js', 'kamotish-markdown.js', 'demo.html'];
const allowedDirs = new Set();                      // folders loaded by path: their files (images) may be served
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.zip': 'application/zip', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf' };

const jobs = new Map();                              // id -> html, loaded by Chrome via /job/<id> (faster than setContent)
let queue = Promise.resolve();                       // one PDF at a time
const serial = fn => (queue = queue.then(fn, fn));

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { fail(e); } });
    req.on('error', fail);
  });
}
function serveFile(res, file) {
  fs.readFile(file, (err, data) => err ? send(res, 404, 'not found', 'text/plain')
    : send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'));
}
const inside = (file, dir) => { const r = path.relative(dir, file); return r && !r.startsWith('..') && !path.isAbsolute(r); };
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const sortKey = n => n.replace(/[一二三四五六七八九十]+/g, m => String(m.length === 1 ? CN[m] : m === '十' ? 10 : (m[0] === '十' ? 10 + CN[m[1]] : CN[m[0]] * 10 + (CN[m[2]] || 0))).padStart(3, '0'));
const byName = (a, b) => sortKey(a).localeCompare(sortKey(b), 'zh', { numeric: true });
const safeName = n => (String(n || 'document').replace(/\.md$/i, '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_') || 'document');

function htmlFor(b) {
  const base = b.dir && allowedDirs.has(b.dir) ? ORIGIN + '/fs' + encodeURI(b.dir) + '/' : '';
  return L.toHtml(String(b.md || ''), { title: safeName(b.name), base, katexHref: ORIGIN + '/vendor/katex/katex.min.css',
    paper: b.paper || 'A4', fontSize: b.fontSize || 11 });
}

async function handle(req, res) {
  const url = new URL(req.url, ORIGIN), p = decodeURIComponent(url.pathname);
  if (req.method === 'GET' && p === '/api/info') return send(res, 200, { local: true, version: 1 });
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, path.join(SITE, 'index.html'));
  if (req.method === 'GET' && WEB_FILES.includes(p.slice(1))) return serveFile(res, path.join(WEB, p.slice(1)));
  if (req.method === 'GET' && /^\/kamotish-(chrome|firefox)\.zip$/.test(p)) return serveFile(res, path.join(ROOT, 'dist', p.slice(1)));
  if (req.method === 'GET' && p.startsWith('/vendor/')) {
    const rest = p.slice(8);
    if (rest.startsWith('katex/')) { const f = path.join(L.KATEX_DIR, rest.slice(6)); return inside(f, L.KATEX_DIR) ? serveFile(res, f) : send(res, 403, 'forbidden', 'text/plain'); }
    return L.VENDOR[rest] && rest !== 'katex' ? serveFile(res, L.VENDOR[rest]) : send(res, 404, 'not found', 'text/plain');
  }
  if (req.method === 'GET' && /^\/[\w.-]+\.(js|css|png|svg|ico)$/.test(p) && fs.existsSync(path.join(SITE, p.slice(1)))) return serveFile(res, path.join(SITE, p.slice(1)));
  if (req.method === 'GET' && p.startsWith('/job/')) {
    const html = jobs.get(p.slice(5));
    return html ? send(res, 200, html, 'text/html; charset=utf-8') : send(res, 404, 'not found', 'text/plain');
  }
  if (req.method === 'GET' && p.startsWith('/fs/')) {
    const f = path.resolve(p.slice(3));
    for (const d of allowedDirs) if (inside(f, d)) return serveFile(res, f);
    return send(res, 403, 'forbidden', 'text/plain');
  }
  if (req.method === 'GET' && p === '/api/list') {                 // all .md files in a folder (not recursive)
    const dir = path.resolve(url.searchParams.get('dir') || '');
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return send(res, 400, { error: '文件夹不存在: ' + dir });
    allowedDirs.add(dir);
    const files = fs.readdirSync(dir).filter(f => /\.md$/i.test(f)).sort(byName)
      .map(f => ({ name: f, dir, md: fs.readFileSync(path.join(dir, f), 'utf8') }));
    return send(res, 200, { dir, files });
  }
  if (req.method === 'POST' && p === '/api/save') {               // write an edited file back (only .md files in a loaded folder)
    const b = await readBody(req), dir = String(b.dir || ''), name = String(b.name || '');
    if (!allowedDirs.has(dir) || path.basename(name) !== name || !/\.(md|markdown)$/i.test(name) || !fs.existsSync(path.join(dir, name)))
      return send(res, 400, { error: '只能保存从路径载入的 .md 文件' });
    fs.writeFileSync(path.join(dir, name), String(b.md || ''), 'utf8');
    return send(res, 200, { saved: path.join(dir, name) });
  }
  if (req.method === 'POST' && p === '/api/pdf') {
    const b = await readBody(req);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    jobs.set(id, htmlFor(b));
    let pdf;
    try { pdf = await serial(() => L.printPdf(null, { url: ORIGIN + '/job/' + id, paper: b.paper || 'A4', pageNumbers: b.pageNumbers !== false })); }
    finally { jobs.delete(id); }
    if (b.saveTo) {
      const dir = path.resolve(String(b.saveTo));
      if (!path.isAbsolute(String(b.saveTo))) return send(res, 400, { error: '输出文件夹要写完整路径 (以 / 开头)' });
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, safeName(b.name) + '.pdf');
      fs.writeFileSync(file, pdf);
      return send(res, 200, { saved: file, bytes: pdf.length });
    }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length,
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(safeName(b.name) + '.pdf') });
    return res.end(pdf);
  }
  send(res, 404, 'not found', 'text/plain');
}

http.createServer((req, res) => handle(req, res).catch(e => { console.error(e); send(res, 500, { error: String(e.message || e) }); }))
  .listen(PORT, HOST, () => console.log('卡谋语工具 (本地版):  ' + ORIGIN));
process.on('SIGINT', () => L.closeBrowser().finally(() => process.exit(0)));
