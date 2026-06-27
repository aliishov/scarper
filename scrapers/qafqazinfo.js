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

    unsafeSearchArea(element) {
      return !!element?.closest?.([
        '.row.toplinks',
        '.toplinks',
        'header',
        'nav',
        '.navbar',
        '.navbar-form',
        '.ad',
        '.ads',
        '.banner',
        '[class*="reklam" i]',
        '[id*="reklam" i]',
        '[class*="advert" i]',
        '[id*="advert" i]'
      ].join(', '));
    }

    resultCardRoot(link) {
      return link?.closest?.('.col-lg-4, .col-md-4, .col-sm-4, .col-xs-12') || link;
    }

    resultLinks(root) {
      return this.allVisible('a[href*="/news/detail/"]', root);
    }

    validSearchResultLink(link) {
      if (!link || this.unsafeSearchArea(link)) return false;
      const card = this.resultCardRoot(link);
      if (!card || this.unsafeSearchArea(card)) return false;
      return !!link.querySelector('h4.hemcinin, .hemcinin');
    }

    searchResultContainers() {
      const rows = this.allVisible('.row')
        .filter((container) => !this.unsafeSearchArea(container))
        .filter((container) => this.resultLinks(container).some((link) => this.validSearchResultLink(link)));
      if (rows.length) return rows;

      return this.allVisible('main, .container, .container-fluid, .panel-body')
        .filter((container) => !this.unsafeSearchArea(container))
        .filter((container) => this.resultLinks(container).some((link) => this.validSearchResultLink(link)));
    }

    ignoredHeaderArticleUrls() {
      const seen = new Set();
      const urls = [];
      document.querySelectorAll('.row.toplinks a[href*="/news/detail/"], .toplinks a[href*="/news/detail/"], header a[href*="/news/detail/"], nav a[href*="/news/detail/"], .navbar a[href*="/news/detail/"]')
        .forEach((link) => {
          const postUrl = this.sourceUrl(link.getAttribute('href') || link.href);
          if (postUrl && !seen.has(postUrl)) {
            seen.add(postUrl);
            urls.push(postUrl);
          }
        });
      return urls;
    }

    extractResultCandidate(link, index) {
      const postUrl = this.sourceUrl(link?.getAttribute('href') || link?.href);
      if (!postUrl) return null;
      const root = this.resultCardRoot(link);
      return {
        index,
        postUrl,
        title: this.text(link.querySelector('h4.hemcinin, .hemcinin')) || this.text(link) || '',
        previewImage: this.imageUrl(root.querySelector('a[href*="/news/detail/"] img[src], img[src]')),
        rawDate: ''
      };
    }

    resultCandidatesSnapshot() {
      const seen = new Set();
      const candidates = [];
      const skippedHeaderUrls = this.ignoredHeaderArticleUrls();
      const containers = this.searchResultContainers();
      for (const container of containers) {
        for (const link of this.resultLinks(container)) {
          if (!this.validSearchResultLink(link)) {
            const postUrl = this.sourceUrl(link.getAttribute('href') || link.href);
            if (postUrl && this.unsafeSearchArea(link) && !skippedHeaderUrls.includes(postUrl)) skippedHeaderUrls.push(postUrl);
            continue;
          }
          const candidate = this.extractResultCandidate(link, candidates.length + 1);
          if (!candidate || seen.has(candidate.postUrl)) continue;
          seen.add(candidate.postUrl);
          candidates.push(candidate);
        }
      }
      return {
        candidates,
        containerFound: containers.length > 0,
        skippedHeaderUrls: unique(skippedHeaderUrls)
      };
    }

    resultCandidates() {
      return this.resultCandidatesSnapshot().candidates;
    }

    resultSignature() {
      return this.resultCandidates().map((candidate) => candidate.postUrl).join('|');
    }

    paginationMetaKey(name) {
      return `qafqazinfo:${name}`;
    }

    readPaginationMeta(name) {
      try { return sessionStorage.getItem(this.paginationMetaKey(name)) || ''; } catch (error) { return ''; }
    }

    writePaginationMeta(name, value) {
      try { sessionStorage.setItem(this.paginationMetaKey(name), String(value || '')); } catch (error) {}
    }

    clearPaginationMeta() {
      for (const name of ['previousUrl', 'expectedUrl', 'previousSignature']) {
        try { sessionStorage.removeItem(this.paginationMetaKey(name)); } catch (error) {}
      }
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

    nextPageLink(currentPage = this.currentPageNumber()) {
      const targetPage = currentPage + 1;
      return this.allVisible('.yiiPager li.page a[href]')
        .find((link) => Number(this.text(link)) === targetPage) || null;
    }

    nextPageUrl(currentPage = this.currentPageNumber()) {
      const nextLink = this.nextPageLink(currentPage);
      return this.normalizePageUrl(nextLink?.getAttribute('href') || nextLink?.href);
    }

    async waitForResultsPageReady(ctx) {
      await ctx.logger.info('[qafqazinfo.az] Waiting for page load');
      await ctx.logger.info('[qafqazinfo.az] Waiting for page load (timeout 15s)');
      const previousUrl = this.readPaginationMeta('previousUrl');
      const expectedUrl = this.readPaginationMeta('expectedUrl');
      const previousSignature = this.readPaginationMeta('previousSignature');
      const expectedPage = expectedUrl ? this.pageNumberFromUrl(expectedUrl) : 0;
      const minimumReadyAt = expectedUrl ? Date.now() + 5000 : Date.now();
      const deadline = Date.now() + 15000;
      let urlLogged = false;
      let domLogged = false;
      let resultsLogged = false;
      let readySnapshot = null;

      while (Date.now() < deadline) {
        ctx.token.throwIfCancelled();
        const currentUrl = this.normalizePageUrl(location.href);
        const urlChanged = !previousUrl || currentUrl !== previousUrl;
        if (urlChanged && !urlLogged && (previousUrl || expectedUrl)) {
          await ctx.logger.info('[qafqazinfo.az] URL changed');
          urlLogged = true;
        }

        const domComplete = document.readyState === 'complete';
        if (domComplete && !domLogged) {
          await ctx.logger.info('[qafqazinfo.az] DOM fully loaded');
          domLogged = true;
        }

        const snapshot = this.resultCandidatesSnapshot();
        const signature = snapshot.candidates.map((candidate) => candidate.postUrl).join('|');
        const resultsDetected = snapshot.containerFound && snapshot.candidates.length > 0;
        const oldCardsGone = !previousSignature || signature !== previousSignature;
        const expectedReached = !expectedUrl || currentUrl === expectedUrl;
        if (resultsDetected && !resultsLogged) {
          await ctx.logger.info('[qafqazinfo.az] Search results detected');
          resultsLogged = true;
        }

        if (Date.now() >= minimumReadyAt && urlChanged && expectedReached && domComplete && resultsDetected && oldCardsGone) {
          readySnapshot = snapshot;
          break;
        }
        await app.utils.sleep(500, ctx.token);
      }

      if (!readySnapshot) {
        readySnapshot = this.resultCandidatesSnapshot();
        if (!readySnapshot.candidates.length) await ctx.logger.warn('[qafqazinfo.az] Results page was not ready before timeout');
      }
      if (readySnapshot.candidates.length) await ctx.logger.info('[qafqazinfo.az] Results page ready');
      if (readySnapshot.candidates.length && expectedPage) {
        await ctx.logger.info(`[qafqazinfo.az] Results page ${expectedPage} loaded`);
        await ctx.logger.info(`[qafqazinfo.az] Continue scraping page ${expectedPage}`);
      }
      this.clearPaginationMeta();
      return readySnapshot;
    }

    async waitForClickedPageUpdate(ctx, beforeUrl, beforeSignature, targetPage) {
      await ctx.logger.info('[qafqazinfo.az] Waiting for page load');
      const startedAt = Date.now();
      const minimumReadyAt = startedAt + 5000;
      const deadline = startedAt + 15000;
      let urlLogged = false;
      let domLogged = false;
      let resultsLogged = false;
      while (Date.now() < deadline) {
        ctx.token.throwIfCancelled();
        const currentUrl = this.normalizePageUrl(location.href);
        const urlChanged = currentUrl !== beforeUrl;
        if (urlChanged && !urlLogged) {
          await ctx.logger.info('[qafqazinfo.az] URL changed');
          urlLogged = true;
        }
        const domComplete = document.readyState === 'complete';
        if (domComplete && !domLogged) {
          await ctx.logger.info('[qafqazinfo.az] DOM fully loaded');
          domLogged = true;
        }
        const snapshot = this.resultCandidatesSnapshot();
        const signature = snapshot.candidates.map((candidate) => candidate.postUrl).join('|');
        const resultsDetected = snapshot.containerFound && snapshot.candidates.length > 0;
        if (resultsDetected && !resultsLogged) {
          await ctx.logger.info('[qafqazinfo.az] Search results detected');
          resultsLogged = true;
        }
        const pageReached = this.currentPageNumber() === targetPage || this.pageNumberFromUrl(currentUrl) === targetPage;
        const resultsChanged = signature && signature !== beforeSignature;
        if (Date.now() >= minimumReadyAt && domComplete && resultsDetected && (urlChanged || resultsChanged || pageReached)) {
          await ctx.logger.info('[qafqazinfo.az] Results page ready');
          await ctx.logger.info(`[qafqazinfo.az] Results page ${targetPage} loaded`);
          await ctx.logger.info(`[qafqazinfo.az] Continue scraping page ${targetPage}`);
          return true;
        }
        await app.utils.sleep(500, ctx.token);
      }
      await ctx.logger.warn(`[qafqazinfo.az] Results page ${targetPage} was not confirmed before timeout`);
      return false;
    }

    async moveToNextPage(ctx, visitedPageUrls) {
      const currentPage = this.currentPageNumber();
      await ctx.logger.info(`[qafqazinfo.az] Current page: ${currentPage}`);
      const targetPage = currentPage + 1;
      const nextLink = this.nextPageLink(currentPage);
      if (!nextLink) {
        await ctx.logger.info('[qafqazinfo.az] No next page found');
        await ctx.logger.info('[qafqazinfo.az] Pagination finished');
        return { moved: false };
      }
      const nextUrl = this.normalizePageUrl(nextLink.getAttribute('href') || nextLink.href);
      if (!nextUrl) {
        await ctx.logger.info('[qafqazinfo.az] No next page found');
        await ctx.logger.info('[qafqazinfo.az] Pagination finished');
        return { moved: false };
      }
      if (visitedPageUrls.has(nextUrl)) {
        await ctx.logger.info('[qafqazinfo.az] Next page already visited; stopping pagination');
        await ctx.logger.info('[qafqazinfo.az] Pagination finished');
        return { moved: false };
      }
      if (this.pageNumberFromUrl(nextUrl) !== targetPage) {
        await ctx.logger.info('[qafqazinfo.az] No next page found');
        await ctx.logger.info('[qafqazinfo.az] Next page already visited; stopping pagination');
        await ctx.logger.info('[qafqazinfo.az] Pagination finished');
        return { moved: false };
      }
      await ctx.logger.info(`[qafqazinfo.az] Next page found: ${targetPage}`);
      await ctx.logger.info(`[qafqazinfo.az] Next page URL: ${nextUrl}`);
      await ctx.logger.info(`[qafqazinfo.az] Moving to next page: ${nextUrl}`);
      await ctx.logger.info('[qafqazinfo.az] Navigating to next page');
      this.writePaginationMeta('previousUrl', this.normalizePageUrl(location.href));
      this.writePaginationMeta('expectedUrl', nextUrl);
      this.writePaginationMeta('previousSignature', this.resultSignature());
      const beforeUrl = this.normalizePageUrl(location.href);
      const beforeSignature = this.resultSignature();
      await ctx.logger.info(`[qafqazinfo.az] Clicking page ${targetPage}`);
      const clicked = await ctx.navigation.click(nextLink, `qafqazinfo.az page ${targetPage}`);
      if (!clicked) {
        await ctx.logger.warn(`[qafqazinfo.az] Page ${targetPage} click failed`);
        return { moved: false };
      }
      const loadedInCurrentDocument = await this.waitForClickedPageUpdate(ctx, beforeUrl, beforeSignature, targetPage);
      return loadedInCurrentDocument ? { moved: true } : { moved: true, navigating: true };
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
      await this.waitForResultsPageReady(ctx);
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
        const snapshot = this.resultCandidatesSnapshot();
        if (snapshot.containerFound) await ctx.logger.info('[qafqazinfo.az] Search results container found');
        if (snapshot.skippedHeaderUrls.length) {
          await ctx.logger.info('[qafqazinfo.az] Header news skipped');
          for (const postUrl of snapshot.skippedHeaderUrls) {
            await ctx.logger.info(`[qafqazinfo.az] Ignored header article: ${postUrl}`);
          }
        }
        const candidates = snapshot.candidates.filter((candidate) => !visitedPosts.has(candidate.postUrl));
        await ctx.logger.info(`[qafqazinfo.az] Result cards found: ${candidates.length}`);
        await ctx.logger.info(`[qafqazinfo.az] Cards found: ${candidates.length}`);
        for (const candidate of candidates) {
          await ctx.logger.info(`[qafqazinfo.az] Search result accepted: ${candidate.postUrl}`);
        }
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
        await ctx.logger.info('[qafqazinfo.az] Current page processed');
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
