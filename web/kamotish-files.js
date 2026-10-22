/* Shared browser-only Markdown and local image importer. */
(function (root) {
'use strict';
const isMd = n => /\.(md|markdown)$/i.test(n);
const fromFile = (f, handle) => f.text().then(text => ({ name: f.name, md: text, handle }));
const isImage = n => /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i.test(n);
const resourceKey = p => new URL(p.split('/').map(encodeURIComponent).join('/'), 'https://kamotish.invalid/').pathname;
const imageData = f => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error); reader.readAsDataURL(f);
});
async function readEntries(entries) {
  const imageSources = Object.create(null), out = [];
  for (const { file, handle, path } of entries) {
    if (isImage(file.name)) imageSources[resourceKey(path)] = await imageData(file);
    else if (isMd(file.name)) out.push(Object.assign(await fromFile(file, handle), { documentPath: resourceKey(path) }));
  }
  for (const d of out) d.imageSources = imageSources;
  return out;
}
async function collectDirHandle(dir, entries, prefix = dir.name + '/') {
  for await (const h of dir.values()) {
    if (h.kind === 'file') entries.push({ file: await h.getFile(), handle: h, path: prefix + h.name });
    else if (h.kind === 'directory') await collectDirHandle(h, entries, prefix + h.name + '/');
  }
}
root.KamotishFiles = { fromFile, readEntries, collectDirHandle, imageData };
})(typeof window !== 'undefined' ? window : globalThis);
