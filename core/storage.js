(function initializeScraperStorage(app) {
  'use strict';

  async function send(action, payload = {}) {
    const response = await chrome.runtime.sendMessage({ action, ...payload });
    if (!response?.success) throw new Error(response?.error || `${action} failed`);
    return response;
  }

  app.storage = Object.freeze({
    async getState() {
      return (await send('state:get')).state || null;
    },
    async initialize(state, secrets = {}) {
      return (await send('state:initialize', { state, secrets })).state;
    },
    async patch(runId, patch) {
      return (await send('state:patch', { runId, patch })).state;
    },
    async log(runId, entry) {
      return (await send('state:log', { runId, entry })).state;
    },
    async requestControl(runId, command) {
      return send(`run:${command}`, { runId });
    }
  });

  app.createStateRepository = function createStateRepository() {
    let queue = Promise.resolve();
    const exclusive = (operation) => {
      const next = queue.then(operation, operation);
      queue = next.catch(() => {});
      return next;
    };

    const read = async () => {
      const result = await chrome.storage.local.get(app.constants.STATE_KEY);
      return result[app.constants.STATE_KEY] || null;
    };

    const write = async (state) => {
      await chrome.storage.local.set({ [app.constants.STATE_KEY]: state });
      return state;
    };

    return Object.freeze({
      get() {
        return exclusive(read);
      },
      initialize(state, secrets = {}) {
        return exclusive(async () => {
          const cleanState = { ...state, revision: 1, logs: (state.logs || []).slice(-app.constants.MAX_LOGS) };
          await write(cleanState);
          if (chrome.storage.session) {
            await chrome.storage.session.set({ [`scraperSecrets:${state.runId}`]: { ...secrets } });
          }
          return cleanState;
        });
      },
      patch(runId, patch) {
        return exclusive(async () => {
          const current = await read();
          if (!current || current.runId !== runId) return null;
          const next = {
            ...current,
            ...patch,
            stats: patch.stats ? { ...(current.stats || {}), ...patch.stats } : current.stats,
            revision: (current.revision || 0) + 1,
            updatedAt: new Date().toISOString()
          };
          return write(next);
        });
      },
      appendLog(runId, entry) {
        return exclusive(async () => {
          const current = await read();
          if (!current || current.runId !== runId) return null;
          const logs = [...(current.logs || []), entry].slice(-app.constants.MAX_LOGS);
          return write({ ...current, logs, revision: (current.revision || 0) + 1, updatedAt: new Date().toISOString() });
        });
      },
      async getSecrets(runId) {
        if (!chrome.storage.session) return {};
        const key = `scraperSecrets:${runId}`;
        const result = await chrome.storage.session.get(key);
        return result[key] || {};
      },
      async clearSecrets(runId) {
        if (chrome.storage.session) await chrome.storage.session.remove(`scraperSecrets:${runId}`);
      }
    });
  };
})(globalThis.ScraperApp);
