/* 卡谋语渲染 - content script.
 * Finds  \kamotish{ ... }  anywhere in a page (also across bold / links / line breaks) and replaces it by the
 * rendered Kamotish text.  Inside the braces:  \{  \}  \\  stand for a literal  {  }  \ ;  every other backslash is passed
 * on to the renderer unchanged (so \mou\1 is still the grapheme mou with tone 1).
 */
(function () {
  'use strict';
  if (window.__kamotishExtension) return;
  const K = window.Kamotish;
  if (!K) return;
  window.__kamotishExtension = true;

  const WRAP = 'kamotish-ext';
  const MARK = '\\kamotish{';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'PRE',
                        'SVG', 'MATH', 'TEMPLATE', 'IFRAME', 'CANVAS', 'HEAD', 'TITLE']);
  const BR_CHAR = '\u2028';
  const ext = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome : null;

  let enabled = true, disabledHosts = [];
  const hostName = location.hostname;
  const active = () => enabled && disabledHosts.indexOf(hostName) < 0;

  // ---------------------------------------------------------------- text flow (a run of inline text inside one block)
  let infoCache = new WeakMap();
  function info(el) {
    if (!el) return { root: null, skip: true };
    let r = infoCache.get(el); if (r) return r;
    const parent = el.parentElement, pi = parent ? info(parent) : null;
    const display = getComputedStyle(el).display;
    const inline = /^(inline|contents|ruby)/.test(display) || display === 'inline-block';
    const skip = (pi && pi.skip) || display === 'none' || SKIP.has(el.nodeName.toUpperCase()) || el.isContentEditable || el.classList.contains(WRAP) ||
                 el.getAttribute('data-kamotish') === 'off';                 // a page can opt out of the extension
    r = { root: (inline && pi && pi.root) ? pi.root : el, skip };
    infoCache.set(el, r); return r;
  }

  function collectFlows(root) {
    const flows = []; let cur = null;
    const flush = () => { if (cur && cur.text.indexOf(MARK) >= 0) flows.push(cur); cur = null; };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (SKIP.has(n.nodeName.toUpperCase()) || n.classList.contains(WRAP)) { flush(); return NodeFilter.FILTER_REJECT; }
          return n.nodeName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const inf = info(n.parentElement);
      if (inf.skip || !inf.root) { flush(); continue; }
      if (!cur || cur.root !== inf.root) { flush(); cur = { root: inf.root, text: '', segs: [] }; }
      const raw = n.nodeType === 3 ? n.nodeValue : BR_CHAR;
      cur.segs.push({ node: n.nodeType === 3 ? n : null, start: cur.text.length, end: cur.text.length + raw.length });
      cur.text += raw;
    }
    flush();
    return flows;
  }

  // ---------------------------------------------------------------- \kamotish{ ... }
  function findMatches(text) {
    const out = []; let pos = 0;
    for (;;) {
      const i = text.indexOf(MARK, pos); if (i < 0) break;
      let j = i + MARK.length, content = '', closed = false;
      while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length && '{}\\'.indexOf(text[j + 1]) >= 0) { content += text[j + 1]; j += 2; }
        else if (c === '}') { closed = true; break; }
        else { content += c; j++; }
      }
      if (!closed) { pos = i + MARK.length; continue; }
      out.push({ start: i, end: j + 1, content });
      pos = j + 1;
    }
    return out;
  }
  function normalise(s) {
    return s.replace(/[ \t\r\n\f\u00a0]+/g, ' ').replace(new RegExp(' ?' + BR_CHAR + ' ?', 'g'), '\n').trim();
  }
  function makeWrapper(src, content) {
    const host = document.createElement('span');
    host.className = WRAP; host.setAttribute('data-src', src); host.setAttribute('translate', 'no');
    host.setAttribute('role', 'img'); host.setAttribute('aria-label', content); host.title = src;
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>:host{display:inline}' + K.css + '</style>' + K.renderInline(content);
    return host;
  }
  function locate(segs, index) {
    for (const s of segs) if (s.node && index >= s.start && index < s.end) return { node: s.node, offset: index - s.start };
    return null;
  }
  function replaceIn(flow) {
    const ms = findMatches(flow.text);
    for (let k = ms.length - 1; k >= 0; k--) {              // last first, so earlier offsets stay valid
      const m = ms[k], a = locate(flow.segs, m.start), b = locate(flow.segs, m.end - 1);
      if (!a || !b) continue;
      const range = document.createRange();
      range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset + 1);
      const src = flow.text.slice(m.start, m.end).split(BR_CHAR).join('\n');
      const wrapper = makeWrapper(src, normalise(m.content));
      range.deleteContents(); range.insertNode(wrapper);
    }
  }

  let busy = false;
  function scan(root) {
    if (!active() || !root || busy) return;
    if ((root.textContent || '').indexOf('kamotish') < 0) return;
    busy = true;
    try { infoCache = new WeakMap(); collectFlows(root).forEach(replaceIn); }
    finally { busy = false; if (observer) observer.takeRecords(); }
  }
  function revertAll() {
    document.querySelectorAll('.' + WRAP).forEach(w => w.replaceWith(document.createTextNode(w.getAttribute('data-src') || '')));
  }

  // ---------------------------------------------------------------- dynamic pages
  const pending = new Set(); let timer = 0, observer = null;
  function queue(n) {
    const el = n.nodeType === 1 ? n : n.parentElement;
    if (!el || (el.closest && el.closest('.' + WRAP + ',.' + WRAP + '-bar'))) return;
    pending.add(el);
    if (!timer) timer = setTimeout(() => {
      timer = 0; const els = Array.from(pending); pending.clear();
      els.filter(e => e.isConnected && !els.some(o => o !== e && o.contains(e))).forEach(scan);
    }, 150);
  }
  function startObserver() {
    observer = new MutationObserver(muts => {
      if (busy || !active()) return;
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(queue); else if (m.type === 'characterData') queue(m.target);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  // ---------------------------------------------------------------- live preview for text boxes (like an IME candidate window)
  // previewMode: 'caret' = only the \kamotish{…} the caret is in (next to the caret), 'all' = every piece in the box, 'off'
  let previewMode = 'caret';
  let bar = null, barBody = null, barTarget = null, barDismissed = null;
  const TEXT_INPUT = /^(text|search|url|email|tel|)$/i;
  function editableOf(t) {
    if (!t || t.nodeType !== 1) return null;
    if (t.closest && t.closest('[data-kamotish="off"]')) return null;
    const n = t.nodeName;
    if (n === 'TEXTAREA' || (n === 'INPUT' && TEXT_INPUT.test(t.type || ''))) return t;
    if (t.isContentEditable) { let h = t; while (h.parentElement && h.parentElement.isContentEditable) h = h.parentElement; return h; }
    return null;
  }
  // the text before and after the caret
  function aroundCaret(el) {
    if (el.value !== undefined) { const p = el.selectionEnd == null ? el.value.length : el.selectionEnd; return [el.value.slice(0, p), el.value.slice(p)]; }
    const sel = getSelection(); if (!sel || !sel.rangeCount || !el.contains(sel.focusNode)) return null;
    const r1 = document.createRange(), r2 = document.createRange();
    r1.selectNodeContents(el); r1.setEnd(sel.focusNode, sel.focusOffset);
    r2.selectNodeContents(el); r2.setStart(sel.focusNode, sel.focusOffset);
    return [r1.toString(), r2.toString()];
  }
  // the \kamotish{…} the caret is inside (or right after its closing brace): {content, pending}
  function pieceAtCaret(before, after) {
    const i = before.lastIndexOf(MARK); if (i < 0) return null;
    let content = '', j = i + MARK.length;
    for (; j < before.length; j++) {
      const c = before[j];
      if (c === '\\' && j + 1 < before.length && '{}\\'.indexOf(before[j + 1]) >= 0) { content += before[++j]; continue; }
      if (c === '}') return j === before.length - 1 ? { content } : null;      // closed before the caret: only if just closed
      content += c;
    }
    for (let k = 0; k < after.length && k < 400; k++) {
      const c = after[k];
      if (c === '\\' && k + 1 < after.length && '{}\\'.indexOf(after[k + 1]) >= 0) { content += after[++k]; continue; }
      if (c === '}') return { content };
      if (after.startsWith(MARK, k)) break;
      content += c;
    }
    return { content, pending: true };
  }
  // every piece in the box (closed ones, plus one still being typed at the end)
  function allPieces(text) {
    const ms = findMatches(text), out = ms.map(m => ({ content: m.content }));
    const last = ms.length ? ms[ms.length - 1].end : 0, i = text.indexOf(MARK, last);
    if (i >= 0) out.push({ content: text.slice(i + MARK.length), pending: true });
    return out;
  }
  // where the caret is on screen
  const MIRROR_PROPS = ['boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign',
    'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordBreak', 'overflowWrap'];
  function caretRect(el) {
    const box = el.getBoundingClientRect();
    if (el.value === undefined) {
      const sel = getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).cloneRange(); r.collapse(false);
        const rs = r.getClientRects(), rr = rs.length ? rs[rs.length - 1] : r.getBoundingClientRect();
        if (rr && (rr.top || rr.bottom)) return { left: rr.left, top: rr.top, bottom: rr.bottom || rr.top + 20 };
      }
      return { left: box.left, top: box.top, bottom: box.bottom };
    }
    const cs = getComputedStyle(el), m = document.createElement('div');
    MIRROR_PROPS.forEach(p => { m.style[p] = cs[p]; });
    Object.assign(m.style, { position: 'fixed', visibility: 'hidden', top: '0', left: '-9999px', overflow: 'hidden',
      whiteSpace: el.nodeName === 'INPUT' ? 'pre' : 'pre-wrap', overflowWrap: el.nodeName === 'INPUT' ? 'normal' : 'break-word', width: box.width + 'px' });
    m.textContent = el.value.slice(0, el.selectionEnd == null ? el.value.length : el.selectionEnd);
    const s = document.createElement('span'); s.textContent = '​'; m.appendChild(s);
    document.documentElement.appendChild(m);
    const lh = s.offsetHeight || parseFloat(cs.fontSize) * 1.3;
    const left = box.left + s.offsetLeft - el.scrollLeft, top = box.top + s.offsetTop - el.scrollTop;
    m.remove();
    return { left: Math.min(Math.max(left, box.left), box.right), top: Math.max(top, box.top), bottom: Math.min(top + lh, box.bottom) };
  }
  function ensureBar() {
    if (bar) return;
    bar = document.createElement('div'); bar.className = WRAP + '-bar'; bar.setAttribute('translate', 'no');
    const sr = bar.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>' + K.css +
      ':host{all:initial;position:fixed;z-index:2147483647;pointer-events:none;display:none}' +
      '.b{box-sizing:border-box;max-width:min(640px,calc(100vw - 16px));max-height:40vh;overflow:hidden;padding:4px 10px 4px 12px;border-radius:8px;' +
      'font:24px/1.5 sans-serif;color:#222;background:#fbf8ef;border:1px solid #cfc7b0;box-shadow:0 4px 14px rgba(0,0,0,.16);display:flex;gap:10px;align-items:center}' +
      '.c{overflow-wrap:anywhere}.c>span+span{margin-left:.6em;padding-left:.6em;border-left:1px solid #cfc7b0}.p{opacity:.55}' +
      '.k{font:11px/1 sans-serif;opacity:.45;align-self:flex-end;padding-bottom:4px;white-space:nowrap}' +
      '@media (prefers-color-scheme:dark){.b{color:#eee;background:#2b2a27;border-color:#555}.c>span+span{border-color:#555}}</style>' +
      '<div class="b"><div class="c"></div><div class="k">Esc</div></div>';
    barBody = sr.querySelector('.c');
    (document.body || document.documentElement).appendChild(bar);
  }
  function hideBar() { if (bar) bar.style.display = 'none'; }
  function updateBar() {
    const el = barTarget;
    if (!active() || previewMode === 'off' || !el || !el.isConnected || barDismissed === el) { hideBar(); return; }
    let pieces;
    if (previewMode === 'all') pieces = allPieces(el.value !== undefined ? el.value : (el.innerText || el.textContent || ''));
    else { const ac = aroundCaret(el), p = ac && pieceAtCaret(ac[0], ac[1]); pieces = p ? [p] : []; }
    pieces = pieces.filter(p => normalise(p.content));
    if (!pieces.length) { hideBar(); return; }
    ensureBar();
    barBody.innerHTML = pieces.map(p => '<span' + (p.pending ? ' class="p"' : '') + '>' + K.renderInline(normalise(p.content)) + '</span>').join('');
    bar.style.display = 'block'; bar.style.left = '0px'; bar.style.top = '-9999px';
    const c = caretRect(el), w = bar.offsetWidth, h = bar.offsetHeight;
    bar.style.left = Math.max(8, Math.min(c.left - 14, innerWidth - w - 8)) + 'px';
    // above the caret line if it fits, otherwise below it; never on top of the line being typed
    bar.style.top = (c.top - h - 6 >= 4 ? c.top - h - 6 : Math.min(c.bottom + 6, innerHeight - h - 4)) + 'px';
  }
  function onEdit(e) {
    const el = editableOf(e.composedPath ? e.composedPath()[0] : e.target);
    if (!el) return;
    if (barTarget !== el) barDismissed = null;
    barTarget = el; updateBar();
  }
  function onKey(e) {
    if (e.key === 'Escape' && bar && bar.style.display !== 'none' && barTarget) { barDismissed = barTarget; hideBar(); e.stopPropagation(); }
  }
  function initPreview() {
    ['focusin', 'input', 'keyup', 'mouseup', 'compositionend'].forEach(t => document.addEventListener(t, onEdit, true));
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('selectionchange', () => { if (barTarget && document.activeElement && barTarget.contains(document.activeElement)) updateBar(); });
    document.addEventListener('focusout', () => setTimeout(() => {
      if (!editableOf(document.activeElement)) { barTarget = null; barDismissed = null; hideBar(); }
    }, 0), true);
    addEventListener('scroll', () => { if (barTarget) updateBar(); }, true);
    addEventListener('resize', () => { if (barTarget) updateBar(); });
  }

  // ---------------------------------------------------------------- settings + popup
  function applySettings() { if (active()) scan(document.body); else { revertAll(); hideBar(); } }
  function init() {
    startObserver(); initPreview();
    if (!ext) { scan(document.body); return; }
    ext.storage.local.get({ enabled: true, disabledHosts: [], previewMode: 'caret' }, v => { enabled = v.enabled; disabledHosts = v.disabledHosts; previewMode = v.previewMode; applySettings(); });
    ext.storage.onChanged.addListener(ch => {
      if (ch.enabled) enabled = ch.enabled.newValue;
      if (ch.disabledHosts) disabledHosts = ch.disabledHosts.newValue || [];
      if (ch.previewMode) { previewMode = ch.previewMode.newValue || 'caret'; updateBar(); }
      applySettings();
    });
    ext.runtime.onMessage.addListener((msg, sender, reply) => {
      if (msg && msg.type === 'status') reply({ host: hostName, enabled, hostDisabled: disabledHosts.indexOf(hostName) >= 0, count: document.querySelectorAll('.' + WRAP).length });
      else if (msg && msg.type === 'rescan') { scan(document.body); reply({ ok: true }); }
    });
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
