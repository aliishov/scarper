(function initializeOxuScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: 'oxu.az',
    baseUrl: 'https://oxu.az/',
    author: 'oxu.az',
    authorUrl: 'https://oxu.az/'
  });

  const MONTHS = new Map([
    ['yanvar', 0], ['fevral', 1], ['mart', 2], ['aprel', 3],
    ['may', 4], ['iyun', 5], ['iyul', 6], ['avqust', 7],
    ['sentyabr', 8], ['oktyabr', 9], ['noyabr', 10], ['dekabr', 11]
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
      .replace(/\u00f6/g, 'o');
  }

  function timeParts(text) {
    const match = String(text || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return { hour: 0, minute: 0, hasTime: false };
    return { hour: Number(match[1]), minute: Number(match[2]), hasTime: true };
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

  function parseOxuDate(rawText, now = new Date()) {
    const raw = String(rawText || '').replace(/\u00a0/g, ' ').trim();
    if (!raw) return null;
    const folded = foldAzeri(raw);
    const { hour, minute } = timeParts(raw);
    if (folded.includes('bu gun')) {
      return validDateParts(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    }
    if (folded.includes('dunen')) {
      const date = new Date(now);
      date.setDate(date.getDate() - 1);
      return validDateParts(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    }

    let match = folded.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (match) {
      return validDateParts(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hour, minute);
    }

    match = folded.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
    if (!match) return null;
    const month = MONTHS.get(match[2]);
    if (month === undefined) return null;
    const year = match[3] ? Number(match[3]) : now.getFullYear();
    const parsed = validDateParts(year, month, Number(match[1]), hour, minute);
    if (!parsed) return null;
    if (!match[3] && parsed.getTime() > now.getTime() + 86400000) {
      return validDateParts(year - 1, month, Number(match[1]), hour, minute);
    }
    return parsed;
  }

  function normalizeOxuUrl(value) {
    try {
      const url = new URL(value || '', SOURCE_CONFIG.baseUrl);
      if (!/(^|\.)oxu\.az$/i.test(url.hostname)) return '';
      url.hash = '';
      url.search = '';
      const result = url.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (error) {
      return '';
    }
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  class OxuScraper extends app.BaseScraper {
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
      return /^\/all\/?$/i.test(location.pathname) && this.currentQuery() === app.utils.normalizeText(keyword);
    }

    searchInput() {
      return this.visible('form input[name="query"], input[name="query"]');
    }

    searchSubmit(input) {
      return input?.closest('form')?.querySelector('button[type="submit"], button') || null;
    }

    searchUrl(keyword) {
      return `${SOURCE_CONFIG.baseUrl}all?query=${encodeURIComponent(String(keyword || ''))}`;
    }

    async search(keyword, ctx) {
      await ctx.logger.info(`[oxu.az] Keyword started: ${keyword}`);
      if (!/(^|\.)oxu\.az$/i.test(location.hostname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (this.resultsMatch(keyword)) {
        await ctx.logger.info('[oxu.az] Search results loaded');
        return { success: true };
      }

      let submitted = false;
      const button = this.visible('.custom-navbar-search-toggle');
      if (button) {
        await ctx.logger.info('[oxu.az] Search button found');
        await ctx.navigation.click(button, 'Oxu.az search toggle');
        await ctx.logger.info('[oxu.az] Search button clicked');
      } else {
        await ctx.logger.warn('[oxu.az] Search button was not found');
      }

      const input = await app.utils.waitFor(() => this.searchInput(), {
        timeoutMs: 6000,
        intervalMs: 250,
        token: ctx.token
      });
      if (input) {
        await ctx.logger.info('[oxu.az] Search input visible');
        const typed = await ctx.navigation.type(input, keyword, 'Oxu.az search input');
        if (typed) {
          await ctx.logger.info('[oxu.az] Keyword typed');
          submitted = await ctx.navigation.pressEnter(input, () => this.resultsMatch(keyword), 'Oxu.az search input');
          if (!submitted) {
            const submit = this.searchSubmit(input);
            if (submit) submitted = await ctx.navigation.click(submit, 'Oxu.az search submit');
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
        await ctx.logger.info('[oxu.az] Search submitted');
        await ctx.logger.info('[oxu.az] Search results loaded');
        return { success: true };
      }

      const fallbackUrl = this.searchUrl(keyword);
      await ctx.logger.warn('[oxu.az] UI search failed; using fallback URL', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true };
    }

    sourceUrl(value) {
      return normalizeOxuUrl(value);
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
      const titleLink = element.querySelector('.post-item-title a[href], h2 a[href], a[href]');
      const postUrl = this.sourceUrl(element.getAttribute('data-url') || titleLink?.getAttribute('href') || titleLink?.href);
      if (!postUrl) return null;
      const image = element.querySelector('.post-item-img img[src], img[src], img[data-src]');
      const rawDate = this.text(element.querySelector('.post-item-meta')) || '';
      return {
        index,
        postUrl,
        title: this.text(titleLink) || this.text(element.querySelector('.post-item-title')) || '',
        previewImage: this.imageUrl(image),
        rawDate,
        category: this.text(element.querySelector('.post-item-category')) || ''
      };
    }

    resultCandidates() {
      const seen = new Set();
      return this.allVisible('.rt-news-item')
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
        await ctx.logger.info(`[oxu.az] Result candidates found: ${candidates.length}`);
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
      await ctx.logger.info(`[oxu.az] Opening article ${ordinal}/${total}: ${candidate.postUrl}`);
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
      const parsedDate = article.postDate ? new Date(article.postDate) : parseOxuDate(rawDate);
      const mediaUrls = unique([
        ...(article.mediaUrls || []),
        candidate.previewImage
      ]);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: article.postUrl || candidate.postUrl,
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title: article.title || candidate.title,
        text: article.text || '',
        category: article.category || candidate.category,
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
          await ctx.logger.info(`[oxu.az] Article title extracted: ${post.title || ''}`);
          await ctx.logger.info(`[oxu.az] Article date raw: ${article.rawDate || candidate.rawDate || ''}`);
          await ctx.logger.info(`[oxu.az] Article date parsed: ${post.postDate || 'null'}`);
          await ctx.logger.info(`[oxu.az] Article text length: ${String(post.text || '').length}`);
          await ctx.logger.info(`[oxu.az] Media URLs collected: ${post.mediaUrls.length}`);
          const outcome = await ctx.onPost(post);
          if (outcome.accepted) await ctx.logger.info(`[oxu.az] Post saved: ${post.postUrl}`);
          if (outcome.limitReached) {
            await ctx.logger.info('[oxu.az] Keyword finished: target');
            return { reason: 'target' };
          }
          if (outcome.older) {
            await ctx.logger.info('[oxu.az] Keyword finished: date-limit');
            return { reason: 'date-limit' };
          }
        } catch (error) {
          if (error instanceof app.utils.CancellationError) throw error;
          await ctx.logger.warn('[oxu.az] Article skipped after scraping error', `${candidate.postUrl}: ${error.message}`);
        }
      }
      await ctx.logger.info('[oxu.az] Keyword finished: exhausted');
      return { reason: 'exhausted' };
    }

    articleText(root = document) {
      return Array.from(root.querySelectorAll('.post-detail-content-inner.resize-area > p'))
        .filter(app.utils.isVisible)
        .map((paragraph) => this.text(paragraph))
        .filter(Boolean)
        .join('\n\n');
    }

    articleMedia(root = document) {
      const urls = [];
      root.querySelectorAll('.post-detail-img img[src], .post-detail-img img[data-src], .post-detail-content-inner.resize-area img[src], .post-detail-content-inner.resize-area img[data-src]')
        .forEach((image) => urls.push(this.imageUrl(image)));
      root.querySelectorAll('.audio-block[data-url]').forEach((audio) => urls.push(this.mediaUrl(audio.getAttribute('data-url'))));
      return unique(urls);
    }

    extractArticleFromPage(preview = {}) {
      const root = document.querySelector('.post-detail[data-stats-collect="1"], .post-detail') || document;
      const title = this.text(root.querySelector('.post-detail-title h1')) || this.text(root.querySelector('h1')) || preview.title || '';
      const rawDate = this.text(root.querySelector('.post-detail-meta span:first-child')) || preview.rawDate || '';
      const parsedDate = parseOxuDate(rawDate);
      const text = this.articleText(root);
      const category = this.text(root.querySelector('.breadcrumb-item.active a span'))
        || this.text(root.querySelector('.breadcrumb-item.active'))
        || preview.category
        || '';
      return {
        source: SOURCE_CONFIG.source,
        postUrl: normalizeOxuUrl(location.href) || preview.postUrl || '',
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title,
        text,
        category,
        rawDate,
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        mediaUrls: this.articleMedia(root),
        scrapedAt: new Date().toISOString()
      };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.oxuDate = parseOxuDate;
  app.parsers.oxuUrl = normalizeOxuUrl;
  app.parsers.oxuSourceConfig = SOURCE_CONFIG;
  app.scrapers[SOURCE_CONFIG.source] = new OxuScraper();
})(globalThis.ScraperApp);
