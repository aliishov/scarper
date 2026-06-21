(function initializeScraperDatabase(app) {
  'use strict';

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
  }

  let databasePromise = null;
  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(app.constants.RESULT_DB_NAME, app.constants.RESULT_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('posts')) {
          const posts = database.createObjectStore('posts', { keyPath: 'key' });
          posts.createIndex('runId', 'runId', { unique: false });
          posts.createIndex('runDate', ['runId', 'post.postDate'], { unique: false });
        }
        if (!database.objectStoreNames.contains('outbox')) {
          const outbox = database.createObjectStore('outbox', { keyPath: 'key' });
          outbox.createIndex('runId', 'runId', { unique: false });
          outbox.createIndex('runStatus', ['runId', 'status'], { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Cannot open scraper database'));
    });
    return databasePromise;
  }

  async function runTransaction(storeNames, mode, operation) {
    const database = await openDatabase();
    const transaction = database.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map((name) => [name, transaction.objectStore(name)]));
    const result = await operation(stores, transaction);
    await transactionDone(transaction);
    return result;
  }

  async function getAllByIndex(storeName, indexName, query) {
    return runTransaction([storeName], 'readonly', async (stores) => {
      return requestResult(stores[storeName].index(indexName).getAll(query));
    });
  }

  async function deleteRun(storeName, runId) {
    return runTransaction([storeName], 'readwrite', async (stores) => {
      const index = stores[storeName].index('runId');
      const request = index.openKeyCursor(IDBKeyRange.only(runId));
      await new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          stores[storeName].delete(cursor.primaryKey);
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error(`Cannot delete ${storeName} records`));
      });
    });
  }

  app.database = Object.freeze({ requestResult, openDatabase, runTransaction, getAllByIndex, deleteRun });
})(globalThis.ScraperApp);
