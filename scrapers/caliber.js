(function initializeCaliberScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: 'caliber.az',
    baseUrl: 'https://caliber.az/',
    author: 'caliber.az',
    authorUrl: 'https://caliber.az/'
  });

  const MONTHS = new Map([
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

  function parseCaliberDateObject(rawText) {
    const raw = String(rawText || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!raw) return null;
    const match = raw.match(/(\d{1,2})\s+([^\d,]+?)\s+(\d{4})\D+(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const month = MONTHS.get(match[2].trim());
    if (month === undefined) return null;
    return validDateParts(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]));
  }

  function parseCaliberDate(rawText) {
    const date = parseCaliberDateObject(rawText);
    return date ? app.utils.formatTimestamp(date) : null;
  }

  function normalizeCaliberUrl(value) {
    try {
      const url = new URL(value || '', SOURCE_CONFIG.baseUrl);
      if (!/(^|\.)caliber\.az$/i.test(url.hostname)) return '';
      url.hash = '';
      url.search = '';
      const result = url.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (error) {
      return '';
    }
  }

  class CaliberScraper extends app.BaseScraper {
    constructor() {
      super(SOURCE_CONFIG.source);
    }

    async ensureReady() {
      return true;
    }

    currentQuery() {
      try {
        const match = location.pathname.match(/^\/search\/(.+?)\/?$/i);
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

    searchButton() {
      return this.visible('.header_button.search_button, .search_button');
    }

    searchInput() {
      return this.visible('.input_block input[type="text"], .input_block input, input[placeholder]');
    }

    searchSubmit(input) {
      return input?.closest('form')?.querySelector('button[type="submit"], button') || null;
    }

    async search(keyword, ctx) {
      await ctx.logger.info(`[caliber.az] Keyword started: ${keyword}`);
      if (!/(^|\.)caliber\.az$/i.test(location.hostname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (this.resultsMatch(keyword)) {
        await ctx.logger.info('[caliber.az] Results loaded');
        return { success: true };
      }
      if (!/^\/?$/i.test(location.pathname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }

      const button = this.searchButton();
      if (button) {
        await ctx.navigation.click(button, 'caliber.az search button');
        await ctx.logger.info('[caliber.az] Search button clicked');
        await ctx.logger.info('[caliber.az] Search opened');
      } else {
        await ctx.logger.warn('[caliber.az] Search button was not found');
      }

      const input = await app.utils.waitFor(() => this.searchInput(), {
        timeoutMs: 7000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!input) {
        const fallbackUrl = this.searchUrl(keyword);
        await ctx.logger.warn('[caliber.az] Search input was not found; using fallback URL', fallbackUrl);
        window.location.assign(fallbackUrl);
        return { success: false, navigating: true };
      }

      await ctx.logger.info('[caliber.az] Search input found');
      const typed = await ctx.navigation.type(input, keyword, 'caliber.az search input');
      if (typed) {
        await ctx.logger.info('[caliber.az] Keyword typed');
        let submitted = await ctx.navigation.pressEnter(input, () => this.resultsMatch(keyword), 'caliber.az search input');
        if (!submitted) {
          const submit = this.searchSubmit(input);
          if (submit) submitted = await ctx.navigation.click(submit, 'caliber.az search submit');
          if (submitted) {
            submitted = !!(await app.utils.waitFor(() => this.resultsMatch(keyword), {
              timeoutMs: 7000,
              intervalMs: 300,
              token: ctx.token
            }));
          }
        }
        if (submitted || this.resultsMatch(keyword)) {
          await ctx.logger.info('[caliber.az] Search submitted');
          await ctx.logger.info('[caliber.az] Results loaded');
          return { success: true };
        }
      }

      const fallbackUrl = this.searchUrl(keyword);
      await ctx.logger.warn('[caliber.az] UI search failed; using fallback URL', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true };
    }

    sourceUrl(value) {
      return normalizeCaliberUrl(value);
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

    backgroundImageUrl(element) {
      const values = [
        element?.style?.backgroundImage || '',
        element?.getAttribute?.('style') || '',
        globalThis.getComputedStyle?.(element)?.backgroundImage || ''
      ];
      for (const value of values) {
        const match = String(value || '').match(/url\((['"]?)(.*?)\1\)/i);
        if (match) {
          const url = this.mediaUrl(match[2]);
          if (url) return url;
        }
      }
      return '';
    }

    extractResultCandidate(element, index) {
      const link = element.querySelector('a[href]');
      const postUrl = this.sourceUrl(link?.getAttribute('href') || link?.href);
      if (!postUrl) return null;
      return {
        index,
        postUrl,
        title: this.text(element.querySelector('.float_block_title')) || this.text(link) || '',
        previewImage: this.backgroundImageUrl(element.querySelector('.float_block_image')),
        rawDate: this.text(element.querySelector('.float_block_time')) || ''
      };
    }

    resultCandidates() {
      const seen = new Set();
      return this.allVisible('.float_block')
        .map((element, index) => this.extractResultCandidate(element, index + 1))
        .filter((candidate) => {
          if (!candidate || seen.has(candidate.postUrl)) return false;
          seen.add(candidate.postUrl);
          return true;
        });
    }

    async scrollForMore(ctx, beforeCount) {
      ctx.token.throwIfCancelled();
      await ctx.logger.info('[caliber.az] Scrolling for more results');
      window.scrollBy({ top: Math.max(window.innerHeight * 1.5, 900), behavior: 'smooth' });
      const loaded = await app.utils.waitFor(() => this.resultCandidates().length > beforeCount, {
        timeoutMs: 12000,
        intervalMs: 350,
        token: ctx.token
      });
      const afterCount = this.resultCandidates().length;
      if (!loaded || afterCount <= beforeCount) {
        await ctx.logger.info('[caliber.az] No more results');
        return false;
      }
      await ctx.logger.info(`[caliber.az] New cards loaded: ${afterCount - beforeCount}`);
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
      await ctx.logger.info(`[caliber.az] Opening article ${ordinal}/${total}: ${candidate.postUrl}`);
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
      const parsedDate = article.postDate ? new Date(article.postDate) : parseCaliberDateObject(rawDate);
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
        const allCandidates = this.resultCandidates();
        const candidates = allCandidates.filter((candidate) => !visited.has(candidate.postUrl));
        await ctx.logger.info(`[caliber.az] Result cards found: ${candidates.length}`);
        for (let index = 0; index < candidates.length; index++) {
          ctx.token.throwIfCancelled();
          const candidate = candidates[index];
          visited.add(candidate.postUrl);
          try {
            const article = await this.openArticleInNewTab(candidate, ctx, index + 1, candidates.length);
            const post = this.buildPost(candidate, article);
            await ctx.logger.info(`[caliber.az] Title extracted: ${article.title || candidate.title || ''}`);
            await ctx.logger.info(`[caliber.az] Date raw: ${article.rawDate || candidate.rawDate || ''}`);
            await ctx.logger.info(`[caliber.az] Date parsed: ${post.postDate || 'null'}`);
            await ctx.logger.info(`[caliber.az] Text length: ${String(post.text || '').length}`);
            await ctx.logger.info(`[caliber.az] Media URLs: ${post.mediaUrls.length}`);
            const outcome = await ctx.onPost(post);
            if (outcome.accepted) await ctx.logger.info(`[caliber.az] Saved: ${post.postUrl}`);
            if (outcome.limitReached) {
              await ctx.logger.info('[caliber.az] Keyword finished: target');
              return { reason: 'target' };
            }
            if (outcome.older) {
              await ctx.logger.info('[caliber.az] Keyword finished: date-limit');
              return { reason: 'date-limit' };
            }
          } catch (error) {
            if (error instanceof app.utils.CancellationError) throw error;
            await ctx.logger.warn('[caliber.az] Article skipped after scraping error', `${candidate.postUrl}: ${error.message}`);
          }
        }
        if (!(await this.scrollForMore(ctx, allCandidates.length))) break;
      }
      await ctx.logger.info('[caliber.az] Keyword finished: exhausted');
      return { reason: 'exhausted' };
    }

    excludedArticleNode(element) {
      return !!element?.closest?.('script, iframe, .ad, .ads, .banner, .signature, .social, .progress, .subscribe, .share, .views');
    }

    articleText(root = document) {
      return Array.from(root.querySelectorAll('.post_body p'))
        .filter((paragraph) => app.utils.isVisible(paragraph) && !this.excludedArticleNode(paragraph))
        .map((paragraph) => this.text(paragraph))
        .filter(Boolean)
        .join('\n\n');
    }

    articleMedia(root = document) {
      const urls = [this.backgroundImageUrl(root.querySelector('.post_cover'))];
      root.querySelectorAll('.post_body img[src], video[src], source[src], audio[src]')
        .forEach((media) => {
          if (!this.excludedArticleNode(media)) urls.push(this.mediaUrl(media.currentSrc || media.src || media.getAttribute('src')));
        });
      return unique(urls);
    }

    extractArticleFromPage(preview = {}) {
      const root = document.querySelector('.post') || document;
      const rawDate = this.text(root.querySelector('.post_time')) || preview.rawDate || '';
      const parsedDate = parseCaliberDateObject(rawDate);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: normalizeCaliberUrl(location.href) || preview.postUrl || '',
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title: this.text(root.querySelector('.post_title')) || this.text(root.querySelector('.post h1, h1')) || preview.title || '',
        text: this.articleText(root),
        rawDate,
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        mediaUrls: this.articleMedia(root),
        scrapedAt: new Date().toISOString()
      };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.parseCaliberDate = parseCaliberDate;
  app.parsers.caliberDate = parseCaliberDate;
  app.parsers.caliberUrl = normalizeCaliberUrl;
  app.parsers.caliberSourceConfig = SOURCE_CONFIG;
  app.scrapers[SOURCE_CONFIG.source] = new CaliberScraper();
})(globalThis.ScraperApp);
