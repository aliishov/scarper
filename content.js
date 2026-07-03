(function initializeContentEntry(app) {
  'use strict';

  const controller = new app.ScraperController();
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
    return false;
  });

  notifyContentReady();
})(globalThis.ScraperApp);
