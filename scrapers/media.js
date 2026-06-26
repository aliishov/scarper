(function initializeMediaAzScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: 'media.az',
    baseUrl: 'https://media.az/',
    author: 'media.az',
    authorUrl: 'https://media.az/'
  });

  function pad(number) {
    return String(number).padStart(2, '0');
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function validDateParts(year, month, day, hour, minute, second = 0) {
    const date = new Date(year, month, day, hour, minute, second, 0);
    return date.getFullYear() === year
      && date.getMonth() === month
      && date.getDate() === day
      && date.getHours() === hour
      && date.getMinutes() === minute
      && date.getSeconds() === second
      ? date
      : null;
  }

  function parseMediaAzDateObject(rawText) {
    const raw = String(rawText || '').replace(/\u00a0/g, ' ').trim();
    if (!raw) return null;
    let match = raw.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      return validDateParts(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6] || 0)
      );
    }
    match = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return null;
    return validDateParts(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    );
  }

  function parseMediaAzDate(rawText) {
    const date = parseMediaAzDateObject(rawText);
    return date ? app.utils.formatTimestamp(date) : null;
  }

  function parseMediaAzDateLimit(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    let year;
    let month;
    let day;
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) return null;
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
    }
    if (!validDateParts(year, month - 1, day, 0, 0, 0)) return null;
    return {
      display: `${pad(day)}/${pad(month)}/${year}`,
      iso: `${year}-${pad(month)}-${pad(day)}`
    };
  }

  function mediaAzSearchUrl(keyword, dateLimit = null) {
    const parsed = typeof dateLimit === 'string' ? parseMediaAzDateLimit(dateLimit) : dateLimit;
    const base = `${SOURCE_CONFIG.baseUrl}search?query=${encodeURIComponent(String(keyword || ''))}`;
    if (!parsed) return base;
    return `${base}&date_start=${parsed.iso}&date_end=&category=&sort_type=0`;
  }

  function normalizeMediaAzUrl(value) {
    try {
      const url = new URL(value || '', SOURCE_CONFIG.baseUrl);
      if (!/(^|\.)media\.az$/i.test(url.hostname)) return '';
      url.hash = '';
      url.search = '';
      const result = url.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (error) {
      return '';
    }
  }

  class MediaAzScraper extends app.BaseScraper {
    constructor() {
      super(SOURCE_CONFIG.source);
    }

    async ensureReady() {
      return true;
    }

    currentQuery() {
      try { return app.utils.normalizeText(new URL(location.href).searchParams.get('query')); } catch (error) { return ''; }
    }

    currentDateStart() {
      try { return String(new URL(location.href).searchParams.get('date_start') || ''); } catch (error) { return ''; }
    }

    resultsMatch(keyword, dateLimit = null) {
      if (!(/^\/search\/?$/i.test(location.pathname) && this.currentQuery() === app.utils.normalizeText(keyword))) return false;
      return !dateLimit || this.currentDateStart() === dateLimit.iso;
    }

    searchButton() {
      return this.visible('button.header__search-open, .header__search-open, button[aria-label*="search" i], button[aria-label*="poisk" i]');
    }

    searchInput() {
      return this.visible('input.header__search__input[name="query"], form.header__search input[name="query"], input[name="query"]');
    }

    searchSubmit(input) {
      return input?.closest('form')?.querySelector('button.header__search__btn[type="submit"], button[type="submit"], button') || null;
    }

    searchUrl(keyword, dateLimit = null) {
      return mediaAzSearchUrl(keyword, dateLimit);
    }

    dateStartInput() {
      return this.visible('input[name="date_start"], #start_date');
    }

    setNativeInputValue(input, value) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async submitSearchForm(form, keyword, ctx) {
      const queryInput = form?.querySelector('input[name="query"]') || this.searchInput();
      if (queryInput && app.utils.normalizeText(queryInput.value) !== app.utils.normalizeText(keyword)) {
        this.setNativeInputValue(queryInput, keyword);
      }
      const submit = form?.querySelector('button[type="submit"], button.header__search__btn, button');
      if (submit && app.utils.isVisible(submit)) {
        await ctx.navigation.click(submit, 'Media.az search submit');
        return true;
      }
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    }

    async applyDateLimitSearch(keyword, dateLimit, ctx) {
      const input = await app.utils.waitFor(() => this.dateStartInput(), {
        timeoutMs: 5000,
        intervalMs: 250,
        token: ctx.token
      });
      if (input) {
        await ctx.logger.info(`[media.az] Setting date_start input: ${dateLimit.iso}`);
        this.setNativeInputValue(input, dateLimit.iso);
        const form = input.closest('form') || this.searchInput()?.closest('form') || document.querySelector('form[action*="/search"], form[action*="search"]');
        const submitted = await this.submitSearchForm(form, keyword, ctx);
        if (submitted) {
          await ctx.logger.info('[media.az] Search submitted with date_start');
          const confirmed = await app.utils.waitFor(() => this.resultsMatch(keyword, dateLimit), {
            timeoutMs: 8000,
            intervalMs: 300,
            token: ctx.token
          });
          if (confirmed) {
            await ctx.logger.info('[media.az] Search results loaded');
            return { success: true };
          }
        }
      }

      const fallbackUrl = this.searchUrl(keyword, dateLimit);
      await ctx.logger.warn('[media.az] Using fallback URL with date_start', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true, fallback: true };
    }

    async search(keyword, ctx) {
      await ctx.logger.info(`[media.az] Keyword started: ${keyword}`);
      const dateLimit = parseMediaAzDateLimit(ctx.state?.dateLimit);
      if (dateLimit) {
        await ctx.logger.info('[media.az] Date limit enabled');
        await ctx.logger.info(`[media.az] Converted date limit: ${dateLimit.display} -> ${dateLimit.iso}`);
      }
      if (!/(^|\.)media\.az$/i.test(location.hostname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (this.resultsMatch(keyword, dateLimit)) {
        await ctx.logger.info('[media.az] Search results loaded');
        return { success: true };
      }
      if (dateLimit && this.resultsMatch(keyword)) return this.applyDateLimitSearch(keyword, dateLimit, ctx);

      let submitted = false;
      const button = this.searchButton();
      if (button) {
        await ctx.logger.info('[media.az] Search button found');
        await ctx.navigation.click(button, 'Media.az search toggle');
        await ctx.logger.info('[media.az] Search button clicked');
      } else {
        await ctx.logger.warn('[media.az] Search button was not found');
      }

      const input = await app.utils.waitFor(() => this.searchInput(), {
        timeoutMs: 6000,
        intervalMs: 250,
        token: ctx.token
      });
      if (input) {
        await ctx.logger.info('[media.az] Search input visible');
        const typed = await ctx.navigation.type(input, keyword, 'Media.az search input');
        if (typed) {
          await ctx.logger.info('[media.az] Keyword typed');
          submitted = await ctx.navigation.pressEnter(input, () => this.resultsMatch(keyword), 'Media.az search input');
          if (!submitted) {
            const submit = this.searchSubmit(input);
            if (submit) submitted = await ctx.navigation.click(submit, 'Media.az search submit');
            if (submitted) {
              submitted = !!(await app.utils.waitFor(() => this.resultsMatch(keyword), {
                timeoutMs: 7000,
                intervalMs: 300,
                token: ctx.token
              }));
            }
          }
        }
      }

      if (submitted || this.resultsMatch(keyword)) {
        await ctx.logger.info('[media.az] Search submitted');
        await ctx.logger.info('[media.az] Search results loaded');
        if (dateLimit) return this.applyDateLimitSearch(keyword, dateLimit, ctx);
        return { success: true };
      }

      const fallbackUrl = this.searchUrl(keyword, dateLimit);
      await ctx.logger.warn(dateLimit ? '[media.az] Using fallback URL with date_start' : '[media.az] UI search failed; using fallback URL', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true };
    }

    sourceUrl(value) {
      return normalizeMediaAzUrl(value);
    }

    mediaUrl(value) {
      try {
        const url = new URL(value || '', location.href);
        return /^https?:$/i.test(url.protocol) ? url.toString() : '';
      } catch (error) {
        return '';
      }
    }

    imageUrl(image) {
      return this.mediaUrl(image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || image?.getAttribute?.('data-original') || '');
    }

    extractResultCandidate(element, index) {
      const link = element.querySelector('a.news__item[href], a[href]');
      const postUrl = this.sourceUrl(link?.getAttribute('href') || link?.href);
      if (!postUrl) return null;
      const image = element.querySelector('.news__image img[src], .news__image img[data-src], img[src], img[data-src]');
      const rawDate = element.getAttribute('data-timestamp') || this.text(element.querySelector('.news__date')) || '';
      return {
        index,
        postUrl,
        title: this.text(element.querySelector('.news__title')) || this.text(link) || '',
        previewImage: this.imageUrl(image),
        rawDate
      };
    }

    resultCandidates() {
      const seen = new Set();
      return this.allVisible('.post-block')
        .map((element, index) => this.extractResultCandidate(element, index + 1))
        .filter((candidate) => {
          if (!candidate || seen.has(candidate.postUrl)) return false;
          seen.add(candidate.postUrl);
          return true;
        });
    }

    async collectResultCandidates(ctx) {
      const target = ctx.targetCount === -1 ? 80 : Math.max(20, (ctx.targetCount - ctx.currentCount()) * 3);
      let stableRounds = 0;
      let previousCount = -1;
      let candidates = [];
      for (let round = 1; round <= 8; round++) {
        ctx.token.throwIfCancelled();
        candidates = this.resultCandidates();
        await ctx.logger.info(`[media.az] Result candidates found: ${candidates.length}`);
        if (candidates.length >= target) break;
        stableRounds = candidates.length === previousCount ? stableRounds + 1 : 0;
        if (stableRounds >= 2) break;
        previousCount = candidates.length;
        await this.scrollPage(ctx, 1000);
      }
      return candidates;
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
      await ctx.logger.info(`[media.az] Opening article ${ordinal}/${total}: ${candidate.postUrl}`);
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
      const rawDate = article.rawDate || candidate.rawDate || '';
      const parsedDate = article.postDate ? new Date(article.postDate) : parseMediaAzDateObject(rawDate);
      const mediaUrls = unique([
        ...(article.mediaUrls || []),
        candidate.previewImage
      ]);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: article.postUrl || candidate.postUrl,
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        text: article.text || '',
        mediaUrls,
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
      const candidates = await this.collectResultCandidates(ctx);
      for (let index = 0; index < candidates.length; index++) {
        ctx.token.throwIfCancelled();
        const candidate = candidates[index];
        try {
          const article = await this.openArticleInNewTab(candidate, ctx, index + 1, candidates.length);
          const post = this.buildPost(candidate, article);
          await ctx.logger.info(`[media.az] Article title extracted: ${post.title || ''}`);
          await ctx.logger.info(`[media.az] Article date raw: ${article.rawDate || candidate.rawDate || ''}`);
          await ctx.logger.info(`[media.az] Article date parsed: ${post.postDate || 'null'}`);
          await ctx.logger.info(`[media.az] Article text length: ${String(post.text || '').length}`);
          await ctx.logger.info(`[media.az] Media URLs collected: ${post.mediaUrls.length}`);
          const outcome = await ctx.onPost(post);
          if (outcome.accepted) await ctx.logger.info(`[media.az] Post saved: ${post.postUrl}`);
          if (outcome.limitReached) {
            await ctx.logger.info('[media.az] Keyword finished: target');
            return { reason: 'target' };
          }
          if (outcome.older) {
            await ctx.logger.info('[media.az] Keyword finished: date-limit');
            return { reason: 'date-limit' };
          }
        } catch (error) {
          if (error instanceof app.utils.CancellationError) throw error;
          await ctx.logger.warn('[media.az] Article skipped after scraping error', `${candidate.postUrl}: ${error.message}`);
        }
      }
      await ctx.logger.info('[media.az] Keyword finished: exhausted');
      return { reason: 'exhausted' };
    }

    articleText(root = document) {
      return Array.from(root.querySelectorAll('.news-inner__desc p'))
        .filter(app.utils.isVisible)
        .map((paragraph) => this.text(paragraph))
        .filter(Boolean)
        .join('\n\n');
    }

    articleMedia(root = document) {
      const urls = [];
      root.querySelectorAll('.news-inner__image img[src], .news-inner__image img[data-src], .news-inner__desc img[src], .news-inner__desc img[data-src]')
        .forEach((image) => urls.push(this.imageUrl(image)));
      root.querySelectorAll('video[src], source[src], audio[src]')
        .forEach((media) => urls.push(this.mediaUrl(media.currentSrc || media.src || media.getAttribute('src'))));
      return unique(urls);
    }

    articleRawDate(root, preview = {}) {
      const dataTimestamp = root.getAttribute?.('data-timestamp') || preview.rawDate || '';
      if (parseMediaAzDateObject(dataTimestamp)) return dataTimestamp;
      const values = Array.from(root.querySelectorAll('.news-inner__info li'))
        .map((element) => this.text(element))
        .filter(Boolean);
      return values.find((value) => parseMediaAzDateObject(value)) || dataTimestamp;
    }

    extractArticleFromPage(preview = {}) {
      const root = document.querySelector('.news-inner__body.rt-news-item, .news-inner__body, .rt-news-item') || document;
      const title = this.text(root.querySelector('.news-inner__title')) || this.text(root.querySelector('h1')) || preview.title || '';
      const rawDate = this.articleRawDate(root, preview);
      const parsedDate = parseMediaAzDateObject(rawDate);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: normalizeMediaAzUrl(root.getAttribute?.('data-url')) || normalizeMediaAzUrl(location.href) || preview.postUrl || '',
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title,
        text: this.articleText(root),
        rawDate,
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        mediaUrls: this.articleMedia(root),
        scrapedAt: new Date().toISOString()
      };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.mediaAzDate = parseMediaAzDate;
  app.parsers.mediaAzDateLimit = parseMediaAzDateLimit;
  app.parsers.mediaAzSearchUrl = mediaAzSearchUrl;
  app.parsers.mediaAzUrl = normalizeMediaAzUrl;
  app.parsers.mediaAzSourceConfig = SOURCE_CONFIG;
  app.scrapers[SOURCE_CONFIG.source] = new MediaAzScraper();
})(globalThis.ScraperApp);
