(function initializeHaqqinScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: 'haqqin.az',
    baseUrl: 'https://haqqin.az/',
    author: 'haqqin.az',
    authorUrl: 'https://haqqin.az/'
  });

  const RU_MONTHS = new Map([
    ['\u044f\u043d\u0432\u0430\u0440\u044f', 0],
    ['\u0444\u0435\u0432\u0440\u0430\u043b\u044f', 1],
    ['\u043c\u0430\u0440\u0442\u0430', 2],
    ['\u0430\u043f\u0440\u0435\u043b\u044f', 3],
    ['\u043c\u0430\u044f', 4],
    ['\u0438\u044e\u043d\u044f', 5],
    ['\u0438\u044e\u043b\u044f', 6],
    ['\u0430\u0432\u0433\u0443\u0441\u0442\u0430', 7],
    ['\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044f', 8],
    ['\u043e\u043a\u0442\u044f\u0431\u0440\u044f', 9],
    ['\u043d\u043e\u044f\u0431\u0440\u044f', 10],
    ['\u0434\u0435\u043a\u0430\u0431\u0440\u044f', 11]
  ]);

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

  function parseHaqqinDateObject(rawText, now = new Date()) {
    const raw = String(rawText || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return null;

    let match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      return validDateParts(now.getFullYear(), now.getMonth(), now.getDate(), Number(match[1]), Number(match[2]));
    }

    match = raw.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})/);
    if (match) {
      return validDateParts(Number(match[5]), Number(match[4]) - 1, Number(match[3]), Number(match[1]), Number(match[2]));
    }

    match = raw.match(/(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4}).*?(\d{1,2}):(\d{2})/);
    if (match) {
      return validDateParts(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]));
    }

    match = raw.toLowerCase().match(/(\d{1,2})\s+([^\d,]+?)\s+(\d{4}).*?(\d{1,2}):(\d{2})/);
    if (match) {
      const month = RU_MONTHS.get(match[2].trim());
      if (month !== undefined) {
        return validDateParts(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]));
      }
    }

    return null;
  }

  function parseHaqqinDate(rawText, now = new Date()) {
    const date = parseHaqqinDateObject(rawText, now);
    return date ? app.utils.formatTimestamp(date) : null;
  }

  function normalizeHaqqinUrl(value) {
    try {
      const url = new URL(value || '', SOURCE_CONFIG.baseUrl);
      if (!/(^|\.)haqqin\.az$/i.test(url.hostname)) return '';
      url.hash = '';
      url.search = '';
      const result = url.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (error) {
      return '';
    }
  }

  class HaqqinScraper extends app.BaseScraper {
    constructor() {
      super(SOURCE_CONFIG.source);
    }

    async ensureReady() {
      return true;
    }

    currentQuery() {
      try {
        const url = new URL(location.href);
        const query = url.searchParams.get('q');
        if (query) return app.utils.normalizeText(query);
        const match = url.pathname.match(/^\/search\/(.+?)\/?$/i);
        return match ? app.utils.normalizeText(decodeURIComponent(match[1])) : '';
      } catch (error) {
        return '';
      }
    }

    resultsMatch(keyword) {
      return /^\/search\/?/i.test(location.pathname) && this.currentQuery() === app.utils.normalizeText(keyword);
    }

    searchUrl(keyword) {
      return `${SOURCE_CONFIG.baseUrl}search/${encodeURIComponent(String(keyword || ''))}`;
    }

    searchOpener() {
      return this.visible('.page-header__open-search-form-button');
    }

    searchInput() {
      return this.visible('form.page-header__search-form input[name="q"], .search-form__input[name="q"]');
    }

    searchSubmit(input) {
      return input?.closest('form')?.querySelector('.search-form__submit-button, button[type="submit"], button') || null;
    }

    async search(keyword, ctx) {
      await ctx.logger.info(`[haqqin.az] Keyword started: ${keyword}`);
      if (!/(^|\.)haqqin\.az$/i.test(location.hostname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (this.resultsMatch(keyword)) {
        await ctx.logger.info('[haqqin.az] Search results loaded');
        return { success: true };
      }
      if (!/^\/?$/i.test(location.pathname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }

      const opener = this.searchOpener();
      if (opener) {
        await ctx.navigation.click(opener, 'haqqin.az search opener');
        await ctx.logger.info('[haqqin.az] Search opener clicked');
      } else {
        await ctx.logger.warn('[haqqin.az] Search opener was not found');
      }

      const input = await app.utils.waitFor(() => this.searchInput(), {
        timeoutMs: 7000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!input) {
        const fallbackUrl = this.searchUrl(keyword);
        await ctx.logger.warn('[haqqin.az] Search input was not found; using fallback URL', fallbackUrl);
        window.location.assign(fallbackUrl);
        return { success: false, navigating: true };
      }

      await ctx.logger.info('[haqqin.az] Search input found');
      const typed = await ctx.navigation.type(input, keyword, 'haqqin.az search input');
      if (typed) {
        await ctx.logger.info('[haqqin.az] Keyword typed');
        let submitted = await ctx.navigation.pressEnter(input, () => this.resultsMatch(keyword), 'haqqin.az search input');
        if (!submitted) {
          const submit = this.searchSubmit(input);
          if (submit) submitted = await ctx.navigation.click(submit, 'haqqin.az search submit');
          if (submitted) {
            submitted = !!(await app.utils.waitFor(() => this.resultsMatch(keyword), {
              timeoutMs: 7000,
              intervalMs: 300,
              token: ctx.token
            }));
          }
        }
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
          await ctx.logger.info('[haqqin.az] Search submitted');
          await ctx.logger.info('[haqqin.az] Search results loaded');
          return { success: true };
        }
      }

      const fallbackUrl = this.searchUrl(keyword);
      await ctx.logger.warn('[haqqin.az] UI search failed; using fallback URL', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true };
    }

    sourceUrl(value) {
      return normalizeHaqqinUrl(value);
    }

    mediaUrl(value) {
      try {
        const url = new URL(value || '', SOURCE_CONFIG.baseUrl);
        return /^https?:$/i.test(url.protocol) ? url.toString() : '';
      } catch (error) {
        return '';
      }
    }

    imageUrl(image) {
      return this.mediaUrl(image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || '');
    }

    extractResultCandidate(element, index) {
      const link = element.matches?.('a[href]') ? element : element.querySelector('a[href]');
      const postUrl = this.sourceUrl(link?.getAttribute('href') || link?.href);
      if (!postUrl) return null;
      const image = element.querySelector('.news-item__image img[src], .news-item__image img[data-src], img[src], img[data-src]');
      return {
        index,
        postUrl,
        title: this.text(element.querySelector('.news-item__title')) || this.text(link) || '',
        previewImage: this.imageUrl(image),
        rawDate: this.text(element.querySelector('.news-item-pubinfo__date, .news-item__pubinfo .news-item-pubinfo__date')) || ''
      };
    }

    resultCandidates() {
      const seen = new Set();
      return this.allVisible('a.news-list__item.news-item, .news-list__item.news-item')
        .map((element, index) => this.extractResultCandidate(element, index + 1))
        .filter((candidate) => {
          if (!candidate || seen.has(candidate.postUrl)) return false;
          seen.add(candidate.postUrl);
          return true;
        });
    }

    loadMoreButton() {
      return this.visible('.load-more__button');
    }

    async loadMore(ctx) {
      const button = this.loadMoreButton();
      if (!button) {
        await ctx.logger.info('[haqqin.az] No more results');
        return false;
      }
      const beforeCount = this.resultCandidates().length;
      await ctx.logger.info('[haqqin.az] Clicking load more');
      await ctx.navigation.click(button, 'haqqin.az load more');
      const loaded = await app.utils.waitFor(() => this.resultCandidates().length > beforeCount, {
        timeoutMs: 12000,
        intervalMs: 300,
        token: ctx.token
      });
      const afterCount = this.resultCandidates().length;
      if (!loaded || afterCount <= beforeCount) {
        await ctx.logger.info('[haqqin.az] No more results');
        return false;
      }
      await ctx.logger.info(`[haqqin.az] New results loaded: ${afterCount - beforeCount}`);
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
      await ctx.logger.info(`[haqqin.az] Opening article ${ordinal}/${total}: ${candidate.postUrl}`);
      const response = await this.sendRuntimeMessage({
        action: 'news:openArticleTab',
        runId: ctx.runId,
        source: SOURCE_CONFIG.source,
        url: candidate.postUrl,
        preview: candidate
      }, ctx.token);
      if (!response?.success) throw new Error(response?.error || 'Article tab scraping failed');
      await ctx.logger.info('[haqqin.az] Article tab closed');
      return response.article || {};
    }

    buildPost(candidate, article) {
      const rawDate = article.rawDate || candidate.rawDate || '';
      const parsedDate = article.postDate ? new Date(article.postDate) : parseHaqqinDateObject(rawDate);
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
      await app.utils.waitFor(() => this.resultCandidates().length || this.resultsMatch(ctx.keyword), {
        timeoutMs: 10000,
        intervalMs: 300,
        token: ctx.token
      });
      const visited = new Set();
      while (true) {
        ctx.token.throwIfCancelled();
        const candidates = this.resultCandidates().filter((candidate) => !visited.has(candidate.postUrl));
        await ctx.logger.info(`[haqqin.az] Result candidates found: ${candidates.length}`);
        for (let index = 0; index < candidates.length; index++) {
          ctx.token.throwIfCancelled();
          const candidate = candidates[index];
          visited.add(candidate.postUrl);
          try {
            const article = await this.openArticleInNewTab(candidate, ctx, index + 1, candidates.length);
            const post = this.buildPost(candidate, article);
            await ctx.logger.info(`[haqqin.az] Article title extracted: ${article.title || candidate.title || ''}`);
            await ctx.logger.info(`[haqqin.az] Article date raw: ${article.rawDate || candidate.rawDate || ''}`);
            await ctx.logger.info(`[haqqin.az] Article date parsed: ${post.postDate || 'null'}`);
            await ctx.logger.info(`[haqqin.az] Article text length: ${String(post.text || '').length}`);
            await ctx.logger.info(`[haqqin.az] Media URLs collected: ${post.mediaUrls.length}`);
            const outcome = await ctx.onPost(post);
            if (outcome.accepted) await ctx.logger.info(`[haqqin.az] Post saved: ${post.postUrl}`);
            if (outcome.limitReached) {
              await ctx.logger.info('[haqqin.az] Keyword finished: target');
              return { reason: 'target' };
            }
            if (outcome.older) {
              await ctx.logger.info('[haqqin.az] Keyword finished: date-limit');
              return { reason: 'date-limit' };
            }
          } catch (error) {
            if (error instanceof app.utils.CancellationError) throw error;
            await ctx.logger.warn('[haqqin.az] Article skipped after scraping error', `${candidate.postUrl}: ${error.message}`);
          }
        }
        if (!(await this.loadMore(ctx))) break;
      }
      await ctx.logger.info('[haqqin.az] Keyword finished: exhausted');
      return { reason: 'exhausted' };
    }

    excludedArticleNode(element) {
      return !!element?.closest?.('.ad, .ads, .banner, .subscribe, .related, .articleBottom, iframe, script');
    }

    articleText(root = document) {
      return Array.from(root.querySelectorAll('.article__content .block-text p, .article__content p'))
        .filter((paragraph) => app.utils.isVisible(paragraph) && !this.excludedArticleNode(paragraph))
        .map((paragraph) => this.text(paragraph))
        .filter(Boolean)
        .join('\n\n');
    }

    articleMedia(root = document) {
      const urls = [];
      root.querySelectorAll('.article__content .block-photo img[src], .article__content img[src], video[src], source[src], audio[src]')
        .forEach((media) => {
          if (!this.excludedArticleNode(media)) urls.push(this.mediaUrl(media.currentSrc || media.src || media.getAttribute('src')));
        });
      return unique(urls);
    }

    extractArticleFromPage(preview = {}) {
      const root = document.querySelector('article.article, .article') || document;
      const rawDate = this.text(root.querySelector('.article__date')) || preview.rawDate || '';
      const parsedDate = parseHaqqinDateObject(rawDate);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: normalizeHaqqinUrl(location.href) || preview.postUrl || '',
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title: this.text(root.querySelector('.article-headline__name')) || this.text(root.querySelector('article.article h1, h1')) || preview.title || '',
        text: this.articleText(root),
        rawDate,
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        mediaUrls: this.articleMedia(root),
        scrapedAt: new Date().toISOString()
      };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.parseHaqqinDate = parseHaqqinDate;
  app.parsers.haqqinDate = parseHaqqinDate;
  app.parsers.haqqinUrl = normalizeHaqqinUrl;
  app.parsers.haqqinSourceConfig = SOURCE_CONFIG;
  app.scrapers[SOURCE_CONFIG.source] = new HaqqinScraper();
})(globalThis.ScraperApp);
