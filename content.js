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
    return false;
  });
})(globalThis.ScraperApp);
