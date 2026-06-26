(function initializeOneNewsScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: '1news.az',
    baseUrl: 'https://1news.az/az',
    author: '1news.az',
    authorUrl: 'https://1news.az/az'
  });

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function validDateParts(year, month, day, hour, minute) {
    const date = new Date(year, month, day, hour, minute, 0, 0);
    return date.getFullYear() === year
      && date.getMonth() === month
      && date.getDate() === day
      && date.getHours() === hour
      && date.getMinutes() === minute
      ? date
      : null;
  }

  function parse1NewsDateObject(rawText) {
    const raw = String(rawText || '').replace(/\u00a0/g, ' ').trim();
    const match = raw.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
    if (!match) return null;
    return validDateParts(
      Number(match[5]),
      Number(match[4]) - 1,
      Number(match[3]),
      Number(match[1]),
      Number(match[2])
    );
  }

  function parse1NewsDate(rawText) {
    const date = parse1NewsDateObject(rawText);
    return date ? app.utils.formatTimestamp(date) : null;
  }

  function normalize1NewsUrl(value) {
    try {
      const url = new URL(value || '', 'https://1news.az');
      if (!/(^|\.)1news\.az$/i.test(url.hostname)) return '';
      url.hash = '';
      url.search = '';
      const result = url.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (error) {
      return '';
    }
  }

  class OneNewsScraper extends app.BaseScraper {
    constructor() {
      super(SOURCE_CONFIG.source);
      this.dateSortingConfirmed = false;
    }

    async ensureReady() {
      return true;
    }

    currentQuery() {
      try { return app.utils.normalizeText(new URL(location.href).searchParams.get('q')); } catch (error) { return ''; }
    }

    resultsMatch(keyword) {
      return /^\/az\/axtarish\/?$/i.test(location.pathname) && this.currentQuery() === app.utils.normalizeText(keyword);
    }

    searchUrl(keyword) {
      return `${SOURCE_CONFIG.baseUrl}/axtarish/?q=${encodeURIComponent(String(keyword || ''))}`;
    }

    searchInput() {
      return this.visible('#searchInput, input[name="q"], .search form input');
    }

    async search(keyword, ctx) {
      await ctx.logger.info(`[1news.az] Keyword started: ${keyword}`);
      this.dateSortingConfirmed = false;
      if (!/(^|\.)1news\.az$/i.test(location.hostname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (!this.resultsMatch(keyword) && !/^\/az\/?$/i.test(location.pathname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (this.resultsMatch(keyword)) {
        await ctx.logger.info('[1news.az] Search results loaded');
        await this.sortResultsByDate(ctx);
        return { success: true };
      }

      const input = await app.utils.waitFor(() => this.searchInput(), {
        timeoutMs: 8000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!input) {
        const fallbackUrl = this.searchUrl(keyword);
        await ctx.logger.warn('[1news.az] Search input was not found; using fallback URL', fallbackUrl);
        window.location.assign(fallbackUrl);
        return { success: false, navigating: true };
      }
      await ctx.logger.info('[1news.az] Search input found');
      const typed = await ctx.navigation.type(input, keyword, '1news.az search input');
      if (typed) {
        await ctx.logger.info('[1news.az] Keyword typed');
        let submitted = await ctx.navigation.pressEnter(input, () => this.resultsMatch(keyword), '1news.az search input');
        if (!submitted) {
          const form = input.closest('form');
          if (form) {
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            submitted = !!(await app.utils.waitFor(() => this.resultsMatch(keyword), {
              timeoutMs: 7000,
              intervalMs: 300,
              token: ctx.token
            }));
          }
        }
        if (submitted || this.resultsMatch(keyword)) {
          await ctx.logger.info('[1news.az] Search submitted');
          await ctx.logger.info('[1news.az] Search results loaded');
          await this.sortResultsByDate(ctx);
          return { success: true };
        }
      }

      const fallbackUrl = this.searchUrl(keyword);
      await ctx.logger.warn('[1news.az] UI search failed; using fallback URL', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true };
    }

    sortMenuContainer() {
      return this.visible('.gsc-option-menu-container');
    }

    async sortResultsByDate(ctx) {
      await ctx.logger.info('[1news.az] Sorting results by Date');
      const container = await app.utils.waitFor(() => this.sortMenuContainer(), {
        timeoutMs: 10000,
        intervalMs: 300,
        token: ctx.token
      });
      if (!container) {
        await ctx.logger.warn('[1news.az] Sort dropdown was not found; continuing without date sorting');
        return false;
      }
      const selected = this.visible('.gsc-selected-option-container, .gsc-option-selector', container);
      if (!selected) {
        await ctx.logger.warn('[1news.az] Sort dropdown trigger was not found; continuing without date sorting');
        return false;
      }
      await ctx.navigation.click(selected, '1news.az sort dropdown');
      await ctx.logger.info('[1news.az] Sort dropdown opened');
      const option = await app.utils.waitFor(() => {
        const menu = this.visible('.gsc-option-menu', container) || document.querySelector('.gsc-option-menu');
        if (!menu) return null;
        return this.allVisible('.gsc-option-menu-item, .gsc-option', menu)
          .find((element) => /date/i.test(this.text(element))) || null;
      }, { timeoutMs: 5000, intervalMs: 200, token: ctx.token });
      if (!option) {
        await ctx.logger.warn('[1news.az] Date sort option was not found; continuing without date sorting');
        return false;
      }
      const before = this.resultSignature();
      await ctx.navigation.click(this.clickable(option), '1news.az sort by Date');
      await ctx.logger.info('[1news.az] Date option selected');
      await ctx.logger.info('[1news.az] Date sorting selected');
      await app.utils.waitFor(() => this.resultCandidates().length && this.resultSignature() !== before, {
        timeoutMs: 8000,
        intervalMs: 300,
        token: ctx.token
      });
      this.dateSortingConfirmed = true;
      await ctx.logger.info('[1news.az] Results resorted by date');
      return true;
    }

    resultSignature() {
      return this.resultCandidates().map((candidate) => candidate.postUrl).join('|');
    }

    sourceUrl(value) {
      return normalize1NewsUrl(value);
    }

    mediaUrl(value) {
      try {
        const url = new URL(value || '', 'https://1news.az');
        return /^https?:$/i.test(url.protocol) ? url.toString() : '';
      } catch (error) {
        return '';
      }
    }

    resultCandidates() {
      const roots = this.allVisible('.gsc-webResult.gsc-result, .gsc-result');
      const seen = new Set();
      return roots.map((root, index) => {
        const link = root.querySelector('.gsc-thumbnail-inside a.gs-title[href], .gs-title a[href], a.gs-title[href], a[href]');
        const postUrl = this.sourceUrl(link?.getAttribute('href') || link?.href);
        if (!postUrl || seen.has(postUrl)) return null;
        seen.add(postUrl);
        const image = root.querySelector('img[src], img[data-src]');
        return {
          index: index + 1,
          postUrl,
          title: this.text(link),
          snippet: this.text(root.querySelector('.gs-snippet, .gsc-table-result .gs-snippet')),
          previewImage: this.mediaUrl(image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || '')
        };
      }).filter(Boolean);
    }

    currentResultsPage() {
      const current = this.visible('.gsc-cursor-page.gsc-cursor-current-page');
      const number = Number(this.text(current) || 1);
      return Number.isFinite(number) && number > 0 ? number : 1;
    }

    nextPageControl() {
      const currentPage = this.currentResultsPage();
      return this.allVisible('.gsc-cursor-page')
        .find((element) => Number(this.text(element)) === currentPage + 1) || null;
    }

    async moveToNextResultsPage(ctx) {
      const next = this.nextPageControl();
      if (!next) return false;
      const nextNumber = Number(this.text(next));
      await ctx.logger.info(`[1news.az] Moving to results page ${nextNumber}`);
      const before = this.resultSignature();
      await ctx.navigation.click(next, `1news.az results page ${nextNumber}`);
      const loaded = await app.utils.waitFor(() => {
        return this.currentResultsPage() === nextNumber && this.resultSignature() && this.resultSignature() !== before;
      }, { timeoutMs: 10000, intervalMs: 300, token: ctx.token });
      if (!loaded) {
        await ctx.logger.warn(`[1news.az] Results page ${nextNumber} was not confirmed`);
        return false;
      }
      await ctx.logger.info(`[1news.az] Results page loaded: ${nextNumber}`);
      return true;
    }

    sendRuntimeMessage(message, token) {
      const request = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        });
      });
      if (!token) return request;
      let unsubscribe = null;
      const cancellation = new Promise((resolve, reject) => {
        unsubscribe = token.onCancel((reason) => reject(new app.utils.CancellationError(reason)));
      });
      return Promise.race([request, cancellation]).finally(() => unsubscribe?.());
    }

    async openArticleInNewTab(candidate, ctx, ordinal, total) {
      await ctx.logger.info(`[1news.az] Opening article ${ordinal}/${total}: ${candidate.postUrl}`);
      const response = await this.sendRuntimeMessage({
        action: 'news:openArticleTab',
        runId: ctx.runId,
        source: SOURCE_CONFIG.source,
        url: candidate.postUrl,
        preview: candidate
      }, ctx.token);
      if (!response?.success) throw new Error(response?.error || 'Article tab scraping failed');
      return response.article || {};
    }

    buildPost(candidate, article) {
      const rawDate = article.rawDate || '';
      const parsedDate = article.postDate ? new Date(article.postDate) : parse1NewsDateObject(rawDate);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: article.postUrl || candidate.postUrl,
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        text: article.text || '',
        mediaUrls: unique([...(article.mediaUrls || []), candidate.previewImage]),
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        scrapedAt: new Date().toISOString()
      };
    }

    async collect(ctx) {
      await app.utils.waitFor(() => this.resultCandidates().length, {
        timeoutMs: 12000,
        intervalMs: 300,
        token: ctx.token
      });
      const visited = new Set();
      while (true) {
        ctx.token.throwIfCancelled();
        const page = this.currentResultsPage();
        await ctx.logger.info(`[1news.az] Results page ${page}`);
        const candidates = this.resultCandidates().filter((candidate) => !visited.has(candidate.postUrl));
        await ctx.logger.info(`[1news.az] Result candidates found: ${candidates.length}`);
        for (let index = 0; index < candidates.length; index++) {
          ctx.token.throwIfCancelled();
          const candidate = candidates[index];
          visited.add(candidate.postUrl);
          try {
            const article = await this.openArticleInNewTab(candidate, ctx, index + 1, candidates.length);
            const post = this.buildPost(candidate, article);
            await ctx.logger.info(`[1news.az] Article title extracted: ${article.title || candidate.title || ''}`);
            await ctx.logger.info(`[1news.az] Article date raw: ${article.rawDate || ''}`);
            await ctx.logger.info(`[1news.az] Article date parsed: ${post.postDate || 'null'}`);
            await ctx.logger.info(`[1news.az] Article text length: ${String(post.text || '').length}`);
            await ctx.logger.info(`[1news.az] Media URLs collected: ${post.mediaUrls.length}`);
            const outcome = await ctx.onPost(post);
            if (outcome.accepted) await ctx.logger.info(`[1news.az] Post saved: ${post.postUrl}`);
            if (outcome.limitReached) {
              await ctx.logger.info('[1news.az] Keyword finished: target');
              return { reason: 'target' };
            }
            if (outcome.older && this.dateSortingConfirmed) {
              await ctx.logger.info('[1news.az] Keyword finished: date-limit');
              return { reason: 'date-limit' };
            }
          } catch (error) {
            if (error instanceof app.utils.CancellationError) throw error;
            await ctx.logger.warn('[1news.az] Article skipped after scraping error', `${candidate.postUrl}: ${error.message}`);
          }
        }
        if (!(await this.moveToNextResultsPage(ctx))) break;
      }
      await ctx.logger.info('[1news.az] Keyword finished: exhausted');
      return { reason: 'exhausted' };
    }

    articleText(root = document) {
      return Array.from(root.querySelectorAll('.mainArticle .content > p, .mainArticle .content p'))
        .filter(app.utils.isVisible)
        .map((paragraph) => this.text(paragraph))
        .filter(Boolean)
        .join('\n\n');
    }

    articleMedia(root = document) {
      const urls = [];
      root.querySelectorAll('.mainArticle .thumb img[src], .mainArticle .content img[src], video[src], source[src], audio[src]')
        .forEach((media) => {
          urls.push(this.mediaUrl(media.currentSrc || media.src || media.getAttribute('src')));
        });
      return unique(urls);
    }

    extractArticleFromPage(preview = {}) {
      const root = document.querySelector('article.mainArticle, .mainArticle') || document;
      const rawDate = this.text(root.querySelector('.authorNDate .date')) || '';
      const parsedDate = parse1NewsDateObject(rawDate);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: normalize1NewsUrl(location.href) || preview.postUrl || '',
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title: this.text(root.querySelector('.title, h1')) || preview.title || '',
        text: this.articleText(root),
        rawDate,
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        mediaUrls: this.articleMedia(root),
        scrapedAt: new Date().toISOString()
      };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.parse1NewsDate = parse1NewsDate;
  app.parsers.oneNewsDate = parse1NewsDate;
  app.parsers.oneNewsUrl = normalize1NewsUrl;
  app.parsers.oneNewsSourceConfig = SOURCE_CONFIG;
  app.scrapers[SOURCE_CONFIG.source] = new OneNewsScraper();
})(globalThis.ScraperApp);
