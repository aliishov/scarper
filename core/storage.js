(function initializeScraperStorage(app) {
  'use strict';

  async function send(action, payload = {}) {
    try {
      const response = await chrome.runtime.sendMessage({ action, ...payload });
      if (!response?.success) throw new Error(response?.error || 'Background returned no success response');
      return response;
    } catch (error) {
      throw new Error(`${action} failed: ${error.message}`, { cause: error });
    }
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
    async patchSource(runId, source, patch, statsDelta = {}) {
      return (await send('state:patchSource', { runId, source, patch, statsDelta })).state;
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

    const parentRunKey = (runId) => `parentRun:${runId}`;
    const sourceRunKey = (sourceRunId) => `sourceRun:${sourceRunId}`;

    const mirrorParentRun = async (state) => {
      if (!state?.runId) return;
      await chrome.storage.local.set({
        [parentRunKey(state.runId)]: {
          runId: state.runId,
          active: state.active,
          phase: state.phase,
          scrapingMode: state.scrapingMode,
          sources: state.sources || [],
          stats: state.stats || {},
          updatedAt: state.updatedAt || new Date().toISOString()
        }
      });
    };

    const mirrorSourceRun = async (runId, source, sourceState) => {
      if (!sourceState?.sourceRunId) return;
      await chrome.storage.local.set({
        [sourceRunKey(sourceState.sourceRunId)]: {
          parentRunId: runId,
          sourceRunId: sourceState.sourceRunId,
          source,
          active: sourceState.active,
          phase: sourceState.phase,
          status: sourceState.status || sourceState.phase || '',
          keywordIndex: sourceState.keywordIndex || 0,
          currentKeyword: sourceState.currentKeyword || '',
          stats: sourceState.stats || {},
          tabId: sourceState.tabId || null,
          windowId: sourceState.windowId || null,
          lastProgressAt: sourceState.lastProgressAt || '',
          updatedAt: new Date().toISOString()
        }
      });
    };

    return Object.freeze({
      get() {
        return exclusive(read);
      },
      initialize(state, secrets = {}) {
        return exclusive(async () => {
          const cleanState = { ...state, revision: 1, logs: (state.logs || []).slice(-app.constants.MAX_LOGS) };
          await write(cleanState);
          await mirrorParentRun(cleanState);
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
          const written = await write(next);
          await mirrorParentRun(written);
          return written;
        });
      },
      patchSource(runId, source, patch = {}, statsDelta = {}) {
        return exclusive(async () => {
          const current = await read();
          if (!current || current.runId !== runId) return null;
          const sourceStates = { ...(current.sourceStates || {}) };
          const previous = sourceStates[source] || {};
          sourceStates[source] = {
            ...previous,
            ...patch,
            stats: patch.stats ? { ...(previous.stats || {}), ...patch.stats } : previous.stats
          };
          const stats = { ...(current.stats || {}) };
          for (const [field, delta] of Object.entries(statsDelta || {})) {
            stats[field] = Number(stats[field] || 0) + Number(delta || 0);
          }
          const next = {
            ...current,
            sourceStates,
            stats,
            revision: (current.revision || 0) + 1,
            updatedAt: new Date().toISOString()
          };
          const written = await write(next);
          await mirrorParentRun(written);
          await mirrorSourceRun(runId, source, sourceStates[source]);
          return written;
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
