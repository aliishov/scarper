(function initializeScraperDownloads(app) {
  'use strict';

  app.downloads = Object.freeze({
    async finalize(runId, stopped = false) {
      const response = await chrome.runtime.sendMessage({ action: 'run:finalize', runId, stopped });
      if (!response?.success) throw new Error(response?.error || 'Run finalization failed');
      return response;
    }
  });

  app.createResultDownloads = function createResultDownloads(log) {
    async function getPosts(runId) {
      const records = await app.database.getAllByIndex('posts', 'runId', IDBKeyRange.only(runId));
      return records
        .map((record) => record.post)
        .sort((left, right) => new Date(right.postDate || 0).getTime() - new Date(left.postDate || 0).getTime());
    }

    async function downloadRun(runId, source) {
      const posts = await getPosts(runId);
      const content = posts.map((post) => JSON.stringify(post)).join('\n') + (posts.length ? '\n' : '');
      const filename = app.utils.buildFilename(source);
      const blob = new Blob([content], { type: 'application/x-ndjson;charset=utf-8' });
      let url = '';
      try {
        url = URL.createObjectURL(blob);
      } catch (error) {
        const bytes = new TextEncoder().encode(content);
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }
        url = `data:application/x-ndjson;base64,${btoa(binary)}`;
      }
      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(id);
        });
      });
      if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60000);
      await log(runId, 'info', `JSONL download started: ${filename}`, `${posts.length} posts`);
      return { downloadId, filename, count: posts.length };
    }

    async function cleanupRun(runId) {
      await Promise.all([
        app.database.deleteRun('posts', runId),
        app.database.deleteRun('outbox', runId)
      ]);
    }

    return Object.freeze({ getPosts, downloadRun, cleanupRun });
  };
})(globalThis.ScraperApp);
