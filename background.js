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
const SOURCE_WATCHDOG_ALARM = 'scraper-source-watchdog';
const SOURCE_WATCHDOG_PERIOD_MINUTES = 0.5;
let operationQueue = Promise.resolve();

function exclusive(operation) {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.catch(() => {});
  return next;
}

function isMultiState(state) {
  return app.utils.isMultiMode(state?.scrapingMode);
}

function targetForSource(source) {
  const targets = {
    facebook: { domain: 'facebook.com', url: 'https://www.facebook.com/' },
    instagram: { domain: 'instagram.com', url: 'https://www.instagram.com/' },
    twitter: { domain: 'x.com', url: 'https://x.com/explore' },
    tiktok: { domain: 'tiktok.com', url: 'https://www.tiktok.com/' },
    'oxu.az': { domain: 'oxu.az', url: 'https://oxu.az/' },
    'media.az': { domain: 'media.az', url: 'https://media.az/' },
    '1news.az': { domain: '1news.az', url: 'https://1news.az/az' },
    'haqqin.az': { domain: 'haqqin.az', url: 'https://haqqin.az/' },
    'caliber.az': { domain: 'caliber.az', url: 'https://caliber.az/' },
    'qafqazinfo.az': { domain: 'qafqazinfo.az', url: 'https://qafqazinfo.az/' },
    'lent.az': { domain: 'lent.az', url: 'https://lent.az/' },
    'baku.ws': { domain: 'baku.ws', url: 'https://baku.ws/' }
  };
  return targets[source] || null;
}

function credentialsForSource(credentials, source) {
  if (!app.utils.SOCIAL_SOURCES.includes(source)) return {};
  return { [source]: { ...(credentials?.[source] || {}) } };
}

function sourceRequiresFocus(source) {
  return app.utils.sourceType(source) === 'social';
}

function ensureSourceWatchdogAlarm() {
  if (!chrome.alarms?.create) return;
  chrome.alarms.create(SOURCE_WATCHDOG_ALARM, { periodInMinutes: SOURCE_WATCHDOG_PERIOD_MINUTES });
}

function clearSourceWatchdogAlarm() {
  if (!chrome.alarms?.clear) return;
  chrome.alarms.clear(SOURCE_WATCHDOG_ALARM);
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

function sourceForTab(state, tabId) {
  if (!isMultiState(state)) return '';
  return Object.entries(state.sourceTabs || {})
    .find(([, details]) => details?.tabId === tabId)?.[0] || '';
}

function createTab(details) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(details, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function createWindow(details) {
  return new Promise((resolve, reject) => {
    chrome.windows.create(details, (window) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(window);
    });
  });
}

function getWindowTabs(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ windowId }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs || []);
    });
  });
}

function removeWindow(windowId) {
  return new Promise((resolve) => {
    chrome.windows.remove(windowId, () => resolve());
  });
}

function focusWindow(windowId) {
  return new Promise((resolve) => {
    chrome.windows.update(windowId, { focused: true }, () => resolve(!chrome.runtime.lastError));
  });
}

function activateTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { active: true }, () => resolve(!chrome.runtime.lastError));
  });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function removeTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => resolve());
  });
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.reload(tabId, () => resolve(!chrome.runtime.lastError));
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

async function assertRunCanContinue(runId) {
  const state = await stateRepository.get();
  if (!state || state.runId !== runId || !state.active) throw new Error('Run stopped while article tab was open');
  if (state.requestedAction === 'stop' || state.requestedAction === 'skip') {
    throw new Error(`Run control requested: ${state.requestedAction}`);
  }
  return state;
}

async function waitForTabComplete(runId, tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await assertRunCanContinue(runId);
    const tab = await getTab(tabId);
    if (tab.status === 'complete') return tab;
    await app.utils.sleep(250);
  }
  throw new Error('Article tab did not finish loading');
}

async function sendArticleExtractMessage(runId, tabId, source, preview) {
  let lastError = null;
  for (let attempt = 1; attempt <= 12; attempt++) {
    await assertRunCanContinue(runId);
    try {
      const response = await sendTabMessage(tabId, { action: 'news:extractArticle', source, preview });
      if (!response?.success) throw new Error(response?.error || 'Article extractor failed');
      return response.article;
    } catch (error) {
      lastError = error;
      await app.utils.sleep(350);
    }
  }
  throw lastError || new Error('Article extractor did not respond');
}

async function sendScraperCommandWithRetry(runId, tabId, message, label, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await assertRunCanContinue(runId);
    try {
      const response = await sendTabMessage(tabId, message);
      if (!response?.success) throw new Error(response?.error || `${label} was not acknowledged`);
      if (attempt > 1) await appendLog(runId, 'info', `[orchestrator] ${label} acknowledged after retry ${attempt}`);
      return response;
    } catch (error) {
      lastError = error;
      await appendLog(runId, attempt === maxAttempts ? 'error' : 'warn', `[orchestrator] ${label} attempt ${attempt}/${maxAttempts} failed`, error.message);
      await app.utils.sleep(750);
    }
  }
  throw lastError || new Error(`${label} did not respond`);
}

async function openNewsArticleTab(request, sender) {
  const state = await assertRunCanContinue(request.runId);
  const sourceTabAllowed = state.sourceTabs?.[request.source]?.tabId === sender.tab?.id;
  if (state.ownerTabId !== sender.tab?.id && !sourceTabAllowed) throw new Error('Article tab request came from a non-owner tab');
  let tab = null;
  await appendLog(request.runId, 'info', `[${request.source}] Opening article in new tab: ${request.url}`);
  try {
    tab = await createTab({
      url: request.url,
      active: false,
      openerTabId: sender.tab.id,
      windowId: sender.tab.windowId
    });
    await waitForTabComplete(request.runId, tab.id);
    await appendLog(request.runId, 'info', `[${request.source}] Article loaded`, request.url);
    const article = await sendArticleExtractMessage(request.runId, tab.id, request.source, request.preview || {});
    await appendLog(request.runId, 'info', `[${request.source}] Article scraped`, request.url);
    return { success: true, article };
  } finally {
    if (tab?.id) {
      await appendLog(request.runId, 'info', `[${request.source}] Closing article tab`, request.url);
      await removeTab(tab.id);
      await appendLog(request.runId, 'info', `[${request.source}] Article tab closed`, request.url);
    }
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
      download = await resultDownloads.downloadRun(runId, state.downloadSource || state.platform);
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
    clearSourceWatchdogAlarm();
    return { state: finalState, serverSummary, download };
  })().finally(() => finalizingRuns.delete(runId));
  finalizingRuns.set(runId, promise);
  return promise;
}

class MultiWindowOrchestrator {
  constructor() {
    this.runs = new Map();
  }

  entry(runId) {
    if (!this.runs.has(runId)) {
      this.runs.set(runId, {
        settlers: new Map(),
        tabs: new Map(),
        windows: new Map(),
        contentReady: new Map(),
        progress: new Map(),
        reloads: new Map(),
        watchdogs: new Map(),
        finishing: false
      });
    }
    return this.runs.get(runId);
  }

  sourceRunId(runId, source) {
    return `${runId}:${source}`;
  }

  recordProgress(runId, source) {
    const entry = this.runs.get(runId);
    if (entry) entry.progress.set(source, Date.now());
  }

  markContentReady(runId, source, tabId, url) {
    const entry = this.entry(runId);
    entry.contentReady.set(source, {
      tabId,
      url,
      readyAt: Date.now()
    });
    this.recordProgress(runId, source);
  }

  async waitForContentReady(runId, source, tabId, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await assertRunCanContinue(runId);
      const ready = this.runs.get(runId)?.contentReady.get(source);
      if (ready?.tabId === tabId) return ready;
      await app.utils.sleep(250);
    }
    return null;
  }

  clearWatchdog(runId, source) {
    const entry = this.runs.get(runId);
    const watchdog = entry?.watchdogs.get(source);
    if (watchdog) clearInterval(watchdog);
    entry?.watchdogs.delete(source);
  }

  startWatchdog(runId, source) {
    const entry = this.entry(runId);
    if (entry.watchdogs.has(source)) return;
    entry.progress.set(source, Date.now());
    const watchdog = setInterval(() => {
      void (async () => {
        const currentEntry = this.runs.get(runId);
        if (!currentEntry?.windows.has(source)) return;
        const lastProgressAt = currentEntry.progress.get(source) || Date.now();
        if (Date.now() - lastProgressAt < 60000) return;
        const windowId = currentEntry.windows.get(source);
        const tabId = currentEntry.tabs.get(source);
        await appendLog(runId, 'warn', `[orchestrator] Source stuck detected: ${source} no progress 60s`);
        if (sourceRequiresFocus(source)) {
          await appendLog(runId, 'info', `[orchestrator] Focus grant for stuck social source: ${source}`);
          await focusWindow(windowId);
          if (tabId) await activateTab(tabId);
        }
        await this.handleStuckSource(runId, source, tabId);
      })().catch(console.error);
    }, 30000);
    entry.watchdogs.set(source, watchdog);
  }

  async requestSourceStatus(runId, source, tabId) {
    await appendLog(runId, 'info', '[orchestrator] Requesting source status', source);
    const state = await stateRepository.get();
    const sourceRunId = state?.sourceTabs?.[source]?.sourceRunId || this.sourceRunId(runId, source);
    const response = await sendTabMessage(tabId, {
      action: 'GET_SOURCE_STATUS',
      type: 'GET_SOURCE_STATUS',
      parentRunId: runId,
      runId,
      sourceRunId,
      source
    });
    if (!response?.success) throw new Error(response?.error || 'Source status was not returned');
    return response.status || {};
  }

  async forceSourceScraping(runId, source, tabId) {
    const state = await stateRepository.get();
    const sourceRunId = state?.sourceTabs?.[source]?.sourceRunId || this.sourceRunId(runId, source);
    await appendLog(runId, 'warn', '[orchestrator] Forcing transition searching -> scraping', source);
    await stateRepository.patchSource(runId, source, {
      phase: 'scraping',
      forcedScrapingAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString()
    });
    await sendTabMessage(tabId, {
      action: 'FORCE_SOURCE_SCRAPING',
      type: 'FORCE_SOURCE_SCRAPING',
      parentRunId: runId,
      runId,
      sourceRunId,
      source
    }).catch(() => null);
    const latest = await stateRepository.get();
    await this.resumeTab(latest, tabId);
  }

  async handleStuckSource(runId, source, tabId) {
    const entry = this.runs.get(runId);
    try {
      const status = await this.requestSourceStatus(runId, source, tabId);
      await appendLog(runId, 'warn', `[orchestrator] Stuck source status: ${source} phase=${status.phase || 'unknown'} pendingNavigation=${status.pendingNavigation || 'none'}`);
      if (!status.running) {
        const latest = await stateRepository.get();
        const sourceState = latest?.sourceStates?.[source] || {};
        if (latest?.active && sourceState.active !== false) {
          await appendLog(runId, 'warn', `[orchestrator] Source controller is not running; sending resume: ${source}`, `phase=${status.phase || 'unknown'} url=${status.url || ''}`);
          await this.resumeTab(latest, tabId);
          entry?.progress.set(source, Date.now());
          return;
        }
      }
      if (status.phase === 'searching' && (status.pendingNavigation === 'search' || status.navigationResumePhase === 'scraping')) {
        await this.forceSourceScraping(runId, source, tabId);
        return;
      }
      const reloads = Number(entry?.reloads.get(source) || 0);
      if (status.phase === 'searching' && reloads < 1) {
        await appendLog(runId, 'warn', `[orchestrator] Source is still searching without navigation handoff; reloading once: ${source}`);
        entry?.reloads.set(source, reloads + 1);
        await reloadTab(tabId);
        entry?.progress.set(source, Date.now());
        return;
      }
      entry?.progress.set(source, Date.now());
    } catch (error) {
      const reloads = Number(entry?.reloads.get(source) || 0);
      if (reloads < 1) {
        await appendLog(runId, 'warn', `[orchestrator] Source status unavailable; reloading source tab once: ${source}`, error.message);
        entry?.reloads.set(source, reloads + 1);
        await reloadTab(tabId);
        entry?.progress.set(source, Date.now());
        return;
      }
      await appendLog(runId, 'error', `[orchestrator] Source failed: ${source} error=No status after reload`);
      await stateRepository.patchSource(runId, source, {
        active: false,
        phase: 'failed',
        lastError: 'No source status after watchdog reload'
      }, { errors: 1 });
      this.settleSource(runId, source, { source, status: 'rejected', error: 'No source status after watchdog reload' });
    }
  }

  async activeTabForWindow(window) {
    if (window?.tabs?.length) return window.tabs.find((tab) => tab.active) || window.tabs[0];
    const tabs = await getWindowTabs(window.id);
    return tabs.find((tab) => tab.active) || tabs[0] || null;
  }

  async updateSourceWindow(runId, source, tabId, windowId, sourceRunId, mode) {
    const state = await stateRepository.get();
    if (!state || state.runId !== runId) return null;
    const sourceTabs = { ...(state.sourceTabs || {}), [source]: { tabId, windowId, source, sourceRunId } };
    await stateRepository.patch(runId, { sourceTabs });
    return stateRepository.patchSource(runId, source, {
      parentRunId: runId,
      sourceRunId,
      source,
      mode,
      tabId,
      windowId,
      phase: 'initialize',
      status: 'starting',
      active: true,
      lastProgressAt: new Date().toISOString()
    });
  }

  waitForSource(runId, source) {
    const entry = this.entry(runId);
    return new Promise((resolve) => {
      entry.settlers.set(source, resolve);
    });
  }

  settleSource(runId, source, payload) {
    const entry = this.runs.get(runId);
    const settle = entry?.settlers.get(source);
    if (settle) {
      entry.settlers.delete(source);
      settle(payload);
    }
  }

  async sourceResults(runId, source) {
    const state = await stateRepository.get();
    return Number(state?.sourceStates?.[source]?.stats?.total || 0);
  }

  async startSourceWindow(source, context) {
    const { runId, credentials, ownerTab, mode, parentState } = context;
    const target = targetForSource(source);
    if (!target) throw new Error(`No target URL for source: ${source}`);
    const entry = this.entry(runId);
    const sourceRunId = this.sourceRunId(runId, source);
    const firstKeyword = parentState?.keywords?.[0] || '';
    const directNewsUrl = app.utils.sourceType(source) === 'news'
      ? app.utils.newsSearchUrl(source, firstKeyword, { dateLimit: parentState?.dateLimit || null })
      : '';
    await appendLog(runId, 'info', `[orchestrator] Creating window for source: ${source}`);
    if (directNewsUrl) await appendLog(runId, 'info', `[orchestrator] News direct search URL: source=${source}`, directNewsUrl);
    const windowDetails = {
      url: directNewsUrl || target.url,
      type: 'normal',
      focused: true
    };
    if (!sourceRequiresFocus(source)) windowDetails.focused = false;
    const window = await createWindow(windowDetails);
    const tab = await this.activeTabForWindow(window);
    if (!tab?.id) throw new Error(`Source window for ${source} was created without an active tab`);
    entry.windows.set(source, window.id);
    entry.tabs.set(source, tab.id);
    this.recordProgress(runId, source);
    this.startWatchdog(runId, source);
    await this.updateSourceWindow(runId, source, tab.id, window.id, sourceRunId, mode);
    await appendLog(runId, 'info', `[orchestrator] Source window created: source=${source} sourceRunId=${sourceRunId}`);
    await appendLog(runId, 'info', `[orchestrator] Window created: ${source} windowId=${window.id}`);
    await waitForTabComplete(runId, tab.id, 30000);
    const ready = await this.waitForContentReady(runId, source, tab.id, 15000);
    if (ready) {
      await appendLog(runId, 'info', `[orchestrator] Content ready before source start: ${source}`, ready.url || '');
    } else {
      await appendLog(runId, 'warn', `[orchestrator] CONTENT_READY timeout before source start: ${source}; start message will retry`);
    }
    if (sourceRequiresFocus(source)) {
      await appendLog(runId, 'info', `[orchestrator] Focus grant for source start: ${source}`);
      await focusWindow(window.id);
      await activateTab(tab.id);
    } else {
      await appendLog(runId, 'info', `[orchestrator] News source will run without focus stealing: ${source}`);
    }
    await sendScraperCommandWithRetry(runId, tab.id, {
      action: 'START_SOURCE_RUN',
      type: 'START_SOURCE_RUN',
      runId,
      parentRunId: runId,
      sourceRunId,
      mode,
      source,
      keywords: parentState?.keywords || [],
      settings: {
        targetCount: parentState?.targetCount,
        dateLimit: parentState?.dateLimit || null,
        infiniteLoop: !!parentState?.infiniteLoop,
        sendToServer: !!parentState?.sendToServer,
        saveToPC: !!parentState?.saveToPC
      },
      credentialsForThisSourceOnly: credentialsForSource(credentials, source)
    }, `Start source run ${source}`, 12);
    await appendLog(runId, 'info', `[orchestrator] START_SOURCE_RUN sent: source=${source}`);
    await appendLog(runId, 'info', `[orchestrator] Source run started: ${source} sourceRunId=${sourceRunId}`);
    return { windowId: window.id, tabId: tab.id, sourceRunId };
  }

  async runSource(source, context) {
    const { runId } = context;
    let windowId = null;
    let tabId = null;
    try {
      const sourceWindow = await this.startSourceWindow(source, context);
      windowId = sourceWindow.windowId;
      tabId = sourceWindow.tabId;
      const result = await this.waitForSource(runId, source);
      const results = await this.sourceResults(runId, source);
      if (result.status === 'rejected') {
        await appendLog(runId, 'error', `[orchestrator] Source failed: ${source} error=${result.error || 'Source failed'}`);
        return result;
      }
      await appendLog(runId, 'info', `[orchestrator] Source completed: ${source} results=${results}`, result.reason || '');
      return result;
    } catch (error) {
      await appendLog(runId, 'error', `[orchestrator] Source failed: ${source} error=${error.message}`);
      await stateRepository.patchSource(runId, source, {
        active: false,
        phase: 'failed',
        lastError: error.message
      }, { errors: 1 });
      return { source, status: 'rejected', error: error.message };
    } finally {
      const entry = this.runs.get(runId);
      this.clearWatchdog(runId, source);
      if (entry) {
        windowId = windowId || entry.windows.get(source) || null;
        tabId = tabId || entry.tabs.get(source) || null;
        entry.windows.delete(source);
        entry.tabs.delete(source);
        entry.contentReady.delete(source);
      }
      if (windowId) await removeWindow(windowId);
      else if (tabId) await removeTab(tabId);
    }
  }

  async runSocialSourcesSequentially(sources, sharedContext) {
    const results = [];
    if (!sources.length) return results;
    await appendLog(sharedContext.runId, 'warn', `[orchestrator] Social focus queue enabled concurrency=1: ${sources.join(', ')}`);
    for (const source of sources) {
      const state = await stateRepository.get();
      if (!state || state.runId !== sharedContext.runId || !state.active || state.requestedAction === 'stop') {
        await appendLog(sharedContext.runId, 'warn', `[orchestrator] Social focus queue stopped before source: ${source}`);
        break;
      }
      await appendLog(sharedContext.runId, 'info', `[orchestrator] Social source starting with exclusive focus: ${source}`);
      const result = await this.runSource(source, sharedContext);
      results.push(result);
      await appendLog(sharedContext.runId, 'info', `[orchestrator] Social source focus released: ${source}`);
    }
    return results;
  }

  async runSources(sources, sharedContext) {
    const newsSources = sources.filter((source) => app.utils.sourceType(source) === 'news');
    const socialSources = sources.filter((source) => app.utils.sourceType(source) === 'social');
    const runs = [
      ...newsSources.map((source) => this.runSource(source, sharedContext)),
      ...(socialSources.length ? [this.runSocialSourcesSequentially(socialSources, sharedContext)] : [])
    ];
    if (newsSources.length) await appendLog(sharedContext.runId, 'info', `[orchestrator] News sources scheduled in parallel: ${newsSources.join(', ')}`);
    if (socialSources.length) await appendLog(sharedContext.runId, 'warn', `[orchestrator] Social sources need browser focus; running through focus queue: ${socialSources.join(', ')}`);
    await appendLog(sharedContext.runId, 'info', '[orchestrator] Waiting for remaining sources');
    const settled = await Promise.allSettled(runs);
    const results = settled.flatMap((result) => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        return result.value.map((value) => ({ status: 'fulfilled', value }));
      }
      return [result];
    });
    await appendLog(sharedContext.runId, 'info', '[orchestrator] All source windows settled');
    await appendLog(sharedContext.runId, 'info', '[orchestrator] All sources settled');
    return results;
  }

  async checkAlarmWatchdogs() {
    const state = await stateRepository.get();
    if (!state?.active || !isMultiState(state)) return;
    const sourceTabs = Object.entries(state.sourceTabs || {});
    if (!sourceTabs.length) return;
    await appendLog(state.runId, 'info', '[orchestrator] Alarm watchdog tick');
    const entry = this.entry(state.runId);
    for (const [source, details] of sourceTabs) {
      const sourceState = state.sourceStates?.[source] || {};
      if (sourceState.active === false || !details?.tabId) continue;
      const lastProgressAt = Date.parse(sourceState.lastProgressAt || state.updatedAt || '') || 0;
      if (Date.now() - lastProgressAt < 60000) continue;
      entry.tabs.set(source, details.tabId);
      if (details.windowId) entry.windows.set(source, details.windowId);
      await appendLog(state.runId, 'warn', `[orchestrator] Alarm watchdog stale source: ${source}`);
      if (sourceRequiresFocus(source) && details.windowId) {
        await appendLog(state.runId, 'info', `[orchestrator] Alarm focus grant for social source: ${source}`);
        await focusWindow(details.windowId);
        await activateTab(details.tabId);
      }
      await this.handleStuckSource(state.runId, source, details.tabId);
    }
  }

  async start(runId, credentials, sender) {
    const state = await stateRepository.get();
    if (!state || state.runId !== runId || !state.active) throw new Error('Run is not active');
    if (!isMultiState(state)) throw new Error(`Run is not a multi scraping mode: ${state.scrapingMode || 'single'}`);
    const sources = state.sources?.length ? state.sources : app.utils.sourcesForMode(state.scrapingMode, state.platform);
    await appendLog(runId, 'info', `[orchestrator] Parent run started: ${runId}`);
    await appendLog(runId, 'info', `[orchestrator] Multi-window mode started: ${state.scrapingMode}`);
    await appendLog(runId, 'info', `[orchestrator] Sources to run: ${sources.join(', ')}`);
    await stateRepository.patch(runId, { phase: 'running_multi', sources });
    ensureSourceWatchdogAlarm();
    const ownerTab = sender.tab || (state.ownerTabId ? await getTab(state.ownerTabId).catch(() => null) : null);
    const results = await this.runSources(sources, { runId, credentials, ownerTab, mode: state.scrapingMode, parentState: state });
    const latest = await stateRepository.get();
    if (!latest || latest.runId !== runId || !latest.active) return { results };
    const filename = app.utils.buildFilename(latest.downloadSource || latest.platform);
    await appendLog(runId, 'info', `[orchestrator] Saving mixed file: ${filename}`);
    await stateRepository.patch(runId, { active: false, phase: 'finalizing', requestedAction: null });
    await finalizeRun(runId, false);
    this.runs.delete(runId);
    return { results };
  }

  async stop(runId) {
    const entry = this.runs.get(runId);
    const state = await stateRepository.get();
    const sourceTabs = Object.entries(state?.sourceTabs || {});
    const tabIds = new Set([
      ...Array.from(entry?.tabs.values() || []),
      ...sourceTabs.map(([, details]) => details?.tabId).filter(Boolean)
    ]);
    const windowIds = new Set([
      ...Array.from(entry?.windows.values() || []),
      ...sourceTabs.map(([, details]) => details?.windowId).filter(Boolean)
    ]);
    await Promise.allSettled(Array.from(tabIds).map((tabId) => sendTabMessage(tabId, { action: 'STOP_SOURCE_RUN', type: 'STOP_SOURCE_RUN', runId })));
    for (const [source] of sourceTabs) {
      await stateRepository.patchSource(runId, source, { active: false, phase: 'stopping', lastError: 'Stopped by user' });
      this.settleSource(runId, source, { source, status: 'rejected', error: 'Stopped by user' });
      this.clearWatchdog(runId, source);
    }
    await Promise.allSettled(Array.from(windowIds).map((windowId) => removeWindow(windowId)));
    if (!windowIds.size) await Promise.allSettled(Array.from(tabIds).map((tabId) => removeTab(tabId)));
    entry?.tabs.clear();
    entry?.windows.clear();
    this.runs.delete(runId);
  }

  async skip(runId) {
    const state = await stateRepository.get();
    const tabs = Object.values(state?.sourceTabs || {}).map((details) => details?.tabId).filter(Boolean);
    await Promise.allSettled(tabs.map((tabId) => sendTabMessage(tabId, { action: 'SKIP_KEYWORD', type: 'SKIP_KEYWORD', runId })));
    setTimeout(() => {
      void (async () => {
        const latest = await stateRepository.get();
        if (latest?.runId === runId && latest.requestedAction === 'skip') {
          await stateRepository.patch(runId, { requestedAction: null });
        }
      })();
    }, 1500);
  }

  async resumeTab(state, tabId) {
    const source = sourceForTab(state, tabId);
    if (!source) return false;
    const credentials = await stateRepository.getSecrets(state.runId);
    const sourceDetails = state.sourceTabs?.[source] || {};
    try {
      if (sourceRequiresFocus(source)) {
        await appendLog(state.runId, 'info', `[orchestrator] Focus grant before resume: ${source}`);
        if (sourceDetails.windowId) await focusWindow(sourceDetails.windowId);
        await activateTab(tabId);
      } else {
        await appendLog(state.runId, 'info', `[orchestrator] Resuming news source without focus: ${source}`);
      }
      const response = await sendScraperCommandWithRetry(state.runId, tabId, {
        action: 'scraper:resume',
        runId: state.runId,
        parentRunId: state.runId,
        sourceRunId: sourceDetails.sourceRunId,
        mode: state.scrapingMode,
        credentials: credentialsForSource(credentials, source),
        source
      }, `Resume source run ${source}`, 12);
      if (!response?.success) throw new Error(response?.error || 'Content script did not acknowledge Resume');
      return true;
    } catch (error) {
      await appendLog(state.runId, 'warn', `[orchestrator] Resume failed for source: ${source}`, error.message);
      return false;
    }
  }

  async handleSourceProgress(runId, source, patch, state) {
    if (!source || !state?.active || !isMultiState(state)) return;
    this.recordProgress(runId, source);
    const hasProgressPatch = Object.prototype.hasOwnProperty.call(patch, 'stats')
      || Object.prototype.hasOwnProperty.call(patch, 'currentKeyword')
      || Object.prototype.hasOwnProperty.call(patch, 'keywordIndex')
      || Object.prototype.hasOwnProperty.call(patch, 'scraperProgress');
    if (!hasProgressPatch) return;
    const sourceState = state.sourceStates?.[source] || {};
    const saved = Number(sourceState.stats?.total || 0);
    const keyword = sourceState.currentKeyword || state.currentKeyword || '';
    await appendLog(runId, 'info', `[orchestrator] Source progress: ${source} saved=${saved} keyword=${keyword}`);
  }

  async handleSourceSettled(request) {
    this.recordProgress(request.runId, request.source);
    await stateRepository.patchSource(request.runId, request.source, {
      active: false,
      phase: request.status === 'rejected' ? 'failed' : 'completed',
      lastError: request.error || '',
      finishedAt: new Date().toISOString()
    });
    const latest = await stateRepository.get();
    const remaining = Object.entries(latest?.sourceStates || {})
      .filter(([, sourceState]) => sourceState?.active !== false)
      .map(([source]) => source);
    await appendLog(request.runId, 'info', `[orchestrator] Waiting for remaining sources: ${remaining.join(', ') || 'none'}`);
    this.settleSource(request.runId, request.source, request);
  }

  async handleContentReady(request, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { success: true, ignored: true };
    const state = await stateRepository.get();
    if (!state?.active || !isMultiState(state)) return { success: true, ignored: true };
    const source = sourceForTab(state, tabId);
    if (!source) return { success: true, ignored: true };
    this.markContentReady(state.runId, source, tabId, request.url || sender.tab?.url || '');
    await appendLog(state.runId, 'info', `[orchestrator] CONTENT_READY source=${source} tabId=${tabId}`, request.url || sender.tab?.url || '');
    const sourceState = state.sourceStates?.[source] || {};
    if (sourceState.active === false) return { success: true, source };
    if (sourceState.phase !== 'initialize' || sourceState.pendingNavigation) {
      await appendLog(state.runId, 'info', `[orchestrator] Resuming after CONTENT_READY: ${source}`, request.url || '');
      await this.resumeTab(state, tabId);
    }
    return { success: true, source, sourceRunId: state.sourceTabs?.[source]?.sourceRunId || '' };
  }

  async diagnostic(runId = '') {
    const state = await stateRepository.get();
    if (!state?.active || !isMultiState(state) || (runId && state.runId !== runId)) {
      return { active: false, sources: [] };
    }
    const entry = this.entry(state.runId);
    const report = [];
    await appendLog(state.runId, 'info', '[diagnostic] RUN_MULTI_DIAGNOSTIC started');
    for (const [source, details] of Object.entries(state.sourceTabs || {})) {
      const tabId = details?.tabId || null;
      const sourceState = state.sourceStates?.[source] || {};
      const ready = entry.contentReady.get(source) || null;
      const row = {
        source,
        sourceRunId: details?.sourceRunId || '',
        tabId,
        windowId: details?.windowId || null,
        phase: sourceState.phase || '',
        active: sourceState.active !== false,
        contentReady: !!ready,
        readyUrl: ready?.url || '',
        tabStatus: '',
        tabUrl: '',
        status: null,
        error: ''
      };
      try {
        if (tabId) {
          const tab = await getTab(tabId);
          row.tabStatus = tab.status || '';
          row.tabUrl = tab.url || '';
          row.status = await this.requestSourceStatus(state.runId, source, tabId);
        }
      } catch (error) {
        row.error = error.message;
      }
      report.push(row);
      await appendLog(state.runId, row.error ? 'warn' : 'info', `[diagnostic] ${source} phase=${row.phase || 'unknown'} active=${row.active} contentReady=${row.contentReady} tabStatus=${row.tabStatus || 'unknown'}`, row.error || row.tabUrl || row.readyUrl || '');
    }
    await appendLog(state.runId, 'info', `[diagnostic] RUN_MULTI_DIAGNOSTIC finished sources=${report.length}`);
    return { active: true, runId: state.runId, sources: report };
  }

  async handleTabRemoved(tabId) {
    const state = await stateRepository.get();
    if (!state?.active || !isMultiState(state)) return false;
    const source = sourceForTab(state, tabId);
    if (!source) return false;
    const sourceState = state.sourceStates?.[source] || {};
    if (sourceState.active === false) return true;
    await appendLog(state.runId, 'error', `[orchestrator] Source failed: ${source} error=Source window was closed`);
    await stateRepository.patchSource(state.runId, source, {
      active: false,
      phase: 'failed',
      lastError: 'Source window was closed'
    }, { errors: 1 });
    this.settleSource(state.runId, source, { source, status: 'rejected', error: 'Source window was closed' });
    return true;
  }
}

const multiScrapeController = new MultiWindowOrchestrator();

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
    case 'state:patchSource': {
      const state = await stateRepository.patchSource(request.runId, request.source, request.patch || {}, request.statsDelta || {});
      if (state) await multiScrapeController.handleSourceProgress(request.runId, request.source, request.patch || {}, state);
      return state ? { success: true, state } : { success: false, error: 'Stale source update rejected' };
    }
    case 'state:log': {
      const state = await stateRepository.appendLog(request.runId, request.entry);
      return state ? { success: true, state } : { success: false, error: 'Stale log rejected' };
    }
    case 'result:add': {
      const result = await exclusive(() => serverQueue.savePost(request.runId, request.post, request.options));
      return { success: true, ...result };
    }
    case 'news:openArticleTab': {
      return openNewsArticleTab(request, sender);
    }
    case 'multi:start': {
      void multiScrapeController.start(request.runId, request.credentials || {}, sender)
        .catch(async (error) => {
          await appendLog(request.runId, 'error', '[orchestrator] Multi scrape crashed', error.stack || error.message);
          await stateRepository.patch(request.runId, { active: false, phase: 'failed', lastError: error.message });
          await finalizeRun(request.runId, false).catch(console.error);
        });
      return { success: true };
    }
    case 'multi:sourceSettled': {
      await multiScrapeController.handleSourceSettled(request);
      return { success: true };
    }
    case 'CONTENT_READY': {
      return multiScrapeController.handleContentReady(request, sender);
    }
    case 'RUN_MULTI_DIAGNOSTIC':
    case 'multi:diagnostic': {
      const report = await multiScrapeController.diagnostic(request.runId || '');
      return { success: true, report };
    }
    case 'run:skip': {
      const current = await stateRepository.get();
      const nextSkipNonce = Number(current?.skipNonce || 0) + 1;
      const state = await exclusive(() => stateRepository.patch(request.runId, { requestedAction: 'skip', skipNonce: nextSkipNonce }));
      if (!state?.active) return { success: false, error: 'Run is not active' };
      await appendLog(request.runId, 'info', `Skip requested for keyword: ${state.currentKeyword}`);
      if (isMultiState(state)) await multiScrapeController.skip(request.runId);
      else await sendToOwner(state, 'scraper:skip');
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
      if (isMultiState(state)) await multiScrapeController.stop(request.runId);
      else await sendToOwner(state, 'scraper:stop');
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
    if (!state?.active || state.requestedAction === 'stop') return;
    if (isMultiState(state)) {
      const source = sourceForTab(state, tabId);
      if (source) await appendLog(state.runId, 'info', `[orchestrator] Tab complete; waiting for CONTENT_READY: ${source}`);
      return;
    }
    if (state.ownerTabId !== tabId) return;
    await sendToOwner(state, 'scraper:resume');
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await stateRepository.get();
    if (await multiScrapeController.handleTabRemoved(tabId)) return;
    if (!state?.active || state.ownerTabId !== tabId) return;
    if (isMultiState(state)) return;
    await stateRepository.patch(state.runId, { active: false, phase: 'failed', lastError: 'Owner tab was closed' });
    await serverQueue.cancelRun(state.runId);
    await appendLog(state.runId, 'error', 'Owner tab was closed; run stopped');
  })();
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SOURCE_WATCHDOG_ALARM) return;
    void multiScrapeController.checkAlarmWatchdogs().catch(console.error);
  });
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
