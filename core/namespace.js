(function initializeScraperNamespace(global) {
  'use strict';

  const app = global.ScraperApp || {};
  app.VERSION = 2;
  app.constants = Object.freeze({
    STATE_KEY: 'scrapeStateV2',
    MAX_LOGS: 300,
    MAX_SEARCH_ATTEMPTS: 3,
    RESULT_DB_NAME: 'multi-platform-scraper-v2',
    RESULT_DB_VERSION: 1,
    SERVER_URL: 'http://localhost:8080/api/posts'
  });
  global.ScraperApp = app;
})(globalThis);
