/* Run from the repository root: node tools/md2pdf/test-browser.cjs
 * Requires installed Chrome (or CHROME) and pdftotext on PATH. */
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core'), L = require('./lib');
const root = path.resolve(__dirname, '../..');
const port = process.env.TEST_PORT || '4877', origin = `http://127.0.0.1:${port}`;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), port]);
  let browser;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kamotish-test-'));
  try {
    await new Promise((ok, bad) => { server.stdout.once('data', ok); server.once('error', bad); server.once('exit', code => bad(Error(`Server exited ${code}`))); });
    browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
    // Exercise the online UI while using the local server for its static files.
    await page.setRequestInterception(true);
    page.on('request', r => r.url().endsWith('/api/info') ? r.respond({ status: 404, body: '{}' }) : r.continue());
    await page.goto(origin, { waitUntil: 'networkidle0' });
    await page.evaluate(() => { add([{ name: '测试文稿.md', md: '# Test\n\nHello' }]); tab('doc'); });
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.title === '测试文稿');
    await page.evaluate(() => {
      const w = document.querySelector('#preview').contentWindow;
      w.print = () => { window.printTitle = document.title; window.frameTitle = w.document.title; w.dispatchEvent(new Event('afterprint')); };
    });
    await page.click('#pdfBtn');
    assert.equal(await page.evaluate(() => window.printTitle), '测试文稿');
    assert.equal(await page.evaluate(() => window.frameTitle), '测试文稿');
    assert.equal(await page.title(), '卡谋语工具');
    await page.select('#pageFormat', 'chinese'); await page.select('#pageAlign', 'right'); await page.select('#pageSize', '10');
    assert(await page.$eval('#preview', e => e.srcdoc.includes('@bottom-right')));
    await page.click('#pagenum');
    assert.equal(await page.$eval('#pageOptions', e => getComputedStyle(e).display), 'none');
    assert.equal(await page.$eval('#preview', e => e.srcdoc.includes('@bottom-')), false);
    // Verify actual PDF counters, not just the generated CSS.
    const pdfPage = await browser.newPage();
    const text = '<p>first</p><p style="break-before:page">second</p>';
    for (const [format, expected] of [['chinese', /第\s*2\s*页/], ['total', /2\s*\/\s*2/], ['number', /\b2\b/]]) {
      await pdfPage.setContent(L.toHtml(text, { pageNumbers: true, pageFormat: format, pageAlign: 'right', pageSize: 10 }));
      const pdf = path.join(temporary, format + '.pdf');
      await pdfPage.pdf({ path: pdf, preferCSSPageSize: true, displayHeaderFooter: false });
      assert.match(execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }), expected);
    }
    await pdfPage.close();
    // Native local PDF API uses the same CSS, without a second footer.
    const response = await fetch(origin + '/api/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试.md', md: text, pageNumbers: true, pageFormat: 'chinese', pageAlign: 'right' }) });
    assert(response.ok); assert.match(response.headers.get('content-disposition'), /%E6%B5%8B%E8%AF%95.pdf/);
    const localPdf = path.join(temporary, 'local.pdf'); fs.writeFileSync(localPdf, Buffer.from(await response.arrayBuffer()));
    assert.equal((execFileSync('pdftotext', ['-layout', localPdf, '-'], { encoding: 'utf8' }).match(/第\s*2\s*页/g) || []).length, 1);
    // FileReader, relative image paths, nested headings, and shared renderer.
    const source = '# 标题\n\n<!-- C01-P01 -->\n\\kamotish{\\nou\\3中国\\mi}\n\n> 引用\n\n![插图](../images/图%20片.png)\n\n[说明](说明.md)\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    await page.bringToFront();
    await page.evaluate(async ({ source, png }) => {
      const image = new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], '图 片.png', { type: 'image/png' });
      const [d] = await KamotishFiles.readEntries([
        { file: new File([source], '测试.md'), path: '书/chapters/测试.md' },
        { file: image, path: '书/images/图 片.png' }
      ]);
      add([d]); show(d);
    }, { source, png });
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('img')?.naturalWidth > 0);
    const popupPromise = new Promise(resolve => page.once('popup', resolve));
    await page.click('#writerBtn'); const writer = await popupPromise;
    writer.on('pageerror', e => errors.push(e.message)); writer.setDefaultTimeout(15000);
    await writer.waitForFunction(() => document.querySelector('#docTitle')?.value === '测试');
    assert.equal(await writer.$$eval('#editor .kamo-err', e => e.length), 0);
    assert.equal(await writer.$$eval('#editor .kamo-run', e => e.length), 1);
    assert.equal(await writer.$$eval('#editor table', e => e.length), 1);
    await writer.waitForFunction(() => document.querySelector('#editor img')?.naturalWidth > 0);
    const native = await writer.evaluate(() => exportNative().content);
    await writer.evaluate(() => importNative(exportNative()));
    assert.deepEqual(await writer.evaluate(() => exportNative().content), native);
    assert.match(await writer.evaluate(() => exportMarkdown()), /!\[插图\]\(<\.\.\/images\/%E5%9B%BE%20%E7%89%87.png>\)/);
    assert.equal(await writer.evaluate(() => sourceOfRun(makeKamoRun('\\no\\3'))), '\\nou\\3');
    assert.equal(await writer.evaluate(() => KamoIME.candidates('nou')[0].value), '\\nou');
    // Direct .md file import, including the user's real document when supplied.
    const input = process.env.KAMOTISH_TEST_MD || path.join(temporary, 'direct.md');
    if (!process.env.KAMOTISH_TEST_MD) fs.writeFileSync(input, source);
    await (await writer.$('#fileInput')).uploadFile(input);
    const expected = (fs.readFileSync(input, 'utf8').match(/\\kamotish\{/g) || []).length;
    await writer.waitForFunction(n => document.querySelectorAll('#editor .kamo-run').length === n, {}, expected);
    assert.equal(await writer.$$eval('#editor .kamo-run', e => e.length), expected);
    if (process.env.KAMOTISH_TEST_MD) {
      const raw = fs.readFileSync(input, 'utf8'), entries = [{ path: 'book/' + path.basename(input), name: path.basename(input), text: raw }];
      const refs = [...raw.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
      for (const ref of new Set(refs)) entries.push({ path: 'book/' + ref, name: path.basename(ref), base64: fs.readFileSync(path.resolve(path.dirname(input), decodeURIComponent(ref))).toString('base64') });
      const count = await writer.evaluate(async entries => {
        const files = entries.map(e => ({ path: e.path, file: new File([e.text === undefined ? Uint8Array.from(atob(e.base64), c => c.charCodeAt(0)) : e.text], e.name, { type: e.text === undefined ? 'image/jpeg' : 'text/markdown' }) }));
        const [d] = await KamotishFiles.readEntries(files); openMarkdown(d);
        await Promise.all([...document.querySelectorAll('#editor img')].map(img => img.decode()));
        return document.querySelectorAll('#editor img').length;
      }, entries);
      assert.equal(count, refs.length);
      const actualNative = await writer.evaluate(() => exportNative().content);
      await writer.evaluate(() => importNative(exportNative()));
      assert.deepEqual(await writer.evaluate(() => exportNative().content), actualNative);
      const listing = await (await fetch(origin + '/api/list?dir=' + encodeURIComponent(path.dirname(input)))).json();
      const loaded = listing.files.find(d => d.name === path.basename(input));
      const handoff = await page.evaluate(async d => { const previous = LOCAL; LOCAL = true; try { return await documentForWriter(d); } finally { LOCAL = previous; } }, loaded);
      assert.equal(Object.keys(handoff.imageSources).length, new Set(refs).size);
      assert(Object.values(handoff.imageSources).every(v => v.startsWith('data:image/')));
      console.log(`PASS: supplied Markdown with ${expected} Kamotish expressions and ${count} decoded local images; native image roundtrip.`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: print title, three PDF footer formats, local API, page-number toggle, folder images, Writer handoff, native roundtrip, old no migration, direct MD import.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGINT'); fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
