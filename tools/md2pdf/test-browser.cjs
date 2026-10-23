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
    assert.equal(await page.$$eval('.writer-top .topActions button', e => e.length), 2);
    assert.equal(await writer.$$eval('#kw-editor .kamo-err', e => e.length), 0);
    assert.equal(await writer.$$eval('#kw-editor .kamo-run', e => e.length), 1);
    assert.equal(await writer.$$eval('#kw-editor table', e => e.length), 1);
    await writer.waitForFunction(() => document.querySelector('#kw-editor img')?.naturalWidth > 0);
    await writer.click('#kw-pdfBtn');
    assert.equal(await page.$eval('nav [data-tab="doc"]',e=>e.classList.contains('on')),true);
    assert.equal(await page.evaluate(()=>current.md),source);
    await page.click('nav [data-tab="writer"]');
    const selected = await writer.evaluate(() => {
      const units=document.querySelectorAll('#kw-editor .kw-unit');const range=document.createRange();
      range.setStartBefore(units[0]);range.setEndAfter(units[1]);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      return [...units].filter(e=>range.intersectsNode(e)).length;
    });
    assert.equal(selected,2);
    await writer.click('#kw-sizeMenu');
    await writer.evaluate(()=>[...document.querySelectorAll('#kw-dropdown button')].find(b=>b.dataset.value==='20').click());
    assert.equal(await writer.$$eval('#kw-editor .kw-unit[style*="20pt"]',e=>e.length),2);
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
    // Word/Docs-style sizes: points, selected range only, mixed state, custom
    // values, native typing and vector typing, with native undo/redo.
    await writer.evaluate(async()=>{
      await writerInstance.openMarkdown({name:'字号与退格.md',md:'正文ABC\n\n\\kamotish{\\nou\\mi\\nou}'});
      const e=document.querySelector('#kw-editor');e.focus();
      const r=document.createRange();r.selectNodeContents(e.querySelector('p'));const s=getSelection();s.removeAllRanges();s.addRange(r);
    });
    await writer.waitForFunction(()=>document.querySelector('#kw-fontSize').value==='12');
    const setSize=async value=>{await writer.click('#kw-fontSize',{clickCount:3});await writer.keyboard.type(String(value));await writer.keyboard.press('Enter');};
    await setSize(18.5);
    assert.equal(await writer.$eval('#kw-fontSize',e=>e.value),'18.5');
    assert.equal(await writer.$eval('#kw-editor p span',e=>getComputedStyle(e).fontSize),'24.6667px');
    assert.equal(await writer.$eval('#kw-editor .kw-unit',e=>getComputedStyle(e).fontSize),'16px','Formatting must not affect unselected atoms');
    await writer.evaluate(()=>{const e=document.querySelector('#kw-editor'),r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);});
    await writer.waitForFunction(()=>document.querySelector('#kw-fontSize').value===''&&document.querySelector('#kw-fontSize').placeholder==='混合');
    await setSize(24);
    assert.equal(await writer.$eval('#kw-fontSize',e=>e.value),'24');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.every(e=>getComputedStyle(e).fontSize==='32px')),true);
    assert.equal(await writer.$$eval('#kw-editor p',es=>es.length),2,'Formatting must preserve paragraphs: '+await writer.$eval('#kw-editor',e=>e.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g,'')));
    await writer.click('#kw-undoBtn');
    assert.equal(await writer.$eval('#kw-editor .kw-unit',e=>getComputedStyle(e).fontSize),'16px');
    await writer.click('#kw-redoBtn');
    assert.equal(await writer.$eval('#kw-editor .kw-unit',e=>getComputedStyle(e).fontSize),'32px');
    await writer.evaluate(()=>{const e=document.querySelector('#kw-editor'),u=e.querySelectorAll('.kw-unit')[1],r=document.createRange();r.setStartBefore(u);r.collapse(true);e.focus();const s=getSelection();s.removeAllRanges();s.addRange(r);});
    await writer.waitForFunction(()=>!document.querySelector('#kw-caret').hidden);
    const caretPosition=await writer.evaluate(()=>{const c=document.querySelector('#kw-caret').getBoundingClientRect(),u=document.querySelector('#kw-editor .kw-unit').getBoundingClientRect();return Math.abs(c.left-u.right)<2&&c.height>20;});
    assert(caretPosition,'Visible caret must sit between the actual glyphs');
    await writer.keyboard.press('Backspace');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.length),2);
    assert.equal(await writer.$$eval('#kw-editor p',es=>es.length),2,'Deleting an atom must not create a paragraph');
    assert.equal(await writer.$$eval('#kw-editor br',es=>es.length),0,'Deleting an atom must not insert a line break');
    await writer.click('#kw-undoBtn');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.length),3,'Atomic deletion must support undo');
    await writer.click('#kw-redoBtn');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.length),2);
    assert.equal(await writer.$$eval('#kw-editor br',es=>es.length),0,'Redo must not restore the unwanted line break');
    await writer.click('#kw-undoBtn');
    await writer.evaluate(()=>{const e=document.querySelector('#kw-editor'),u=e.querySelectorAll('.kw-unit')[1],r=document.createRange();r.setStartBefore(u);r.collapse(true);e.focus();const s=getSelection();s.removeAllRanges();s.addRange(r);});
    await writer.keyboard.press('Delete');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.length),2);
    await setSize(30);
    await writer.keyboard.type('nou');await writer.keyboard.press('1');
    assert.equal(await writer.$$eval('#kw-editor .kw-unit',es=>es.some(e=>e.style.fontSize==='30pt')),true,'New vector input must inherit the chosen size');
    await writer.click('#kw-nativeMode');
    await setSize(15);
    await writer.keyboard.type('XYZ');
    assert.equal(await writer.evaluate(()=>{const w=document.createTreeWalker(document.querySelector('#kw-editor'),NodeFilter.SHOW_TEXT);while(w.nextNode())if(w.currentNode.textContent.includes('XYZ'))return getComputedStyle(w.currentNode.parentElement).fontSize;return null;}),'20px','New ordinary input must inherit the chosen size');
    await writer.click('#kw-kamoMode');
    await writer.screenshot({path:'/private/tmp/kamotish-writer-font-size.png',fullPage:true});
    console.log('PASS: caret between SVG atoms, atomic Backspace/Delete and undo, point sizes, custom and mixed sizes, selection preservation, native/vector typing and formatting undo/redo.');
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
        await Promise.all([...document.querySelectorAll('#kw-editor img')].map(img => img.decode()));
        return document.querySelectorAll('#kw-editor img').length;
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
      await page.evaluate(()=>{const e=document.querySelector('#kw-editor');e.innerHTML='<p><br></p>';e.focus();const r=document.createRange();r.setStart(e.firstChild,0);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);});
      await page.keyboard.type('nou');
      const bounds=await page.evaluate(()=>({popup:document.querySelector('#kw-ime').getBoundingClientRect().toJSON(),caret:document.querySelector('#kw-editor p').getBoundingClientRect().toJSON()}));
      assert(Math.abs(bounds.popup.x-bounds.caret.x)<10,'IME must align with the empty-paragraph caret');
      assert(bounds.popup.y>=bounds.caret.y && bounds.popup.y-bounds.caret.bottom<20,'IME must appear just below the caret');
      await page.keyboard.press(tone);
      assert.equal(await page.$eval('#kw-editor .kw-unit',e=>e.dataset.raw),'\\nou'+(tone==='1'?'':'\\'+tone));
    }
    await page.evaluate(()=>{const e=document.querySelector('#kw-editor');e.innerHTML='<p><br></p>';e.focus();const r=document.createRange();r.setStart(e.firstChild,0);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);KamoIME._testSetShards({n:{nou:Array.from({length:20},(_,i)=>['候选'+i,100-i])}});});
    await page.keyboard.type('nou');await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('#kw-candidates .selected',e=>Number(e.dataset.i)),1);
    await page.keyboard.press('ArrowDown');assert.equal(await page.$eval('#kw-candidates .selected',e=>Number(e.dataset.i)),7);
    await page.keyboard.press('ArrowUp');assert.equal(await page.$eval('#kw-candidates .selected',e=>Number(e.dataset.i)),1);
    await page.keyboard.press('Space');assert.equal(await page.$eval('#kw-editor .kw-unit',e=>e.dataset.raw),'\\nou\\2');
    await page.evaluate(()=>{document.querySelector('#kw-editor').innerHTML='<p><br></p>';});
    await page.click('#kw-nativeMode'); await page.click('#kw-editor'); await page.keyboard.type('First document');
    // Insert a configurable table at the caret.
    await page.click('#kw-insertMenu');
    await page.evaluate(()=>[...document.querySelectorAll('#kw-dropdown button')].find(e=>e.textContent.includes('表格')).click());
    await page.$eval('#kw-tableRows',e=>e.value='2'); await page.$eval('#kw-tableColumns',e=>e.value='3');
    await page.$eval('#kw-tableForm',e=>e.requestSubmit());
    assert.equal(await page.$$eval('#kw-editor table tr',e=>e.length),2);
    assert.equal(await page.$$eval('#kw-editor table th',e=>e.length),3);
    assert.equal(await page.$$eval('#kw-editor table td',e=>e.length),3);
    await page.click('#kw-editor th'); await page.keyboard.type('Header');
    // Insert a real image through the menu/file picker, retaining text and the insertion point.
    const imageFile=path.join(temporary,'figure.png');fs.writeFileSync(imageFile,Buffer.from(png,'base64'));
    await page.evaluate(()=>{const editor=document.querySelector('#kw-editor');const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);editor.focus();});
    await page.click('#kw-insertMenu');const imageChooser=page.waitForFileChooser();
    await page.evaluate(()=>[...document.querySelectorAll('#kw-dropdown button')].find(e=>e.textContent.startsWith('图片')).click());
    await (await imageChooser).accept([imageFile]);
    await page.waitForFunction(()=>document.querySelector('#kw-editor img')?.naturalWidth===1);
    assert.match(await page.$eval('#kw-editor',e=>e.textContent),/First document/);
    assert.match(await page.$eval('#kw-editor',e=>e.textContent),/Header/);
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
    assert.match(await page.$eval('#kw-editor',e=>e.textContent),/First document/);
    assert.equal(await page.$$eval('#kw-editor table tr',e=>e.length),2);
    await page.waitForFunction(()=>document.querySelector('#kw-editor img')?.naturalWidth===1);
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
      const editor=document.querySelector('#kw-editor');editor.innerHTML='<p>Saved edited content</p>';editor.dispatchEvent(new Event('input',{bubbles:true}));
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
