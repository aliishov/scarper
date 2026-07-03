(function initializeContentEntry(app) {
  'use strict';

  const controller = new app.ScraperController();
  const capabilityHeartbeatTimers = new Map();
  console.log(`Multi-platform scraper content v${app.VERSION} loaded; waiting for explicit Start/Resume`);

  function notifyContentReady() {
    try {
      const result = chrome.runtime.sendMessage({
        action: 'CONTENT_READY',
        type: 'CONTENT_READY',
        url: location.href,
        readyAt: new Date().toISOString()
      });
      if (result && typeof result.catch === 'function') result.catch((error) => {
        console.debug('Could not notify background that content is ready', error);
      });
    } catch (error) {
      console.debug('Could not notify background that content is ready', error);
    }
  }

  async function logControl(runId, source, message, details = '') {
    if (!runId) return;
    try {
      const logger = new app.Logger(runId, source || 'source');
      await logger.info(message, details);
    } catch (error) {
      console.debug('Could not write content control log', message, error);
    }
  }

  function capabilitySnapshot(source = '') {
    const scraper = app.scrapers[source] || null;
    let cardsCount = 0;
    let cardsError = '';
    try {
      if (typeof scraper?.resultCandidates === 'function') {
        cardsCount = scraper.resultCandidates().length;
      }
    } catch (error) {
      cardsError = error.message;
    }
    return {
      source,
      url: location.href,
      title: document.title || '',
      visibilityState: document.visibilityState || '',
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
      cardsCount,
      cardsError,
      timestamp: new Date().toISOString()
    };
  }

  function socialProbeInput(source) {
    const scraper = app.scrapers[source] || null;
    try {
      if (typeof scraper?.searchInput === 'function') return scraper.searchInput();
    } catch (error) {}
    const selectors = {
      facebook: 'input[type="search"], input[name="q"], [role="search"] input, [contenteditable="true"][role="textbox"], [role="combobox"][contenteditable="true"]',
      instagram: 'input[placeholder*="Search" i], input[aria-label*="Search" i], input[type="text"], [contenteditable="true"]',
      twitter: 'input[type="text"], input:not([type]), [role="textbox"], [data-testid="SearchBox_Search_Input"]',
      tiktok: '[data-e2e="search-user-input"], input[type="search"], [role="search"] input, input[placeholder*="Search" i]'
    };
    return document.querySelector(selectors[source] || 'input, [contenteditable="true"]');
  }

  function setProbeInputValue(input, value) {
    if (!input) return false;
    if (input.isContentEditable) {
      input.textContent = value;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      return app.utils.normalizeText(input.textContent) === app.utils.normalizeText(value);
    }
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof input.setSelectionRange === 'function') {
      const end = String(value).length;
      try { input.setSelectionRange(end, end); } catch (error) {}
    }
    return app.utils.normalizeText(input.value) === app.utils.normalizeText(value);
  }

  async function capabilityUiProbe(request) {
    const source = request.source || '';
    const keyword = String(request.keyword || 'parallel capability test');
    const input = socialProbeInput(source);
    const beforeUrl = location.href;
    let activeElementOk = false;
    let caretOk = false;
    let typingOk = false;
    let enterAccepted = false;
    let error = '';
    try {
      if (!input) throw new Error('search input not found');
      input.scrollIntoView?.({ block: 'center', inline: 'center' });
      input.focus?.({ preventScroll: true });
      activeElementOk = document.activeElement === input;
      typingOk = setProbeInputValue(input, keyword);
      caretOk = typeof input.selectionStart === 'number'
        ? input.selectionStart === String(keyword).length && input.selectionEnd === String(keyword).length
        : activeElementOk;
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        }));
      }
      await app.utils.sleep(1000);
      enterAccepted = location.href !== beforeUrl;
    } catch (probeError) {
      error = probeError.message;
    }
    return {
      source,
      focused: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
      visibilityState: document.visibilityState || '',
      activeElementOk,
      caretOk,
      typingOk,
      enterAccepted,
      urlBefore: beforeUrl,
      urlAfter: location.href,
      error
    };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const action = request?.type || request?.action;
    if (!action) return false;
    if (action === 'START_SOURCE_RUN') {
      const runId = request.parentRunId || request.runId;
      const source = request.source || '';
      const sourceRunId = request.sourceRunId || runId;
      void (async () => {
        const logger = new app.Logger(runId, source || 'source');
        await logger.info(`START_SOURCE_RUN received sourceRunId=${sourceRunId}`);
      })();
      controller.start(runId, request.credentialsForThisSourceOnly || request.credentials || {}, {
        parentRunId: runId,
        sourceRunId,
        mode: request.mode || '',
        source
      });
      sendResponse({ success: true, sourceRunId });
      return false;
    }
    if (action === 'scraper:start' || action === 'scraper:resume') {
      void logControl(
        request.parentRunId || request.runId,
        request.source || '',
        `${action} received sourceRunId=${request.sourceRunId || request.runId}`,
        `url=${location.href}`
      );
      controller.start(request.runId, request.credentials || {}, {
        parentRunId: request.parentRunId || request.runId,
        sourceRunId: request.sourceRunId || request.runId,
        mode: request.mode || '',
        source: request.source || ''
      });
      sendResponse({ success: true });
      return false;
    }
    if (action === 'scraper:stop' || action === 'STOP_SOURCE_RUN') {
      void logControl(request.parentRunId || request.runId, request.source || '', `${action} received`, `url=${location.href}`);
      controller.stop('stop');
      sendResponse({ success: true });
      return false;
    }
    if (action === 'scraper:skip' || action === 'SKIP_KEYWORD') {
      void logControl(request.parentRunId || request.runId, request.source || '', `${action} received`, `url=${location.href}`);
      controller.skip();
      sendResponse({ success: true });
      return false;
    }
    if (action === 'GET_SOURCE_STATUS') {
      void (async () => {
        try {
          const status = await controller.statusForContext(request);
          await logControl(request.parentRunId || request.runId, request.source || status.source, `GET_SOURCE_STATUS handled phase=${status.phase || 'unknown'}`, `running=${status.running} url=${status.url || location.href}`);
          sendResponse({ success: true, status });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
    if (action === 'FORCE_SOURCE_SCRAPING') {
      void (async () => {
        try {
          const status = await controller.forceScrapingForContext(request);
          await logControl(request.parentRunId || request.runId, request.source || status.source, `FORCE_SOURCE_SCRAPING handled phase=${status.phase || 'unknown'}`);
          sendResponse({ success: true, status });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
    if (action === 'news:extractArticle') {
      void (async () => {
        try {
          const scraper = app.scrapers[request.source];
          if (!scraper?.extractArticleFromPage) throw new Error(`Article extractor is not available for ${request.source}`);
          const article = await scraper.extractArticleFromPage(request.preview || {});
          sendResponse({ success: true, article });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
    if (action === 'CAPABILITY_START_HEARTBEAT') {
      const key = request.testId || 'default';
      clearInterval(capabilityHeartbeatTimers.get(key));
      const sendHeartbeat = () => {
        chrome.runtime.sendMessage({
          action: 'PARALLEL_CAPABILITY_HEARTBEAT',
          type: 'PARALLEL_CAPABILITY_HEARTBEAT',
          testId: request.testId || '',
          source: request.source || '',
          snapshot: capabilitySnapshot(request.source || '')
        }).catch?.(() => {});
      };
      sendHeartbeat();
      const timer = setInterval(sendHeartbeat, Number(request.intervalMs || 2000));
      capabilityHeartbeatTimers.set(key, timer);
      setTimeout(() => {
        clearInterval(timer);
        capabilityHeartbeatTimers.delete(key);
      }, Number(request.durationMs || 7000));
      sendResponse({ success: true, snapshot: capabilitySnapshot(request.source || '') });
      return false;
    }
    if (action === 'CAPABILITY_DOM_PROBE') {
      sendResponse({ success: true, snapshot: capabilitySnapshot(request.source || '') });
      return false;
    }
    if (action === 'CAPABILITY_UI_PROBE') {
      void capabilityUiProbe(request)
        .then((probe) => sendResponse({ success: true, probe }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }
    return false;
  });

  notifyContentReady();
})(globalThis.ScraperApp);
