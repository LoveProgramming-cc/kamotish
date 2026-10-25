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
    await page.setViewport({width:1440,height:980});
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
    // The report download uses current source, including edits not yet rendered.
    await page.evaluate(async()=>{
      add([{name:'报错测试.md',md:'\\kamotish{\\nou}'}]);
      const d=docs.find(d=>d.name==='报错测试.md');show(d);d.md='标题\n\n\\kamotish{\\unknown}';
      window.savedDownload=download;download=async(blob,name)=>{window.errorDownload={name,text:await blob.text()};};
    });
    await page.click('#exportProblems');
    await page.waitForFunction(()=>window.errorDownload);
    const errorDownload=await page.evaluate(()=>window.errorDownload);
    assert.equal(errorDownload.name,'卡谋语渲染报错.txt');assert.match(errorDownload.text,/文件：报错测试.md/);assert.match(errorDownload.text,/第 3 行/);assert.match(errorDownload.text,/未知字素/);
    await page.evaluate(()=>{download=window.savedDownload;});
    // FileReader, relative image paths, nested headings, and shared renderer.
    const source = '# 标题\n\n<!-- C01-P01 -->\n\\kamotish{\\nou\\3中国\\mi}\n\n> 引用\n\n![插图](../images/图%20片.png)\n\n[说明](说明.md)\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    await page.bringToFront();
    await page.evaluate(async ({ source, png }) => {
      const image = new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], '图 片.png', { type: 'image/png' });
      const [d] = await KamotishFiles.readEntries([
        { file: new File([source], '测试.md'), path: '书/chapters/测试.md' },
        { file: image, path: '书/images/图 片.png' }
      ]);
      window.testDocument = d; add([d]); show(d);
    }, { source, png });
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('img')?.naturalWidth > 0);
    const pageCount = (await browser.pages()).length;
    await page.click('nav [data-tab="writer"]'); const writer = page;
    await writer.waitForSelector('#kw-editor');
    await writer.waitForFunction(() => document.querySelector('#kw-docTitle')?.value === '测试');
    assert.equal((await browser.pages()).length, pageCount, 'Writer must stay in the same browser tab');
    assert.equal(await page.$eval('nav [data-tab="writer"]', e => e.classList.contains('on')), true);
    assert.equal(await page.$$eval('.writer-top .menubar button', e => e.map(b => b.textContent).join()), '文件,编辑,插入,格式,工具');
    assert.equal(await writer.$$eval('#kw-editor .kamo-err', e => e.length), 0);
    assert.equal(await writer.$$eval('#kw-editor .kamo-run', e => e.length), 1);
    assert.equal(await writer.$$eval('#kw-editor table', e => e.length), 1);
    await writer.waitForFunction(() => document.querySelector('#kw-editor .kw-image img')?.naturalWidth > 0);
    await writer.click('#kw-pdfBtn');
    assert.equal(await page.$eval('nav [data-tab="doc"]',e=>e.classList.contains('on')),true);
    assert.equal(await page.evaluate(()=>current.md),source);
    await page.click('nav [data-tab="writer"]');
    // Helpers that address the editor through its document model.
    const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))));
    const shortcut = async (...keys) => { for (const k of keys) await page.keyboard.down(k); for (const k of [...keys].reverse()) await page.keyboard.up(k); await settle(); };
    const sel = (from, to = from) => page.evaluate((f, t) => { const v = writerInstance.view; v.focus(); v.dispatch(v.state.tr.setSelection(PM.state.TextSelection.create(v.state.doc, f, t))); }, from, to);
    const units = () => page.evaluate(() => { const r = []; writerInstance.view.state.doc.descendants((n, p) => { if (n.type.name === 'kamo') r.push(p); }); return r; });
    const selection = () => page.evaluate(() => { const s = writerInstance.view.state.selection; return [s.anchor, s.head]; });
    const reset = (html = '<p></p>') => page.evaluate(h => { const v = writerInstance.view, M = KamotishWriterModel, box = document.createElement('div'); box.innerHTML = h; const doc = M.domToDoc(box); v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content)); v.focus(); v.dispatch(v.state.tr.setSelection(PM.state.TextSelection.create(v.state.doc, 1))); }, html);
    const docText = () => page.evaluate(() => writerInstance.view.state.doc.textContent);
    const clickMenuItem = async (anchor, label) => { await page.click(anchor); await page.evaluate(l => [...document.querySelectorAll('#kw-dropdown button')].find(b => b.querySelector('.menuLabel')?.firstChild?.textContent === l).click(), label); };
    {
      const [a, b] = await units(); await sel(a, b + 1);
      await clickMenuItem('#kw-sizeMenu', '20');
      assert.equal(await writer.$$eval('#kw-editor .kw-unit', es => es.filter(e => getComputedStyle(e).fontSize === '26.6667px').length), 2);
    }
    const native = await writer.evaluate(() => writerInstance.exportNative().content);
    await writer.evaluate(() => writerInstance.importNative(writerInstance.exportNative()));
    assert.deepEqual(await writer.evaluate(() => writerInstance.exportNative().content), native);
    assert.match(await writer.evaluate(() => writerInstance.exportMarkdown()), /!\[插图\]\(<\.\.\/images\/%E5%9B%BE%20%E7%89%87.png>\)/);
    await page.click('nav [data-tab="doc"]');
    assert.notEqual(await page.evaluate(()=>current.md),source,'Edited text must return to the document workspace');
    assert.equal(await page.evaluate(()=>docs.filter(d=>d.name==='测试.md').length),1,'Switching workspaces must not duplicate the document');
    await page.click('nav [data-tab="writer"]');
    await writer.evaluate(() => writerInstance.openMarkdown({name:'旧文稿.md' ,md:'\\kamotish{\\no\\3}'}));
    assert.equal(await writer.$eval('#kw-editor .kw-unit',e=>e.dataset.raw),'\\nou\\3');
    assert.equal(await writer.evaluate(() => KamoIME.candidates('nou')[0].value), '\\nou');
    // Docs-style sizes: points, selected range only, mixed state, custom values,
    // native typing and vector typing, with undo/redo.
    await writer.evaluate(() => writerInstance.openMarkdown({name:'字号与退格.md',md:'正文ABC\n\n\\kamotish{\\nou\\mi\\nou}'}));
    await sel(1, 6);
    await writer.waitForFunction(()=>document.querySelector('#kw-fontSize').value==='12');
    const setSize=async value=>{await writer.click('#kw-fontSize',{clickCount:3});await writer.keyboard.type(String(value));await writer.keyboard.press('Enter');};
    await setSize(18.5);
    assert.equal(await writer.$eval('#kw-fontSize',e=>e.value),'18.5');
    assert.equal(await writer.$eval('#kw-editor p span',e=>getComputedStyle(e).fontSize),'24.6667px');
    assert.equal(await writer.$eval('#kw-editor .kw-unit',e=>getComputedStyle(e).fontSize),'16px','Formatting must not affect unselected atoms');
    await page.evaluate(() => { const v = writerInstance.view; v.focus(); v.dispatch(v.state.tr.setSelection(new PM.state.AllSelection(v.state.doc))); });
    await writer.waitForFunction(()=>document.querySelector('#kw-fontSize').value===''&&document.querySelector('#kw-fontSize').placeholder==='混合');
    await setSize(24);
    assert.equal(await writer.$eval('#kw-fontSize',e=>e.value),'24');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.every(e=>getComputedStyle(e).fontSize==='32px')),true);
    assert.equal(await writer.$$eval('#kw-editor p',es=>es.length),2,'Formatting must preserve paragraphs');
    await writer.click('#kw-undoBtn');
    assert.equal(await writer.$eval('#kw-editor .kw-unit',e=>getComputedStyle(e).fontSize),'16px');
    await writer.click('#kw-redoBtn');
    assert.equal(await writer.$eval('#kw-editor .kw-unit',e=>getComputedStyle(e).fontSize),'32px');
    let atoms = await units(); await sel(atoms[1]);
    await writer.waitForFunction(()=>!document.querySelector('#kw-caret').hidden);
    const caretPosition=await writer.evaluate(()=>{const c=document.querySelector('#kw-caret').getBoundingClientRect(),u=document.querySelector('#kw-editor .kw-unit').getBoundingClientRect();return Math.abs(c.left+1-u.right)<2&&c.height>20;});
    assert(caretPosition,'Visible caret must sit between the actual glyphs');
    const caretSpan=await writer.evaluate(()=>{const c=document.querySelector('#kw-caret').getBoundingClientRect(),g=document.querySelector('#kw-editor .kw-unit svg').getBoundingClientRect();return {c:[c.top,c.bottom],g:[g.top,g.bottom]};});
    assert(caretSpan.c[0]<=caretSpan.g[0]+1&&caretSpan.c[1]>=caretSpan.g[1]-1&&caretSpan.c[1]-caretSpan.g[1]<8,'Caret must span the glyph, not hang below it: '+JSON.stringify(caretSpan));
    await page.evaluate(()=>{const v=writerInstance.view;v.focus();v.dispatch(v.state.tr.setSelection(new PM.state.AllSelection(v.state.doc)));});
    await page.click('#kw-highlightMenu'); await page.click('#kw-dropdown .swatch[title="#fff2cc"]');
    await sel(1);
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.every(e=>getComputedStyle(e).backgroundColor==='rgb(255, 242, 204)')),true,'Highlight must cover large atoms completely');
    await writer.click('#kw-undoBtn');
    atoms = await units(); await sel(atoms[1]);
    const realBreaks = () => writer.$$eval('#kw-editor br:not(.ProseMirror-trailingBreak)',es=>es.length);
    await writer.keyboard.press('Backspace');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.length),2);
    assert.equal(await writer.$$eval('#kw-editor p',es=>es.length),2,'Deleting an atom must not create a paragraph');
    assert.equal(await realBreaks(),0,'Deleting an atom must not insert a line break');
    await writer.click('#kw-undoBtn');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.length),3,'Atomic deletion must support undo');
    await writer.click('#kw-redoBtn');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.length),2);
    assert.equal(await realBreaks(),0,'Redo must not restore an unwanted line break');
    await writer.click('#kw-undoBtn');
    atoms = await units(); await sel(atoms[1]);
    await writer.keyboard.press('Delete');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.length),2);
    // Arrow keys step over one atom at a time; Home/End reach the line edges past atoms.
    atoms = await units(); const paragraphEnd = atoms[1] + 1;
    await sel(paragraphEnd); await writer.keyboard.press('ArrowLeft'); assert.deepEqual(await selection(), [atoms[1], atoms[1]]);
    await writer.keyboard.press('ArrowLeft'); assert.deepEqual(await selection(), [atoms[0], atoms[0]]);
    await sel(paragraphEnd); await writer.keyboard.press('Home'); assert.deepEqual(await selection(), [atoms[0], atoms[0]]);
    await writer.keyboard.down('Shift'); await writer.keyboard.press('End'); await writer.keyboard.up('Shift'); assert.deepEqual(await selection(), [atoms[0], paragraphEnd]);
    if (MOD === 'Meta') { await sel(paragraphEnd); await shortcut('Meta', 'Shift', 'ArrowLeft'); assert.deepEqual(await selection(), [paragraphEnd, atoms[0]], '⌘⇧← must select past atoms to the line start'); }
    await sel(paragraphEnd);
    await setSize(30);
    await writer.keyboard.type('nou');await writer.keyboard.press('1');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.filter(e=>getComputedStyle(e).fontSize==='40px').length),1,'New vector input must inherit the chosen size');
    assert.match(await writer.evaluate(()=>writerInstance.exportMarkdown()), /\\kamotish\{\\nou\\nou\}/, 'Consecutive graphemes typed with the IME join one run');
    await writer.click('#kw-nativeMode');
    await setSize(15);
    await writer.keyboard.type('XYZ');
    assert.equal(await writer.evaluate(()=>{const w=document.createTreeWalker(document.querySelector('#kw-editor'),NodeFilter.SHOW_TEXT);while(w.nextNode())if(w.currentNode.textContent.includes('XYZ'))return getComputedStyle(w.currentNode.parentElement).fontSize;return null;}),'20px','New ordinary input must inherit the chosen size');
    await writer.click('#kw-kamoMode');
    // Tone: select a grapheme and press a tone key; the picker changes it as well.
    atoms = await units(); await page.evaluate(p => { const v = writerInstance.view; v.dispatch(v.state.tr.setSelection(PM.state.NodeSelection.create(v.state.doc, p))); v.focus(); }, atoms[0]);
    await writer.keyboard.press('3');
    assert.equal(await page.evaluate(p => writerInstance.view.state.doc.nodeAt(p).attrs.raw, atoms[0]), '\\nou\\3');
    await page.click('#kw-editor .kw-unit'); await page.waitForFunction(() => !document.querySelector('#kw-tonePicker').hidden);
    await page.evaluate(() => document.querySelectorAll('#kw-toneChoices button')[1].click());
    assert.equal(await page.evaluate(p => writerInstance.view.state.doc.nodeAt(p).attrs.raw, atoms[0]), '\\nou\\2');
    await writer.click('#kw-undoBtn');
    assert.equal(await page.evaluate(p => writerInstance.view.state.doc.nodeAt(p).attrs.raw, atoms[0]), '\\nou\\3', 'Tone changes are undoable');
    await writer.screenshot({path:'/private/tmp/kamotish-writer-font-size.png',fullPage:true});
    console.log('PASS: caret between SVG atoms, atomic Backspace/Delete and undo, arrows and Home/End over atoms, point sizes, custom and mixed sizes, native/vector typing, tone keys and undo.');
    // Docs features: shortcuts, Markdown autoformat, lists, links, find/replace, clipboard.
    await page.click('#kw-nativeMode');
    await reset();
    await page.keyboard.type('# 标题甲'); await page.keyboard.press('Enter'); await page.keyboard.type('正文一');
    assert.equal(await page.$eval('#kw-editor h1', e => e.textContent), '标题甲', 'Typing "# " makes a heading');
    await page.waitForFunction(() => document.querySelector('#kw-outline button')?.textContent === '标题甲');
    await shortcut('Shift', 'ArrowLeft'); await shortcut('Shift', 'ArrowLeft');
    await shortcut(MOD, 'b'); assert.equal(await page.$eval('#kw-editor strong', e => e.textContent), '文一');
    assert.equal(await page.$eval('[data-mark="bold"]', e => e.classList.contains('on')), true, 'Toolbar shows the active format');
    await shortcut(MOD, 'z'); assert.equal(await page.$$eval('#kw-editor strong', e => e.length), 0);
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.keyboard.type('- 项目一'); await page.keyboard.press('Enter'); await page.keyboard.type('项目二'); await page.keyboard.press('Tab');
    assert.equal(await page.$$eval('#kw-editor ul ul li', e => e.length), 1, 'Tab nests a list item');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await page.$$eval('#kw-editor ul > li', e => e.length), 2);
    await shortcut(MOD, 'Shift', '7'); assert.equal(await page.$$eval('#kw-editor ol > li', e => e.length), 2, 'Changing list type keeps the items');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => writerInstance.view.state.selection.$from.parent.type.name), 'paragraph', 'Enter on an empty item leaves the list');
    await page.keyboard.type('访问网站');
    await shortcut('Shift', 'ArrowLeft'); await shortcut('Shift', 'ArrowLeft');
    await shortcut(MOD, 'k'); await page.waitForFunction(() => !document.querySelector('#kw-linkDialog').hidden);
    await page.keyboard.type('example.com'); await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#kw-editor a', e => [e.textContent, e.getAttribute('href')].join()), '网站,https://example.com');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => !document.querySelector('#kw-linkBubble').hidden);
    await page.click('#kw-linkRemove'); assert.equal(await page.$$eval('#kw-editor a', e => e.length), 0);
    await shortcut(MOD, 'f'); await page.waitForFunction(() => !document.querySelector('#kw-findBar').hidden);
    await page.$eval('#kw-findInput', e => { e.value = ''; }); await page.type('#kw-findInput', '项目');
    assert.equal(await page.$eval('#kw-findCount', e => e.textContent), '1 / 2');
    assert.equal(await page.$$eval('#kw-editor .kw-find', e => e.length), 2);
    await page.click('#kw-findBtn'); await page.type('#kw-replaceInput', '条目'); await page.click('#kw-replaceAll');
    assert.match(await docText(), /条目一条目二/); assert.doesNotMatch(await docText(), /项目/);
    await page.click('#kw-findClose');
    // Plain-text copy gives Kamotish source; pasted source becomes atoms.
    await reset('<p>前<span class="kamo-run"><span class="kw-unit" data-raw="\\mi" data-kind="glyph" data-name="mi"></span>文</span>后</p>');
    const copied = await page.evaluate(() => { const v = writerInstance.view; return KamotishWriterModel.sliceToText(v.state.doc.slice(1, v.state.doc.content.size - 1)); });
    assert.equal(copied, '前\\kamotish{\\mi文}后');
    await sel(1);
    await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', '粘贴\\kamotish{\\nou\\2}'); writerInstance.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    assert.equal(await page.evaluate(() => { let n = 0; writerInstance.view.state.doc.descendants(x => { if (x.attrs?.raw === '\\nou\\2') n++; }); return n; }), 1, 'Pasted \\kamotish source becomes an atom');
    await page.screenshot({path:'/private/tmp/kamotish-writer-docs-features.png'});
    console.log('PASS: Markdown autoformat, outline, bold shortcut and toolbar state, undo, nested lists, list type switch, links and link bubble, find and replace all, plain-text copy and Kamotish paste.');
    // LaTeX: typed $ stays text; formulas come from ∑ / Insert, the editor, and the equation toolbar.
    await reset();
    await page.click('#kw-nativeMode'); await sel(1);
    const mathNodes = () => page.evaluate(() => { const r = []; writerInstance.view.state.doc.descendants(n => { if (n.type.name.startsWith('math')) r.push(n.type.name + ':' + n.attrs.tex); }); return r; });
    await page.keyboard.type('价格 $3 和 $x$ ');
    assert.deepEqual(await mathNodes(), [], 'Typed dollars stay plain text');
    assert.equal(await page.$eval('#kw-eqBar', e => e.hidden), true, 'No equation toolbar before the first formula');
    await page.click('[data-action="math"]');
    await page.waitForFunction(() => !document.querySelector('#kw-mathEditor').hidden && document.activeElement.id === 'kw-mathSource');
    assert.equal(await page.$eval('#kw-eqBar', e => e.hidden), false, 'Inserting a formula shows the equation toolbar');
    await page.keyboard.type('E=mc^2+');
    await page.click('[data-menu="eq-greek"]'); await page.evaluate(() => [...document.querySelectorAll('#kw-dropdown .eqGrid button')].find(b => b.title === '\\alpha').click());
    assert.equal(await page.$eval('#kw-mathSource', e => e.value), 'E=mc^2+\\alpha ', 'Equation toolbar symbols go into the open formula');
    await page.keyboard.press('Enter');
    assert.equal(await page.$$eval('#kw-editor .kw-math .katex', e => e.length), 1);
    await page.click('#kw-newEquation'); await page.waitForFunction(() => !document.querySelector('#kw-mathEditor').hidden);
    await page.click('[data-menu="eq-struct"]'); await page.click('#kw-dropdown .eqGrid button[title="分数"]');
    await page.keyboard.type('1'); await page.keyboard.press('Enter');
    await page.click('#kw-insertMenu'); await page.evaluate(() => [...document.querySelectorAll('#kw-dropdown button')].find(b => b.textContent.startsWith('公式块')).click());
    await page.waitForFunction(() => !document.querySelector('#kw-mathEditor').hidden);
    await page.keyboard.type('\\int_0^1 x\\,dx'); await page.keyboard.press('Enter');
    assert.deepEqual(await mathNodes(), ['math_inline:E=mc^2+\\alpha', 'math_inline:\\frac{1}{}', 'math_display:\\int_0^1 x\\,dx']);
    await page.click('#kw-editor .kw-math');
    await page.waitForFunction(() => document.querySelector('#kw-mathSource').value === 'E=mc^2+\\alpha' && !document.querySelector('#kw-mathEditor').hidden);
    await page.click('#kw-mathPalette button[title="分数"]');
    await page.keyboard.type('1'); await page.keyboard.press('Escape');
    assert.deepEqual((await mathNodes())[0], 'math_inline:E=mc^2+\\alpha', 'Esc cancels an edit');
    const mathMd = await page.evaluate(() => writerInstance.exportMarkdown());
    assert.match(mathMd, /价格 \\\$3 和 \\\$x\\\$ \$E=mc\^2\+\\alpha\$/); assert.match(mathMd, /\$\$\n\\int_0\^1 x\\,dx\n\$\$/);
    await page.evaluate(md => writerInstance.openMarkdown({ name: '公式.md', md: md + '\n\n```latex\nc^2\n```\n\n行内 \\(a+b\\)' }), mathMd);
    assert.deepEqual(await mathNodes(), ['math_inline:E=mc^2+\\alpha', 'math_inline:\\frac{1}{}', 'math_display:\\int_0^1 x\\,dx', 'math_display:c^2', 'math_inline:a+b']);
    assert.match(await docText(), /价格 \$3 和 \$x\$/, 'Escaped dollars stay text after a roundtrip');
    assert.equal(await page.$eval('#kw-eqBar', e => e.hidden), false, 'A document with formulas shows the equation toolbar');
    const mathNative = await page.evaluate(() => writerInstance.exportNative().content);
    await page.evaluate(() => writerInstance.importNative(writerInstance.exportNative()));
    assert.deepEqual(await page.evaluate(() => writerInstance.exportNative().content), mathNative);
    // Right-click anywhere in the page opens the editor's own menu.
    await page.click('#kw-editor p', { button: 'right' });
    assert.equal(await page.$eval('#kw-dropdown', e => !e.hidden && e.classList.contains('menu-context')), true);
    assert.match(await page.$eval('#kw-dropdown', e => e.textContent), /粘贴为纯文本/);
    await page.keyboard.press('Escape');
    await page.screenshot({path:'/private/tmp/kamotish-writer-math.png'});
    await reset(); await page.click('#kw-kamoMode'); await sel(1);
    await page.keyboard.type('$3. '); await page.keyboard.press('k');
    assert.equal(await page.$eval('#kw-ime', e => e.hidden), false, 'A lone $ must not stop the Kamotish IME');
    await page.keyboard.press('Escape'); await page.click('#kw-nativeMode');
    console.log('PASS: typed $ stays text, formulas via ∑/Insert, equation toolbar, editor palette, Esc cancel, Markdown/latex fence import and export, native roundtrip, right-click menu');
    // Direct .md file import, including the user's real document when supplied.
    const input = process.env.KAMOTISH_TEST_MD || path.join(temporary, 'direct.md');
    if (!process.env.KAMOTISH_TEST_MD) fs.writeFileSync(input, source);
    await writer.click('#kw-fileMenu');
    const chooserPromise = writer.waitForFileChooser();
    await writer.evaluate(() => [...document.querySelectorAll('#kw-dropdown button')].find(b=>b.textContent.includes('导入单个文件')).click());
    const chooser = await chooserPromise; assert.equal(chooser.isMultiple(), false); await chooser.accept([input]);
    await writer.waitForFunction(name=>document.querySelector('#kw-docTitle').value===name,{},path.basename(input).replace(/\.[^.]+$/,''));
    const expected = (fs.readFileSync(input, 'utf8').match(/\\kamotish\{/g) || []).length;
    await writer.waitForFunction(n => document.querySelectorAll('#kw-editor .kamo-run').length === n, {}, expected);
    assert.equal(await writer.$$eval('#kw-editor .kamo-run', e => e.length), expected);
    if (process.env.KAMOTISH_TEST_MD) {
      const raw = fs.readFileSync(input, 'utf8'), entries = [{ path: 'book/' + path.basename(input), name: path.basename(input), text: raw }];
      const refs = [...raw.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
      for (const ref of new Set(refs)) entries.push({ path: 'book/' + ref, name: path.basename(ref), base64: fs.readFileSync(path.resolve(path.dirname(input), decodeURIComponent(ref))).toString('base64') });
      const count = await writer.evaluate(async entries => {
        const files = entries.map(e => ({ path: e.path, file: new File([e.text === undefined ? Uint8Array.from(atob(e.base64), c => c.charCodeAt(0)) : e.text], e.name, { type: e.text === undefined ? 'image/jpeg' : 'text/markdown' }) }));
        const [d] = await KamotishFiles.readEntries(files); await writerInstance.openMarkdown(d);
        await Promise.all([...document.querySelectorAll('#kw-editor .kw-image img')].map(img => img.decode()));
        return document.querySelectorAll('#kw-editor .kw-image img').length;
      }, entries);
      assert.equal(count, refs.length);
      const actualNative = await writer.evaluate(() => writerInstance.exportNative().content);
      await writer.evaluate(() => writerInstance.importNative(writerInstance.exportNative()));
      assert.deepEqual(await writer.evaluate(() => writerInstance.exportNative().content), actualNative);
      const listing = await (await fetch(origin + '/api/list?dir=' + encodeURIComponent(path.dirname(input)))).json();
      const loaded = listing.files.find(d => d.name === path.basename(input));
      const handoff = await page.evaluate(async d => { const previous = LOCAL; LOCAL = true; try { return await documentForWriter(d); } finally { LOCAL = previous; } }, loaded);
      assert.equal(Object.keys(handoff.imageSources).length, new Set(refs).size);
      assert(Object.values(handoff.imageSources).every(v => v.startsWith('data:image/')));
      console.log(`PASS: supplied Markdown with ${expected} Kamotish expressions and ${count} decoded local images; native image roundtrip.`);
    }
    await page.evaluate(()=>{writerInstance.openMarkdown(window.testDocument);document.querySelector('#kw-workspace').scrollTop=0;});
    await page.waitForFunction(()=>document.querySelector('#kw-docTitle').value==='测试');
    await page.screenshot({path:'/private/tmp/kamotish-integrated-writer.png',fullPage:true});
    await page.click('#kw-fileMenu');
    await page.screenshot({path:'/private/tmp/kamotish-integrated-writer-menu.png',fullPage:true});
    await page.keyboard.press('Escape');
    await page.setViewport({width:700,height:900});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#kw-sidebar')).display==='none');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'/private/tmp/kamotish-integrated-writer-mobile.png',fullPage:true});
    // A closed document returns to the library; reloading never auto-opens a cached draft.
    page.on('dialog', async dialog => {console.log('Browser dialog:',dialog.type());await dialog.accept();});
    await page.evaluate(()=>writerInstance.closeDocument());
    console.log('Checking closed-document reload');
    await page.reload({waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#kw-libraryList');
    await page.waitForFunction(()=>writerInstance && !document.querySelector('#kw-libraryStatus').textContent.includes('载入'));
    assert.equal(await page.$eval('#kw-documentView',e=>e.hidden),true);
    await page.setViewport({width:1440,height:980});
    await page.click('#kw-newDocument');
    await page.$eval('#kw-nameInput',e=>e.value='文稿甲');
    await page.$eval('#kw-nameForm',e=>e.requestSubmit());
    await page.waitForFunction(()=>document.querySelector('#kw-docTitle').value==='文稿甲'&&!document.querySelector('#kw-documentView').hidden);
    // Empty paragraphs, CSS zoom, tone keys and candidate pages.
    for(const tone of ['1','2','3','4']){
      await reset();
      await page.keyboard.type('nou');
      const bounds=await page.evaluate(()=>({popup:document.querySelector('#kw-ime').getBoundingClientRect().toJSON(),caret:document.querySelector('#kw-editor p').getBoundingClientRect().toJSON()}));
      assert(Math.abs(bounds.popup.x-bounds.caret.x)<10,'IME must align with the empty-paragraph caret');
      assert(bounds.popup.y>=bounds.caret.y && bounds.popup.y-bounds.caret.bottom<20,'IME must appear just below the caret');
      await page.keyboard.press(tone);
      assert.equal(await page.$eval('#kw-editor .kw-unit',e=>e.dataset.raw),'\\nou'+(tone==='1'?'':'\\'+tone));
    }
    await reset(); await page.evaluate(()=>KamoIME._testSetShards({n:{nou:Array.from({length:20},(_,i)=>['候选'+i,100-i])}}));
    await page.keyboard.type('nou');await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('#kw-candidates .selected',e=>Number(e.dataset.i)),1);
    // ↓ first moves to the next row of the wrapped list, then turns the page; ↑ goes back.
    const imeState = () => page.evaluate(() => { const b = document.querySelector('#kw-candidates .selected'), all = [...document.querySelectorAll('#kw-candidates .candidate')]; return { i: Number(b.dataset.i), row: b.offsetTop, rows: new Set(all.map(x => x.offsetTop)).size, first: Number(all[0].dataset.i) }; });
    const top = await imeState(); assert(top.rows > 1, 'Test needs a wrapped candidate list');
    await page.keyboard.press('ArrowDown'); const lower = await imeState();
    assert(lower.first === 0 && lower.row > top.row, 'ArrowDown moves to the lower row on the same page');
    while ((await imeState()).first === 0) await page.keyboard.press('ArrowDown');
    assert.equal((await imeState()).first, 6, 'Past the last row ArrowDown turns the page');
    await page.keyboard.press('ArrowUp'); assert.equal((await imeState()).first, 0);
    await page.keyboard.press('Escape'); await page.keyboard.type('nou'); await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');assert.equal(await page.$eval('#kw-editor .kw-unit',e=>e.dataset.raw),'\\nou\\2');
    await reset();
    await page.click('#kw-nativeMode'); await page.click('#kw-editor p'); await page.keyboard.type('First document');
    // Insert a configurable table at the caret, then edit it from the context menu.
    await page.click('#kw-insertMenu');
    await page.evaluate(()=>[...document.querySelectorAll('#kw-dropdown button')].find(e=>e.textContent.includes('表格')).click());
    await page.$eval('#kw-tableRows',e=>e.value='2'); await page.$eval('#kw-tableColumns',e=>e.value='3');
    await page.$eval('#kw-tableForm',e=>e.requestSubmit());
    assert.equal(await page.$$eval('#kw-editor table tr',e=>e.length),2);
    assert.equal(await page.$$eval('#kw-editor table th',e=>e.length),3);
    assert.equal(await page.$$eval('#kw-editor table td',e=>e.length),3);
    await page.keyboard.type('Header');
    await page.click('#kw-editor td', { button: 'right' });
    await page.evaluate(()=>[...document.querySelectorAll('#kw-dropdown button')].find(e=>e.textContent.includes('在下方插入行')).click());
    assert.equal(await page.$$eval('#kw-editor table tr',e=>e.length),3);
    await shortcut(MOD, 'z');
    assert.equal(await page.$$eval('#kw-editor table tr',e=>e.length),2);
    // Insert a real image through the menu/file picker, retaining text and the insertion point.
    const imageFile=path.join(temporary,'figure.png');fs.writeFileSync(imageFile,Buffer.from(png,'base64'));
    await page.evaluate(()=>{const v=writerInstance.view;v.focus();v.dispatch(v.state.tr.setSelection(PM.state.Selection.atEnd(v.state.doc)));});
    await page.click('#kw-insertMenu');const imageChooser=page.waitForFileChooser();
    await page.evaluate(()=>[...document.querySelectorAll('#kw-dropdown button')].find(e=>e.textContent.startsWith('图片')).click());
    await (await imageChooser).accept([imageFile]);
    await page.waitForFunction(()=>document.querySelector('#kw-editor .kw-image img')?.naturalWidth===1);
    assert.match(await docText(),/First document/);
    assert.match(await docText(),/Header/);
    const firstId=await page.evaluate(()=>writerInstance.exportNative().id);
    await page.evaluate(()=>writerInstance.save());
    await page.screenshot({path:'/private/tmp/kamotish-writer-insert.png',fullPage:true});
    await page.click('#kw-pdfBtn');
    await page.waitForFunction(()=>document.querySelector('#preview').contentDocument?.querySelector('img')?.naturalWidth===1);
    assert.equal(await page.evaluate(()=>document.querySelector('#preview').contentDocument.querySelectorAll('table tr').length),2);
    await page.click('nav [data-tab="writer"]');
    await page.evaluate(()=>writerInstance.closeDocument());
    // Multiple independently saved documents.
    await page.click('#kw-newDocument');await page.$eval('#kw-nameInput',e=>e.value='文稿乙');await page.$eval('#kw-nameForm',e=>e.requestSubmit());
    await page.waitForFunction(()=>document.querySelector('#kw-docTitle').value==='文稿乙');
    const secondId=await page.evaluate(()=>writerInstance.exportNative().id);assert.notEqual(firstId,secondId);
    await page.evaluate(()=>writerInstance.closeDocument());
    await page.evaluate(id=>writerInstance.openSavedDocument(id),firstId);
    assert.match(await docText(),/First document/);
    assert.equal(await page.$$eval('#kw-editor table tr',e=>e.length),2);
    await page.waitForFunction(()=>document.querySelector('#kw-editor .kw-image img')?.naturalWidth===1);
    // A failed write must keep the active document open.
    await page.evaluate(()=>{window.actualPut=KamotishLibrary.put;KamotishLibrary.put=async()=>{throw Error('simulated storage failure');};const title=document.querySelector('#kw-docTitle');title.value='文稿甲';title.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.evaluate(()=>writerInstance.closeDocument());assert.equal(await page.evaluate(()=>writerInstance.hasDocument()),true);
    assert.match(await page.$eval('#kw-saveStatus',e=>e.textContent),/保存失败/);
    await page.evaluate(()=>{KamotishLibrary.put=window.actualPut;});
    await page.evaluate(()=>writerInstance.closeDocument());
    // Rename, search, duplicate and delete through the document manager.
    await page.click(`[data-document-id="${firstId}"] summary`);
    await page.evaluate(id=>[...document.querySelector(`[data-document-id="${id}"]`).querySelectorAll('.document-action-menu button')].find(e=>e.textContent==='重命名').click(),firstId);
    await page.waitForFunction(()=>!document.querySelector('#kw-nameDialog').hidden);
    await page.$eval('#kw-nameInput',e=>e.value='文稿甲改名');await page.$eval('#kw-nameForm',e=>e.requestSubmit());
    await page.waitForFunction(()=>document.querySelector('#kw-nameDialog').hidden);
    await page.type('#kw-librarySearch','甲改名');assert.equal(await page.$$eval('.library-row',e=>e.length),1);
    await page.$eval('#kw-librarySearch',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.click(`[data-document-id="${firstId}"] summary`);
    await page.evaluate(id=>[...document.querySelector(`[data-document-id="${id}"]`).querySelectorAll('.document-action-menu button')].find(e=>e.textContent==='创建副本').click(),firstId);
    await page.waitForFunction(()=>[...document.querySelectorAll('.library-open strong')].some(e=>e.textContent==='文稿甲改名（副本）'));
    const copyId=await page.evaluate(()=>[...document.querySelectorAll('.library-row')].find(e=>e.querySelector('strong').textContent==='文稿甲改名（副本）').dataset.documentId);
    await page.click(`[data-document-id="${copyId}"] summary`);
    await page.evaluate(id=>[...document.querySelector(`[data-document-id="${id}"]`).querySelectorAll('.document-action-menu button')].find(e=>e.textContent==='删除').click(),copyId);
    await page.click('#kw-deleteConfirm');await page.waitForFunction(id=>!document.querySelector(`[data-document-id="${id}"]`),{},copyId);
    await page.reload({waitUntil:'domcontentloaded',timeout:30000});await page.waitForSelector('#kw-libraryList');
    await page.waitForFunction(id=>document.querySelector(`[data-document-id="${id}"]`),{},firstId);
    assert.equal(await page.$eval('#kw-documentView',e=>e.hidden),true);
    assert.equal(await page.evaluate(id=>KamotishLibrary.get(id),copyId),undefined);
    const persisted=await page.evaluate(id=>KamotishLibrary.get(id),firstId);assert.equal(persisted.title,'文稿甲改名');
    await page.screenshot({path:'/private/tmp/kamotish-writer-library.png',fullPage:true});
    // Duplicating an edited Markdown import must use its saved edits, not the original source.
    await page.evaluate(async()=>{
      await writerInstance.openMarkdown({name:'导入后编辑.md',md:'Original source'});
      const v=writerInstance.view,s=v.state;v.dispatch(s.tr.replaceWith(0,s.doc.content.size,s.schema.nodes.paragraph.create(null,s.schema.text('Saved edited content'))));
      await writerInstance.closeDocument();
    });
    const editedId=await page.evaluate(()=>[...document.querySelectorAll('.library-row')].find(e=>e.querySelector('strong').textContent==='导入后编辑').dataset.documentId);
    await page.click(`[data-document-id="${editedId}"] summary`);
    await page.evaluate(id=>[...document.querySelector(`[data-document-id="${id}"]`).querySelectorAll('.document-action-menu button')].find(e=>e.textContent==='创建副本').click(),editedId);
    await page.waitForFunction(()=>[...document.querySelectorAll('.library-open strong')].some(e=>e.textContent==='导入后编辑（副本）'));
    const editedCopy=await page.evaluate(()=>[...document.querySelectorAll('.library-row')].find(e=>e.querySelector('strong').textContent==='导入后编辑（副本）').dataset.documentId);
    await page.evaluate(id=>writerInstance.openSavedDocument(id),editedCopy);
    assert.match(await page.evaluate(()=>writerInstance.exportDocument().md),/Saved edited content/);
    assert.doesNotMatch(await page.evaluate(()=>writerInstance.exportDocument().md),/Original source/);
    await page.evaluate(()=>writerInstance.closeDocument());
    await page.evaluate(async()=>{
      await writerInstance.openMarkdown({name:'同名文稿.md',md:'First version'});await writerInstance.closeDocument();
      await writerInstance.openMarkdown({name:'同名文稿.md',md:'Second version'});await writerInstance.closeDocument();
    });
    assert.equal(await page.evaluate(()=>docs.filter(d=>d.name==='同名文稿.md').length),2,'Distinct saved documents with the same name must not overwrite each other');
    // Migrate an existing singleton cache, while still showing the library on startup.
    const migrationContext=await browser.createBrowserContext();const migrationPage=await migrationContext.newPage();
    migrationPage.on('pageerror',e=>errors.push(e.message));
    await migrationPage.evaluateOnNewDocument(doc=>localStorage.setItem('kamotish-writer-v2',JSON.stringify(doc)),{format:'Kamotish Writer',schemaVersion:2,id:'old-cache',title:'旧缓存文稿',content:[{t:'element',tag:'p',children:[{t:'text',v:'保留旧内容'}]}]});
    await migrationPage.goto(origin+'/#writer',{waitUntil:'domcontentloaded',timeout:15000});
    await migrationPage.waitForFunction(()=>[...document.querySelectorAll('.library-open strong')].some(e=>e.textContent==='旧缓存文稿'));
    assert.equal(await migrationPage.$eval('#kw-documentView',e=>e.hidden),true);
    assert.equal((await migrationPage.evaluate(()=>KamotishLibrary.list())).length,1);
    await migrationPage.evaluate(()=>KamotishLibrary.remove('old-cache'));
    await migrationPage.reload({waitUntil:'domcontentloaded'});await migrationPage.waitForFunction(()=>writerInstance);await migrationPage.evaluate(()=>writerInstance.ready);
    assert.equal((await migrationPage.evaluate(()=>KamotishLibrary.list())).length,0,'Deleted legacy drafts must not be restored again');
    await migrationContext.close();
    console.log('PASS: document library, migration, no automatic reopening, new/open/close/rename/search/duplicate/delete, save failure retention, inserted tables/images and PDF persistence.');

    assert.deepEqual(errors, []);
    console.log('PASS: print title, three PDF footer formats, local API, page-number toggle, folder images, same-page Writer, file menu import, roundtrip to PDF, native roundtrip, old no migration, direct MD import.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGINT'); fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
