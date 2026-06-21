importScripts(
  'core/namespace.js',
  'core/utils.js',
  'core/database.js',
  'core/storage.js',
  'core/server.js',
  'core/downloads.js'
);

const app = globalThis.ScraperApp;
const stateRepository = app.createStateRepository();

async function appendLog(runId, level, message, details = '') {
  const state = await stateRepository.get();
  if (!state || state.runId !== runId) return null;
  const entry = {
    timestamp: new Date().toISOString(),
    platform: state.platform,
    level,
    message: String(message),
    details: String(details || '')
  };
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${state.platform}] ${message}`, details || '');
  return stateRepository.appendLog(runId, entry);
}

const serverQueue = app.createServerQueue(stateRepository, appendLog);
const resultDownloads = app.createResultDownloads(appendLog);
const finalizingRuns = new Map();
let operationQueue = Promise.resolve();

function exclusive(operation) {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.catch(() => {});
  return next;
}

async function sendToOwner(state, action) {
  if (!state?.ownerTabId) return false;
  const credentials = await stateRepository.getSecrets(state.runId);
  try {
    const response = await chrome.tabs.sendMessage(state.ownerTabId, { action, runId: state.runId, credentials });
    if (!response?.success) throw new Error('Content script did not acknowledge the command');
    return true;
  } catch (error) {
    await appendLog(state.runId, 'warn', `${action} message could not reach the owner tab`, error.message);
    return false;
  }
}

async function finalizeRun(runId, stopped) {
  if (finalizingRuns.has(runId)) return finalizingRuns.get(runId);
  const promise = (async () => {
    let state = await stateRepository.get();
    if (!state || state.runId !== runId) throw new Error('Run is no longer current');
    await appendLog(runId, 'info', stopped ? 'Stop finalization started' : 'Normal finalization started');

    let serverSummary;
    if (stopped) {
      await serverQueue.cancelRun(runId);
      serverSummary = await serverQueue.summarize(runId);
    } else {
      const drained = await serverQueue.drainRun(runId);
      serverSummary = { ...await serverQueue.summarize(runId), sent: drained.sent };
    }

    state = await stateRepository.get();
    let download = null;
    if (state?.saveToPC) {
      download = await resultDownloads.downloadRun(runId, state.platform);
    } else {
      await appendLog(runId, 'info', 'JSONL download is disabled');
    }

    await resultDownloads.cleanupRun(runId);
    await stateRepository.clearSecrets(runId);
    const phase = stopped ? 'stopped' : (serverSummary.failed ? 'completed_with_errors' : 'completed');
    const finalState = await stateRepository.patch(runId, {
      active: false,
      phase,
      requestedAction: null,
      finishedAt: new Date().toISOString(),
      serverSummary,
      downloadSummary: download
    });
    await appendLog(runId, serverSummary.failed ? 'warn' : 'info', `Run finalized: ${phase}`);
    return { state: finalState, serverSummary, download };
  })().finally(() => finalizingRuns.delete(runId));
  finalizingRuns.set(runId, promise);
  return promise;
}

async function handleMessage(request, sender) {
  switch (request.action) {
    case 'state:get': {
      return { success: true, state: await stateRepository.get() };
    }
    case 'state:initialize': {
      const { state, previous } = await exclusive(async () => {
        const previous = await stateRepository.get();
        const state = await stateRepository.initialize(request.state, request.secrets || {});
        return { state, previous };
      });
      if (previous?.runId && previous.runId !== request.state.runId) {
        void Promise.allSettled([
          serverQueue.cancelRun(previous.runId),
          resultDownloads.cleanupRun(previous.runId),
          stateRepository.clearSecrets(previous.runId)
        ]).then(async (results) => {
          const failures = results.filter((result) => result.status === 'rejected');
          if (failures.length) {
            await appendLog(request.state.runId, 'warn', 'Previous run cleanup was incomplete', failures.map((result) => result.reason?.message).join('; '));
          }
        });
      }
      return { success: true, state };
    }
    case 'state:patch': {
      const state = await stateRepository.patch(request.runId, request.patch || {});
      return state ? { success: true, state } : { success: false, error: 'Stale run update rejected' };
    }
    case 'state:log': {
      const state = await stateRepository.appendLog(request.runId, request.entry);
      return state ? { success: true, state } : { success: false, error: 'Stale log rejected' };
    }
    case 'result:add': {
      const result = await exclusive(() => serverQueue.savePost(request.runId, request.post, request.options));
      return { success: true, ...result };
    }
    case 'run:skip': {
      const state = await exclusive(() => stateRepository.patch(request.runId, { requestedAction: 'skip' }));
      if (!state?.active) return { success: false, error: 'Run is not active' };
      await appendLog(request.runId, 'info', `Skip requested for keyword: ${state.currentKeyword}`);
      await sendToOwner(state, 'scraper:skip');
      return { success: true, state };
    }
    case 'run:stop': {
      const state = await exclusive(() => stateRepository.patch(request.runId, {
        active: false,
        phase: 'stopping',
        requestedAction: 'stop'
      }));
      if (!state) return { success: false, error: 'Run is no longer current' };
      await appendLog(request.runId, 'info', 'Stop requested by user');
      await sendToOwner(state, 'scraper:stop');
      const finalized = await finalizeRun(request.runId, true);
      return { success: true, ...finalized };
    }
    case 'run:finalize': {
      const finalized = await finalizeRun(request.runId, !!request.stopped);
      return { success: true, ...finalized };
    }
    default:
      return { success: false, error: `Unknown action: ${request.action}` };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error('Background message error', request?.action, error);
      sendResponse({ success: false, error: error.message });
    });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  void (async () => {
    const state = await stateRepository.get();
    if (!state?.active || state.ownerTabId !== tabId || state.requestedAction === 'stop') return;
    await sendToOwner(state, 'scraper:resume');
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await stateRepository.get();
    if (!state?.active || state.ownerTabId !== tabId) return;
    await stateRepository.patch(state.runId, { active: false, phase: 'failed', lastError: 'Owner tab was closed' });
    await serverQueue.cancelRun(state.runId);
    await appendLog(state.runId, 'error', 'Owner tab was closed; run stopped');
  })();
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
