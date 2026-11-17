'use strict';
/* Persistence adapters. Completion means a committed transaction, not just a successful put request. */
(() => {
  function createStore(factory) {
    let opening;
    const open = () => opening || (opening = new Promise((resolve, reject) => {
      const request = factory.open('saillens', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Browser storage unavailable.'));
    }).catch(error => { opening = null; throw error; }));
    return {
      async get(key) { const db = await open(); return new Promise((resolve, reject) => {
        const tx = db.transaction('kv'), request = tx.objectStore('kv').get(key);
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('Browser storage read failed.'));
      }); },
      async set(key, value) { return this.setMany([[key, value]]); },
      async setMany(entries) { const db = await open(); return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Browser storage write failed.'));
        for (const [key, value] of entries) tx.objectStore('kv').put(value, key);
      }); }
    };
  }
  function serialWriter(write) {
    let tail = Promise.resolve();
    return value => { const result = tail.then(() => write(value)); tail = result.catch(() => {}); return result; };
  }
  Object.assign(SL, { createStore, serialWriter });
})();
