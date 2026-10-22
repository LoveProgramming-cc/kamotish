/* 卡谋语工具 - one app for the online version (GitHub Pages) and the local version (tools/md2pdf/server.js).
 * Everything is rendered here in the browser with the shared setup in kamotish-markdown.js.  When the page is served by
 * the local server (api/info answers), the extra features are switched on: load a folder by path, save to the original
 * file, PDFs through Chrome with page numbers, batch export, PDFs written into a folder.
 */
'use strict';
const $ = id => document.getElementById(id);
const KM = window.KamotishMarkdown;
const md = KM.create({ markdownit: window.markdownit, texmath: window.texmath, katex: window.katex,
  Kamotish: window.Kamotish, kamotishPlugin: window.markdownitKamotish });
const KATEX_CSS = new URL('vendor/katex/katex.min.css', location.href).href;
let LOCAL = false;

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const log = t => { $('log').textContent = t; };
const store = { get: k => { try { return localStorage.getItem('kamo.' + k); } catch (e) { return null; } },
                set: (k, v) => { try { localStorage.setItem('kamo.' + k, v); } catch (e) {} } };
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const sortKey = n => n.replace(/[一二三四五六七八九十]+/g, m => String(m.length === 1 ? CN[m] : m === '十' ? 10 : (m[0] === '十' ? 10 + CN[m[1]] : CN[m[0]] * 10 + (CN[m[2]] || 0))).padStart(3, '0'));
const byName = (a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'zh', { numeric: true });
const isMd = n => /\.(md|markdown)$/i.test(n);

// ------------------------------------------------------------------ local or online
async function detectLocal() {
  try {
    const r = await fetch('api/info', { cache: 'no-store' });
    LOCAL = r.ok && (await r.json()).local === true;
  } catch (e) { LOCAL = false; }
  document.body.classList.toggle('local', LOCAL);
  $('mode').textContent = LOCAL ? '本地版' : '在线版'; $('mode').classList.toggle('local', LOCAL);
  $('mode').title = LOCAL ? '由本机的 tools/md2pdf/server.js 提供，可直接读写本机文件' : '网页版：文件只在浏览器里处理';
  draw(); docbar();
}

// ------------------------------------------------------------------ tabs
let writerReady = null, writerInstance = null, currentTab = null, writerLinkedDoc = null, writerLinkedText = null;
function tab(name) {
  if (currentTab === 'writer' && name !== 'writer' && writerInstance) acceptWriterDocument(writerInstance.exportDocument());
  if (name !== 'writer') writerInstance?.deactivate();
  currentTab = name;
  if (name === 'writer') ensureWriter().then(syncCurrentWriter).catch(e => { $('tab-writer').textContent = '编辑器载入失败: ' + e.message; });
  document.querySelectorAll('nav button').forEach(b => { b.classList.toggle('on', b.dataset.tab === name); b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
  store.set('tab', name);
  history.replaceState(null, '', '#' + name);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => tab(b.dataset.tab));
const initialTab = location.hash.slice(1) || store.get('tab');
tab($('tab-' + initialTab) ? initialTab : 'doc');

// ------------------------------------------------------------------ try it
const css = document.createElement('style'); css.textContent = window.Kamotish.css; document.head.appendChild(css);
const live = () => { $('out').innerHTML = window.Kamotish.renderInline($('src').value); };
$('src').addEventListener('input', live); live();

// ------------------------------------------------------------------ documents
// {name, md, saved (text as on disk), dir? (loaded by path, local), handle? (File System Access), problems, status}
const docs = [];
let current = null, editorDoc = null;
const isDirty = d => d.md !== d.saved;
const opts = () => ({ paper: $('paper').value, fontSize: Number($('size').value), pageNumbers: $('pagenum').checked, pageFormat: $('pageFormat').value, pageAlign: $('pageAlign').value, pageSize: Number($('pageSize').value), saveTo: $('saveTo').value.trim() });
['paper', 'size', 'saveTo', 'pageFormat', 'pageAlign', 'pageSize'].forEach(k => {
  if (store.get(k)) $(k).value = store.get(k);
  $(k).addEventListener('change', () => { store.set(k, $(k).value); if (k !== 'saveTo' && current) render(true); });
});

if (store.get('pagenum') !== null) $('pagenum').checked = store.get('pagenum') === 'true';
const pageOptions = () => { $('pageOptions').hidden = !$('pagenum').checked; };
pageOptions();
$('pagenum').addEventListener('change', () => {
  store.set('pagenum', String($('pagenum').checked)); pageOptions(); if (current) render(true);
});

function add(list) {
  list.sort(byName);
  for (const d of list) {
    d.saved = d.md; d.problems = KM.problems(md, d.md, window.Kamotish);
    const old = docs.findIndex(x => x.name === d.name && (x.dir || x.documentPath || '') === (d.dir || d.documentPath || ''));
    if (old >= 0 && isDirty(docs[old]) && !confirm(d.name + ' 有未保存的修改，重新载入会丢掉这些修改。继续吗？')) continue;
    if (old >= 0) { if (docs[old] === current) current = d; docs[old] = d; } else docs.push(d);
  }
  draw();
  if (docs.length) show(current || docs[0]);
}

function draw() {
  $('count').textContent = docs.length + ' 个文件';
  $('all').disabled = !docs.length;
  const ul = $('list'); ul.innerHTML = '';
  docs.forEach(d => {
    const li = document.createElement('li'); if (d === current) li.className = 'sel';
    const name = document.createElement('span'); name.className = 'name';
    name.textContent = (isDirty(d) ? '● ' : '') + d.name; name.title = (d.dir ? d.dir + '/' : '') + d.name;
    const badge = document.createElement('span'); badge.className = 'badge';
    if (d.status) { badge.textContent = d.status; badge.classList.add(d.status === '已导出' ? 'ok' : d.status === '失败' ? 'warn' : 'busy'); }
    else if (d.problems.length) { badge.textContent = d.problems.length + ' 处无法渲染'; badge.classList.add('warn'); }
    li.append(name, badge); li.onclick = () => show(d);
    ul.append(li);
  });
}

// ------------------------------------------------------------------ preview
let renderTimer = 0, keepScroll = 0, pendingFlash = null;
function show(d) {
  current = d; draw();
  if (editorDoc !== d) { editorDoc = d; $('editor').value = d.md; $('editor').scrollTop = 0; cursorPos(); render(false); }
  $('docbar').style.display = 'flex'; docbar();
}
function docHtml(d) {
  const o = opts(), base = LOCAL && d.dir ? location.origin + '/fs' + encodeURI(d.dir) + '/' : '';
  return KM.documentHtml(md, d.md, { title: d.name.replace(/\.(md|markdown)$/i, ''), base, katexHref: KATEX_CSS,
    paper: o.paper, fontSize: o.fontSize, pageNumbers: o.pageNumbers, pageFormat: o.pageFormat, pageAlign: o.pageAlign, pageSize: o.pageSize, imageSources: d.imageSources, documentPath: d.documentPath, Kamotish: window.Kamotish });
}
function render(keepPos) {
  const d = current; if (!d) return;
  d.problems = KM.problems(md, d.md, window.Kamotish); draw(); problemsPanel();
  const f = $('preview');
  keepScroll = keepPos && f.contentWindow ? f.contentWindow.scrollY : 0;
  $('empty').hidden = true; $('work').hidden = false;
  f.srcdoc = docHtml(d);
}
$('preview').onload = () => {
  const w = $('preview').contentWindow; if (w && keepScroll) w.scrollTo(0, keepScroll);
  if (pendingFlash) { const q = pendingFlash; pendingFlash = null; flash(q); }
};

function problemsPanel() {
  const d = current, p = $('problems');
  if (!d || !d.problems.length) { p.style.display = 'none'; return; }
  p.style.display = 'block';
  p.innerHTML = '<b>' + d.problems.length + ' 处卡谋语无法渲染 (预览中显示为红色)，点击定位并修改:</b>' +
    d.problems.map((q, i) => '<div class="p" data-i="' + i + '"><span class="ln">第 ' + q.line + ' 行</span><code>' + esc(q.content) + '</code></div>').join('');
  p.querySelectorAll('.p').forEach(el => el.onclick = () => locate(d.problems[Number(el.dataset.i)]));
}

// click a problem: open the editor, select the source there, and show the spot in the preview
function locate(q) {
  setEditing(true);
  const ed = $('editor'), lines = ed.value.split('\n');
  let pos = 0; for (let i = 0; i < q.line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  const at = ed.value.indexOf(q.source, pos), start = at >= 0 ? at : pos + q.column;
  ed.focus({ preventScroll: true }); ed.setSelectionRange(start, start + (at >= 0 ? q.source.length : 0));
  const m = $('mirror'); m.style.width = ed.clientWidth + 'px';                // how far down is it, with lines wrapped
  m.textContent = ed.value.slice(0, start); const mark = document.createElement('span'); mark.textContent = '|'; m.appendChild(mark);
  ed.scrollTop = Math.max(0, mark.offsetTop - ed.clientHeight / 3);
  cursorPos(); flash(q);
}
function flash(q) {
  const f = $('preview'), doc = f.contentDocument, el = doc && doc.querySelectorAll('.kamotish')[q.index];
  if (!el) { pendingFlash = q; return; }
  const w = f.contentWindow;                                                  // scroll only the preview, not the page
  w.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + w.scrollY - w.innerHeight / 2));
  el.classList.add('kamo-flash'); setTimeout(() => el.classList.remove('kamo-flash'), 1800);
}

// ------------------------------------------------------------------ editor
function setEditing(on) { $('work').classList.toggle('editing', on); $('editBtn').classList.toggle('on', on); cursorPos(); }
$('editBtn').onclick = () => setEditing(!$('work').classList.contains('editing'));
function cursorPos() {
  const ed = $('editor');
  $('cursorPos').textContent = $('work').classList.contains('editing') ? '第 ' + ed.value.slice(0, ed.selectionStart).split('\n').length + ' 行' : '';
}
['keyup', 'click', 'focus'].forEach(t => $('editor').addEventListener(t, cursorPos));
$('editor').addEventListener('input', () => {
  if (!current) return;
  current.md = $('editor').value; current.status = null; draw(); docbar(); cursorPos();
  clearTimeout(renderTimer); renderTimer = setTimeout(() => render(true), 400);
});
$('editor').addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); } });

// ------------------------------------------------------------------ save
const canWriteBack = d => (LOCAL && d.dir) || !!(d.handle && d.handle.createWritable);
function docbar() {
  const d = current; if (!d) return;
  $('docTitle').innerHTML = (isDirty(d) ? '<span class="dirty">● </span>' : '') + esc(d.name) +
    (d.dir ? ' <span style="color:var(--muted);font-weight:normal">' + esc(d.dir) + '</span>' : '');
  $('saveBtn').textContent = canWriteBack(d) ? '保存' : '下载修改后的 .md';
  $('saveBtn').title = canWriteBack(d) ? '保存到原文件 (⌘S / Ctrl+S)' : '这个浏览器不能写回原文件，会下载一份修改后的 .md';
  $('saveBtn').disabled = !isDirty(d);
  $('pdfBtn').textContent = LOCAL ? '导出 PDF' : '打印 / 存为 PDF';
}
async function save() {
  const d = current; if (!d || !isDirty(d)) return;
  const text = d.md;
  try {
    if (LOCAL && d.dir) {
      const r = await post('api/save', { dir: d.dir, name: d.name, md: text });
      log('已保存 ' + (await r.json()).saved);
    } else if (d.handle && d.handle.createWritable) {
      if (d.handle.requestPermission && (await d.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('没有得到写入权限');
      const w = await d.handle.createWritable(); await w.write(text); await w.close();
      log('已保存 ' + d.name);
    } else {
      download(new Blob([text], { type: 'text/markdown;charset=utf-8' }), d.name);
      log('已下载 ' + d.name + ' (修改后的版本)');
    }
    d.saved = text;
  } catch (e) { log('保存失败: ' + e.message); }
  draw(); docbar();
}
$('saveBtn').onclick = save;
document.addEventListener('keydown', e => { if (!$('tab-doc').hidden && (e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } });
window.addEventListener('beforeunload', e => { if (docs.some(isDirty)) { e.preventDefault(); e.returnValue = ''; } });

// ------------------------------------------------------------------ PDF
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
  return r;
}
async function exportLocal(d) {
  d.status = '导出中…'; draw(); const o = opts(), t0 = Date.now();
  try {
    const r = await post('api/pdf', { name: d.name, md: d.md, dir: d.dir, imageSources: d.imageSources, documentPath: d.documentPath, paper: o.paper, fontSize: o.fontSize, pageNumbers: o.pageNumbers, pageFormat: o.pageFormat, pageAlign: o.pageAlign, pageSize: o.pageSize, saveTo: o.saveTo });
    if (o.saveTo) { const j = await r.json(); log('已保存 ' + j.saved + ' (' + (j.bytes / 1048576).toFixed(1) + ' MB, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒)'); }
    else { const blob = await r.blob(), name = d.name.replace(/\.(md|markdown)$/i, '') + '.pdf'; download(blob, name); log('已下载 ' + name + ' (' + (blob.size / 1048576).toFixed(1) + ' MB)'); }
    d.status = '已导出';
  } catch (e) { d.status = '失败'; log(d.name + ' 导出失败: ' + e.message); }
  draw();
}
async function documentForWriter(d) {
  const result = { name: d.name, md: d.md, imageSources: d.imageSources, documentPath: d.documentPath };
  if (LOCAL && d.dir) {
    result.imageSources = Object.assign(Object.create(null), d.imageSources);
    result.documentPath = d.documentPath || '/' + encodeURIComponent(d.name);
    const base = location.origin + '/fs' + d.dir.split('/').map(encodeURIComponent).join('/') + '/';
    const dom = new DOMParser().parseFromString(docHtml(d), 'text/html');
    for (const img of dom.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) continue;
      const response = await fetch(new URL(src, base));
      if (!response.ok) throw new Error('无法读取插图: ' + src);
      const key = new URL(src, new URL(result.documentPath, 'https://kamotish.invalid/')).pathname;
      result.imageSources[key] = await window.KamotishFiles.imageData(await response.blob());
    }
  }
  return result;
}
function ensureWriter() {
  if (!writerReady) writerReady = (async () => {
    const response = await fetch('writer/editor.html');
    if (!response.ok) throw new Error('无法载入编辑器');
    $('tab-writer').innerHTML = await response.text();
    writerInstance = window.KamotishWriter.mount($('tab-writer'), {
      onExport: d => { acceptWriterDocument(d); tab('doc'); }
    });
    return writerInstance;
  })();
  return writerReady;
}
function acceptWriterDocument(d) {
  let existing = docs.find(x => x.name === d.name && (x.documentPath || '') === (d.documentPath || ''));
  if (existing) { Object.assign(existing, d); existing.status = null; existing.problems = KM.problems(md, existing.md, window.Kamotish); }
  else { existing = Object.assign({ saved: d.md, problems: KM.problems(md, d.md, window.Kamotish) }, d); docs.push(existing); }
  writerLinkedDoc = existing; writerLinkedText = existing.md;
  editorDoc = null; show(existing);
}
async function syncCurrentWriter(writer) {
  if (currentTab !== 'writer') return;
  if (current && (writerLinkedDoc !== current || writerLinkedText !== current.md)) {
    const selected = current, d = await documentForWriter(selected);
    if (currentTab !== 'writer') return;
    selected.documentPath = d.documentPath || '/' + encodeURIComponent(d.name); d.documentPath = selected.documentPath;
    writer.openMarkdown(d); writerLinkedDoc = selected; writerLinkedText = selected.md;
  }
  writer.activate();
}
$('writerBtn').onclick = () => { if (current) tab('writer'); };
$('pdfBtn').onclick = () => {
  if (!current) return;
  if (LOCAL) return exportLocal(current);
  const w = $('preview').contentWindow, oldTitle = document.title;
  // Chrome's Save as PDF uses the top-level title even when printing an iframe.
  document.title = w.document.title = current.name.replace(/\.(md|markdown)$/i, '');
  const restore = () => {
    document.title = oldTitle;
    w.removeEventListener('afterprint', restore); window.removeEventListener('afterprint', restore);
  };
  w.addEventListener('afterprint', restore); window.addEventListener('afterprint', restore);
  try { w.focus(); w.print(); } catch (e) { restore(); throw e; }
};
$('all').onclick = async () => {
  if (!opts().saveTo && docs.length > 3 && !confirm('没有填“PDF 存到”文件夹，会触发 ' + docs.length + ' 次浏览器下载。继续吗？')) return;
  $('all').disabled = true;
  for (let i = 0; i < docs.length; i++) { log('导出 ' + (i + 1) + '/' + docs.length + ': ' + docs[i].name); await exportLocal(docs[i]); }
  $('all').disabled = false; log('全部完成: ' + docs.filter(d => d.status === '已导出').length + '/' + docs.length);
};
$('clear').onclick = () => {
  if (docs.some(isDirty) && !confirm('有未保存的修改，清空会丢掉这些修改。继续吗？')) return;
  docs.length = 0; current = editorDoc = null;
  $('work').hidden = true; $('empty').hidden = false; $('problems').style.display = 'none'; $('docbar').style.display = 'none'; draw();
};

// ------------------------------------------------------------------ adding files
const { fromFile, readEntries, collectDirHandle } = window.KamotishFiles;
const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }];
$('pickFiles').onclick = async () => {
  $('pickFiles').closest('details')?.removeAttribute('open');
  if (!window.showOpenFilePicker) return $('files').click();
  try { const hs = await window.showOpenFilePicker({ multiple: true, types: MD_TYPES }); add(await Promise.all(hs.map(async h => fromFile(await h.getFile(), h)))); }
  catch (e) { if (e.name !== 'AbortError') log(e.message); }
};
$('pickDir').onclick = async () => {
  $('pickDir').closest('details')?.removeAttribute('open');
  if (!window.showDirectoryPicker) return $('dirInput').click();
  try { const entries = []; await collectDirHandle(await window.showDirectoryPicker({ mode: 'readwrite' }), entries); add(await readEntries(entries)); }
  catch (e) { if (e.name !== 'AbortError') log(e.message); }
};
const readInputs = fs => readEntries([...fs].map(file => ({ file, path: file.webkitRelativePath || file.name })));
$('files').onchange = async e => { add(await readInputs(e.target.files)); e.target.value = ''; };
$('dirInput').onchange = async e => { add(await readInputs(e.target.files)); e.target.value = ''; };

const drop = $('drop');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = async e => {
  e.preventDefault(); drop.classList.remove('over');
  const items = [...e.dataTransfer.items].filter(i => i.kind === 'file'), entries = [];
  if (items.length && items[0].getAsFileSystemHandle) {                  // Chrome / Edge: handles, so edits can be saved back
    const hs = await Promise.all(items.map(i => i.getAsFileSystemHandle()));   // (all started inside the event)
    for (const h of hs) {
      if (!h) continue;
      if (h.kind === 'file') entries.push({ file: await h.getFile(), handle: h, path: h.name });
      else if (h.kind === 'directory') await collectDirHandle(h, entries);
    }
  } else {
    const walk = ent => new Promise(ok => {
      if (ent.isFile) ent.file(file => { entries.push({ file, path: ent.fullPath.replace(/^\//, '') }); ok(); }, ok);
      else { const rd = ent.createReader(), all = [];
        const more = () => rd.readEntries(es => es.length ? (all.push(...es), more()) : Promise.all(all.map(walk)).then(ok), ok); more(); }
    });
    await Promise.all(items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean).map(walk));
  }
  add(await readEntries(entries));
};

// local: load a folder by its path
if (store.get('dirPath')) $('dirPath').value = store.get('dirPath');
$('loadPath').onclick = async () => {
  const dir = $('dirPath').value.trim(); if (!dir) return;
  try {
    const r = await fetch('api/list?dir=' + encodeURIComponent(dir)), j = await r.json();
    if (!r.ok) throw new Error(j.error);
    add(j.files); log('载入 ' + j.files.length + ' 个文件: ' + j.dir); store.set('dirPath', dir);
  } catch (e) { log('载入失败: ' + e.message); }
};
$('dirPath').onkeydown = e => { if (e.key === 'Enter') $('loadPath').click(); };

detectLocal();
