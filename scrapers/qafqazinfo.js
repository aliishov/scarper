(function initializeQafqazinfoScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: 'qafqazinfo.az',
    baseUrl: 'https://qafqazinfo.az/',
    author: 'qafqazinfo.az',
    authorUrl: 'https://qafqazinfo.az/'
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

  function parseQafqazinfoDateObject(rawText) {
    const raw = String(rawText || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const match = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*\|\s*(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    return validDateParts(year, second - 1, first, hour, minute)
      || validDateParts(year, first - 1, second, hour, minute);
  }

  function parseQafqazinfoDate(rawText) {
    const date = parseQafqazinfoDateObject(rawText);
    return date ? app.utils.formatTimestamp(date) : null;
  }

  function normalizeQafqazinfoUrl(value) {
    try {
      const url = new URL(value || '', SOURCE_CONFIG.baseUrl);
      if (!/(^|\.)qafqazinfo\.az$/i.test(url.hostname)) return '';
      url.hash = '';
      const result = url.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (error) {
      return '';
    }
  }

  function normalizeQafqazinfoPostUrl(value) {
    const url = normalizeQafqazinfoUrl(value);
    if (!/\/news\/detail\//i.test(url)) return '';
    try {
      const parsed = new URL(url);
      parsed.search = '';
      return parsed.toString().replace(/\/$/, '');
    } catch (error) {
      return '';
    }
  }

  class QafqazinfoScraper extends app.BaseScraper {
    constructor() {
      super(SOURCE_CONFIG.source);
    }

    async ensureReady() {
      return true;
    }

    currentQuery() {
      try { return app.utils.normalizeText(new URL(location.href).searchParams.get('keyword')); } catch (error) { return ''; }
    }

    resultsMatch(keyword) {
      return /^\/news\/search\/?$/i.test(location.pathname) && this.currentQuery() === app.utils.normalizeText(keyword);
    }

    searchUrl(keyword) {
      return `${SOURCE_CONFIG.baseUrl}news/search?keyword=${encodeURIComponent(String(keyword || ''))}`;
    }

    searchInput() {
      return this.visible('#frmSearch input[name="keyword"], input[name="keyword"][placeholder="Axtar"], .navbar-form input[name="keyword"]');
    }

    async search(keyword, ctx) {
      await ctx.logger.info(`[qafqazinfo.az] Keyword started: ${keyword}`);
      if (!/(^|\.)qafqazinfo\.az$/i.test(location.hostname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (this.resultsMatch(keyword)) {
        await ctx.logger.info('[qafqazinfo.az] Results loaded');
        return { success: true };
      }
      if (!/^\/?$/i.test(location.pathname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }

      const input = await app.utils.waitFor(() => this.searchInput(), {
        timeoutMs: 7000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!input) {
        const fallbackUrl = this.searchUrl(keyword);
        await ctx.logger.warn('[qafqazinfo.az] Search input was not found; using fallback URL', fallbackUrl);
        window.location.assign(fallbackUrl);
        return { success: false, navigating: true };
      }

      await ctx.logger.info('[qafqazinfo.az] Search input found');
      const typed = await ctx.navigation.type(input, keyword, 'qafqazinfo.az search input');
      if (typed) {
        await ctx.logger.info('[qafqazinfo.az] Keyword typed');
        let submitted = await ctx.navigation.pressEnter(input, () => this.resultsMatch(keyword), 'qafqazinfo.az search input');
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
          await ctx.logger.info('[qafqazinfo.az] Search submitted');
          await ctx.logger.info('[qafqazinfo.az] Results loaded');
          return { success: true };
        }
      }

      const fallbackUrl = this.searchUrl(keyword);
      await ctx.logger.warn('[qafqazinfo.az] UI search failed; using fallback URL', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true };
    }

    sourceUrl(value) {
      return normalizeQafqazinfoPostUrl(value);
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

    extractResultCandidate(link, index) {
      const postUrl = this.sourceUrl(link?.getAttribute('href') || link?.href);
      if (!postUrl) return null;
      const root = link.closest('.col-lg-4, .col-md-4, .col-sm-4, .col-xs-12') || link;
      return {
        index,
        postUrl,
        title: this.text(link.querySelector('h4.hemcinin, .hemcinin')) || this.text(link) || '',
        previewImage: this.imageUrl(root.querySelector('a[href*="/news/detail/"] img[src], img[src]')),
        rawDate: ''
      };
    }

    resultCandidates() {
      const seen = new Set();
      return this.allVisible('a[href*="/news/detail/"]')
        .map((link, index) => this.extractResultCandidate(link, index + 1))
        .filter((candidate) => {
          if (!candidate || seen.has(candidate.postUrl)) return false;
          seen.add(candidate.postUrl);
          return true;
        });
    }

    currentPageNumber() {
      try {
        const page = Number(new URL(location.href).searchParams.get('page') || 1);
        return Number.isFinite(page) && page > 0 ? page : 1;
      } catch (error) {
        return 1;
      }
    }

    pageNumberFromUrl(value) {
      try {
        const page = Number(new URL(value, location.href).searchParams.get('page') || 1);
        return Number.isFinite(page) && page > 0 ? page : 1;
      } catch (error) {
        return 1;
      }
    }

    normalizePageUrl(value) {
      return normalizeQafqazinfoUrl(value);
    }

    nextPageUrl(visitedPageUrls = new Set()) {
      const currentPage = this.currentPageNumber();
      const nextLink = this.visible('.yiiPager li.next a[href]');
      const nextUrl = this.normalizePageUrl(nextLink?.getAttribute('href') || nextLink?.href);
      if (nextUrl && this.pageNumberFromUrl(nextUrl) > currentPage && !visitedPageUrls.has(nextUrl)) return nextUrl;

      const numbered = this.allVisible('.yiiPager li.page a[href]')
        .map((link) => {
          const url = this.normalizePageUrl(link.getAttribute('href') || link.href);
          return { url, page: this.pageNumberFromUrl(url) };
        })
        .filter((item) => item.url && item.page > currentPage && !visitedPageUrls.has(item.url))
        .sort((a, b) => a.page - b.page);
      return numbered[0]?.url || '';
    }

    async moveToNextPage(ctx, visitedPageUrls) {
      const nextUrl = this.nextPageUrl(visitedPageUrls);
      if (!nextUrl) {
        await ctx.logger.info('[qafqazinfo.az] No next page');
        return { moved: false };
      }
      if (visitedPageUrls.has(nextUrl)) {
        await ctx.logger.info('[qafqazinfo.az] Next page already visited; stopping pagination');
        return { moved: false };
      }
      await ctx.logger.info(`[qafqazinfo.az] Moving to next page: ${nextUrl}`);
      window.location.assign(nextUrl);
      return { moved: true, navigating: true };
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
      await ctx.logger.info(`[qafqazinfo.az] Opening article: ${candidate.postUrl}`);
      await ctx.logger.info(`[qafqazinfo.az] Opening article ${ordinal}/${total}: ${candidate.postUrl}`);
      const response = await this.sendRuntimeMessage({
        action: 'news:openArticleTab',
        runId: ctx.runId,
        source: SOURCE_CONFIG.source,
        url: candidate.postUrl,
        preview: candidate
      }, ctx.token);
      if (!response?.success) throw new Error(response?.error || 'Article tab scraping failed');
      await ctx.logger.info('[qafqazinfo.az] Article tab closed');
      return response.article || {};
    }

    buildPost(candidate, article) {
      const rawDate = article.rawDate || candidate.rawDate || '';
      const parsedDate = article.postDate ? new Date(article.postDate) : parseQafqazinfoDateObject(rawDate);
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
      const visitedPosts = new Set();
      const visitedPageUrls = new Set();
      while (true) {
        ctx.token.throwIfCancelled();
        const pageUrl = this.normalizePageUrl(location.href);
        if (visitedPageUrls.has(pageUrl)) {
          await ctx.logger.info('[qafqazinfo.az] Next page already visited; stopping pagination');
          break;
        }
        visitedPageUrls.add(pageUrl);
        await ctx.logger.info(`[qafqazinfo.az] Results page: ${this.currentPageNumber()}`);
        const candidates = this.resultCandidates().filter((candidate) => !visitedPosts.has(candidate.postUrl));
        await ctx.logger.info(`[qafqazinfo.az] Result cards found: ${candidates.length}`);
        await ctx.logger.info(`[qafqazinfo.az] Cards found: ${candidates.length}`);
        for (let index = 0; index < candidates.length; index++) {
          ctx.token.throwIfCancelled();
          const candidate = candidates[index];
          visitedPosts.add(candidate.postUrl);
          try {
            const article = await this.openArticleInNewTab(candidate, ctx, index + 1, candidates.length);
            const post = this.buildPost(candidate, article);
            await ctx.logger.info(`[qafqazinfo.az] Title extracted: ${article.title || candidate.title || ''}`);
            await ctx.logger.info(`[qafqazinfo.az] Date raw: ${article.rawDate || candidate.rawDate || ''}`);
            await ctx.logger.info(`[qafqazinfo.az] Date parsed: ${post.postDate || 'null'}`);
            await ctx.logger.info(`[qafqazinfo.az] Text length: ${String(post.text || '').length}`);
            await ctx.logger.info(`[qafqazinfo.az] Media URLs: ${post.mediaUrls.length}`);
            const outcome = await ctx.onPost(post);
            if (outcome.accepted) await ctx.logger.info(`[qafqazinfo.az] Saved: ${post.postUrl}`);
            if (outcome.limitReached) {
              await ctx.logger.info('[qafqazinfo.az] Keyword finished: target');
              return { reason: 'target' };
            }
            if (outcome.older) {
              await ctx.logger.info('[qafqazinfo.az] Keyword finished: date-limit');
              return { reason: 'date-limit' };
            }
          } catch (error) {
            if (error instanceof app.utils.CancellationError) throw error;
            await ctx.logger.warn('[qafqazinfo.az] Article skipped after scraping error', `${candidate.postUrl}: ${error.message}`);
          }
        }
        const next = await this.moveToNextPage(ctx, visitedPageUrls);
        if (next.navigating) return { navigating: true };
        if (!next.moved) break;
      }
      await ctx.logger.info('[qafqazinfo.az] Keyword finished: exhausted');
      return { reason: 'exhausted' };
    }

    excludedArticleNode(element) {
      return !!element?.closest?.('script, iframe, .banner, .banners, .social-buttons, .social, .views, .category');
    }

    articleText(root = document) {
      return Array.from(root.querySelectorAll('.panel-body.news_text p, .news_text p'))
        .filter((paragraph) => app.utils.isVisible(paragraph) && !this.excludedArticleNode(paragraph))
        .map((paragraph) => this.text(paragraph))
        .filter(Boolean)
        .join('\n\n');
    }

    articleMedia(root = document) {
      const urls = [];
      root.querySelectorAll('.panel-body > img.img-responsive[src], .news_text img[src], video[src], source[src], audio[src]')
        .forEach((media) => {
          if (!this.excludedArticleNode(media)) urls.push(this.mediaUrl(media.currentSrc || media.src || media.getAttribute('src')));
        });
      return unique(urls);
    }

    articleRawDate(root, preview = {}) {
      const time = root.querySelector('.news-time time, time[datetime]');
      const textDate = this.text(time);
      if (parseQafqazinfoDateObject(textDate)) return textDate;
      const attrDate = time?.getAttribute?.('datetime') || '';
      return attrDate || preview.rawDate || '';
    }

    extractArticleFromPage(preview = {}) {
      const root = document.querySelector('.panel-body') || document;
      const rawDate = this.articleRawDate(root, preview);
      const parsedDate = parseQafqazinfoDateObject(rawDate);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: normalizeQafqazinfoPostUrl(location.href) || preview.postUrl || '',
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title: this.text(root.querySelector('.panel-body > h1, h1')) || preview.title || '',
        text: this.articleText(root),
        rawDate,
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        mediaUrls: this.articleMedia(root),
        scrapedAt: new Date().toISOString()
      };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.parseQafqazinfoDate = parseQafqazinfoDate;
  app.parsers.qafqazinfoDate = parseQafqazinfoDate;
  app.parsers.qafqazinfoUrl = normalizeQafqazinfoPostUrl;
  app.parsers.qafqazinfoSourceConfig = SOURCE_CONFIG;
  app.scrapers[SOURCE_CONFIG.source] = new QafqazinfoScraper();
})(globalThis.ScraperApp);
