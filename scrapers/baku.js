(function initializeBakuWsScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: 'baku.ws',
    baseUrl: 'https://baku.ws/',
    author: 'baku.ws',
    authorUrl: 'https://baku.ws/'
  });

  const MONTHS = new Map([
    ['yan', 0], ['yanvar', 0],
    ['fev', 1], ['fevral', 1],
    ['mar', 2], ['mart', 2],
    ['apr', 3], ['aprel', 3],
    ['may', 4],
    ['iyn', 5], ['iyun', 5],
    ['iyl', 6], ['iyul', 6],
    ['avq', 7], ['avqust', 7],
    ['sen', 8], ['sentyabr', 8],
    ['okt', 9], ['oktyabr', 9],
    ['noy', 10], ['noyabr', 10],
    ['dek', 11], ['dekabr', 11]
  ]);

  function foldAzeri(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\u0259/g, 'e')
      .replace(/\u0131/g, 'i')
      .replace(/\u015f/g, 's')
      .replace(/\u00e7/g, 'c')
      .replace(/\u011f/g, 'g')
      .replace(/\u00f6/g, 'o')
      .replace(/\u00fc/g, 'u');
  }

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

  function parseBakuWsDateObject(value) {
    if (value && typeof value === 'object') {
      const day = Number(value.day);
      const month = MONTHS.get(foldAzeri(value.month).trim());
      const year = Number(value.year);
      const time = String(value.time || '').match(/(\d{1,2}):(\d{2})/);
      if (month === undefined || !time) return null;
      return validDateParts(year, month, day, Number(time[1]), Number(time[2]));
    }

    const raw = foldAzeri(String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());
    if (!raw) return null;

    let match = raw.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})\D+(\d{1,2}):(\d{2})/);
    if (match) {
      const month = MONTHS.get(match[2]);
      if (month !== undefined) return validDateParts(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]));
    }

    match = raw.match(/(\d{1,2}):(\d{2})\D+(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
    if (match) {
      const month = MONTHS.get(match[4]);
      if (month !== undefined) return validDateParts(Number(match[5]), month, Number(match[3]), Number(match[1]), Number(match[2]));
    }

    match = raw.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})\D+(\d{1,2}):(\d{2})/);
    if (match) return validDateParts(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]));

    return null;
  }

  function parseBakuWsDate(value) {
    const date = parseBakuWsDateObject(value);
    return date ? app.utils.formatTimestamp(date) : null;
  }

  function normalizeBakuWsUrl(value) {
    try {
      const url = new URL(value || '', SOURCE_CONFIG.baseUrl);
      if (!/(^|\.)baku\.ws$/i.test(url.hostname)) return '';
      url.hash = '';
      const result = url.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (error) {
      return '';
    }
  }

  function normalizeBakuWsPostUrl(value) {
    const url = normalizeBakuWsUrl(value);
    if (!url || /\/search\/?$/i.test(new URL(url).pathname)) return '';
    try {
      const parsed = new URL(url);
      parsed.search = '';
      return parsed.toString().replace(/\/$/, '');
    } catch (error) {
      return '';
    }
  }

  class BakuWsScraper extends app.BaseScraper {
    constructor() {
      super(SOURCE_CONFIG.source);
    }

    async ensureReady() {
      return true;
    }

    currentQuery() {
      try { return app.utils.normalizeText(new URL(location.href).searchParams.get('query')); } catch (error) { return ''; }
    }

    resultsMatch(keyword) {
      return /^\/search\/?$/i.test(location.pathname) && this.currentQuery() === app.utils.normalizeText(keyword);
    }

    searchUrl(keyword) {
      return `${SOURCE_CONFIG.baseUrl}search?query=${encodeURIComponent(String(keyword || ''))}`;
    }

    searchIcon() {
      const candidates = Array.from(document.querySelectorAll('svg use, .svg-icon.normal'));
      const seed = candidates.find((element) => {
        if (element.matches?.('.svg-icon.normal')) return true;
        const href = `${element.getAttribute('href') || ''} ${element.getAttribute('xlink:href') || ''} ${element.href?.baseVal || ''}`;
        return href.includes('search-normal');
      });
      const icon = seed?.closest?.('svg') || seed;
      return icon?.closest?.('button, a, div[role="button"], .custom-navbar-search-toggle, .search-toggle') || icon || null;
    }

    searchInput() {
      return this.visible('form.custom-navbar-search-block.open input[name="query"], form[action*="/search"] input[name="query"], input[name="query"]');
    }

    searchSubmit(input) {
      return input?.closest('form')?.querySelector('button[type="submit"], button') || null;
    }

    async search(keyword, ctx) {
      await ctx.logger.info(`[baku.ws] Keyword started: ${keyword}`);
      if (!/(^|\.)baku\.ws$/i.test(location.hostname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (this.resultsMatch(keyword)) {
        await ctx.logger.info('[baku.ws] Results loaded');
        return { success: true };
      }
      if (!/^\/?$/i.test(location.pathname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }

      const icon = this.searchIcon();
      if (icon) {
        await ctx.logger.info('[baku.ws] Search icon found');
        await ctx.navigation.click(icon, 'baku.ws search icon');
        await ctx.logger.info('[baku.ws] Search opened');
      } else {
        await ctx.logger.warn('[baku.ws] Search icon was not found');
      }

      const input = await app.utils.waitFor(() => this.searchInput(), {
        timeoutMs: 7000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!input) {
        const fallbackUrl = this.searchUrl(keyword);
        await ctx.logger.warn('[baku.ws] Search input was not found; using fallback URL', fallbackUrl);
        window.location.assign(fallbackUrl);
        return { success: false, navigating: true };
      }

      await ctx.logger.info('[baku.ws] Search input found');
      const typed = await ctx.navigation.type(input, keyword, 'baku.ws search input');
      if (typed) {
        await ctx.logger.info('[baku.ws] Keyword typed');
        let submitted = await ctx.navigation.pressEnter(input, () => this.resultsMatch(keyword), 'baku.ws search input');
        if (!submitted) {
          const submit = this.searchSubmit(input);
          if (submit) submitted = await ctx.navigation.click(submit, 'baku.ws search submit');
          if (!submitted) {
            const form = input.closest('form');
            if (form) {
              if (typeof form.requestSubmit === 'function') form.requestSubmit();
              else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              submitted = true;
            }
          }
          if (submitted) {
            submitted = !!(await app.utils.waitFor(() => this.resultsMatch(keyword), {
              timeoutMs: 8000,
              intervalMs: 300,
              token: ctx.token
            }));
          }
        }
        if (submitted || this.resultsMatch(keyword)) {
          await ctx.logger.info('[baku.ws] Search submitted');
          await ctx.logger.info('[baku.ws] Results loaded');
          return { success: true };
        }
      }

      const fallbackUrl = this.searchUrl(keyword);
      await ctx.logger.warn('[baku.ws] UI search failed; using fallback URL', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true };
    }

    sourceUrl(value) {
      return normalizeBakuWsPostUrl(value);
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
      return this.mediaUrl(image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || image?.getAttribute?.('src') || '');
    }

    isBanner(element) {
      return !!element?.closest?.('.cat-left-bnr, [class*="bnr"], [class*="banner"]');
    }

    rawDateFromCard(card) {
      const time = this.text(card.querySelector('.post-item-date-time')) || '';
      const day = this.text(card.querySelector('.post-item-date-day')) || '';
      return [day, time].filter(Boolean).join(' ').trim() || this.text(card.querySelector('.post-item-date')) || '';
    }

    extractResultCandidate(element, index) {
      if (this.isBanner(element)) return null;
      const root = element.closest('.post-item') || element;
      if (this.isBanner(root)) return null;
      const content = root.querySelector('.rt-news-item[data-url], .post-item-content[data-url]') || root;
      const titleLink = root.querySelector('.post-item-title a[href], h3 a[href], a[href]');
      const imageLink = root.querySelector('.post-item-img a[href]');
      const postUrl = this.sourceUrl(content.getAttribute('data-url') || titleLink?.getAttribute('href') || titleLink?.href || imageLink?.getAttribute('href') || imageLink?.href);
      if (!postUrl) return null;
      return {
        index,
        postUrl,
        title: this.text(titleLink) || this.text(root.querySelector('.post-item-title')) || '',
        previewImage: this.imageUrl(root.querySelector('.post-item-img img[src], img[src], img[data-src]')),
        rawDate: this.rawDateFromCard(root)
      };
    }

    resultCandidatesSnapshot() {
      const seen = new Set();
      const candidates = [];
      let bannerSkipped = 0;
      for (const element of this.allVisible('.post-item, .rt-news-item[data-url], .post-item-content[data-url]')) {
        if (this.isBanner(element)) {
          bannerSkipped++;
          continue;
        }
        const candidate = this.extractResultCandidate(element, candidates.length + 1);
        if (!candidate || seen.has(candidate.postUrl)) continue;
        seen.add(candidate.postUrl);
        candidates.push(candidate);
      }
      return { candidates, bannerSkipped };
    }

    resultCandidates() {
      return this.resultCandidatesSnapshot().candidates;
    }

    async scrollForMore(ctx, beforeCount) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        ctx.token.throwIfCancelled();
        await ctx.logger.info('[baku.ws] Scrolling for more results');
        window.scrollBy({ top: Math.max(window.innerHeight * 1.6, 1000), behavior: 'smooth' });
        const loaded = await app.utils.waitFor(() => this.resultCandidates().length > beforeCount, {
          timeoutMs: 8000,
          intervalMs: 350,
          token: ctx.token
        });
        const afterCount = this.resultCandidates().length;
        if (loaded && afterCount > beforeCount) {
          await ctx.logger.info(`[baku.ws] New result cards loaded: ${afterCount - beforeCount}`);
          return true;
        }
        await app.utils.sleep(600, ctx.token);
      }
      await ctx.logger.info('[baku.ws] No more result cards after retries');
      return false;
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
      await ctx.logger.info(`[baku.ws] Opening article ${ordinal}/${total}: ${candidate.postUrl}`);
      await ctx.logger.info(`[baku.ws] Opening article: ${candidate.postUrl}`);
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
      const parsedDate = article.postDate ? new Date(article.postDate) : parseBakuWsDateObject(rawDate);
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
        timeoutMs: 12000,
        intervalMs: 300,
        token: ctx.token
      });
      const visitedPosts = new Set();
      while (true) {
        ctx.token.throwIfCancelled();
        const snapshot = this.resultCandidatesSnapshot();
        if (snapshot.bannerSkipped) {
          for (let index = 0; index < snapshot.bannerSkipped; index++) await ctx.logger.info('[baku.ws] Ad/banner skipped');
        }
        const allCandidates = snapshot.candidates;
        const candidates = allCandidates.filter((candidate) => !visitedPosts.has(candidate.postUrl));
        await ctx.logger.info(`[baku.ws] News cards found: ${candidates.length}`);
        for (let index = 0; index < candidates.length; index++) {
          ctx.token.throwIfCancelled();
          const candidate = candidates[index];
          visitedPosts.add(candidate.postUrl);
          try {
            const article = await this.openArticleInNewTab(candidate, ctx, index + 1, candidates.length);
            const post = this.buildPost(candidate, article);
            await ctx.logger.info(`[baku.ws] Date raw: ${article.rawDate || candidate.rawDate || ''}`);
            await ctx.logger.info(`[baku.ws] Date parsed: ${post.postDate || 'null'}`);
            await ctx.logger.info(`[baku.ws] Text length: ${String(post.text || '').length}`);
            await ctx.logger.info(`[baku.ws] Media URLs: ${post.mediaUrls.length}`);
            const outcome = await ctx.onPost(post);
            if (outcome.accepted) await ctx.logger.info(`[baku.ws] Saved: ${post.postUrl}`);
            if (outcome.limitReached) {
              await ctx.logger.info('[baku.ws] Keyword finished: target');
              return { reason: 'target' };
            }
            if (outcome.older) {
              await ctx.logger.info('[baku.ws] Keyword finished: date-limit');
              return { reason: 'date-limit' };
            }
          } catch (error) {
            if (error instanceof app.utils.CancellationError) throw error;
            await ctx.logger.warn('[baku.ws] Article skipped after scraping error', `${candidate.postUrl}: ${error.message}`);
          }
        }
        if (!(await this.scrollForMore(ctx, allCandidates.length))) break;
      }
      await ctx.logger.info('[baku.ws] Keyword finished: exhausted');
      return { reason: 'exhausted' };
    }

    excludedArticleNode(element) {
      return !!element?.closest?.([
        'script',
        'iframe',
        'footer',
        '.ad',
        '.ads',
        '.meta',
        '.related',
        '.similar',
        '.share',
        '.social',
        '.views',
        '.like',
        '.dislike',
        '.rating',
        '.vote',
        '.resize-buttons',
        '.post-detail-tags',
        '.post-detail-share',
        '.post-detail-footer',
        '[class*="bnr"]',
        '[class*="banner"]',
        '[class*="yandex"]',
        '[id*="yandex"]'
      ].join(', '));
    }

    articleText(root = document) {
      return Array.from(root.querySelectorAll('.post-detail-content.resize-area p, .post-detail-content p, .resize-area p'))
        .filter((paragraph) => app.utils.isVisible(paragraph) && !this.excludedArticleNode(paragraph))
        .map((paragraph) => this.text(paragraph))
        .filter(Boolean)
        .join('\n\n');
    }

    articleMedia(root = document) {
      const urls = [];
      root.querySelectorAll('.post-detail-img img[src], .post-detail-content img[src], video[src], source[src], audio[src]')
        .forEach((media) => {
          if (!this.excludedArticleNode(media)) urls.push(this.mediaUrl(media.currentSrc || media.src || media.getAttribute('src') || media.getAttribute('data-src')));
        });
      return unique(urls);
    }

    articleDateParts(root = document) {
      const date = root.querySelector('.post-date') || document.querySelector('.post-date');
      return {
        day: this.text(date?.querySelector('.post-date-day')) || '',
        month: this.text(date?.querySelector('.post-date-month')) || '',
        year: this.text(date?.querySelector('.post-date-year')) || '',
        time: this.text(date?.querySelector('.post-date-time')) || ''
      };
    }

    articleRawDate(root, preview = {}) {
      const parts = this.articleDateParts(root);
      const raw = [parts.day, parts.month, parts.year, parts.time].filter(Boolean).join(' ').trim();
      return raw || this.text(root.querySelector('.post-date')) || preview.rawDate || '';
    }

    extractArticleFromPage(preview = {}) {
      const root = document.querySelector('.news-detail, .post-detail, .post-detail-area') || document;
      const rawDate = this.articleRawDate(root, preview);
      const parsedDate = parseBakuWsDateObject(rawDate);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: normalizeBakuWsPostUrl(location.href) || preview.postUrl || '',
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title: this.text(root.querySelector('.post-detail-title h1')) || this.text(root.querySelector('h1')) || preview.title || '',
        text: this.articleText(root),
        rawDate,
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        mediaUrls: this.articleMedia(root),
        scrapedAt: new Date().toISOString()
      };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.parseBakuWsDate = parseBakuWsDate;
  app.parsers.bakuWsDate = parseBakuWsDate;
  app.parsers.bakuWsUrl = normalizeBakuWsPostUrl;
  app.parsers.bakuWsSourceConfig = SOURCE_CONFIG;
  app.scrapers[SOURCE_CONFIG.source] = new BakuWsScraper();
})(globalThis.ScraperApp);
