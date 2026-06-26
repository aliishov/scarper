(function initializeScraperServer(app) {
  'use strict';

  const POST_FIELDS = Object.freeze([
    'keyword', 'source', 'scrapedAt', 'postDate', 'postUrl', 'author', 'authorUrl', 'text', 'mediaUrls'
  ]);

  function publicPost(post) {
    return Object.fromEntries(POST_FIELDS.map((field) => [field, post[field]]));
  }

  app.server = Object.freeze({
    postFields: POST_FIELDS,
    toPayload: publicPost,
    async savePost(runId, post, options) {
      const response = await chrome.runtime.sendMessage({ action: 'result:add', runId, post, options });
      if (!response?.success) throw new Error(response?.error || 'Cannot save post');
      return response;
    }
  });

  app.createServerQueue = function createServerQueue(stateRepository, log) {
    const draining = new Map();
    const abortControllers = new Map();

    const logRun = async (runId, level, message, details = '') => {
      try { await log(runId, level, message, details); } catch (error) { console.error(error); }
    };

    async function savePost(runId, post, options = {}) {
      const state = await stateRepository.get();
      if (!state || state.runId !== runId || !state.active || state.requestedAction === 'stop') {
        return { accepted: false, stopped: true };
      }

      const canonical = post.key || app.utils.canonicalPostKey(post);
      if (!canonical) throw new Error('Post has no stable URL/ID key');
      const storageKey = `${runId}:${canonical}`;
      let duplicate = false;
      await app.database.runTransaction(['posts', 'outbox'], 'readwrite', async (stores) => {
        const existing = await app.database.requestResult(stores.posts.get(storageKey));
        if (existing) {
          duplicate = true;
          return;
        }
        stores.posts.put({ key: storageKey, runId, post: publicPost(post), createdAt: Date.now() });
        if (options.sendToServer) {
          stores.outbox.put({
            key: storageKey,
            runId,
            post: publicPost(post),
            status: 'queued',
            attempts: 0,
            lastError: '',
            createdAt: Date.now()
          });
        }
      });

      if (!duplicate && options.sendToServer) void startDrain(runId);
      return { accepted: !duplicate, duplicate };
    }

    async function fetchPost(record, runSignal) {
      let lastError = null;
      for (let attempt = record.attempts + 1; attempt <= 4; attempt++) {
        if (runSignal.aborted) throw new DOMException('Run stopped', 'AbortError');
        const requestController = new AbortController();
        const abortRequest = () => requestController.abort(runSignal.reason || 'Run stopped');
        runSignal.addEventListener('abort', abortRequest, { once: true });
        const timeout = setTimeout(() => requestController.abort('Server timeout'), 20000);
        try {
          await logRun(record.runId, 'info', `Server send attempt ${attempt}/4`, record.post.postUrl);
          const response = await fetch(app.constants.SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record.post),
            signal: requestController.signal
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await logRun(record.runId, 'info', 'Server accepted post', record.post.postUrl);
          return { success: true, attempts: attempt };
        } catch (error) {
          if (runSignal.aborted) throw error;
          lastError = error;
          await logRun(record.runId, 'warn', `Server send failed on attempt ${attempt}`, error.message);
          if (attempt < 4) await app.utils.sleep(800 * (2 ** (attempt - 1)));
        } finally {
          clearTimeout(timeout);
          runSignal.removeEventListener('abort', abortRequest);
        }
      }
      return { success: false, attempts: 4, error: lastError?.message || 'Unknown server error' };
    }

    async function drainRun(runId) {
      const controller = abortControllers.get(runId) || new AbortController();
      abortControllers.set(runId, controller);
      let sent = 0;
      let failed = 0;
      while (!controller.signal.aborted) {
        const records = await app.database.getAllByIndex('outbox', 'runId', IDBKeyRange.only(runId));
        const record = records.find((item) => item.status === 'queued');
        if (!record) break;
        let result;
        try {
          result = await fetchPost(record, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) break;
          result = { success: false, attempts: 4, error: error.message };
        }
        await app.database.runTransaction(['outbox'], 'readwrite', async (stores) => {
          if (result.success) stores.outbox.delete(record.key);
          else stores.outbox.put({ ...record, status: 'failed', attempts: result.attempts, lastError: result.error });
        });
        if (result.success) sent++;
        else failed++;
      }
      return { sent, failed, cancelled: controller.signal.aborted };
    }

    function startDrain(runId) {
      if (draining.has(runId)) return draining.get(runId);
      const promise = drainRun(runId)
        .catch(async (error) => {
          await logRun(runId, 'error', 'Server queue crashed', error.stack || error.message);
          return { sent: 0, failed: 1, cancelled: false, error: error.message };
        })
        .finally(() => draining.delete(runId));
      draining.set(runId, promise);
      return promise;
    }

    async function cancelRun(runId) {
      abortControllers.get(runId)?.abort('Run stopped by user');
      await app.database.runTransaction(['outbox'], 'readwrite', async (stores) => {
        const records = await app.database.requestResult(stores.outbox.index('runId').getAll(IDBKeyRange.only(runId)));
        for (const record of records) stores.outbox.put({ ...record, status: 'cancelled', lastError: 'Stopped by user' });
      });
      await logRun(runId, 'info', 'Server queue cancelled by Stop');
    }

    async function summarize(runId) {
      const records = await app.database.getAllByIndex('outbox', 'runId', IDBKeyRange.only(runId));
      return {
        queued: records.filter((record) => record.status === 'queued').length,
        failed: records.filter((record) => record.status === 'failed').length,
        cancelled: records.filter((record) => record.status === 'cancelled').length
      };
    }

    return Object.freeze({ savePost, startDrain, drainRun: startDrain, cancelRun, summarize, publicPost });
  };
})(globalThis.ScraperApp);
