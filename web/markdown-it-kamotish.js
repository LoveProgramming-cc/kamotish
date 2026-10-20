/*!
 * markdown-it-kamotish - markdown-it plugin: renders  \kamotish{…}  with kamotish.js.
 *
 *   Node:     md.use(require('markdown-it-kamotish.js'), require('kamotish.js').Kamotish)
 *   Browser:  <script src="kamotish.js"></script><script src="markdown-it-kamotish.js"></script>
 *             md.use(window.markdownitKamotish, window.Kamotish)
 *
 * Same rules as the browser extension: \{ \} \\ inside the braces are escapes, every other backslash goes to the
 * renderer, a missing } leaves the text as it is, and nothing inside `code` / code blocks is touched.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.markdownitKamotish = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MARK = '\\kamotish{';
  return function kamotishPlugin(md, Kamotish) {
    md.inline.ruler.before('escape', 'kamotish', (state, silent) => {
      const src = state.src, start = state.pos;
      if (!src.startsWith(MARK, start)) return false;
      let j = start + MARK.length, content = '';
      while (j < state.posMax) {
        const c = src[j];
        if (c === '\\' && j + 1 < state.posMax && '{}\\'.includes(src[j + 1])) { content += src[j + 1]; j += 2; }
        else if (c === '}') break;
        else { content += c; j++; }
      }
      if (j >= state.posMax) return false;                     // no closing brace: leave the text as it is
      if (!silent) state.push('kamotish', '', 0).content = content.replace(/\s+/g, ' ').trim();
      state.pos = j + 1;
      return true;
    });
    md.renderer.rules.kamotish = (tokens, i) =>
      '<span class="kamotish" title="' + md.utils.escapeHtml(tokens[i].content) + '">' + Kamotish.renderInline(tokens[i].content) + '</span>';
  };
});
