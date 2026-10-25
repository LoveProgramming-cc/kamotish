'use strict';
/* Kamotish Writer 3: a ProseMirror document editor with Google Docs style menus, toolbar,
 * shortcuts, find and replace, links, tables and images. Kamotish graphemes and syllables
 * are atom nodes in the document model; the Kamotish IME inserts them as transactions. */
window.KamotishWriter = { mount(container, options = {}) {
const M = window.KamotishWriterModel, { schema, Slice, Fragment } = M;
const { EditorState, TextSelection, NodeSelection, Plugin, PluginKey } = PM.state;
const { EditorView, Decoration, DecorationSet } = PM.view;
const { keymap } = PM.keymap;
const { history, undo, redo, undoDepth, redoDepth, closeHistory } = PM.history;
const { baseKeymap, toggleMark, chainCommands, exitCode, wrapIn, lift } = PM.commands;
const { wrapInList, splitListItem, liftListItem, sinkListItem } = PM.schemaList;
const T = PM.tables;
const { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule, undoInputRule } = PM.inputrules;
const $ = id => container.querySelector('#kw-' + id);
const safe = M.safe, nodes = schema.nodes, marks = schema.marks;
const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);

let hasDocument = false, loadingDocument = false, revision = 0, savedRevision = 0, createdAt = '', saveQueue = Promise.resolve();
let libraryRecords = [], nameAction = null, deleteTarget = null, insertionTarget = null, openedDocument = null, baseline = '';
let automaticZoom = !localStorage.getItem('kamotish-writer-zoom'), zoom = 1, saveTimer, outlineTimer;
let mode = 'kamo', composing = '', items = [], active = 0, toneTarget = null, dropdownType = '', menuAnchor = null;
let docId = crypto.randomUUID?.() || String(Date.now()), linkRange = null;
const workspace = $('workspace'), layout = $('layout'), ime = $('ime'), menu = $('dropdown');

function notify(s) { const t = $('toast'); t.textContent = s; t.classList.add('show'); clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2600); }
function filename() { return ($('docTitle').value || 'Kamotish').replace(/[\\/:*?"<>|]/g, '_'); }
function download(name, data, mime) { const blob = new Blob([data], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
function keyLabel(spec) {
  return spec.split('-').map(k => k === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : k === 'Shift' ? (isMac ? '⇧' : 'Shift') : k === 'Alt' ? (isMac ? '⌥' : 'Alt') : k.length === 1 ? k.toUpperCase() : k).join(isMac ? '' : '+');
}

/* ---------- Commands ---------- */
// Each toolbar or menu action is its own undo step, as in Docs.
const run = (command, focus = true) => { const ok = command(view.state, tr => view.dispatch(closeHistory(tr)), view); if (focus) view.focus(); return ok; };
function selectionRanges(state) { return state.selection.ranges.map(r => [r.$from.pos, r.$to.pos]); }
function markActive(state, type) {
  const { empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  let found = false, missing = false;
  for (const [from, to] of selectionRanges(state)) state.doc.nodesBetween(from, to, node => {
    if (!node.isInline || node.type === nodes.hard_break) return;
    if (type.isInSet(node.marks)) found = true; else missing = true;
  });
  return found && !missing;
}
function marksAtSelection(state, type) {
  const { empty, $from } = state.selection, values = [];
  if (empty) { values.push(type.isInSet(state.storedMarks || $from.marks()) || null); return values; }
  for (const [from, to] of selectionRanges(state)) state.doc.nodesBetween(from, to, node => {
    if (node.isInline && node.type !== nodes.hard_break) values.push(type.isInSet(node.marks) || null);
  });
  return values.length ? values : [null];
}
// Add (attrs) or remove (null) one mark across the selection; empty selections set typing marks.
function setMark(type, attrs) {
  return (state, dispatch) => {
    const { empty } = state.selection;
    if (!dispatch) return true;
    const tr = state.tr;
    if (empty) {
      if (attrs) tr.addStoredMark(type.create(attrs)); else tr.removeStoredMark(type);
    } else for (const [from, to] of selectionRanges(state)) {
      if (attrs) tr.addMark(from, to, type.create(attrs)); else tr.removeMark(from, to, type);
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}
function toggle(name) { return toggleMark(marks[name]); }
function clearFormatting(state, dispatch) {
  if (!dispatch) return true;
  const tr = state.tr;
  if (state.selection.empty) tr.setStoredMarks((state.storedMarks || state.selection.$from.marks()).filter(m => !M.FORMAT_MARKS.includes(m.type)));
  for (const [from, to] of selectionRanges(state)) for (const type of M.FORMAT_MARKS) tr.removeMark(from, to, type);
  eachTextblock(state, (node, pos) => { if (node.attrs.align || node.attrs.lineHeight) tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { align: null, lineHeight: null })); });
  dispatch(tr);
  return true;
}
function eachTextblock(state, f) {
  const seen = new Set();
  for (const [from, to] of selectionRanges(state)) state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) { if (!seen.has(pos)) { seen.add(pos); f(node, pos); } return false; }
  });
}
function setBlockAttr(name, value) {
  return (state, dispatch) => {
    let applicable = false; const tr = state.tr;
    eachTextblock(state, (node, pos) => { if (name in node.attrs) { applicable = true; tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { [name]: value })); } });
    if (applicable && dispatch) dispatch(tr);
    return applicable;
  };
}
function setBlockType(type, attrs = {}) {
  return (state, dispatch) => {
    const tr = state.tr;
    for (const [from, to] of selectionRanges(state)) tr.setBlockType(from, to, type, node => {
      const keep = {}; for (const k of ['align', 'indent', 'lineHeight']) if (type.spec.attrs?.[k] && node.attrs[k] !== undefined) keep[k] = node.attrs[k];
      return Object.assign(keep, attrs);
    });
    if (!tr.docChanged) return false;
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}
function inBlockquote(state) { const { $from } = state.selection; for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === nodes.blockquote) return true; return false; }
function applyBlockStyle(value) {
  if (value === 'blockquote') return run(inBlockquote(view.state) ? lift : wrapIn(nodes.blockquote));
  if (value === 'pre') return run(setBlockType(nodes.code_block));
  if (/^h[1-6]$/.test(value)) return run(setBlockType(nodes.heading, { level: Number(value[1]) }));
  return run(setBlockType(nodes.paragraph));
}
function listAncestor(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) { const n = $from.node(d); if (n.type === nodes.bullet_list || n.type === nodes.ordered_list) return { node: n, depth: d, pos: $from.before(d) }; }
  return null;
}
function toggleList(type) {
  return (state, dispatch) => {
    const list = listAncestor(state);
    if (list && list.node.type === type) return liftListItem(nodes.list_item)(state, dispatch);
    if (list) { if (dispatch) dispatch(state.tr.setNodeMarkup(list.pos, type)); return true; }
    return wrapInList(type)(state, dispatch);
  };
}
function changeIndent(delta) {
  return (state, dispatch) => {
    if (listAncestor(state)) return (delta > 0 ? sinkListItem : liftListItem)(nodes.list_item)(state, dispatch);
    let applicable = false; const tr = state.tr;
    eachTextblock(state, (node, pos) => {
      if (!('indent' in node.attrs)) return;
      const indent = Math.max(0, Math.min(8, (node.attrs.indent || 0) + delta));
      if (indent !== node.attrs.indent) { applicable = true; tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { indent })); }
    });
    if (applicable && dispatch) dispatch(tr);
    return applicable;
  };
}
// Home/End and ⌘←/⌘→ by visual line. Chrome stops these at noneditable inline atoms.
function lineEdge(dir, extend) {
  return (state, dispatch, view) => {
    const { head, anchor } = state.selection, $head = state.doc.resolve(head);
    if (!$head.parent.isTextblock) return false;
    let caret; try { caret = view.coordsAtPos(head, dir < 0 ? 1 : -1); } catch { return false; }
    const block = view.nodeDOM($head.before()); if (!block?.getBoundingClientRect) return false;
    const box = block.getBoundingClientRect(), y = (caret.top + caret.bottom) / 2;
    const hit = view.posAtCoords({ left: dir < 0 ? box.left + 1 : box.right - 1, top: y }); if (!hit) return false;
    const pos = Math.max($head.start(), Math.min($head.end(), hit.pos));
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, extend ? anchor : pos, pos)).scrollIntoView());
    return true;
  };
}
// Arrow keys treat a Kamotish atom like one character (ProseMirror would select it first).
function moveOverAtom(dir, extend) {
  return (state, dispatch) => {
    const sel = state.selection;
    if (sel instanceof NodeSelection) {
      if (sel.node.type !== nodes.kamo && sel.node.type !== nodes.math_inline) return false;
      const pos = dir < 0 ? sel.from : sel.to;
      if (dispatch) dispatch(state.tr.setSelection(extend ? TextSelection.create(state.doc, dir < 0 ? sel.to : sel.from, pos) : TextSelection.create(state.doc, pos)).scrollIntoView());
      return true;
    }
    if (!(sel instanceof TextSelection) || (!extend && !sel.empty)) return false;
    let head = sel.head, node = dir < 0 ? sel.$head.nodeBefore : sel.$head.nodeAfter;
    if (node?.type !== nodes.kamo && node?.type !== nodes.math_inline) return false;
    do { head += dir * node.nodeSize; const $h = state.doc.resolve(head); node = dir < 0 ? $h.nodeBefore : $h.nodeAfter; }
    while (node?.type === nodes.kamo && node.attrs.kind === 'separator');
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, extend ? sel.anchor : head, head)).scrollIntoView());
    return true;
  };
}
const insertHardBreak = (state, dispatch) => { if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView()); return true; };
const insertHr = (state, dispatch) => {
  if (dispatch) { const tr = state.tr.replaceSelectionWith(nodes.horizontal_rule.create()); dispatch(tr.scrollIntoView()); }
  return true;
};

/* ---------- Font sizes ---------- */
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const BASE_PT = { paragraph: 12, code_block: 10.5, 1: 24, 2: 18, 3: 14, 4: 12, 5: 12, 6: 12 };
function toPt(size) {
  const m = /^(\d+(?:\.\d+)?)(pt|px|em|rem|%)$/.exec(size || ''); if (!m) return null;
  const n = Number(m[1]); return Math.round((m[2] === 'pt' ? n : m[2] === 'px' ? n * .75 : m[2] === '%' ? n / 100 * 12 : n * 12) * 100) / 100;
}
function selectionSizes(state) {
  const sizes = new Set(), { empty, $from } = state.selection;
  const base = parent => parent.type === nodes.heading ? BASE_PT[parent.attrs.level] : BASE_PT[parent.type.name] || 12;
  if (empty) { const m = marks.fontSize.isInSet(state.storedMarks || $from.marks()); sizes.add(m ? toPt(m.attrs.size) : base($from.parent)); return [...sizes]; }
  for (const [from, to] of selectionRanges(state)) state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isInline || node.type === nodes.hard_break) return;
    const m = marks.fontSize.isInSet(node.marks); sizes.add(m ? toPt(m.attrs.size) : base(parent));
  });
  return sizes.size ? [...sizes] : [base($from.parent)];
}
function applySize(pt) {
  if (!Number.isFinite(pt) || pt < 1 || pt > 400) { notify('字号请输入 1–400 之间的数值（磅）'); updateToolbar(); return; }
  run(setMark(marks.fontSize, { size: Math.round(pt * 100) / 100 + 'pt' }));
}
function stepSize(direction) {
  const current = selectionSizes(view.state)[0] || 12;
  const next = direction > 0 ? SIZES.find(s => s > current) ?? Math.min(400, current + 10) : [...SIZES].reverse().find(s => s < current) ?? Math.max(1, current - 1);
  applySize(next);
}

/* ---------- Kamotish IME and atoms ---------- */
const IME_PAGE_SIZE = 6;
function setMode(m) { stopIme(); mode = m; $('kamoMode').classList.toggle('active', m === 'kamo'); $('nativeMode').classList.toggle('active', m === 'native'); notify(m === 'kamo' ? '卡谋语拼音已开启' : '系统输入法已开启'); view.focus(); }
$('kamoMode').onclick = () => setMode('kamo'); $('nativeMode').onclick = () => setMode('native');
for (const b of [$('kamoMode'), $('nativeMode')]) b.addEventListener('mousedown', e => e.preventDefault());
KamoIME.onupdate = status => { $('dictionaryStatus').textContent = status; if (composing) drawIme(); };
KamoIME.init();
function stopIme() { composing = ''; ime.hidden = true; active = 0; items = []; }
function insertSource(source) {
  const state = view.state, { $from } = state.selection;
  if ($from.parent.type.spec.code) { view.dispatch(state.tr.insertText(source)); return; }
  const inherited = (state.storedMarks || $from.marks()).filter(m => m.type !== marks.kamoRun);
  // Consecutive graphemes join the previous run: \mi\wou is unambiguous source. A syllable
  // after another unit starts a new run, otherwise its letters would merge on export.
  const before = state.selection.empty ? $from.nodeBefore : null, previousRun = before && marks.kamoRun.isInSet(before.marks);
  const runId = previousRun && source.startsWith('\\') ? previousRun.attrs.id : M.newRunId();
  const content = M.nodesFromSource(source, inherited, runId);
  const tr = state.tr.replaceSelection(new Slice(Fragment.fromArray(content), 0, 0));
  tr.setStoredMarks(inherited);
  view.dispatch(tr.scrollIntoView());
}
function caretRect() { const { head } = view.state.selection; try { return view.coordsAtPos(head); } catch { return view.dom.getBoundingClientRect(); } }
function placeFixed(el, rect) {
  el.hidden = false; const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(innerWidth - w - 9, rect.left)) + 'px';
  el.style.top = (rect.bottom + h + 10 > innerHeight ? Math.max(8, rect.top - h - 7) : rect.bottom + 7) + 'px';
}
function placeIme() { if (composing) placeFixed(ime, caretRect()); }
function preview(x) { return x.type === 'glyph' || x.type === 'phon' ? Kamotish.renderInline(x.value) : safe(x.value); }
function drawIme() {
  if (!composing) { ime.hidden = true; return; }
  items = KamoIME.candidates(composing); active = Math.min(active, Math.max(0, items.length - 1));
  const page = Math.floor(active / IME_PAGE_SIZE), start = page * IME_PAGE_SIZE;
  $('composition').textContent = composing;
  $('candidates').innerHTML = items.slice(start, start + IME_PAGE_SIZE).map((c, j) => `<button data-i="${start + j}" class="candidate ${start + j === active ? 'selected' : ''}"><span class="kamoPreview">${preview(c)}</span><span class="caption">${safe(c.label)}</span></button>`).join('');
  container.querySelector('.imeFoot').textContent = `1–4 一至四声 · ←→ 选择 · ↑↓ 翻页 · Enter/空格 确认 · ${page + 1}/${Math.max(1, Math.ceil(items.length / IME_PAGE_SIZE))} 页 · Esc`;
  placeIme();
}
function chooseTone(tone) {
  const selected = items[active], target = selected && ['glyph', 'phon'].includes(selected.type) ? selected : items.find(c => ['glyph', 'phon'].includes(c.type));
  if (!target) return;
  stopIme(); insertSource(target.value.replace(/\\[1-4]$/, '') + (tone === '1' ? '' : '\\' + tone));
}
function choose(i = active) {
  const c = items[i]; if (!c) return;
  stopIme();
  if (c.type === 'glyph' || c.type === 'phon') insertSource(c.value); else view.dispatch(view.state.tr.insertText(c.value).scrollIntoView());
}
$('candidates').addEventListener('mousedown', e => e.preventDefault());
$('candidates').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { choose(Number(b.dataset.i)); view.focus(); } });
function imeKeyDown(view, e) {
  if (mode !== 'kamo' || e.isComposing || e.keyCode === 229) return false;
  if (composing) {
    if (e.ctrlKey || e.metaKey || e.altKey) { stopIme(); return false; }
    if (e.key === 'Escape') { stopIme(); return true; }
    if (e.key === 'Backspace') { composing = composing.slice(0, -1); drawIme(); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const pages = Math.max(1, Math.ceil(items.length / IME_PAGE_SIZE));
      const page = Math.max(0, Math.min(pages - 1, Math.floor(active / IME_PAGE_SIZE) + (e.key === 'ArrowDown' ? 1 : -1)));
      active = Math.min(items.length - 1, page * IME_PAGE_SIZE + active % IME_PAGE_SIZE); drawIme(); return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const start = Math.floor(active / IME_PAGE_SIZE) * IME_PAGE_SIZE, count = Math.min(IME_PAGE_SIZE, items.length - start);
      active = start + (active - start + (e.key === 'ArrowRight' ? 1 : count - 1)) % Math.max(1, count); drawIme(); return true;
    }
    if (/^[1-4]$/.test(e.key)) { chooseTone(e.key); return true; }
    if (e.key === ' ' || e.key === 'Enter') { choose(); return true; }
    if (/^[a-z']$/i.test(e.key)) { composing += e.key.toLowerCase(); active = 0; drawIme(); return true; }
    if (e.key === '-') { composing += "'"; active = 0; drawIme(); return true; }
    if (e.key.length === 1) { if (items[0]) choose(0); view.dispatch(view.state.tr.insertText(e.key).scrollIntoView()); return true; }
    if (e.key === 'Tab') { choose(); return true; }
    stopIme(); return false;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const sel = view.state.selection;
  // A selected grapheme: 1–4 changes its tone, as in the tone picker.
  if (sel instanceof NodeSelection && sel.node.type === nodes.kamo && /^[1-4]$/.test(e.key)) {
    if (sel.node.attrs.kind === 'glyph') { setTone(sel.from, e.key === '1' ? '' : e.key); return true; }
  }
  if (/^[a-z]$/i.test(e.key) && !sel.$from.parent.type.spec.code) {
    closeTone(); closeDropdown(); composing = e.key.toLowerCase(); drawIme(); return true;
  }
  return false;
}
function closeTone() { toneTarget = null; $('tonePicker').hidden = true; }
function setTone(pos, tone) {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type !== nodes.kamo || node.attrs.kind !== 'glyph') return;
  const raw = '\\' + node.attrs.name + (tone ? '\\' + tone : '');
  const tr = view.state.tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { raw, tone: tone || '' }));
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(closeHistory(tr)); closeTone(); view.focus();
}
function showTone(pos) {
  const node = view.state.doc.nodeAt(pos); if (!node || node.attrs.kind !== 'glyph') return;
  closeDropdown(); toneTarget = pos;
  const target = $('toneChoices'); target.replaceChildren();
  for (let i = 1; i <= 4; i++) {
    const t = i === 1 ? '' : String(i), b = document.createElement('button');
    b.className = (node.attrs.tone || '') === t ? 'selected' : ''; b.type = 'button';
    b.innerHTML = `${Kamotish.renderInline('\\' + node.attrs.name + (t ? '\\' + t : ''))}<small>${M.NAMED_TONES[i - 1]}</small>`;
    b.onmousedown = e => e.preventDefault(); b.onclick = () => setTone(pos, t); target.append(b);
  }
  const dom = view.nodeDOM(pos); placeFixed($('tonePicker'), (dom || view.dom).getBoundingClientRect());
}

/* ---------- Plugins ---------- */
// Highlight Kamotish atoms inside a text selection (SVG has no native selection paint).
const atomSelection = new Plugin({
  props: {
    decorations(state) {
      const { selection } = state; if (selection.empty || selection instanceof NodeSelection) return null;
      const deco = [];
      for (const [from, to] of selectionRanges(state)) state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === nodes.kamo) deco.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-selected' }));
      });
      return deco.length ? DecorationSet.create(state.doc, deco) : null;
    }
  }
});
// Find and replace state, kept in the editor so matches follow every edit.
const findKey = new PluginKey('find');
function findMatches(doc, query, caseSensitive) {
  const result = []; if (!query) return result;
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '', map = [];
    node.forEach((child, offset) => {
      const s = child.isText ? child.text : '￼';
      for (let i = 0; i < s.length; i++) map.push(pos + 1 + offset + i);
      text += s;
    });
    const hay = caseSensitive ? text : text.toLocaleLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + Math.max(1, needle.length))) result.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
    return false;
  });
  return result;
}
const findPlugin = new Plugin({
  key: findKey,
  state: {
    init: () => ({ query: '', caseSensitive: false, matches: [], index: -1 }),
    apply(tr, value, old, state) {
      const meta = tr.getMeta(findKey);
      if (meta) { const next = Object.assign({}, value, meta); next.matches = findMatches(state.doc, next.query, next.caseSensitive); next.index = next.matches.length ? Math.min(Math.max(0, meta.index ?? value.index), next.matches.length - 1) : -1; return next; }
      if (tr.docChanged && value.query) { const matches = findMatches(state.doc, value.query, value.caseSensitive); return Object.assign({}, value, { matches, index: matches.length ? Math.min(Math.max(0, value.index), matches.length - 1) : -1 }); }
      return value;
    }
  },
  props: {
    decorations(state) {
      const f = findKey.getState(state); if (!f.query || !f.matches.length) return null;
      return DecorationSet.create(state.doc, f.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === f.index ? 'kw-find kw-find-current' : 'kw-find' })));
    }
  }
});
// Image node view: Docs-like selection frame and a corner handle to resize.
class ImageView {
  constructor(node, view, getPos) {
    this.node = node; this.view = view; this.getPos = getPos;
    this.dom = document.createElement('span'); this.dom.className = 'kw-image';
    this.img = document.createElement('img'); this.dom.append(this.img);
    this.handle = document.createElement('span'); this.handle.className = 'kw-image-handle'; this.handle.title = '拖动调整大小'; this.dom.append(this.handle);
    this.handle.addEventListener('pointerdown', e => this.resize(e));
    this.render();
  }
  render() {
    const a = this.node.attrs; this.img.src = a.src; this.img.alt = a.alt || ''; this.img.title = a.title || '';
    if (a.width) this.img.style.width = a.width + 'px'; else this.img.style.removeProperty('width');
  }
  update(node) { if (node.type !== this.node.type) return false; this.node = node; this.render(); return true; }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e) { return e.target === this.handle; }
  ignoreMutation() { return true; }
  resize(e) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startWidth = this.img.getBoundingClientRect().width / zoom, max = view.dom.clientWidth - 160;
    const move = ev => { this.img.style.width = Math.max(24, Math.min(max, startWidth + (ev.clientX - startX) / zoom)) + 'px'; };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      const width = Math.round(parseFloat(this.img.style.width)), pos = this.getPos();
      if (typeof pos !== 'number') return;
      const tr = view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { width }));
      view.dispatch(closeHistory(tr.setSelection(NodeSelection.create(tr.doc, pos))));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
}
function markdownRules() {
  return inputRules({ rules: [
    textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, m => ({ level: m[1].length })),
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
    wrappingInputRule(/^(\d+)[.)]\s$/, nodes.ordered_list, m => ({ order: +m[1] }), (m, n) => n.childCount + n.attrs.order === +m[1]),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    textblockTypeInputRule(/^```$/, nodes.code_block),
    // $$ on an empty line starts a formula block; $$…$$ inside a line becomes a block too.
    new InputRule(/^\$\$$/, (state, match, start) => {
      const $start = state.doc.resolve(start); if ($start.parent.type !== nodes.paragraph) return null;
      const tr = state.tr.replaceRangeWith($start.before(), $start.after(), nodes.math_display.create());
      const pos = tr.mapping.map($start.before(), 1) - 1, at = tr.doc.nodeAt(pos)?.type === nodes.math_display ? pos : $start.before();
      return tr.setSelection(NodeSelection.create(tr.doc, at)).setMeta('openMath', at);
    }),
    new InputRule(/(^|[^$\\])\$\$([^$\n]+)\$\$$/, (state, match, start, end) => {
      const tex = match[2].trim(); if (!tex) return null;
      return state.tr.replaceWith(start + match[1].length, end, nodes.math_display.create({ tex }));
    }),
    // $…$ becomes an inline formula. No space just inside the dollars, so prices like $5 and $6 stay text.
    new InputRule(/(^|[^$\\])\$([^\s$](?:[^$\n]*[^\s$\\])?)\$$/, (state, match, start, end) => {
      const tr = state.tr.replaceWith(start + match[1].length, end, nodes.math_inline.create({ tex: match[2] }));
      return tr;
    }),
    new InputRule(/^(?:---|\*\*\*|___)$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start); if ($start.parent.type !== nodes.paragraph || $start.depth !== 1) return null;
      return state.tr.replaceRangeWith($start.before(), $start.after(), nodes.horizontal_rule.create()).insert($start.before() + 1, nodes.paragraph.create());
    })
  ] });
}
const shortcuts = {
  'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, Backspace: undoInputRule,
  'Mod-b': toggle('bold'), 'Mod-i': toggle('italic'), 'Mod-u': toggle('underline'), 'Shift-Mod-x': toggle('strike'),
  'Mod-.': toggle('sup'), 'Mod-,': toggle('sub'), 'Mod-e': toggle('code'),
  'Shift-Mod-l': setBlockAttr('align', null), 'Shift-Mod-e': setBlockAttr('align', 'center'), 'Shift-Mod-r': setBlockAttr('align', 'right'), 'Shift-Mod-j': setBlockAttr('align', 'justify'),
  'Mod-Alt-0': setBlockType(nodes.paragraph), 'Mod-Alt-1': setBlockType(nodes.heading, { level: 1 }), 'Mod-Alt-2': setBlockType(nodes.heading, { level: 2 }), 'Mod-Alt-3': setBlockType(nodes.heading, { level: 3 }),
  'Shift-Mod-7': toggleList(nodes.ordered_list), 'Shift-Mod-8': toggleList(nodes.bullet_list),
  'Mod-[': changeIndent(-1), 'Mod-]': changeIndent(1), 'Mod-\\': clearFormatting,
  'Shift-Mod-.': () => (stepSize(1), true), 'Shift-Mod-,': () => (stepSize(-1), true),
  'Mod-k': () => (openLinkDialog(), true), 'Mod-f': () => (openFind(false), true), 'Shift-Mod-h': () => (openFind(true), true),
  'Shift-Mod-c': () => (openCount(), true),
  'Mod-/': () => (openShortcuts(), true),
  ArrowLeft: moveOverAtom(-1, false), ArrowRight: moveOverAtom(1, false), 'Shift-ArrowLeft': moveOverAtom(-1, true), 'Shift-ArrowRight': moveOverAtom(1, true),
  Home: lineEdge(-1, false), End: lineEdge(1, false), 'Shift-Home': lineEdge(-1, true), 'Shift-End': lineEdge(1, true),
  ...(isMac ? { 'Mod-ArrowLeft': lineEdge(-1, false), 'Mod-ArrowRight': lineEdge(1, false), 'Shift-Mod-ArrowLeft': lineEdge(-1, true), 'Shift-Mod-ArrowRight': lineEdge(1, true) } : {}),
  'Shift-Enter': chainCommands(exitCode, insertHardBreak),
  Enter: chainCommands((state) => { const s = state.selection; if (s instanceof NodeSelection && (s.node.type === nodes.math_inline || s.node.type === nodes.math_display)) { openMathEditor(s.from); return true; } return false; }, splitListItem(nodes.list_item)),
  Tab: chainCommands(T.goToNextCell(1), sinkListItem(nodes.list_item), changeIndent(1), () => true),
  'Shift-Tab': chainCommands(T.goToNextCell(-1), liftListItem(nodes.list_item), changeIndent(-1), () => true),
};
const plugins = [
  markdownRules(), keymap(shortcuts), keymap(baseKeymap), history(), PM.dropcursor.dropCursor({ color: '#1a73e8', width: 2 }), PM.gapcursor.gapCursor(),
  T.columnResizing({ cellMinWidth: 40 }), T.tableEditing(), atomSelection, findPlugin
];
function newState(doc) { return EditorState.create({ doc, plugins }); }

/* ---------- Clipboard, paste, drop ---------- */
async function insertImageFiles(files, pos) {
  const images = files.filter(f => /^image\//.test(f.type)); if (!images.length) return false;
  const target = docId;
  try {
    const content = [];
    for (const file of images) content.push(nodes.image.create({ src: await KamotishFiles.imageData(file), alt: file.name.replace(/\.[^.]+$/, '') }));
    if (!hasDocument || docId !== target) return notify('当前文稿已切换，已取消插入图片');
    const tr = view.state.tr;
    if (pos == null) tr.replaceSelection(new Slice(Fragment.fromArray(content), 0, 0)); else tr.insert(Math.min(pos, tr.doc.content.size), content);
    view.dispatch(tr.scrollIntoView()); view.focus();
  } catch (error) { notify('插入图片失败: ' + error.message); }
  return true;
}

const view = new EditorView({ mount: $('editor') }, {
  state: newState(M.emptyDoc()),
  nodeViews: { image: (node, view, getPos) => new ImageView(node, view, getPos) },
  attributes: { spellcheck: 'false', 'aria-multiline': 'true', role: 'textbox' },
  handleKeyDown: imeKeyDown,
  handleDOMEvents: {
    mousedown() { if (composing) stopIme(); closeTone(); return false; },
    blur() { setTimeout(drawCaret); return false; },
    focus() { setTimeout(drawCaret); return false; },
    contextmenu(view, e) { return openContextMenu(e); }
  },
  clipboardTextSerializer: slice => M.sliceToText(slice),
  transformPasted: slice => new Slice(M.expandLiterals(slice.content), slice.openStart, slice.openEnd),
  handlePaste(view, e) {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length && !e.clipboardData.getData('text/html')) { e.preventDefault(); insertImageFiles(files); return true; }
    return false;
  },
  handleDrop(view, e) {
    const files = [...(e.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type));
    if (!files.length) return false;
    e.preventDefault(); const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
    insertImageFiles(files, at?.pos); return true;
  },
  dispatchTransaction(tr) {
    const state = view.state.apply(tr);
    view.updateState(state);
    if (tr.docChanged) changed();
    const mathAt = tr.getMeta('openMath');
    if (mathAt != null) setTimeout(() => openMathEditor(mathAt));
    if (tr.docChanged || tr.selectionSet || tr.storedMarksSet) afterUpdate();
    else if (tr.getMeta(findKey)) updateFindCount();
  }
});
const editor = view.dom;
// Clicking a formula opens its editor.
editor.addEventListener('click', e => {
  const mathDom = e.target.closest?.('.kw-math, .kw-math-block'); if (!mathDom) return;
  const pos = view.posAtDOM(mathDom.parentNode, [...mathDom.parentNode.childNodes].indexOf(mathDom));
  const node = view.state.doc.nodeAt(pos);
  if (node?.type === nodes.math_inline || node?.type === nodes.math_display) openMathEditor(pos);
});
// Clicking a grapheme selects it (ProseMirror) and opens the tone picker.
editor.addEventListener('click', e => {
  const unitDom = e.target.closest?.('.kw-unit[data-kind="glyph"]'); if (!unitDom) return;
  const pos = view.posAtDOM(unitDom.parentNode, [...unitDom.parentNode.childNodes].indexOf(unitDom));
  if (view.state.doc.nodeAt(pos)?.type === nodes.kamo) showTone(pos);
});

/* ---------- Atom caret ---------- */
// Chrome draws no caret next to noneditable inline SVG. Draw one from the document position.
const visualCaret = $('caret');
function drawCaret() {
  visualCaret.hidden = true; editor.classList.remove('atom-caret');
  const { selection } = view.state;
  if (!hasDocument || composing || !view.hasFocus() || !selection.empty) return;
  const $pos = selection.$head, before = $pos.nodeBefore, after = $pos.nodeAfter;
  const atom = before?.type === nodes.kamo ? before : after?.type === nodes.kamo ? after : null; if (!atom) return;
  const dom = view.nodeDOM(before === atom ? $pos.pos - before.nodeSize : $pos.pos); if (!dom?.getBoundingClientRect) return;
  const rect = dom.getBoundingClientRect(), bounds = workspace.getBoundingClientRect();
  const height = parseFloat(getComputedStyle(dom).fontSize) * zoom * 1.15, x = before === atom ? rect.right : rect.left, y = rect.bottom - height;
  if (y + height < bounds.top || y > bounds.bottom || x < bounds.left || x > bounds.right) return;
  visualCaret.style.cssText = `left:${x - 1}px;top:${y}px;height:${height}px`; visualCaret.hidden = false; editor.classList.add('atom-caret');
}

/* ---------- Toolbar state ---------- */
const BLOCK_STYLES = [['p', '正文', 'Mod-Alt-0'], ['h1', '标题 1', 'Mod-Alt-1'], ['h2', '标题 2', 'Mod-Alt-2'], ['h3', '标题 3', 'Mod-Alt-3'], ['h4', '标题 4'], ['blockquote', '引用'], ['pre', '代码块']];
const FONTS = [['', '宋体（默认）', "'Songti SC','Noto Serif CJK SC',serif"], ['sans-serif', '黑体', "'PingFang SC','Noto Sans CJK SC',sans-serif"], ["'Kaiti SC','STKaiti','KaiTi',serif", '楷体', "'Kaiti SC','STKaiti','KaiTi',serif"], ['serif', 'Serif', 'serif'], ['Georgia,serif', 'Georgia', 'Georgia,serif'], ['Arial,sans-serif', 'Arial', 'Arial,sans-serif'], ['monospace', '等宽字体', 'monospace']];
const LINE_HEIGHTS = [['1', '单倍'], ['1.15', '1.15'], ['1.5', '1.5 倍'], ['', '默认 (1.9)'], ['2', '双倍']];
const TEXT_COLORS = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'];
function currentBlockValue(state) {
  if (inBlockquote(state)) return 'blockquote';
  const p = state.selection.$from.parent;
  return p.type === nodes.heading ? 'h' + p.attrs.level : p.type === nodes.code_block ? 'pre' : 'p';
}
const fontKey = f => String(f || '').replace(/["']/g, '').replace(/\s*,\s*/g, ',').toLowerCase();
function fontLabel(family) { if (!family) return '宋体'; const f = FONTS.find(x => fontKey(x[0]) === fontKey(family)); return f ? f[1].replace('（默认）', '') : family.split(',')[0].replace(/['"]/g, ''); }
function updateToolbar() {
  const state = view.state, { $from } = state.selection;
  for (const b of container.querySelectorAll('[data-mark]')) { const on = markActive(state, marks[b.dataset.mark]); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  const style = BLOCK_STYLES.find(s => s[0] === currentBlockValue(state));
  $('blockStyle').querySelector('.label').textContent = style ? style[1] : '正文';
  const families = [...new Set(marksAtSelection(state, marks.fontFamily).map(m => m?.attrs.family || ''))];
  $('fontFamily').querySelector('.label').textContent = families.length === 1 ? fontLabel(families[0]) : '混合';
  if (document.activeElement !== $('fontSize')) {
    const sizes = selectionSizes(state);
    $('fontSize').value = sizes.length === 1 ? String(sizes[0]) : ''; $('fontSize').placeholder = sizes.length > 1 ? '混合' : '';
  }
  const align = $from.parent.attrs.align || 'left';
  for (const b of container.querySelectorAll('[data-align]')) b.classList.toggle('on', b.dataset.align === align);
  const list = listAncestor(state);
  for (const b of container.querySelectorAll('[data-list]')) b.classList.toggle('on', list?.node.type.name === b.dataset.list);
  $('undoBtn').disabled = undoDepth(state) === 0; $('redoBtn').disabled = redoDepth(state) === 0;
  const color = marksAtSelection(state, marks.color)[0], highlight = marksAtSelection(state, marks.highlight)[0];
  container.querySelector('.colorMark').style.background = color ? color.attrs.color : '#000';
  container.querySelector('.highlightMark').style.background = highlight ? highlight.attrs.color : 'transparent';
}
function afterUpdate() {
  updateToolbar(); drawCaret(); updateLinkBubble(); updateFindCount(); placeIme();
  if (toneTarget != null) { const n = view.state.doc.nodeAt(toneTarget); if (!n || n.type !== nodes.kamo) closeTone(); }
  highlightOutline();
}

/* ---------- Outline and counter ---------- */
let headings = [];
function refreshOutline() {
  const root = $('outline'); root.replaceChildren(); headings = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type === nodes.heading) {
      if (node.attrs.level <= 3) {
        const b = document.createElement('button'); b.className = 'h' + node.attrs.level;
        b.textContent = node.textContent.trim() || (node.childCount ? '卡谋语标题' : '未命名标题');
        b.onclick = () => { const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)); view.dispatch(tr); view.focus(); const dom = view.nodeDOM(pos); dom?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        root.append(b); headings.push({ pos, button: b });
      }
      return false;
    }
    return node.type === nodes.blockquote;
  });
  const c = M.countText(view.state.doc); $('counter').textContent = c.chars.toLocaleString('zh-CN') + ' 字';
  highlightOutline();
}
function highlightOutline() {
  const head = view.state.selection.head; let current = null;
  for (const h of headings) if (h.pos <= head) current = h;
  for (const h of headings) h.button.classList.toggle('current', h === current);
}

/* ---------- Menus ---------- */
function closeDropdown() {
  menu.hidden = true; dropdownType = ''; menuAnchor = null;
  container.querySelectorAll('.menuAnchor[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
const item = (label, action, extra = {}) => Object.assign({ label, action }, extra);
const heading = label => ({ heading: label });
const sep = { separator: true };
function inTable(state) { const { $from } = state.selection; for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.spec.tableRole === 'table') return true; return false; }
function tableItems() {
  const s = view.state;
  return [heading('表格'), item('在上方插入行', () => run(T.addRowBefore)), item('在下方插入行', () => run(T.addRowAfter)),
    item('在左侧插入列', () => run(T.addColumnBefore)), item('在右侧插入列', () => run(T.addColumnAfter)),
    item('删除行', () => run(T.deleteRow)), item('删除列', () => run(T.deleteColumn)),
    item('合并单元格', () => run(T.mergeCells), { disabled: !T.mergeCells(s) }), item('拆分单元格', () => run(T.splitCell), { disabled: !T.splitCell(s) }),
    item('切换表头行', () => run(T.toggleHeaderRow)), item('删除表格', () => run(T.deleteTable), { danger: true })];
}
function menuEntries(type) {
  const s = view.state;
  switch (type) {
    case 'import': return [item('导入单个文件…', () => $('fileInput').click(), { hint: 'Markdown、原生文稿、文本' }), item('导入文件夹…', () => $('folderInput').click(), { hint: 'Markdown 与本地图片' })];
    case 'file': return [
      item('新建文稿…', newDocument), sep,
      item('导入单个文件…', () => $('fileInput').click(), { hint: 'Markdown、原生文稿、文本' }), item('导入文件夹…', () => $('folderInput').click(), { hint: 'Markdown 与本地图片' }), sep,
      item('重命名…', () => renameDocument(docId)), item('创建副本', async () => { await save(); await duplicateDocument(docId); }), item('立即保存', () => save().then(ok => { if (ok) notify('已保存到我的文稿'); }), { key: 'Mod-s' }), sep,
      item('下载原生文稿 (.kamodoc)', saveNative, { hint: '保留全部格式与插图' }), item('导出 Markdown (.md)', exportMd, { hint: '与文档工具互通' }), item('排版 / 导出 PDF', exportPdf), sep,
      item('关闭文稿', closeDocument, { hint: '保存后返回我的文稿' })];
    case 'edit': return [
      item('撤销', () => run(undo), { key: 'Mod-z', disabled: !undoDepth(s) }), item('重做', () => run(redo), { key: 'Shift-Mod-z', disabled: !redoDepth(s) }), sep,
      item('剪切', () => { view.focus(); document.execCommand('cut'); }, { key: 'Mod-x' }), item('复制', () => { view.focus(); document.execCommand('copy'); }, { key: 'Mod-c' }),
      item('粘贴', () => notify((isMac ? '⌘' : 'Ctrl+') + 'V 粘贴：浏览器不允许菜单直接读取剪贴板'), { key: 'Mod-v' }), sep,
      item('全选', () => run(PM.commands.selectAll), { key: 'Mod-a' }), item('查找和替换', () => openFind(true), { key: 'Shift-Mod-h' })];
    case 'insert': return [
      item('图片…', chooseImages, { hint: '从本机选择，可多选；也可直接粘贴或拖入' }), item('表格…', openTableDialog), item('链接…', openLinkDialog, { key: 'Mod-k' }),
      item('卡谋语…', openInsert, { hint: '字素与拟素源码' }), item('公式（行内）', () => insertMath(false), { hint: '也可直接输入 $公式$' }), item('公式块', () => insertMath(true), { hint: '也可在空行输入 $$' }), sep, item('水平线', () => run(insertHr)), item('换行（不分段）', () => run(insertHardBreak), { key: 'Shift-Enter' })];
    case 'format': {
      const entries = [heading('文字'),
        item('加粗', () => run(toggle('bold')), { key: 'Mod-b', checked: markActive(s, marks.bold) }), item('斜体', () => run(toggle('italic')), { key: 'Mod-i', checked: markActive(s, marks.italic) }),
        item('下划线', () => run(toggle('underline')), { key: 'Mod-u', checked: markActive(s, marks.underline) }), item('删除线', () => run(toggle('strike')), { key: 'Shift-Mod-x', checked: markActive(s, marks.strike) }),
        item('上标', () => run(toggle('sup')), { key: 'Mod-.', checked: markActive(s, marks.sup) }), item('下标', () => run(toggle('sub')), { key: 'Mod-,', checked: markActive(s, marks.sub) }),
        item('行内代码', () => run(toggle('code')), { key: 'Mod-e', checked: markActive(s, marks.code) }),
        item('增大字号', () => stepSize(1), { key: 'Shift-Mod-.' }), item('减小字号', () => stepSize(-1), { key: 'Shift-Mod-,' }),
        heading('段落'), ...BLOCK_STYLES.slice(0, 4).map(([v, label, key]) => item(label, () => applyBlockStyle(v), { key, checked: currentBlockValue(s) === v })),
        item('左对齐', () => run(setBlockAttr('align', null)), { key: 'Shift-Mod-l' }), item('居中', () => run(setBlockAttr('align', 'center')), { key: 'Shift-Mod-e' }),
        item('右对齐', () => run(setBlockAttr('align', 'right')), { key: 'Shift-Mod-r' }), item('两端对齐', () => run(setBlockAttr('align', 'justify')), { key: 'Shift-Mod-j' }),
        item('项目符号列表', () => run(toggleList(nodes.bullet_list)), { key: 'Shift-Mod-8' }), item('编号列表', () => run(toggleList(nodes.ordered_list)), { key: 'Shift-Mod-7' }),
        item('增加缩进', () => run(changeIndent(1)), { key: 'Mod-]' }), item('减少缩进', () => run(changeIndent(-1)), { key: 'Mod-[' }),
        sep, item('清除格式', () => run(clearFormatting), { key: 'Mod-\\' })];
      if (inTable(s)) entries.push(...tableItems());
      return entries;
    }
    case 'tools': return [item('字数统计', openCount, { key: 'Shift-Mod-c' }), item('查找和替换', () => openFind(true), { key: 'Shift-Mod-h' }), sep,
      item('卡谋语输入法', () => setMode('kamo'), { checked: mode === 'kamo' }), item('系统输入法', () => setMode('native'), { checked: mode === 'native' }), sep,
      item('显示文稿大纲', toggleSidebar, { checked: !layout.classList.contains('collapsed') }), item('键盘快捷键', openShortcuts, { key: 'Mod-/' })];
    case 'block': return BLOCK_STYLES.map(([v, label]) => item(label, () => applyBlockStyle(v), { checked: currentBlockValue(s) === v, className: 'style-' + v }));
    case 'font': { const cur = marksAtSelection(s, marks.fontFamily)[0]?.attrs.family || ''; return FONTS.map(([v, label, css]) => item(label, () => run(setMark(marks.fontFamily, v ? { family: v } : null)), { checked: fontKey(cur) === fontKey(v), fontCss: css })); }
    case 'size': { const cur = selectionSizes(s); return SIZES.map(v => item(String(v), () => applySize(v), { checked: cur.length === 1 && cur[0] === v })); }
    case 'lineHeight': { const cur = s.selection.$from.parent.attrs.lineHeight || ''; return [heading('行距'), ...LINE_HEIGHTS.map(([v, label]) => item(label, () => run(setBlockAttr('lineHeight', v || null)), { checked: cur === v }))]; }
    case 'zoom': return [.5, .75, .9, 1, 1.25, 1.5, 2].map(z => item(Math.round(z * 100) + '%', () => setZoom(z), { checked: !automaticZoom && Math.abs(zoom - z) < .01 }))
      .concat([item('适合宽度', () => { automaticZoom = true; localStorage.removeItem('kamotish-writer-zoom'); fitWidth(); }, { checked: automaticZoom })]);
    case 'context': {
      const entries = [item('剪切', () => { view.focus(); document.execCommand('cut'); }, { key: 'Mod-x', disabled: s.selection.empty }), item('复制', () => { view.focus(); document.execCommand('copy'); }, { key: 'Mod-c', disabled: s.selection.empty }),
        sep, item('插入链接', openLinkDialog, { key: 'Mod-k' }), item('清除格式', () => run(clearFormatting), { key: 'Mod-\\' })];
      return inTable(s) ? tableItems().concat([sep], entries) : entries;
    }
  }
  return [];
}
function swatches(type) {
  const box = document.createElement('div'), current = marksAtSelection(view.state, marks[type])[0]?.attrs.color;
  const reset = document.createElement('button'); reset.className = 'menuItem swatchReset'; reset.textContent = type === 'color' ? '重置文字颜色' : '无突出显示';
  reset.onclick = () => { closeDropdown(); run(setMark(marks[type], null)); }; box.append(reset);
  const grid = document.createElement('div'); grid.className = 'swatchGrid';
  for (const color of TEXT_COLORS) {
    const b = document.createElement('button'); b.className = 'swatch' + (current === color ? ' on' : ''); b.style.background = color; b.title = color; b.setAttribute('aria-label', color);
    b.onclick = () => { closeDropdown(); run(setMark(marks[type], { color })); }; grid.append(b);
  }
  const custom = document.createElement('label'); custom.className = 'swatchCustom';
  custom.innerHTML = '<span>自定义</span><input type="text" placeholder="#1a73e8" maxlength="7" aria-label="自定义颜色">';
  custom.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) { closeDropdown(); run(setMark(marks[type], { color: v })); } else notify('请输入 #RRGGBB 格式的颜色'); } });
  box.append(grid, custom); return box;
}
function openMenu(anchor, type, point) {
  if (!menu.hidden && dropdownType === type && menuAnchor === anchor && !point) { closeDropdown(); return; }
  closeTone(); stopIme(); closeDropdown(); dropdownType = type; menuAnchor = anchor;
  anchor?.setAttribute('aria-expanded', 'true');
  menu.replaceChildren(); menu.className = 'dropdown menu-' + type;
  if (type === 'color' || type === 'highlight') menu.append(swatches(type));
  else for (const entry of menuEntries(type)) {
    if (entry.separator) { const s = document.createElement('div'); s.className = 'menuSeparator'; menu.append(s); continue; }
    if (entry.heading) { const h = document.createElement('div'); h.className = 'menuHeading'; h.textContent = entry.heading; menu.append(h); continue; }
    const b = document.createElement('button'); b.className = 'menuItem' + (entry.danger ? ' danger' : '') + (entry.className ? ' ' + entry.className : ''); b.setAttribute('role', 'menuitem'); b.disabled = !!entry.disabled;
    b.innerHTML = `<span class="check">${entry.checked ? '✓' : ''}</span><span class="menuLabel">${safe(entry.label)}${entry.hint ? '<small>' + safe(entry.hint) + '</small>' : ''}</span>${entry.key ? '<kbd>' + safe(keyLabel(entry.key)) + '</kbd>' : ''}`;
    if (entry.fontCss) b.querySelector('.menuLabel').style.fontFamily = entry.fontCss;
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { closeDropdown(); try { const r = entry.action(); r?.catch?.(e => notify(e.message)); } catch (e) { notify(e.message); } };
    menu.append(b);
  }
  if (point) placeFixed(menu, { left: point.x, right: point.x, top: point.y, bottom: point.y }); else placeFixed(menu, anchor.getBoundingClientRect());
}
container.querySelectorAll('[data-menu]').forEach(b => {
  b.addEventListener('mousedown', e => { if (b.id !== 'kw-fontSize') e.preventDefault(); });
  b.addEventListener('click', e => { e.preventDefault(); openMenu(b, b.dataset.menu); });
  // Like a desktop menubar: once a menu is open, hovering another top menu switches to it.
  if (b.classList.contains('menubarItem')) b.addEventListener('mouseenter', () => { if (!menu.hidden && menuAnchor?.classList.contains('menubarItem') && menuAnchor !== b) openMenu(b, b.dataset.menu); });
});
menu.addEventListener('keydown', e => {
  const btns = [...menu.querySelectorAll('button:not(:disabled)')], index = btns.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); btns[(index + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus(); }
  else if (e.key === 'Escape') { const anchor = menuAnchor; closeDropdown(); anchor ? anchor.focus() : view.focus(); }
});
function openContextMenu(e) {
  if (!inTable(view.state)) return false;
  const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
  if (pos && view.state.selection.empty) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.pos)));
  if (!inTable(view.state)) return false;
  e.preventDefault(); openMenu(null, 'context', { x: e.clientX, y: e.clientY }); return true;
}
document.addEventListener('pointerdown', e => {
  container.querySelectorAll('.document-actions[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
  if (!e.target.closest('#kw-dropdown,.menuAnchor')) closeDropdown();
  if (!e.target.closest('#kw-tonePicker,.kw-unit')) closeTone();
  if (!e.target.closest('#kw-ime,#kw-editor')) stopIme();
  if (mathPos != null && !e.target.closest('#kw-mathEditor')) closeMathEditor(true);
});

/* ---------- Toolbar actions ---------- */
const ACTIONS = {
  undo: () => run(undo), redo: () => run(redo), find: () => openFind(true), sizeUp: () => stepSize(1), sizeDown: () => stepSize(-1),
  link: openLinkDialog, image: chooseImages, kamo: openInsert, math: () => insertMath(false), indent: () => run(changeIndent(1)), outdent: () => run(changeIndent(-1)), clearFormat: () => run(clearFormatting)
};
container.querySelectorAll('.tools button').forEach(b => {
  if (!b.classList.contains('menuAnchor') && !b.closest('.inputSwitch')) b.addEventListener('mousedown', e => e.preventDefault());
});
container.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => ACTIONS[b.dataset.action]()));
container.querySelectorAll('[data-mark]').forEach(b => b.addEventListener('click', () => run(toggle(b.dataset.mark))));
container.querySelectorAll('[data-align]').forEach(b => b.addEventListener('click', () => run(setBlockAttr('align', b.dataset.align === 'left' ? null : b.dataset.align))));
container.querySelectorAll('[data-list]').forEach(b => b.addEventListener('click', () => run(toggleList(nodes[b.dataset.list]))));
$('fontSize').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); applySize(Number(e.target.value)); }
  else if (e.key === 'Escape') { updateToolbar(); view.focus(); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepSize(e.key === 'ArrowUp' ? 1 : -1); $('fontSize').focus(); }
});
$('fontSize').addEventListener('focus', e => e.target.select());
$('fontSize').addEventListener('change', e => { if (e.target.value.trim() && Number(e.target.value) !== selectionSizes(view.state)[0]) applySize(Number(e.target.value)); });
$('fontSize').addEventListener('blur', () => setTimeout(updateToolbar));

/* ---------- Links ---------- */
function markRange(state, type, pos) {
  const $pos = state.doc.resolve(pos), parent = $pos.parent;
  let index = $pos.index(), mark = index < parent.childCount ? type.isInSet(parent.child(index).marks) : null;
  if (!mark && $pos.textOffset === 0 && index > 0) { index--; mark = type.isInSet(parent.child(index).marks); }
  if (!mark) return null;
  let first = index, last = index + 1;
  while (first > 0 && mark.isInSet(parent.child(first - 1).marks)) first--;
  while (last < parent.childCount && mark.isInSet(parent.child(last).marks)) last++;
  let from = $pos.start(); for (let i = 0; i < first; i++) from += parent.child(i).nodeSize;
  let to = from; for (let i = first; i < last; i++) to += parent.child(i).nodeSize;
  return { from, to, mark };
}
function plainSelection(state) {
  const { from, to, $from, $to } = state.selection; let plain = $from.sameParent($to);
  state.doc.nodesBetween(from, to, node => { if (node.isInline && !node.isText) plain = false; });
  return plain;
}
function openLinkDialog() {
  const state = view.state, { from, to, empty } = state.selection;
  linkRange = markRange(state, marks.link, from); if (linkRange && to > linkRange.to) linkRange = null;
  const range = linkRange || { from, to }, textField = $('linkText').closest('.field');
  $('linkText').value = state.doc.textBetween(range.from, range.to, ' ', '\ufffc');
  $('linkUrl').value = linkRange?.mark.attrs.href || '';
  textField.hidden = !(empty || linkRange || plainSelection(state));
  $('linkDialog').hidden = false; (!textField.hidden && !$('linkText').value ? $('linkText') : $('linkUrl')).focus();
}
$('linkCancel').onclick = () => { $('linkDialog').hidden = true; view.focus(); };
$('linkForm').onsubmit = e => {
  e.preventDefault();
  let href = $('linkUrl').value.trim(); if (!href) return;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[#/.]/.test(href) && /^[^\s]+\.[^\s]+$/.test(href)) href = (href.includes('@') && !href.includes('/') ? 'mailto:' : 'https://') + href;
  href = M.safeLink(href); if (!href) return notify('不支持此链接地址');
  const state = view.state, link = marks.link.create({ href }), text = $('linkText').value, tr = state.tr;
  const range = linkRange || { from: state.selection.from, to: state.selection.to };
  const current = state.doc.textBetween(range.from, range.to, ' ', '\ufffc');
  const keep = (range.from === range.to ? state.storedMarks || state.selection.$from.marks() : state.doc.resolve(range.from + 1).marks()).filter(m => m.type !== marks.link && m.type !== marks.kamoRun);
  let end = range.to;
  if (range.from === range.to) { const t = text || href; tr.insert(range.from, schema.text(t, link.addToSet(keep))); end = range.from + t.length; }
  else if (!$('linkText').closest('.field').hidden && text && text !== current) { tr.replaceWith(range.from, range.to, schema.text(text, link.addToSet(keep))); end = range.from + text.length; }
  else tr.removeMark(range.from, range.to, marks.link).addMark(range.from, range.to, link);
  tr.setSelection(TextSelection.create(tr.doc, end)).removeStoredMark(marks.link);
  view.dispatch(tr); $('linkDialog').hidden = true; view.focus();
};
function updateLinkBubble() {
  const bubble = $('linkBubble'), { selection } = view.state;
  const range = view.hasFocus() && !composing && hasDocument ? markRange(view.state, marks.link, selection.from) : null;
  if (!range || selection.to > range.to) { bubble.hidden = true; return; }
  $('linkHref').textContent = range.mark.attrs.href; $('linkHref').href = range.mark.attrs.href;
  const start = view.coordsAtPos(range.from), end = view.coordsAtPos(range.to);
  placeFixed(bubble, { left: start.left, right: end.right, top: start.top, bottom: Math.max(start.bottom, end.bottom) });
}
$('linkBubble').addEventListener('mousedown', e => { if (e.target.tagName === 'BUTTON') e.preventDefault(); });
$('linkEdit').onclick = () => openLinkDialog();
$('linkRemove').onclick = () => { const r = markRange(view.state, marks.link, view.state.selection.from); if (r) view.dispatch(view.state.tr.removeMark(r.from, r.to, marks.link)); view.focus(); };

/* ---------- Find and replace ---------- */
function setFind(meta) { view.dispatch(view.state.tr.setMeta(findKey, meta)); }
function openFind(replace) {
  const bar = $('findBar'); bar.hidden = false; bar.classList.toggle('withReplace', !!replace || bar.classList.contains('withReplace'));
  const { from, to } = view.state.selection, selected = view.state.doc.textBetween(from, to, ' ');
  if (selected && !selected.includes('\n') && selected.length < 100) $('findInput').value = selected;
  $('findInput').focus(); $('findInput').select();
  setFind({ query: $('findInput').value, caseSensitive: $('findCase').checked, index: 0 }); revealMatch();
}
function closeFind() { $('findBar').hidden = true; setFind({ query: '' }); view.focus(); }
function revealMatch(select = false) {
  const f = findKey.getState(view.state); const m = f.matches[f.index]; if (!m) return;
  const dom = view.domAtPos(m.from).node; const el = dom.nodeType === 3 ? dom.parentElement : dom;
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (select) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to))); }
}
function stepMatch(delta) {
  const f = findKey.getState(view.state); if (!f.matches.length) return;
  setFind({ index: (f.index + delta + f.matches.length) % f.matches.length }); revealMatch();
}
function updateFindCount() {
  if ($('findBar').hidden) return;
  const f = findKey.getState(view.state);
  $('findCount').textContent = f.query ? (f.matches.length ? `${f.index + 1} / ${f.matches.length}` : '无结果') : '';
}
$('findInput').addEventListener('input', () => { setFind({ query: $('findInput').value, index: 0 }); revealMatch(); });
$('findCase').addEventListener('change', () => setFind({ caseSensitive: $('findCase').checked, index: 0 }));
$('findInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') closeFind(); });
$('replaceInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') closeFind(); });
$('findNext').onclick = () => stepMatch(1); $('findPrev').onclick = () => stepMatch(-1); $('findClose').onclick = closeFind;
function replaceOne() {
  const f = findKey.getState(view.state), m = f.matches[f.index]; if (!m) return;
  const value = $('replaceInput').value, tr = view.state.tr;
  if (value) tr.insertText(value, m.from, m.to); else tr.delete(m.from, m.to);
  view.dispatch(tr); revealMatch();
}
function replaceAll() {
  const f = findKey.getState(view.state); if (!f.matches.length) return;
  const value = $('replaceInput').value, tr = view.state.tr;
  for (const m of [...f.matches].reverse()) { if (value) tr.insertText(value, m.from, m.to); else tr.delete(m.from, m.to); }
  view.dispatch(tr); notify(`已替换 ${f.matches.length} 处`);
}
$('replaceOne').onclick = replaceOne; $('replaceAll').onclick = replaceAll;

/* ---------- Formulas ---------- */
const MATH_TEMPLATES = [
  ['\\frac{a}{b}', '\\frac{}{}', '分数'], ['x^{2}', '^{}', '上标'], ['x_{i}', '_{}', '下标'], ['\\sqrt{x}', '\\sqrt{}', '根号'], ['\\sqrt[n]{x}', '\\sqrt[]{}', 'n 次根'],
  ['\\sum_{i=1}^{n}', '\\sum_{i=1}^{n} ', '求和'], ['\\prod_{i=1}^{n}', '\\prod_{i=1}^{n} ', '连乘'], ['\\int_{a}^{b}', '\\int_{}^{} \\,\\mathrm{d}x', '积分'], ['\\lim_{x\\to\\infty}', '\\lim_{x \\to } ', '极限'],
  ['\\left(x\\right)', '\\left(  \\right)', '括号'], ['\\vec{v}', '\\vec{}', '向量'], ['\\hat{x}', '\\hat{}', '帽'], ['\\overline{x}', '\\overline{}', '上划线'],
  ['\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', '\\begin{pmatrix}  &  \\\\  &  \\end{pmatrix}', '矩阵'],
  ['\\begin{cases}a\\\\b\\end{cases}', '\\begin{cases}  & x>0 \\\\  & x\\le 0 \\end{cases}', '分段'], ['\\text{文字}', '\\text{}', '文字']
];
const MATH_SYMBOLS = '\\alpha \\beta \\gamma \\delta \\epsilon \\theta \\lambda \\mu \\pi \\rho \\sigma \\phi \\omega \\Delta \\Sigma \\Omega \\infty \\pm \\times \\div \\cdot \\le \\ge \\ne \\approx \\equiv \\to \\Rightarrow \\Leftrightarrow \\in \\notin \\subset \\cup \\cap \\forall \\exists \\partial \\nabla \\degree \\ldots'.split(' ');
let mathPos = null, mathCreated = false;
function renderMath(el, tex, display) { try { katex.render(tex || '\\square', el, { throwOnError: false, displayMode: display }); } catch { el.textContent = tex; } }
(function buildPalette() {
  const box = $('mathPalette');
  for (const [sample, insert, label] of MATH_TEMPLATES) { const b = document.createElement('button'); b.type = 'button'; b.title = label; b.dataset.insert = insert; renderMath(b, sample, false); box.append(b); }
  const symbols = document.createElement('div'); symbols.className = 'mathSymbols';
  for (const sym of MATH_SYMBOLS) { const b = document.createElement('button'); b.type = 'button'; b.title = sym; b.dataset.insert = sym + ' '; renderMath(b, sym, false); symbols.append(b); }
  box.after(symbols);
})();
function openMathEditor(pos) {
  const node = view.state.doc.nodeAt(pos); if (!node || (node.type !== nodes.math_inline && node.type !== nodes.math_display)) return;
  closeDropdown(); closeTone(); stopIme();
  mathPos = pos; mathCreated = !node.attrs.tex;
  if (!(view.state.selection instanceof NodeSelection && view.state.selection.from === pos)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  const box = $('mathEditor'), src = $('mathSource');
  box.classList.toggle('display', node.type === nodes.math_display);
  src.value = node.attrs.tex; src.rows = node.type === nodes.math_display ? 3 : 1; updateMathPreview();
  const dom = view.nodeDOM(pos); placeFixed(box, (dom || view.dom).getBoundingClientRect());
  src.focus(); src.setSelectionRange(src.value.length, src.value.length);
}
function updateMathPreview() {
  const node = mathPos != null && view.state.doc.nodeAt(mathPos);
  renderMath($('mathPreview'), $('mathSource').value.replace(/^\$+|\$+$/g, ''), node?.type === nodes.math_display);
}
function closeMathEditor(commit) {
  if (mathPos == null) return;
  const pos = mathPos, node = view.state.doc.nodeAt(pos); mathPos = null; $('mathEditor').hidden = true;
  if (!node || (node.type !== nodes.math_inline && node.type !== nodes.math_display)) return;
  const tex = $('mathSource').value.trim().replace(/^\$+|\$+$/g, '').trim();
  const tr = view.state.tr; let removed = false;
  if (commit && tex) { if (tex !== node.attrs.tex) tr.setNodeMarkup(pos, null, { tex }); }
  else if (!tex || (mathCreated && !node.attrs.tex)) { tr.delete(pos, pos + node.nodeSize); removed = true; }
  const after = removed ? tr.mapping.map(pos) : pos + node.nodeSize;
  tr.setSelection(PM.state.Selection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size))));
  view.dispatch(closeHistory(tr.scrollIntoView())); view.focus();
}
function insertMath(display) {
  const state = view.state, { from, to, empty } = state.selection;
  const tex = empty ? '' : state.doc.textBetween(from, to, ' ');
  const node = (display ? nodes.math_display : nodes.math_inline).create({ tex });
  const tr = state.tr.replaceSelectionWith(node);
  let pos = null; tr.doc.nodesBetween(Math.max(0, tr.mapping.map(from, -1) - 2), Math.min(tr.doc.content.size, tr.mapping.map(from, -1) + 3), (n, p) => { if (pos == null && n.type === node.type && n.attrs.tex === tex) pos = p; });
  if (pos == null) return;
  view.dispatch(closeHistory(tr.setSelection(NodeSelection.create(tr.doc, pos))));
  openMathEditor(pos);
}
$('mathSource').addEventListener('input', () => {
  updateMathPreview();
  // Typing the closing $$ (or $) finishes the formula, as in Markdown.
  if (/\$\$\s*$/.test($('mathSource').value) && $('mathSource').value.replace(/^\$+/, '').trim().length > 2) closeMathEditor(true);
});
$('mathSource').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); closeMathEditor(true); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMathEditor(false); }
});
container.querySelector('.mathPaletteWrap').addEventListener('mousedown', e => e.preventDefault());
container.querySelector('.mathPaletteWrap').addEventListener('click', e => {
  const b = e.target.closest('[data-insert]'); if (!b) return;
  const src = $('mathSource'), text = b.dataset.insert, start = src.selectionStart, end = src.selectionEnd;
  src.setRangeText(text, start, end, 'end');
  const hole = text.indexOf('{}'), inner = text.indexOf('{ }');
  if (hole >= 0) src.setSelectionRange(start + hole + 1, start + hole + 1);
  else if (text.includes('  ')) { const p = start + text.indexOf('  ') + 1; src.setSelectionRange(p, p); }
  src.focus(); updateMathPreview();
});
$('mathDone').onclick = () => closeMathEditor(true);
$('mathDelete').onclick = () => { $('mathSource').value = ''; closeMathEditor(true); };

/* ---------- Dialogs ---------- */
function openCount() {
  const all = M.countText(view.state.doc), { from, to, empty } = view.state.selection, part = empty ? null : M.countText(view.state.doc, from, to);
  const row = (label, key) => `<tr><th>${label}</th>${part ? `<td>${part[key].toLocaleString('zh-CN')}</td>` : ''}<td>${all[key].toLocaleString('zh-CN')}</td></tr>`;
  $('countTable').innerHTML = (part ? '<tr><th></th><td class="muted">所选</td><td class="muted">全文</td></tr>' : '') +
    row('字数（汉字、单词、卡谋语各计 1）', 'words') + row('字符数（不含空格）', 'chars') + row('字符数（含空格）', 'charsWithSpaces') + row('卡谋语字素 / 拟素', 'units') + row('公式', 'formulas') + row('段落', 'paragraphs');
  $('countDialog').hidden = false; $('countClose').focus();
}
$('countClose').onclick = () => { $('countDialog').hidden = true; view.focus(); };
$('counter').onclick = openCount;
function openShortcuts() {
  const groups = [['常用', [['撤销 / 重做', 'Mod-z', 'Shift-Mod-z'], ['保存', 'Mod-s'], ['查找 / 替换', 'Mod-f', 'Shift-Mod-h'], ['字数统计', 'Shift-Mod-c'], ['插入链接', 'Mod-k'], ['换行（不分段）', 'Shift-Enter']]],
    ['文字', [['加粗', 'Mod-b'], ['斜体', 'Mod-i'], ['下划线', 'Mod-u'], ['删除线', 'Shift-Mod-x'], ['上标 / 下标', 'Mod-.', 'Mod-,'], ['行内代码', 'Mod-e'], ['增大 / 减小字号', 'Shift-Mod-.', 'Shift-Mod-,'], ['清除格式', 'Mod-\\']]],
    ['段落', [['正文 / 标题 1–3', 'Mod-Alt-0', 'Mod-Alt-1'], ['左 / 中 / 右 / 两端对齐', 'Shift-Mod-l', 'Shift-Mod-e'], ['编号 / 项目符号列表', 'Shift-Mod-7', 'Shift-Mod-8'], ['增加 / 减少缩进', 'Mod-]', 'Mod-['], ['列表内缩进', 'Tab', 'Shift-Tab']]],
    ['自动格式', [['# 空格 → 标题；- 空格 → 列表；1. 空格 → 编号；> 空格 → 引用；--- → 水平线'], ['$公式$ → 行内公式；空行输入 $$ → 公式块；单击公式可编辑']]],
    ['卡谋语输入', [['输入拼音后 1–4 选声调；← → 候选；↑ ↓ 翻页；空格/Enter 确认'], ['选中字素后按 1–4 修改声调']]]];
  $('shortcutList').innerHTML = groups.map(([title, rows]) => `<h3>${title}</h3><dl>${rows.map(([label, ...keys]) => `<dt>${safe(label)}</dt><dd>${keys.map(k => '<kbd>' + safe(keyLabel(k)) + '</kbd>').join(' ')}</dd>`).join('')}</dl>`).join('');
  $('shortcutDialog').hidden = false; $('shortcutClose').focus();
}
$('shortcutClose').onclick = () => { $('shortcutDialog').hidden = true; view.focus(); };
function sourceValue() { const value = $('kamoSource').value.trim(); return value.startsWith('\\kamotish{') && value.endsWith('}') ? value.slice('\\kamotish{'.length, -1) : value; }
function openInsert() { $('kamoDialog').hidden = false; $('kamoSource').value = '\\mi\\wou\\3中国人\\mou\\2'; updatePreview(); $('kamoSource').focus(); $('kamoSource').select(); }
function updatePreview() { $('sourcePreview').innerHTML = Kamotish.renderInline(sourceValue()); }
$('kamoSource').addEventListener('input', updatePreview);
$('kamoSource').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('kamoForm').requestSubmit(); } });
$('cancelInsert').onclick = () => { $('kamoDialog').hidden = true; view.focus(); };
$('kamoForm').onsubmit = e => { e.preventDefault(); const s = sourceValue(); $('kamoDialog').hidden = true; view.focus(); if (s) insertSource(s); };
for (const id of ['kamoDialog', 'linkDialog', 'countDialog', 'shortcutDialog', 'tableDialog']) $(id).addEventListener('pointerdown', e => { if (e.target === $(id)) { $(id).hidden = true; view.focus(); } });

// Table dialog: a Docs-like size grid plus explicit numbers.
const grid = $('tableGrid');
for (let r = 1; r <= 8; r++) for (let c = 1; c <= 10; c++) { const cell = document.createElement('span'); cell.dataset.r = r; cell.dataset.c = c; grid.append(cell); }
function paintGrid(rows, cols) { for (const cell of grid.children) cell.classList.toggle('on', cell.dataset.r <= rows && cell.dataset.c <= cols); }
grid.addEventListener('mouseover', e => { const c = e.target.dataset; if (c.r) { $('tableRows').value = c.r; $('tableColumns').value = c.c; paintGrid(c.r, c.c); } });
grid.addEventListener('click', e => { if (e.target.dataset.r) $('tableForm').requestSubmit(); });
for (const id of ['tableRows', 'tableColumns']) $(id).addEventListener('input', () => paintGrid($('tableRows').value, $('tableColumns').value));
function openTableDialog() { insertionTarget = docId; $('tableDialog').hidden = false; paintGrid($('tableRows').value, $('tableColumns').value); $('tableRows').focus(); }
$('tableCancel').onclick = () => { $('tableDialog').hidden = true; view.focus(); };
$('tableForm').onsubmit = e => {
  e.preventDefault(); if (!hasDocument || insertionTarget !== docId) return;
  const rows = Number($('tableRows').value), cols = Number($('tableColumns').value);
  if (!Number.isInteger(rows) || rows < 1 || rows > 30 || !Number.isInteger(cols) || cols < 1 || cols > 12) return notify('表格最多 30 行、12 列');
  const header = $('tableHeader').checked, cell = type => type.create(null, nodes.paragraph.create());
  const table = nodes.table.create(null, Array.from({ length: rows }, (_, r) => nodes.table_row.create(null, Array.from({ length: cols }, () => cell(r === 0 && header ? nodes.table_header : nodes.table_cell)))));
  $('tableDialog').hidden = true;
  const state = view.state, tr = state.tr.replaceSelectionWith(table);
  // Put the caret in the first cell.
  let cellPos = null; tr.doc.nodesBetween(tr.mapping.map(state.selection.from, -1), tr.doc.content.size, (node, pos) => { if (cellPos == null && node.type.spec.tableRole === 'cell') { cellPos = pos; return false; } return cellPos == null; });
  if (cellPos != null) tr.setSelection(TextSelection.create(tr.doc, cellPos + 2));
  view.dispatch(tr.scrollIntoView()); view.focus();
};
function chooseImages() { insertionTarget = docId; $('imageInput').click(); }
$('imageInput').onchange = async e => {
  const target = insertionTarget, files = [...e.target.files]; e.target.value = '';
  if (files.some(f => !/^image\//.test(f.type))) return notify('插入图片失败: 请选择图片文件');
  if (!hasDocument || docId !== target) return notify('当前文稿已切换，已取消插入图片');
  await insertImageFiles(files);
};

/* ---------- Zoom and sidebar ---------- */
// CSS layout zoom (not a transform): caret, selection and popup coordinates stay correct.
function setZoom(z, persist = true) {
  zoom = Math.min(2, Math.max(.5, Math.round(z * 100) / 100)); container.style.setProperty('--doc-zoom', String(zoom));
  $('zoomLevel').firstChild.textContent = Math.round(zoom * 100) + '% ';
  if (persist) { automaticZoom = false; localStorage.setItem('kamotish-writer-zoom', String(zoom)); }
  requestAnimationFrame(() => { drawCaret(); placeIme(); updateLinkBubble(); });
}
workspace.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * .01)); } }, { passive: false });
let gestureBase = 1;
workspace.addEventListener('gesturestart', e => { e.preventDefault(); gestureBase = zoom; }, { passive: false });
workspace.addEventListener('gesturechange', e => { e.preventDefault(); setZoom(gestureBase * e.scale); }, { passive: false });
workspace.addEventListener('gestureend', e => e.preventDefault(), { passive: false });
workspace.addEventListener('scroll', () => { placeIme(); drawCaret(); updateLinkBubble(); if (!$('tonePicker').hidden) closeTone(); if (mathPos != null) { const d = view.nodeDOM(mathPos); if (d) placeFixed($('mathEditor'), d.getBoundingClientRect()); } }, { passive: true });
window.addEventListener('resize', () => { placeIme(); drawCaret(); if (!container.hidden) fitWidth(); });
function toggleSidebar() {
  if (matchMedia('(max-width:760px)').matches) { const opened = layout.classList.toggle('outline-open'); layout.classList.remove('collapsed'); $('sideToggle').setAttribute('aria-expanded', String(opened)); return; }
  const collapsed = layout.classList.toggle('collapsed'); $('sideToggle').setAttribute('aria-expanded', String(!collapsed));
  localStorage.setItem('kamotish-writer-sidebar', collapsed ? 'hidden' : 'visible'); setTimeout(fitWidth);
}
$('sideToggle').onclick = toggleSidebar; $('outlineOpen').onclick = toggleSidebar;
function fitWidth() { if (automaticZoom && workspace.clientWidth) setZoom(Math.min(1, (workspace.clientWidth - 48) / 794), false); }
try { const savedZoom = localStorage.getItem('kamotish-writer-zoom'); if (savedZoom) setZoom(Number(savedZoom)); } catch { zoom = 1; }
if (localStorage.getItem('kamotish-writer-sidebar') === 'hidden') { layout.classList.add('collapsed'); $('sideToggle').setAttribute('aria-expanded', 'false'); }

container.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (hasDocument) save().then(ok => { if (ok) notify('已保存到我的文稿'); }); return; }
  if (mod && ['+', '=', '-', '0'].includes(e.key) && view.hasFocus()) { e.preventDefault(); setZoom(e.key === '0' ? 1 : zoom + (e.key === '-' ? -.1 : .1)); return; }
  if (mod && e.key.toLowerCase() === 'f' && hasDocument && !view.hasFocus() && !e.target.closest('.modal')) { e.preventDefault(); openFind(false); return; }
  if (e.key === 'Escape') {
    if (composing) stopIme(); closeTone(); if (!menu.hidden) { closeDropdown(); view.focus(); }
    for (const id of ['kamoDialog', 'tableDialog', 'nameDialog', 'deleteDialog', 'linkDialog', 'countDialog', 'shortcutDialog', 'folderDialog']) if (!$(id).hidden) { $(id).hidden = true; if (hasDocument) view.focus(); }
  }
});

/* ---------- Saving, import and export ---------- */
function changed() {
  clearTimeout(outlineTimer); outlineTimer = setTimeout(refreshOutline, 120);
  if (!hasDocument || loadingDocument) return;
  revision++; $('saveStatus').textContent = '正在编辑…'; clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 450);
}
$('docTitle').addEventListener('input', changed);
$('docTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); view.focus(); } });
function setDoc(doc) {
  view.updateState(newState(doc)); stopIme(); closeTone(); closeDropdown();
  if (!$('findBar').hidden) setFind({ query: $('findInput').value, caseSensitive: $('findCase').checked, index: 0 });
  refreshOutline(); updateToolbar(); drawCaret();
}
function exportNative() { return { format: 'Kamotish Writer', schemaVersion: 2, id: docId, title: $('docTitle').value, createdBy: 'Kamotish Writer 3', savedAt: new Date().toISOString(), page: { size: 'A4' }, content: M.docToAst(view.state.doc) }; }
function importNative(doc) {
  if (doc?.format !== 'Kamotish Writer' || doc.schemaVersion !== 2 || !Array.isArray(doc.content)) throw Error('不是支持的 .kamodoc 文档 (需要版本 2)');
  if (doc.content.length > 100000) throw Error('文档节点数量异常');
  setDoc(M.astToDoc(doc.content)); $('docTitle').value = String(doc.title || '未命名文稿'); docId = String(doc.id || docId); changed();
}
function saveNative() { download(filename() + '.kamodoc', JSON.stringify(exportNative(), null, 2), 'application/vnd.kamotish-writer+json;charset=utf-8'); notify('原生 .kamodoc 文稿已导出'); }
function exportMarkdown() { return M.docToMarkdown(view.state.doc); }
function exportMd() { download(filename() + '.md', exportMarkdown(), 'text/markdown;charset=utf-8'); notify('Markdown 已导出'); }
function exportPdf() { deactivate(); options.onExport?.(exportDocument()); }
$('pdfBtn').onclick = exportPdf;
const markdown = window.markdownit({ html: true, linkify: true }).use(window.markdownitKamotish, Kamotish);
markdown.renderer.rules.kamotish = (tokens, i) => M.runElement(tokens[i].content).outerHTML;
// Formulas import as editable nodes: the texmath rules give the TeX source, not finished HTML.
if (window.texmath && window.katex) {
  markdown.use(window.texmath, { engine: window.katex, delimiters: ['dollars', 'brackets'] });
  for (const name of Object.keys(markdown.renderer.rules).filter(n => n.startsWith('math_'))) {
    const display = !/^math_inline(_bracket)?$/.test(name);
    markdown.renderer.rules[name] = (tokens, i) => M.mathElement(tokens[i].content.trim(), display, false).outerHTML;
  }
  const fence = markdown.renderer.rules.fence;
  markdown.renderer.rules.fence = (tokens, i, ...rest) => ['latex', 'tex', 'math', 'katex'].includes((tokens[i].info || '').trim().toLowerCase()) ? M.mathElement(tokens[i].content.trim(), true, false).outerHTML : fence(tokens, i, ...rest);
}
function importMarkdown(source, { imageSources, documentPath } = {}) {
  const dom = new DOMParser().parseFromString(markdown.render(source), 'text/html');
  dom.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(e => e.remove());
  dom.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || ''; img.dataset.originalSrc = src;
    if (imageSources && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) {
      const key = new URL(src, new URL(documentPath || '', 'https://kamotish.invalid/')).pathname;
      if (Object.prototype.hasOwnProperty.call(imageSources, key)) img.src = imageSources[key];
    }
  });
  setDoc(M.domToDoc(dom.body)); changed();
}
async function openMarkdown(d) {
  await ready; if (hasDocument && !(await save())) throw Error('当前文稿尚未保存，未切换文稿');
  loadingDocument = true; hasDocument = true; deactivate(); docId = d.writerId || crypto.randomUUID(); createdAt = new Date().toISOString();
  if (d.writerId) { const previous = await KamotishLibrary.get(d.writerId); if (previous) createdAt = previous.createdAt; }
  openedDocument = d; importMarkdown(d.md, d); $('docTitle').value = d.name.replace(/\.(md|markdown)$/i, '');
  baseline = JSON.stringify(exportNative().content) + $('docTitle').value; revision = 1; savedRevision = 0; loadingDocument = false;
  showDocument(); await save(true); notify('文稿已载入');
}
$('folderCancel').onclick = () => { $('folderDialog').hidden = true; };
$('folderInput').onchange = async e => {
  try {
    const docs = await window.KamotishFiles.readEntries([...e.target.files].map(file => ({ file, path: file.webkitRelativePath || file.name })));
    if (!docs.length) throw Error('文件夹中没有 Markdown 文档');
    const list = $('folderFiles'); list.replaceChildren();
    for (const d of docs) { const b = document.createElement('button'); b.textContent = decodeURIComponent(d.documentPath); b.onclick = async () => { try { await openMarkdown(d); $('folderDialog').hidden = true; } catch (e) { notify(e.message); } }; list.append(b); }
    $('folderDialog').hidden = false;
  } catch (ex) { notify('导入失败: ' + ex.message); } finally { e.target.value = ''; }
};
$('fileInput').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    if (f.size > 60 * 1024 * 1024) throw Error('文件过大 (上限 60 MB)');
    const src = await f.text();
    if (/\.kamodoc$/i.test(f.name)) await openNativeDocument(JSON.parse(src));
    else if (/\.html?$/i.test(f.name)) { const dom = new DOMParser().parseFromString(src, 'text/html'); dom.querySelectorAll('script,style,iframe,object,embed').forEach(x => x.remove()); await openMarkdown({ name: f.name, md: dom.body.textContent }); }
    else await openMarkdown({ name: f.name, md: src });
  } catch (ex) { notify('导入失败: ' + ex.message); }
  e.target.value = '';
};
async function save(force = false) {
  clearTimeout(saveTimer); if (!hasDocument || loadingDocument || (!force && revision === savedRevision)) return true;
  const id = docId, version = revision, source = openedDocument ? { name: openedDocument.name, md: openedDocument.md, documentPath: openedDocument.documentPath, writerId: id } : null;
  const record = { id, title: $('docTitle').value || '未命名文稿', createdAt, updatedAt: new Date().toISOString(), document: exportNative(), source, baseline };
  $('saveStatus').textContent = '正在保存…';
  const result = saveQueue.then(() => KamotishLibrary.put(record)); saveQueue = result.catch(() => {});
  try {
    await result;
    if (hasDocument && docId === id) { savedRevision = Math.max(savedRevision, version); $('saveStatus').textContent = revision === savedRevision ? '已保存到此浏览器' : '正在编辑…'; }
    return true;
  } catch (e) { if (docId === id) $('saveStatus').textContent = '保存失败 · 请下载备份'; notify('文稿保存失败: ' + e.message); return false; }
}
function restoreDoc() {
  try { const raw = localStorage.getItem('kamotish-writer-v2'); if (raw) { importNative(JSON.parse(raw)); return true; } } catch (e) { console.warn('Native recovery failed:', e); }
  try {
    const v1 = JSON.parse(localStorage.getItem('kamotish-writer-v1'));
    if (v1 && typeof v1.html === 'string' && typeof v1.title === 'string') {
      const dom = new DOMParser().parseFromString(v1.html, 'text/html');
      dom.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(x => x.remove());
      setDoc(M.domToDoc(dom.body)); $('docTitle').value = v1.title; notify('已迁移旧版文稿; 建议导出 .kamodoc 备份'); return true;
    }
  } catch (e) { console.warn('v1 recovery failed:', e); }
  return false;
}
function showDocument() {
  $('libraryView').hidden = true; $('documentView').hidden = false;
  workspace.scrollTop = 0; fitWidth();
  view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
  requestAnimationFrame(() => view.focus());
}

/* ---------- Library ---------- */
async function refreshLibrary() { libraryRecords = await KamotishLibrary.list(); renderLibrary(); }
function renderLibrary() {
  const term = $('librarySearch').value.trim().toLocaleLowerCase();
  const records = libraryRecords.filter(d => d.title.toLocaleLowerCase().includes(term));
  records.sort($('librarySort').value === 'title' ? (a, b) => a.title.localeCompare(b.title, 'zh') : (a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $('libraryCount').textContent = libraryRecords.length + ' 份文稿';
  $('libraryStatus').textContent = records.length ? '' : term ? '没有找到匹配的文稿' : '还没有文稿。新建一份，或从“导入”菜单导入已有文档。';
  const list = $('libraryList'); list.replaceChildren();
  for (const record of records) {
    const row = document.createElement('div'); row.className = 'library-row'; row.dataset.documentId = record.id;
    const open = document.createElement('button'); open.className = 'library-open';
    open.innerHTML = '<span class="document-symbol" aria-hidden="true">▤</span><span><strong>' + safe(record.title) + '</strong><small>' + safe(new Date(record.updatedAt).toLocaleString('zh-CN')) + ' 修改</small></span>';
    open.onclick = () => openSavedDocument(record.id).catch(e => notify(e.message));
    const more = document.createElement('details'); more.className = 'document-actions';
    const summary = document.createElement('summary'); summary.textContent = '⋯'; summary.setAttribute('aria-label', record.title + '的操作'); more.append(summary);
    const actions = document.createElement('div'); actions.className = 'document-action-menu';
    for (const [label, action] of [['重命名', () => renameDocument(record.id)], ['创建副本', () => duplicateDocument(record.id)], ['删除', () => requestDelete(record)]]) {
      const button = document.createElement('button'); button.textContent = label; if (label === '删除') button.className = 'danger';
      button.onclick = () => { more.open = false; try { action()?.catch?.(e => notify(e.message)); } catch (e) { notify(e.message); } }; actions.append(button);
    }
    more.append(actions); row.append(open, more); list.append(row);
  }
}
function askName(headingText, value, action) {
  nameAction = action; $('nameHeading').textContent = headingText; $('nameInput').value = value; $('nameDialog').hidden = false;
  $('nameInput').focus(); $('nameInput').select();
}
$('nameCancel').onclick = () => { $('nameDialog').hidden = true; nameAction = null; if (hasDocument) view.focus(); };
$('nameForm').onsubmit = async e => {
  e.preventDefault(); const name = $('nameInput').value.trim(); if (!name) return;
  const submit = $('nameForm').querySelector('[type="submit"]'); submit.disabled = true;
  try { await nameAction?.(name); $('nameDialog').hidden = true; nameAction = null; } catch (error) { notify(error.message); } finally { submit.disabled = false; }
};
function newDocument() { askName('新建文稿', '未命名文稿', name => openNativeDocument({ format: 'Kamotish Writer', schemaVersion: 2, title: name, content: [{ t: 'element', tag: 'p', children: [] }] })); }
async function openNativeDocument(document) {
  await ready; if (hasDocument && !(await save())) throw Error('当前文稿尚未保存，未切换文稿');
  if (document?.format !== 'Kamotish Writer' || document.schemaVersion !== 2 || !Array.isArray(document.content) || document.content.length > 100000) throw Error('不是支持的 .kamodoc 文稿');
  loadingDocument = true; hasDocument = true; deactivate(); openedDocument = null; baseline = ''; createdAt = new Date().toISOString();
  importNative(Object.assign({}, document, { id: crypto.randomUUID() })); revision = 1; savedRevision = 0; loadingDocument = false; showDocument(); await save(true);
}
async function openSavedDocument(id) {
  await ready; if (hasDocument && !(await save())) throw Error('当前文稿尚未保存，未切换文稿');
  const record = await KamotishLibrary.get(id); if (!record) throw Error('这份文稿已不存在');
  loadingDocument = true; hasDocument = true; deactivate(); openedDocument = record.source; baseline = record.baseline || ''; createdAt = record.createdAt;
  importNative(record.document); revision = 0; savedRevision = 0; loadingDocument = false; $('saveStatus').textContent = '已保存到此浏览器'; showDocument();
}
async function closeDocument() {
  if (hasDocument) { if (!(await save())) return; options.onDocumentClosed?.(exportDocument()); }
  clearTimeout(saveTimer); hasDocument = false; openedDocument = null; deactivate();
  $('documentView').hidden = true; $('libraryView').hidden = false; setDoc(M.emptyDoc());
  await refreshLibrary();
}
async function renameDocument(id) {
  const record = id === docId && hasDocument ? { title: $('docTitle').value } : await KamotishLibrary.get(id);
  if (!record) throw Error('文稿已不存在');
  askName('重命名文稿', record.title, async title => {
    if (hasDocument && docId === id) { $('docTitle').value = title; changed(); await save(); }
    else {
      const stored = await KamotishLibrary.get(id), unchanged = stored.source && stored.baseline === JSON.stringify(stored.document.content) + stored.document.title;
      stored.title = title; stored.document.title = title; stored.updatedAt = new Date().toISOString();
      if (stored.source) { stored.source.name = title + '.md'; stored.baseline = unchanged ? JSON.stringify(stored.document.content) + title : ''; }
      await KamotishLibrary.put(stored);
    }
    options.onDocumentRenamed?.(id, title); await refreshLibrary();
  });
}
async function duplicateDocument(id) {
  const record = await KamotishLibrary.get(id); if (!record) throw Error('文稿已不存在');
  const unchanged = record.source && record.baseline === JSON.stringify(record.document.content) + record.document.title;
  record.id = crypto.randomUUID(); record.title += '（副本）'; record.createdAt = record.updatedAt = new Date().toISOString(); record.document.id = record.id; record.document.title = record.title;
  if (record.source) { record.source.name = record.title + '.md'; record.source.writerId = record.id; record.baseline = unchanged ? JSON.stringify(record.document.content) + record.title : ''; }
  await KamotishLibrary.put(record); await refreshLibrary(); notify('已创建副本“' + record.title + '”');
}
function requestDelete(record) { deleteTarget = record.id; $('deleteMessage').textContent = '将从此浏览器的文稿库中删除“' + record.title + '”。已下载的文件不会受影响。'; $('deleteDialog').hidden = false; $('deleteCancel').focus(); }
$('deleteCancel').onclick = () => { $('deleteDialog').hidden = true; deleteTarget = null; };
$('deleteConfirm').onclick = async () => {
  if (!deleteTarget) return;
  try { await KamotishLibrary.remove(deleteTarget); options.onDocumentDeleted?.(deleteTarget); $('deleteDialog').hidden = true; deleteTarget = null; await refreshLibrary(); notify('文稿已删除'); } catch (e) { notify(e.message); }
};
$('librarySearch').oninput = renderLibrary; $('librarySort').onchange = renderLibrary;
$('newDocument').onclick = newDocument; $('backToLibrary').onclick = () => closeDocument().catch(e => notify(e.message));
async function initializeLibrary() {
  try {
    if (!(await KamotishLibrary.meta('legacy-migrated'))) {
      loadingDocument = true;
      if (restoreDoc()) {
        const native = exportNative(), now = new Date().toISOString();
        await KamotishLibrary.put({ id: native.id, title: native.title || '恢复的文稿', createdAt: now, updatedAt: now, document: native, source: null, baseline: '' });
      }
      await KamotishLibrary.setMeta('legacy-migrated', true); loadingDocument = false;
    }
    setDoc(M.emptyDoc()); hasDocument = false; await refreshLibrary();
  } catch (e) { loadingDocument = false; $('libraryStatus').textContent = '无法打开本地文稿库: ' + e.message; throw e; }
}

const ready = initializeLibrary();
window.addEventListener('pagehide', () => save());
window.addEventListener('beforeunload', e => { if (hasDocument && revision !== savedRevision) { e.preventDefault(); e.returnValue = ''; } });
function deactivate() {
  visualCaret.hidden = true; stopIme(); closeTone(); closeDropdown(); $('linkBubble').hidden = true; if (mathPos != null) closeMathEditor(true);
  for (const id of ['kamoDialog', 'folderDialog', 'tableDialog', 'linkDialog', 'countDialog', 'shortcutDialog']) $(id).hidden = true;
}
function exportDocument() {
  if (!hasDocument) return null;
  const name = filename() + '.md', documentPath = openedDocument?.documentPath || '/' + encodeURIComponent(name);
  const unchanged = openedDocument && baseline === JSON.stringify(exportNative().content) + $('docTitle').value;
  const imageSources = Object.assign(Object.create(null), openedDocument?.imageSources);
  view.state.doc.descendants(node => {
    if (node.type !== nodes.image) return;
    const src = node.attrs.originalSrc || node.attrs.src;
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && node.attrs.src.startsWith('data:image/')) {
      imageSources[new URL(src, new URL(documentPath, 'https://kamotish.invalid/')).pathname] = node.attrs.src;
    }
  });
  return { writerId: docId, name: unchanged ? openedDocument.name : name, md: unchanged ? openedDocument.md : exportMarkdown(), documentPath, imageSources };
}
return {
  ready, view, openMarkdown, exportDocument, exportNative, importNative, exportMarkdown, deactivate, save, closeDocument, newDocument, openSavedDocument, insertSource,
  hasDocument: () => hasDocument,
  activate() { if (!hasDocument) refreshLibrary().catch(e => notify(e.message)); fitWidth(); if (matchMedia('(max-width:760px)').matches) $('sideToggle').setAttribute('aria-expanded', String(layout.classList.contains('outline-open'))); }
};
} };
