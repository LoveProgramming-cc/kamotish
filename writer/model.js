'use strict';
/* Kamotish Writer document model.
 * - ProseMirror schema: paragraphs, headings, lists, tables, images and Kamotish atoms.
 * - .kamodoc schema version 2 AST <-> DOM <-> ProseMirror document.
 * - Markdown export with \kamotish{...} source.
 * A Kamotish grapheme or syllable is one inline atom node; its source spelling is stored
 * in attrs. SVG is only a view and never enters saved documents. */
window.KamotishWriterModel = (() => {
  const { Schema, DOMParser: PMDOMParser, DOMSerializer, Fragment, Slice } = PM.model;
  const { tableNodes } = PM.tables;

  const NAMED_TONES = ['一声', '二声', '三声', '四声'];
  const GLYPH = /^\\([a-z][a-z']*\d?)(?:\\([1-4]))?/;
  const KNOWN_GLYPHS = new Set(Kamotish.graphemeNames());
  const UNIT_KINDS = ['phon', 'glyph', 'separator', 'text'];
  const safe = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let runCounter = 0;
  const newRunId = () => 'r' + Date.now().toString(36) + (runCounter++).toString(36);

  // Repair two known legacy spellings: \no is now \nou, and v1 doubled slashes.
  function normalizedSource(v) {
    return String(v || '').replace(/\\no(?![a-z'])/g, '\\nou').replace(/\\\\(?=[a-z][a-z']*\d?|[234])/g, '\\');
  }

  /* Split Kamotish source into plain text and units, exactly as the renderer reads it:
   * \name\tone graphemes, letter runs (syllables; upper case = abbreviation as text),
   * '-' joins syllables, '--' is a literal dash. */
  function parseSource(value) {
    const source = normalizedSource(value), out = [];
    let i = 0, plain = '', pending = '';
    const flush = () => { if (plain) { out.push({ text: plain }); plain = ''; } };
    const flushPending = () => { if (pending) { out.push({ unit: { raw: pending, kind: 'separator' } }); pending = ''; } };
    while (i < source.length) {
      const rest = source.slice(i), ch = source[i];
      if (ch === '\\') {
        const m = GLYPH.exec(rest);
        if (m && KNOWN_GLYPHS.has(m[1])) {
          flush(); flushPending();
          out.push({ unit: { raw: m[0], kind: 'glyph', name: m[1], tone: m[2] || '' } });
          i += m[0].length; continue;
        }
        plain += ch; i++; continue;
      }
      if (ch === '-') {
        flush();
        if (source[i + 1] === '-') { flushPending(); out.push({ unit: { raw: '--', kind: 'text' } }); i += 2; continue; }
        pending += '-'; i++; continue;
      }
      if (/[a-z]/i.test(ch)) {
        const part = /^[A-Za-z]+/.exec(rest)[0];
        let end = i + part.length;
        if (!/[A-Z]/.test(part)) { const tone = /^\\([1-4])/.exec(source.slice(end)); if (tone) end += tone[0].length; }
        flush();
        const raw = pending + source.slice(i, end); pending = '';
        out.push({ unit: { raw, kind: /[A-Z]/.test(part) ? 'text' : 'phon' } });
        i = end; continue;
      }
      if (pending) { flush(); flushPending(); }
      plain += ch; i++;
    }
    flush(); flushPending();
    return out;
  }

  function unitAttrs(a) {
    const kind = UNIT_KINDS.includes(a.kind) ? a.kind : 'text';
    let raw = String(a.raw || ''), name = String(a.name || ''), tone = /^[1-4]$/.test(a.tone) ? String(a.tone) : '';
    if (kind === 'glyph') { raw = normalizedSource(raw); if (name === 'no') name = 'nou'; }
    return { raw, kind, name, tone };
  }
  function unitDisplay(a) {
    if (a.kind === 'glyph') return '\\' + a.name + (a.tone && a.tone !== '1' ? '\\' + a.tone : '');
    return a.raw.replace(/^-/, '');
  }
  // The DOM form of one unit. Without `render` it carries only data (for parsing and saving).
  function unitElement(attrs, render = true) {
    const a = unitAttrs(attrs), e = document.createElement('span');
    e.className = 'kw-unit'; e.contentEditable = 'false';
    e.dataset.raw = a.raw; e.dataset.kind = a.kind;
    if (a.name) e.dataset.name = a.name;
    if (a.tone) e.dataset.tone = a.tone;
    if (a.kind === 'separator') e.classList.add('kw-hidden');
    else if (a.kind === 'text') e.textContent = a.raw;
    else if (render) e.innerHTML = Kamotish.renderInline(unitDisplay(a));
    e.setAttribute('aria-label', a.kind === 'glyph' ? a.name + NAMED_TONES[Number(a.tone || 1) - 1] : a.raw);
    return e;
  }
  function runElement(source) {
    const run = document.createElement('span');
    run.className = 'kamo-run'; run.dataset.kamoRun = 'true';
    for (const part of parseSource(source)) run.append(part.unit ? unitElement(part.unit, false) : document.createTextNode(part.text));
    return run;
  }

  // A LaTeX formula. Rendered with KaTeX when `render`; otherwise only data (for parsing and saving).
  function mathElement(tex, display, render = true) {
    const e = document.createElement(display ? 'div' : 'span');
    e.className = display ? 'kw-math-block' : 'kw-math'; e.dataset.tex = tex || ''; e.contentEditable = 'false';
    if (!render) return e;
    if (!tex) { e.classList.add('kw-math-empty'); e.textContent = display ? '公式块' : '公式'; return e; }
    try { window.katex.render(tex, e, { throwOnError: false, displayMode: display }); } catch (err) { e.textContent = tex; }
    return e;
  }

  /* ---------- Schema ---------- */
  const ALIGNS = ['left', 'center', 'right', 'justify'];
  function blockAttrsFrom(dom) {
    const align = ALIGNS.includes(dom.style.textAlign) ? dom.style.textAlign : null;
    const margin = /^(\d+(?:\.\d+)?)em$/.exec(dom.style.marginLeft || '');
    const lineHeight = /^\d(?:\.\d+)?$/.test(dom.style.lineHeight) ? dom.style.lineHeight : null;
    return { align: align === 'left' ? null : align, indent: margin ? Math.min(8, Math.round(Number(margin[1]) / 2)) : 0, lineHeight };
  }
  function blockStyle(attrs) {
    const css = [];
    if (attrs.align) css.push('text-align:' + attrs.align);
    if (attrs.indent) css.push('margin-left:' + attrs.indent * 2 + 'em');
    if (attrs.lineHeight) css.push('line-height:' + attrs.lineHeight);
    return css.length ? { style: css.join(';') } : {};
  }
  const blockAttrSpec = { align: { default: null }, indent: { default: 0 }, lineHeight: { default: null } };
  const plainColor = v => v && !/^(inherit|initial|currentcolor|transparent|rgba\(0, 0, 0, 0\))$/i.test(v);
  const decoration = word => [
    { style: 'text-decoration', getAttrs: v => v.includes(word) && null },
    { style: 'text-decoration-line', getAttrs: v => v.includes(word) && null }
  ];

  function safeLink(value, image = false) {
    const s = String(value || '').trim();
    const scheme = s.replace(/[\u0000- ]/g, '');
    if (/^(?:https?:|mailto:)/i.test(scheme) || !/^[a-z][a-z0-9+.-]*:/i.test(scheme)) return s;
    if (image && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|avif|bmp|x-icon)[;,]/i.test(s)) return s;
    return '';
  }

  const schema = new Schema({
    nodes: Object.assign({
      doc: { content: 'block+' },
      paragraph: {
        group: 'block', content: 'inline*', attrs: blockAttrSpec,
        parseDOM: [{ tag: 'p', getAttrs: blockAttrsFrom }],
        toDOM: n => ['p', blockStyle(n.attrs), 0]
      },
      heading: {
        group: 'block', content: 'inline*', defining: true,
        attrs: Object.assign({ level: { default: 1 } }, blockAttrSpec),
        parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({ tag: 'h' + level, getAttrs: d => Object.assign(blockAttrsFrom(d), { level }) })),
        toDOM: n => ['h' + n.attrs.level, blockStyle(n.attrs), 0]
      },
      blockquote: { group: 'block', content: 'block+', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
      code_block: {
        group: 'block', content: 'text*', marks: '', code: true, defining: true,
        parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', ['code', 0]]
      },
      horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
      math_display: {
        group: 'block', atom: true, selectable: true, attrs: { tex: { default: '' } },
        parseDOM: [{ tag: 'div.kw-math-block', getAttrs: d => ({ tex: d.dataset.tex || '' }) }, { tag: 'span.kw-math[data-display]', priority: 60, getAttrs: d => ({ tex: d.dataset.tex || '' }) }],
        toDOM: n => mathElement(n.attrs.tex, true)
      },
      bullet_list: { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
      ordered_list: {
        group: 'block', content: 'list_item+', attrs: { order: { default: 1 } },
        parseDOM: [{ tag: 'ol', getAttrs: d => ({ order: d.hasAttribute('start') ? Number(d.getAttribute('start')) || 1 : 1 }) }],
        toDOM: n => n.attrs.order === 1 ? ['ol', 0] : ['ol', { start: n.attrs.order }, 0]
      },
      list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] }
    }, tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} }), {
      text: { group: 'inline' },
      image: {
        inline: true, group: 'inline', draggable: true,
        attrs: { src: {}, alt: { default: '' }, title: { default: '' }, originalSrc: { default: '' }, width: { default: null } },
        parseDOM: [{
          tag: 'img[src]', getAttrs: d => {
            const src = safeLink(d.getAttribute('src'), true);
            if (!src) return false;
            const width = parseInt(d.getAttribute('width') || d.style.width, 10);
            return { src, alt: d.getAttribute('alt') || '', title: d.getAttribute('title') || '', originalSrc: d.dataset.originalSrc || '', width: width > 0 ? width : null };
          }
        }],
        toDOM: n => ['img', { src: n.attrs.src, alt: n.attrs.alt, title: n.attrs.title || null, 'data-original-src': n.attrs.originalSrc || null, width: n.attrs.width || null }]
      },
      math_inline: {
        inline: true, group: 'inline', atom: true, selectable: true, attrs: { tex: { default: '' } },
        parseDOM: [{ tag: 'span.kw-math', getAttrs: d => ({ tex: d.dataset.tex || '' }) }],
        toDOM: n => mathElement(n.attrs.tex, false)
      },
      hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
      kamo: {
        inline: true, group: 'inline', atom: true, selectable: true,
        attrs: { raw: { default: '' }, kind: { default: 'phon' }, name: { default: '' }, tone: { default: '' } },
        parseDOM: [{ tag: 'span.kw-unit', getAttrs: d => unitAttrs(d.dataset) }],
        toDOM: n => unitElement(n.attrs)
      }
    }),
    // Order is nesting order: earlier marks wrap later ones. kamoRun stays innermost.
    marks: {
      link: {
        attrs: { href: {}, title: { default: null } }, inclusive: false,
        parseDOM: [{ tag: 'a[href]', getAttrs: d => { const href = safeLink(d.getAttribute('href')); return href ? { href, title: d.getAttribute('title') } : false; } }],
        toDOM: m => ['a', { href: m.attrs.href, title: m.attrs.title, rel: 'noopener noreferrer' }, 0]
      },
      bold: {
        parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: n => n.style.fontWeight !== 'normal' && null },
          { style: 'font-weight', getAttrs: v => /^(bold(er)?|[6-9]\d\d)$/.test(v) && null }],
        toDOM: () => ['strong', 0]
      },
      italic: { parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
      underline: { parseDOM: [{ tag: 'u' }, ...decoration('underline')], toDOM: () => ['u', 0] },
      strike: { parseDOM: [{ tag: 's' }, { tag: 'strike' }, { tag: 'del' }, ...decoration('line-through')], toDOM: () => ['s', 0] },
      code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
      sup: { excludes: 'sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
      sub: { excludes: 'sup', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
      color: {
        attrs: { color: {} },
        parseDOM: [{ style: 'color', getAttrs: v => plainColor(v) ? { color: v } : false }],
        toDOM: m => ['span', { style: 'color:' + m.attrs.color }, 0]
      },
      highlight: {
        attrs: { color: {} },
        parseDOM: [{ style: 'background-color', getAttrs: v => plainColor(v) ? { color: v } : false }],
        toDOM: m => ['span', { style: 'background-color:' + m.attrs.color }, 0]
      },
      fontFamily: {
        attrs: { family: {} },
        parseDOM: [{ style: 'font-family', getAttrs: v => v ? { family: v } : false }],
        toDOM: m => ['span', { style: 'font-family:' + m.attrs.family }, 0]
      },
      fontSize: {
        attrs: { size: {} },
        parseDOM: [{ style: 'font-size', getAttrs: v => /^\d+(\.\d+)?(pt|px|em|rem|%)$/.test(v) ? { size: v } : false }],
        toDOM: m => ['span', { style: 'font-size:' + m.attrs.size }, 0]
      },
      kamoRun: {
        attrs: { id: { default: '' } }, inclusive: false,
        parseDOM: [{ tag: 'span.kamo-run', getAttrs: () => ({ id: newRunId() }) }],
        toDOM: () => ['span', { class: 'kamo-run', 'data-kamo-run': 'true' }, 0]
      }
    }
  });
  const FORMAT_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'sup', 'sub', 'color', 'highlight', 'fontFamily', 'fontSize'].map(n => schema.marks[n]);

  /* Kamotish source -> inline ProseMirror nodes, all in one new run. */
  function nodesFromSource(source, marks = [], runId = newRunId()) {
    const run = schema.marks.kamoRun.create({ id: runId }), set = run.addToSet(marks.filter(m => m.type !== schema.marks.kamoRun));
    return parseSource(source).map(p => p.unit ? schema.nodes.kamo.create(unitAttrs(p.unit), null, set) : schema.text(p.text, set));
  }
  // Turn literal \kamotish{...} in pasted or imported text into atoms.
  const KAMOTISH_LITERAL = /\\kamotish\{([^{}]*)\}/g;
  function expandLiterals(fragment) {
    const out = [];
    fragment.forEach(node => {
      if (node.isText && node.text.includes('\\kamotish{') && !node.marks.some(m => m.type === schema.marks.code)) {
        let last = 0;
        for (const m of node.text.matchAll(KAMOTISH_LITERAL)) {
          if (m.index > last) out.push(schema.text(node.text.slice(last, m.index), node.marks));
          out.push(...nodesFromSource(m[1], node.marks));
          last = m.index + m[0].length;
        }
        if (last < node.text.length) out.push(schema.text(node.text.slice(last), node.marks));
      } else if (!node.isLeaf && node.type !== schema.nodes.code_block) out.push(node.copy(expandLiterals(node.content)));
      else out.push(node);
    });
    return Fragment.fromArray(out);
  }

  /* ---------- .kamodoc AST <-> DOM ---------- */
  const AST_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'A', 'SUP', 'SUB', 'CODE', 'PRE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);
  const STYLE_FIELDS = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'textAlign', 'lineHeight', 'letterSpacing', 'textIndent', 'marginLeft'];
  function extractStyles(e) { const r = {}; for (const k of STYLE_FIELDS) if (e.style?.[k]) r[k] = e.style[k]; return r; }
  function applySafeStyles(e, style) {
    if (!style || typeof style !== 'object') return;
    for (const k of STYLE_FIELDS) { const v = style[k]; if (typeof v === 'string' && v.length < 180 && !/expression\s*\(|url\s*\(/i.test(v)) e.style[k] = v; }
  }
  const children = n => [...n.childNodes].map(nodeToAst).filter(Boolean);
  function nodeToAst(n) {
    if (n.nodeType === 3) return { t: 'text', v: n.textContent };
    if (n.nodeType !== 1) return null;
    if (n.tagName === 'IMG') {
      const r = { t: 'image', src: safeLink(n.getAttribute('src'), true), originalSrc: n.dataset.originalSrc || '', alt: n.getAttribute('alt') || '', title: n.getAttribute('title') || '' };
      const width = parseInt(n.getAttribute('width'), 10); if (width > 0) r.width = width;
      return r;
    }
    if (n.classList.contains('kw-unit')) return { t: 'unit', raw: n.dataset.raw || '', kind: n.dataset.kind || 'phon', name: n.dataset.name || '', tone: n.dataset.tone || '', style: extractStyles(n) };
    if (n.classList.contains('kamo-run')) return { t: 'run', style: extractStyles(n), children: children(n) };
    if (n.classList.contains('kw-math') || n.classList.contains('kw-math-block')) return { t: 'math', tex: n.dataset.tex || '', display: n.classList.contains('kw-math-block') };
    if (!AST_TAGS.has(n.tagName)) return { t: 'element', tag: 'span', children: children(n) };
    let tag = n.tagName.toLowerCase(), style = extractStyles(n);
    if (tag === 'font') { tag = 'span'; if (n.color) style.color = n.color; if (n.face) style.fontFamily = n.face; }
    const r = { t: 'element', tag, children: children(n) };
    if (Object.keys(style).length) r.style = style;
    if (n.tagName === 'A') r.href = safeLink(n.getAttribute('href'));
    if (n.tagName === 'OL' && n.start > 1) r.start = n.start;
    if (n.tagName === 'TD' || n.tagName === 'TH') {
      r.colspan = n.colSpan; r.rowspan = n.rowSpan;
      if (n.dataset.colwidth) r.colwidth = n.dataset.colwidth;
    }
    return r;
  }
  function astToNode(n) {
    if (!n || typeof n !== 'object') return document.createTextNode('');
    if (n.t === 'text') return document.createTextNode(String(n.v || ''));
    if (n.t === 'image') {
      const e = document.createElement('img');
      e.src = safeLink(n.src, true); e.alt = String(n.alt || ''); if (n.title) e.title = String(n.title);
      if (n.originalSrc) e.dataset.originalSrc = safeLink(n.originalSrc, true);
      if (Number(n.width) > 0) e.setAttribute('width', String(Math.round(Number(n.width))));
      return e;
    }
    if (n.t === 'math') return mathElement(String(n.tex || ''), !!n.display, false);
    if (n.t === 'unit') { const e = unitElement({ raw: String(n.raw || ''), kind: n.kind, name: String(n.name || ''), tone: String(n.tone || '') }, false); applySafeStyles(e, n.style); return e; }
    const list = Array.isArray(n.children) ? n.children : [];
    if (n.t === 'run') {
      const e = document.createElement('span'); e.className = 'kamo-run'; e.dataset.kamoRun = 'true';
      applySafeStyles(e, n.style); for (const x of list) e.append(astToNode(x)); return e;
    }
    let tag = String(n.tag || 'span').toUpperCase(); if (!AST_TAGS.has(tag) || tag === 'FONT') tag = 'SPAN';
    const e = document.createElement(tag); applySafeStyles(e, n.style);
    if (tag === 'A') e.href = safeLink(n.href);
    if (tag === 'OL' && Number(n.start) > 1) e.start = Number(n.start);
    if (tag === 'TD' || tag === 'TH') {
      e.colSpan = Math.max(1, Math.min(100, Number(n.colspan) || 1)); e.rowSpan = Math.max(1, Math.min(100, Number(n.rowspan) || 1));
      if (/^\d+(,\d+)*$/.test(n.colwidth || '')) e.dataset.colwidth = n.colwidth;
    }
    for (const x of list) e.append(astToNode(x));
    return e;
  }

  /* ---------- DOM <-> ProseMirror ---------- */
  const parser = PMDOMParser.fromSchema(schema), serializer = DOMSerializer.fromSchema(schema);
  function prepareDom(root) {
    // Writer v1 kept a whole formula in one token.
    root.querySelectorAll('.kamo-token').forEach(e => e.replaceWith(runElement(e.dataset.kamo || '')));
    // contenteditable placeholders: <p><br></p> is an empty paragraph, not a line break.
    root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,div').forEach(block => {
      const last = block.lastChild;
      if (last?.nodeName === 'BR' && ![...block.childNodes].some(c => c !== last && (c.nodeType === 1 || c.textContent.trim()))) last.remove();
    });
    return root;
  }
  function domToDoc(root) { return parser.parse(prepareDom(root)); }
  function docToDom(doc) { const box = document.createElement('div'); box.append(serializer.serializeFragment(doc.content, { document })); return box; }
  function docToAst(doc) { return [...docToDom(doc).childNodes].map(nodeToAst).filter(Boolean); }
  function astToDoc(content) {
    const box = document.createElement('div');
    for (const n of content) box.append(astToNode(n));
    const doc = domToDoc(box);
    return doc.content.size ? doc : schema.nodes.doc.create(null, schema.nodes.paragraph.create());
  }
  function emptyDoc() { return schema.nodes.doc.create(null, schema.nodes.paragraph.create()); }

  /* ---------- Markdown export ---------- */
  function sourceOfRun(run) {
    let value = '';
    for (const n of run.childNodes) {
      if (n.nodeType === 3) value += n.textContent;
      else if (n.nodeType === 1) value += n.classList.contains('kw-unit') ? n.dataset.raw || '' : sourceOfRun(n);
    }
    return value;
  }
  const cssOf = style => Object.entries(style).map(([k, v]) => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + safe(v)).join(';');
  function serializeInline(root) {
    let out = '';
    for (const n of root.childNodes) {
      if (n.nodeType === 3) { out += n.textContent.replace(/([\\*_`\[\]$])/g, '\\$1'); continue; }
      if (n.nodeType !== 1) continue;
      if (n.classList.contains('kw-unit')) { out += '\\kamotish{' + (n.dataset.raw || '') + '}'; continue; }
      if (n.classList.contains('kamo-run')) { out += '\\kamotish{' + sourceOfRun(n) + '}'; continue; }
      if (n.classList.contains('kw-math')) { out += '$' + (n.dataset.tex || '').replace(/\s*\n\s*/g, ' ') + '$'; continue; }
      let v = serializeInline(n);
      switch (n.tagName) {
        case 'IMG': {
          const src = n.dataset.originalSrc || n.getAttribute('src') || '', width = n.getAttribute('width');
          if (width || src.startsWith('data:image/svg+xml')) v = '<img src="' + safe(src) + '" alt="' + safe(n.alt || '') + '"' + (width ? ' width="' + safe(width) + '"' : '') + '>';
          else v = '![' + (n.alt || '').replace(/[\[\]]/g, '') + '](<' + src.replace(/>/g, '%3E') + '>)';
          break;
        }
        case 'BR': v = '  \n'; break;
        case 'B': case 'STRONG': v = v.trim() ? '**' + v + '**' : v; break;
        case 'I': case 'EM': v = v.trim() ? '*' + v + '*' : v; break;
        case 'U': v = '<u>' + v + '</u>'; break;
        case 'S': case 'STRIKE': v = '~~' + v + '~~'; break;
        case 'SUP': v = '<sup>' + v + '</sup>'; break;
        case 'SUB': v = '<sub>' + v + '</sub>'; break;
        case 'CODE': { const t = n.textContent, fence = '`'.repeat(Math.max(1, ...[...t.matchAll(/`+/g)].map(m => m[0].length + 1))); v = fence + (t.startsWith('`') ? ' ' + t + ' ' : t) + fence; break; }
        case 'A': v = '[' + v + '](' + (n.getAttribute('href') || '').replace(/[()\s]/g, encodeURIComponent) + ')'; break;
        default: { const style = extractStyles(n); if (Object.keys(style).length) v = '<span style="' + cssOf(style) + '">' + v + '</span>'; }
      }
      out += v;
    }
    return out;
  }
  function listMd(list, depth) {
    const ordered = list.tagName === 'OL', start = ordered ? list.start || 1 : 1, pad = '   '.repeat(depth);
    return [...list.children].map((li, i) => {
      const marker = ordered ? (start + i) + '. ' : '- ';
      const parts = [...li.children].map(c => /^(UL|OL)$/.test(c.tagName) ? listMd(c, depth + 1) : pad + '   ' + blockMd(c).replace(/\n/g, '\n' + pad + '   '));
      const first = parts.shift() || '';
      return pad + marker + first.trimStart() + (parts.length ? '\n' + parts.join('\n') : '');
    }).join('\n');
  }
  function blockMd(n) {
    if (n.nodeType === 3) return n.textContent.trim();
    if (n.nodeType !== 1) return '';
    const tag = n.tagName, align = n.style.textAlign || '';
    let result;
    if (/^H[1-6]$/.test(tag)) result = '#'.repeat(+tag[1]) + ' ' + serializeInline(n).trim();
    else if (tag === 'BLOCKQUOTE') result = [...n.childNodes].map(blockMd).filter(Boolean).join('\n\n').split('\n').map(line => '> ' + line).join('\n');
    else if (tag === 'UL' || tag === 'OL') result = listMd(n, 0);
    else if (tag === 'HR') result = '---';
    else if (n.classList.contains('kw-math-block')) result = '$$\n' + (n.dataset.tex || '').trim() + '\n$$';
    else if (tag === 'PRE') {
      const fence = '`'.repeat(Math.max(3, ...[...n.textContent.matchAll(/`+/g)].map(m => m[0].length + 1)));
      result = fence + '\n' + n.textContent.replace(/\n$/, '') + '\n' + fence;
    } else if (tag === 'TABLE') {
      const rows = [...n.querySelectorAll('tr')].map(tr => [...tr.children].map(td => [...td.children].map(c => serializeInline(c).trim()).filter(Boolean).join('<br>').replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
      if (!rows.length) return '';
      const width = Math.max(...rows.map(r => r.length)), row = r => '| ' + Array.from({ length: width }, (_, i) => r[i] || '').join(' | ') + ' |';
      result = [row(rows[0]), row(Array(width).fill('---')), ...rows.slice(1).map(row)].join('\n');
    } else {
      result = serializeInline(n).trim();
      if (!result) return '';
    }
    return align && align !== 'left' && align !== 'justify' ? `<div style="text-align:${align}">\n\n${result}\n\n</div>` : result;
  }
  function docToMarkdown(doc) {
    return '<!-- Kamotish Writer Markdown. For exact roundtrip, use .kamodoc -->\n\n' + [...docToDom(doc).childNodes].map(blockMd).filter(Boolean).join('\n\n').trim() + '\n';
  }

  /* ---------- Clipboard text ---------- */
  function sliceToText(slice) {
    const lines = [];
    let line = '', kamo = '', runId = null;
    const flush = () => { if (runId !== null) { line += '\\kamotish{' + kamo + '}'; kamo = ''; runId = null; } };
    const runOf = node => node.marks.find(m => m.type === schema.marks.kamoRun);
    function inline(node) {
      const run = runOf(node);
      if (node.type === schema.nodes.kamo || (node.isText && run)) {
        const id = run ? run.attrs.id : '';
        if (runId !== null && id !== runId) flush();
        runId = id; kamo += node.isText ? node.text : node.attrs.raw; return;
      }
      flush();
      if (node.isText) line += node.text;
      else if (node.type === schema.nodes.hard_break) line += '\n';
      else if (node.type === schema.nodes.image) line += node.attrs.alt ? '[' + node.attrs.alt + ']' : '';
      else if (node.type === schema.nodes.math_inline) line += '$' + node.attrs.tex + '$';
    }
    function block(node) {
      if (node.isTextblock) { node.forEach(inline); flush(); lines.push(line); line = ''; }
      else if (node.type === schema.nodes.math_display) lines.push('$$' + node.attrs.tex + '$$');
      else if (node.isInline) inline(node);
      else node.forEach(block);
    }
    slice.content.forEach(block); flush(); if (line) lines.push(line);
    return lines.join('\n');
  }

  /* ---------- Statistics ---------- */
  function countText(doc, from = 0, to = doc.content.size) {
    let chars = 0, charsWithSpaces = 0, units = 0, paragraphs = 0, words = 0, formulas = 0;
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && node.content.size) paragraphs++;
      if (node.isText) {
        const text = node.text.slice(Math.max(0, from - pos), to - pos);
        charsWithSpaces += text.length; chars += text.replace(/\s/g, '').length;
        words += (text.match(/[㐀-鿿豈-﫿]/g) || []).length + (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9À-ɏ'-]+/g) || []).length;
      } else if (node.type === schema.nodes.kamo && node.attrs.kind !== 'separator') { units++; chars++; charsWithSpaces++; words++; }
      else if (node.type === schema.nodes.math_inline || node.type === schema.nodes.math_display) formulas++;
    });
    return { chars, charsWithSpaces, units, paragraphs, words, formulas };
  }

  return {
    schema, Slice, Fragment, NAMED_TONES, FORMAT_MARKS, safe, safeLink, normalizedSource, parseSource, unitAttrs, unitDisplay, unitElement, runElement, mathElement,
    nodesFromSource, expandLiterals, newRunId, nodeToAst, astToNode, domToDoc, docToDom, docToAst, astToDoc, emptyDoc, docToMarkdown, sliceToText, countText
  };
})();
