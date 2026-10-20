#!/usr/bin/env node
/* Markdown -> PDF with Kamotish (\kamotish{…}) and math ($…$, $$…$$, \(…\), \[…\]).
 *
 *   node md2pdf.js input.md [more.md …] [-o out.pdf | -d outdir] [--html] [--paper A5] [--size 12]
 *
 * Web GUI for many files: node server.js
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const L = require('./lib');

async function main() {
  const argv = process.argv.slice(2), files = [], o = { paper: 'A4', fontSize: 11 };
  let out = null, outDir = null, keepHtml = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') out = argv[++i]; else if (a === '-d') outDir = argv[++i];
    else if (a === '--html') keepHtml = true; else if (a === '--paper') o.paper = argv[++i];
    else if (a === '--size') o.fontSize = Number(argv[++i]); else files.push(a);
  }
  if (!files.length) { console.error('usage: node md2pdf.js input.md [more.md …] [-o out.pdf | -d outdir] [--html] [--paper A5] [--size 12]'); process.exit(1); }
  if (out && files.length > 1) { console.error('-o only works with one input; use -d for several'); process.exit(1); }
  try {
    for (const f of files) {
      const input = path.resolve(f), name = path.basename(input).replace(/\.md$/i, '');
      const output = path.resolve(out || path.join(outDir || path.dirname(input), name + '.pdf'));
      const text = fs.readFileSync(input, 'utf8');
      const bad = L.problems(text);
      if (bad.length) console.warn(`${name}: ${bad.length} Kamotish piece(s) could not be read:\n  ` + bad.slice(0, 10).map(p => '第 ' + p.line + ' 行: ' + p.source).join('\n  '));
      const html = L.toHtml(text, Object.assign({ title: name, base: 'file://' + encodeURI(path.dirname(input)) + '/' }, o));
      const htmlPath = keepHtml ? output.replace(/\.pdf$/i, '') + '.html' : path.join(os.tmpdir(), 'md2pdf-' + process.pid + '.html');
      fs.writeFileSync(htmlPath, html);
      try {
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, await L.printPdf(null, { url: 'file://' + htmlPath, paper: o.paper }));
      } finally { if (!keepHtml) fs.unlinkSync(htmlPath); }
      console.log('wrote', output);
    }
  } finally { await L.closeBrowser(); }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
