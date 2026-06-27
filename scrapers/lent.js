(function initializeLentScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: 'lent.az',
    baseUrl: 'https://lent.az/',
    author: 'lent.az',
    authorUrl: 'https://lent.az/'
  });

  const MONTHS = new Map([
    ['yanvar', 0],
    ['fevral', 1],
    ['mart', 2],
    ['aprel', 3],
    ['may', 4],
    ['iyun', 5],
    ['iyul', 6],
    ['avqust', 7],
    ['sentyabr', 8],
    ['oktyabr', 9],
    ['noyabr', 10],
    ['dekabr', 11]
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

  function parseDateLimitObject(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return validDateParts(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0);
  }

  function lentSearchType(dateLimit, now = new Date()) {
    const limit = parseDateLimitObject(dateLimit);
    if (!limit) return '4';
    const oneWeek = new Date(now);
    oneWeek.setDate(oneWeek.getDate() - 7);
    if (limit.getTime() >= oneWeek.getTime()) return '1';
    const oneMonth = new Date(now);
    oneMonth.setMonth(oneMonth.getMonth() - 1);
    if (limit.getTime() >= oneMonth.getTime()) return '2';
    const sixMonths = new Date(now);
    sixMonths.setMonth(sixMonths.getMonth() - 6);
    if (limit.getTime() >= sixMonths.getTime()) return '3';
    return '4';
  }

  function parseLentDateObject(rawText) {
    const raw = String(rawText || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!raw) return null;
    const match = raw.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const month = MONTHS.get(match[2]);
    if (month === undefined) return null;
    return validDateParts(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]));
  }

  function parseLentDate(rawText) {
    const date = parseLentDateObject(rawText);
    return date ? app.utils.formatTimestamp(date) : null;
  }

  function normalizeLentUrl(value) {
    try {
      const url = new URL(value || '', SOURCE_CONFIG.baseUrl);
      if (!/(^|\.)lent\.az$/i.test(url.hostname)) return '';
      url.hash = '';
      const result = url.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (error) {
      return '';
    }
  }

  function normalizeLentPostUrl(value) {
    const url = normalizeLentUrl(value);
    if (!url || /\/axtaris-neticesi/i.test(url)) return '';
    try {
      const parsed = new URL(url);
      parsed.search = '';
      return parsed.toString().replace(/\/$/, '');
    } catch (error) {
      return '';
    }
  }

  class LentScraper extends app.BaseScraper {
    constructor() {
      super(SOURCE_CONFIG.source);
    }

    async ensureReady() {
      return true;
    }

    currentQuery() {
      try { return app.utils.normalizeText(new URL(location.href).searchParams.get('search')); } catch (error) { return ''; }
    }

    currentType() {
      try { return String(new URL(location.href).searchParams.get('type') || ''); } catch (error) { return ''; }
    }

    resultsMatch(keyword, type = '') {
      if (!/^\/axtaris-neticesi\/?$/i.test(location.pathname)) return false;
      if (this.currentQuery() !== app.utils.normalizeText(keyword)) return false;
      return !type || this.currentType() === String(type);
    }

    searchUrl(keyword, type = '4') {
      return `${SOURCE_CONFIG.baseUrl}axtaris-neticesi?search=${encodeURIComponent(String(keyword || ''))}&type=${encodeURIComponent(String(type || '4'))}`;
    }

    searchButton() {
      return this.visible('#search_btn, button[aria-label="Search"]');
    }

    searchInput() {
      return this.visible('form[action*="axtaris-neticesi"] input[name="search"], input[name="search"]#search, input[name="search"]');
    }

    searchTypeSelect() {
      return this.visible('form[action*="axtaris-neticesi"] select[name="type"], select[name="type"]');
    }

    searchSubmit(input) {
      return input?.closest('form')?.querySelector('.btn_search, button[type="submit"], button') || this.visible('.btn_search');
    }

    setNativeValue(element, value) {
      if (!element) return false;
      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    async selectSearchType(type, ctx) {
      const select = await app.utils.waitFor(() => this.searchTypeSelect(), {
        timeoutMs: 5000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!select) {
        await ctx.logger.warn('[lent.az] Search type select was not found');
        return false;
      }
      this.setNativeValue(select, String(type));
      await ctx.logger.info(`[lent.az] Search type selected: ${type}`);
      await ctx.logger.info(`[lent.az] Selected search type: ${type}`);
      return true;
    }

    async search(keyword, ctx) {
      await ctx.logger.info(`[lent.az] Keyword started: ${keyword}`);
      const type = lentSearchType(ctx.state?.dateLimit);
      if (ctx.state?.dateLimit) await ctx.logger.info('[lent.az] Date limit enabled');
      await ctx.logger.info(`[lent.az] Selected search type: ${type}`);
      if (!/(^|\.)lent\.az$/i.test(location.hostname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }
      if (this.resultsMatch(keyword, type)) {
        await ctx.logger.info('[lent.az] Results loaded');
        return { success: true };
      }
      if (!/^\/?$/i.test(location.pathname)) {
        window.location.assign(SOURCE_CONFIG.baseUrl);
        return { success: false, navigating: true };
      }

      const button = this.searchButton();
      if (button) {
        await ctx.navigation.click(button, 'lent.az search button');
        await ctx.logger.info('[lent.az] Search modal opened');
      } else {
        await ctx.logger.warn('[lent.az] Search button was not found');
      }

      const input = await app.utils.waitFor(() => this.searchInput(), {
        timeoutMs: 7000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!input) {
        const fallbackUrl = this.searchUrl(keyword, type);
        await ctx.logger.warn('[lent.az] Search input was not found; using fallback URL', fallbackUrl);
        window.location.assign(fallbackUrl);
        return { success: false, navigating: true };
      }

      const typed = await ctx.navigation.type(input, keyword, 'lent.az search input');
      if (typed) {
        await ctx.logger.info('[lent.az] Keyword typed');
        await this.selectSearchType(type, ctx);
        const submit = this.searchSubmit(input);
        let submitted = false;
        if (submit) submitted = await ctx.navigation.click(submit, 'lent.az search submit');
        if (!submitted) {
          const form = input.closest('form');
          if (form) {
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            submitted = true;
          }
        }
        if (submitted) {
          const confirmed = await app.utils.waitFor(() => this.resultsMatch(keyword, type), {
            timeoutMs: 8000,
            intervalMs: 300,
            token: ctx.token
          });
          if (confirmed) {
            await ctx.logger.info('[lent.az] Search submitted');
            await ctx.logger.info('[lent.az] Results loaded');
            return { success: true };
          }
        }
      }

      const fallbackUrl = this.searchUrl(keyword, type);
      await ctx.logger.warn('[lent.az] UI search failed; using fallback URL', fallbackUrl);
      window.location.assign(fallbackUrl);
      return { success: false, navigating: true };
    }

    sourceUrl(value) {
      return normalizeLentPostUrl(value);
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

    isAdCard(element) {
      return !!element?.closest?.('.item.rek_item, .rek_item, .rek_baner_mobile, .custom-banner');
    }

    rawDateFromOverlay(overlay) {
      const parts = Array.from(overlay?.querySelectorAll?.('span') || [])
        .map((node) => this.text(node))
        .filter(Boolean);
      if (!parts.length) return this.text(overlay);
      if (parts.length === 1) return parts[0];
      const time = parts.find((part) => /\d{1,2}:\d{2}/.test(part)) || '';
      const date = parts.find((part) => MONTHS.has(app.utils.normalizeText(part).split(/\s+/)[1])) || '';
      return date && time ? `${date} ${time}` : parts.join(' ');
    }

    extractResultCandidate(card, index) {
      if (this.isAdCard(card)) return null;
      const overlay = card.querySelector('.item_head .overlay[href], a.overlay[href]');
      const titleLink = card.querySelector('.item_foot .title[href], a.title[href]');
      const postUrl = this.sourceUrl(overlay?.getAttribute('href') || overlay?.href || titleLink?.getAttribute('href') || titleLink?.href);
      if (!postUrl) return null;
      return {
        index,
        postUrl,
        title: this.text(card.querySelector('.title h3, a.title h3')) || this.text(titleLink) || '',
        previewImage: this.imageUrl(card.querySelector('.item_head img[src], img[src]')),
        rawDate: this.rawDateFromOverlay(overlay)
      };
    }

    resultCandidatesSnapshot() {
      const seen = new Set();
      const candidates = [];
      let adSkipped = 0;
      for (const card of this.allVisible('.item[id^="news_"][data-id], .item:not(.rek_item)')) {
        if (this.isAdCard(card)) {
          adSkipped++;
          continue;
        }
        const candidate = this.extractResultCandidate(card, candidates.length + 1);
        if (!candidate || seen.has(candidate.postUrl)) continue;
        seen.add(candidate.postUrl);
        candidates.push(candidate);
      }
      return { candidates, adSkipped };
    }

    resultCandidates() {
      return this.resultCandidatesSnapshot().candidates;
    }

    resultSignature() {
      return this.resultCandidates().map((candidate) => candidate.postUrl).join('|');
    }

    currentPageNumber() {
      const active = this.visible('.pagination li.active_li span');
      const number = Number(this.text(active) || '');
      if (Number.isFinite(number) && number > 0) return number;
      try {
        const page = Number(new URL(location.href).searchParams.get('page') || 1);
        return Number.isFinite(page) && page > 0 ? page : 1;
      } catch (error) {
        return 1;
      }
    }

    normalizePageUrl(value) {
      return normalizeLentUrl(value);
    }

    nextPageLink(currentPage = this.currentPageNumber()) {
      const targetPage = currentPage + 1;
      return this.allVisible('.pagination li a[href]')
        .find((link) => Number(this.text(link)) === targetPage)
        || this.visible('.pagination a[rel="next"][href]');
    }

    async waitForPageUpdate(ctx, beforeUrl, beforeSignature, targetPage) {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        ctx.token.throwIfCancelled();
        const currentUrl = this.normalizePageUrl(location.href);
        const signature = this.resultSignature();
        const pageReached = this.currentPageNumber() === targetPage || /[?&]page=/.test(currentUrl);
        if (document.readyState === 'complete' && this.resultCandidates().length && (currentUrl !== beforeUrl || signature !== beforeSignature || pageReached)) {
          await ctx.logger.info(`[lent.az] Results page ${targetPage} loaded`);
          return true;
        }
        await app.utils.sleep(500, ctx.token);
      }
      await ctx.logger.warn(`[lent.az] Results page ${targetPage} was not confirmed before timeout`);
      return false;
    }

    async moveToNextPage(ctx, visitedPageUrls) {
      const currentPage = this.currentPageNumber();
      const targetPage = currentPage + 1;
      const link = this.nextPageLink(currentPage);
      if (!link) return { moved: false };
      const nextUrl = this.normalizePageUrl(link.getAttribute('href') || link.href);
      if (!nextUrl || visitedPageUrls.has(nextUrl)) return { moved: false };
      await ctx.logger.info(`[lent.az] Moving to page ${targetPage}`);
      const beforeUrl = this.normalizePageUrl(location.href);
      const beforeSignature = this.resultSignature();
      const clicked = await ctx.navigation.click(link, `lent.az page ${targetPage}`);
      if (!clicked) return { moved: false };
      const loaded = await this.waitForPageUpdate(ctx, beforeUrl, beforeSignature, targetPage);
      return loaded ? { moved: true } : { moved: true, navigating: true };
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
      await ctx.logger.info(`[lent.az] Opening article: ${candidate.postUrl}`);
      await ctx.logger.info(`[lent.az] Opening article ${ordinal}/${total}: ${candidate.postUrl}`);
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
      const parsedDate = article.postDate ? new Date(article.postDate) : parseLentDateObject(rawDate);
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
      const visitedPageUrls = new Set();
      while (true) {
        ctx.token.throwIfCancelled();
        const pageUrl = this.normalizePageUrl(location.href);
        if (visitedPageUrls.has(pageUrl)) break;
        visitedPageUrls.add(pageUrl);
        const snapshot = this.resultCandidatesSnapshot();
        if (snapshot.adSkipped) {
          for (let index = 0; index < snapshot.adSkipped; index++) await ctx.logger.info('[lent.az] Ad card skipped');
        }
        const candidates = snapshot.candidates.filter((candidate) => !visitedPosts.has(candidate.postUrl));
        await ctx.logger.info(`[lent.az] News cards found: ${candidates.length}`);
        for (let index = 0; index < candidates.length; index++) {
          ctx.token.throwIfCancelled();
          const candidate = candidates[index];
          visitedPosts.add(candidate.postUrl);
          try {
            const article = await this.openArticleInNewTab(candidate, ctx, index + 1, candidates.length);
            const post = this.buildPost(candidate, article);
            await ctx.logger.info(`[lent.az] Date raw: ${article.rawDate || candidate.rawDate || ''}`);
            await ctx.logger.info(`[lent.az] Date parsed: ${post.postDate || 'null'}`);
            await ctx.logger.info(`[lent.az] Text length: ${String(post.text || '').length}`);
            await ctx.logger.info(`[lent.az] Media URLs: ${post.mediaUrls.length}`);
            const outcome = await ctx.onPost(post);
            if (outcome.accepted) await ctx.logger.info(`[lent.az] Saved: ${post.postUrl}`);
            if (outcome.limitReached) {
              await ctx.logger.info('[lent.az] Keyword finished: target');
              return { reason: 'target' };
            }
            if (outcome.older) {
              await ctx.logger.info('[lent.az] Keyword finished: date-limit');
              return { reason: 'date-limit' };
            }
          } catch (error) {
            if (error instanceof app.utils.CancellationError) throw error;
            await ctx.logger.warn('[lent.az] Article skipped after scraping error', `${candidate.postUrl}: ${error.message}`);
          }
        }
        const next = await this.moveToNextPage(ctx, visitedPageUrls);
        if (next.navigating) return { navigating: true };
        if (!next.moved) break;
      }
      await ctx.logger.info('[lent.az] Keyword finished: exhausted');
      return { reason: 'exhausted' };
    }

    excludedArticleNode(element) {
      return !!element?.closest?.('script, iframe, .ad, .ads, .banner, .related, .tags, .similar, .social, .reaction, .writer, .views, .custom-banner');
    }

    articleText(root = document) {
      return Array.from(root.querySelectorAll('.news_content[itemprop="articleBody"] p, .news_content p'))
        .filter((paragraph) => app.utils.isVisible(paragraph) && !this.excludedArticleNode(paragraph))
        .map((paragraph) => this.text(paragraph))
        .filter(Boolean)
        .join('\n\n');
    }

    articleMedia(root = document) {
      const urls = [];
      root.querySelectorAll('.news_img img[src], .news_content img[src], video[src], source[src], audio[src]')
        .forEach((media) => {
          if (!this.excludedArticleNode(media)) urls.push(this.mediaUrl(media.currentSrc || media.src || media.getAttribute('src')));
        });
      return unique(urls);
    }

    articleRawDate(root, preview = {}) {
      const overlay = root.querySelector('.news_img .overlay');
      return this.rawDateFromOverlay(overlay) || preview.rawDate || '';
    }

    extractArticleFromPage(preview = {}) {
      const root = document.querySelector('#content.left_column, #content, .left_column') || document;
      const rawDate = this.articleRawDate(root, preview);
      const parsedDate = parseLentDateObject(rawDate);
      return {
        source: SOURCE_CONFIG.source,
        postUrl: normalizeLentPostUrl(location.href) || preview.postUrl || '',
        author: SOURCE_CONFIG.author,
        authorUrl: SOURCE_CONFIG.authorUrl,
        title: this.text(root.querySelector('.news_title')) || this.text(root.querySelector('h1')) || preview.title || '',
        text: this.articleText(root),
        rawDate,
        postDate: parsedDate ? app.utils.formatTimestamp(parsedDate) : null,
        mediaUrls: this.articleMedia(root),
        scrapedAt: new Date().toISOString()
      };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.parseLentDate = parseLentDate;
  app.parsers.lentDate = parseLentDate;
  app.parsers.lentSearchType = lentSearchType;
  app.parsers.lentUrl = normalizeLentPostUrl;
  app.parsers.lentSourceConfig = SOURCE_CONFIG;
  app.scrapers[SOURCE_CONFIG.source] = new LentScraper();
})(globalThis.ScraperApp);
