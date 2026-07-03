(function initializeContentEntry(app) {
  'use strict';

  const controller = new app.ScraperController();
  console.log(`Multi-platform scraper content v${app.VERSION} loaded; waiting for explicit Start/Resume`);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request?.action) return false;
    if (request.action === 'scraper:start' || request.action === 'scraper:resume') {
      controller.start(request.runId, request.credentials || {});
      sendResponse({ success: true });
      return false;
    }
    if (request.action === 'scraper:stop') {
      controller.stop('stop');
      sendResponse({ success: true });
      return false;
    }
    if (request.action === 'scraper:skip') {
      controller.skip();
      sendResponse({ success: true });
      return false;
    }
    if (request.action === 'news:extractArticle') {
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
})(globalThis.ScraperApp);
