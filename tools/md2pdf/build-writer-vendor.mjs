/* Bundles ProseMirror for the Writer (a static page, no build step at deploy).
 * Run from tools/md2pdf after `npm install`: node build-writer-vendor.mjs */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const license = readFileSync(new URL('node_modules/prosemirror-view/LICENSE', import.meta.url), 'utf8');
const out = fileURLToPath(new URL('../../writer/vendor/prosemirror.js', import.meta.url));
const entry = `
export * as state from 'prosemirror-state';
export * as view from 'prosemirror-view';
export * as model from 'prosemirror-model';
export * as transform from 'prosemirror-transform';
export * as commands from 'prosemirror-commands';
export * as keymap from 'prosemirror-keymap';
export * as history from 'prosemirror-history';
export * as schemaList from 'prosemirror-schema-list';
export * as tables from 'prosemirror-tables';
export * as dropcursor from 'prosemirror-dropcursor';
export * as gapcursor from 'prosemirror-gapcursor';
export * as inputrules from 'prosemirror-inputrules';
`;
await build({
  stdin: { contents: entry, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'js' },
  bundle: true, format: 'iife', globalName: 'PM', minify: true, target: 'es2020', outfile: out, 
  banner: { js: `/* ProseMirror (https://prosemirror.net), bundled for Kamotish Writer by tools/md2pdf/build-writer-vendor.mjs.\n${license.trim()}\n*/` }
});
console.log('wrote', out);
