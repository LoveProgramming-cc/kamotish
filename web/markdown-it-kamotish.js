/*!
 * markdown-it-kamotish - markdown-it plugin: renders  \kamotish{…}  with kamotish.js.
 *
 *   Node:     md.use(require('markdown-it-kamotish.js'), require('kamotish.js').Kamotish)
 *   Browser:  <script src="kamotish.js"></script><script src="markdown-it-kamotish.js"></script>
 *             md.use(window.markdownitKamotish, window.Kamotish)
 *
 * Same rules as the browser extension: \{ \} \\ inside the braces are escapes, every other backslash goes to the
 * renderer, a missing } leaves the text as it is, and nothing inside `code` / code blocks is touched.
 * The Markdown-escaped form that some editors write,  \\kamotish{\\mi\\wou\\3}, is read like  \kamotish{\mi\wou\3}.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.markdownitKamotish = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MARK = '\\kamotish{', ESCAPED_MARK = '\\\\kamotish{';
  const PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';           // what a Markdown backslash escape applies to

  // scan from i to the closing }, undoing the escapes in `escapable`; returns [content, index of }] or null
  function scan(src, i, max, escapable) {
    let out = '';
    while (i < max) {
      const c = src[i];
      if (c === '\\' && i + 1 < max && escapable.includes(src[i + 1])) { out += src[i + 1]; i += 2; }
      else if (c === '}') return [out, i];
      else { out += c; i++; }
    }
    return null;
  }

  return function kamotishPlugin(md, Kamotish) {
    md.inline.ruler.before('escape', 'kamotish', (state, silent) => {
      const src = state.src, start = state.pos;
      let r;
      if (src.startsWith(MARK, start)) r = scan(src, start + MARK.length, state.posMax, '{}\\');
      else if (src.startsWith(ESCAPED_MARK, start)) {
        r = scan(src, start + ESCAPED_MARK.length, state.posMax, PUNCT);    // undo the Markdown escapes first …
        if (r) r[0] = r[0].replace(/\\([{}\\])/g, '$1');                     // … then ours
      } else return false;
      if (!r) return false;                                    // no closing brace: leave the text as it is
      if (!silent) {
        const t = state.push('kamotish', '', 0);
        t.content = r[0].replace(/\s+/g, ' ').trim();
        t.meta = { start, end: r[1] + 1 };                     // position in the inline source (to find the line again)
      }
      state.pos = r[1] + 1;
      return true;
    });
    md.renderer.rules.kamotish = (tokens, i) =>
      '<span class="kamotish" title="' + md.utils.escapeHtml(tokens[i].content) + '">' + Kamotish.renderInline(tokens[i].content) + '</span>';
  };
});
