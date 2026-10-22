/* Local document library. Images and document ASTs live in IndexedDB, not localStorage. */
'use strict';
window.KamotishLibrary = (() => {
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('kamotish-writer-library', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents', { keyPath: 'id' });
        request.result.createObjectStore('meta');
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => { database = null; reject(request.error); };
      request.onblocked = () => { database = null; reject(new Error('请关闭其他旧版编辑器页面后重试')); };
    });
    return database;
  }
  async function run(store, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode), request = action(transaction.objectStore(store));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error('文稿保存已中断'));
    });
  }
  return {
    list: () => run('documents', 'readonly', s => s.getAll()),
    get: id => run('documents', 'readonly', s => s.get(id)),
    put: document => run('documents', 'readwrite', s => s.put(document)),
    remove: id => run('documents', 'readwrite', s => s.delete(id)),
    meta: key => run('meta', 'readonly', s => s.get(key)),
    setMeta: (key, value) => run('meta', 'readwrite', s => s.put(value, key))
  };
})();
