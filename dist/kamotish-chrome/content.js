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
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE', 'KBD', 'SAMP',
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
    const skip = (pi && pi.skip) || display === 'none' || SKIP.has(el.nodeName.toUpperCase()) || el.isContentEditable || el.classList.contains(WRAP);
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
    if (!el || (el.closest && el.closest('.' + WRAP))) return;
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

  // ---------------------------------------------------------------- settings + popup
  function applySettings() { if (active()) scan(document.body); else revertAll(); }
  function init() {
    startObserver();
    if (!ext) { scan(document.body); return; }
    ext.storage.local.get({ enabled: true, disabledHosts: [] }, v => { enabled = v.enabled; disabledHosts = v.disabledHosts; applySettings(); });
    ext.storage.onChanged.addListener(ch => {
      if (ch.enabled) enabled = ch.enabled.newValue;
      if (ch.disabledHosts) disabledHosts = ch.disabledHosts.newValue || [];
      applySettings();
    });
    ext.runtime.onMessage.addListener((msg, sender, reply) => {
      if (msg && msg.type === 'status') reply({ host: hostName, enabled, hostDisabled: disabledHosts.indexOf(hostName) >= 0, count: document.querySelectorAll('.' + WRAP).length });
      else if (msg && msg.type === 'rescan') { scan(document.body); reply({ ok: true }); }
    });
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
