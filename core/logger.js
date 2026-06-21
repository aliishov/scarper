(function initializeScraperLogger(app) {
  'use strict';

  class Logger {
    constructor(runId, platform) {
      this.runId = runId;
      this.platform = platform;
    }

    async write(level, message, details = null) {
      const entry = {
        timestamp: new Date().toISOString(),
        platform: this.platform,
        level,
        message: String(message),
        details: details ? String(details) : ''
      };
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${this.platform}] ${message}`, details || '');
      try { await app.storage.log(this.runId, entry); } catch (error) { console.error('Logger storage error', error); }
      return entry;
    }

    info(message, details = null) { return this.write('info', message, details); }
    warn(message, details = null) { return this.write('warn', message, details); }
    error(message, details = null) { return this.write('error', message, details); }
    transition(from, to) { return this.info(`State transition: ${from} -> ${to}`); }
  }

  app.Logger = Logger;
})(globalThis.ScraperApp);
