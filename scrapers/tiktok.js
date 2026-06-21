(function initializeTikTokScraper(app) {
  'use strict';

  function videoIdDate(videoId) {
    if (!/^\d{16,22}$/.test(String(videoId || ''))) return null;
    try {
      const seconds = Number(BigInt(videoId) >> 32n);
      const date = new Date(seconds * 1000);
      return date.getFullYear() >= 2016 && date.getTime() <= Date.now() + 300000 ? date : null;
    } catch (error) { return null; }
  }

  function parseTikTokVideoUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, 'https://www.tiktok.com');
      const match = url.pathname.match(/^\/@([^/]+)\/video\/(\d+)/i);
      if (!match) return null;
      const handle = decodeURIComponent(match[1]);
      return {
        postUrl: `https://www.tiktok.com/@${handle}/video/${match[2]}`,
        author: handle,
        authorUrl: `https://www.tiktok.com/@${handle}`,
        videoId: match[2]
      };
    } catch (error) { return null; }
  }

  function cleanTikTokCaption(value, author = '') {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    const quoted = raw.match(/tiktok video from [^:]+:\s*[“"](.+?)[”"]\.?$/i);
    const text = String(quoted?.[1] || raw)
      .replace(/\s*(?:[|·]|\s-\s)\s*TikTok(?:\s*[-|].*)?$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const normalized = app.utils.normalizeText(text);
    if (!normalized || normalized === app.utils.normalizeText(author)) return '';
    if (/^tiktok(?:\s*[-|:]|$)/i.test(text) || /^make your day/i.test(text)) return '';
    return text;
  }

  class TikTokScraper extends app.BaseScraper {
    constructor() {
      super('tiktok');
      this.freshUiConfirmed = false;
    }

    currentQuery() {
      try { return app.utils.normalizeText(new URL(location.href).searchParams.get('q')); } catch (error) { return ''; }
    }

    searchInput() {
      return this.visible('[data-e2e="search-user-input"], input[type="search"], [role="search"] input, input[placeholder*="Search" i], input[placeholder*="Поиск" i]');
    }

    isVideosRoute() {
      return /^\/search\/video(?:\/|$)/i.test(location.pathname);
    }

    isVideosTabSelected(element) {
      if (this.isVideosRoute()) return true;
      const control = element?.closest('[role="tab"], a, button, [role="button"]') || element;
      if (!control) return false;
      const selectedValues = [
        control.getAttribute('aria-selected'),
        control.getAttribute('aria-current'),
        control.getAttribute('data-state'),
        control.getAttribute('data-active')
      ].map(app.utils.normalizeText);
      return selectedValues.some((value) => /^(true|page|active|selected)$/.test(value));
    }

    videosTab() {
      const patterns = [/^videos$/, /^video$/, /^видео$/];
      const candidates = this.allVisible('[role="tab"], a[href*="/search/video"], button, [role="button"]');
      return candidates.find((element) => {
        const label = app.utils.normalizeText(`${element.getAttribute('aria-label') || ''} ${this.text(element)}`);
        if (label.length > 80 || !patterns.some((pattern) => pattern.test(label))) return false;
        const href = element.closest('a')?.getAttribute('href') || '';
        return !href || /\/search\/video(?:[/?#]|$)/i.test(href);
      }) || null;
    }

    async switchToVideosTab(keyword, ctx) {
      await ctx.logger.info('[tiktok] Search results opened', location.href);
      if (this.isVideosRoute()) {
        await ctx.logger.info('[tiktok] Videos tab confirmed', 'URL already points to /search/video');
        return { success: true };
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        ctx.token.throwIfCancelled();
        await ctx.logger.info('[tiktok] Looking for Videos tab', `attempt=${attempt}/3`);
        const tab = this.videosTab();
        if (!tab) {
          await ctx.logger.warn('[tiktok] Videos tab was not found', `attempt=${attempt}/3`);
          await app.utils.sleep(app.utils.randomInt(900, 1500), ctx.token);
          continue;
        }
        if (this.isVideosTabSelected(tab)) {
          await ctx.logger.info('[tiktok] Videos tab confirmed', 'tab is already selected');
          return { success: true };
        }

        await ctx.logger.info('[tiktok] Click: TikTok Videos tab', `attempt=${attempt}/3`);
        const clicked = await ctx.navigation.click(tab, 'TikTok Videos tab');
        if (clicked) {
          const confirmed = await app.utils.waitFor(() => {
            const currentTab = this.videosTab();
            return this.isVideosRoute() || this.isVideosTabSelected(currentTab);
          }, { timeoutMs: 5000, intervalMs: 250, token: ctx.token });
          if (confirmed) {
            await ctx.logger.info('[tiktok] Videos tab confirmed', location.href);
            return { success: true };
          }
        }
        await ctx.logger.warn('[tiktok] Videos tab click was not confirmed', `attempt=${attempt}/3`);
        await app.utils.sleep(app.utils.randomInt(900, 1500), ctx.token);
      }

      await ctx.logger.warn('[tiktok] Videos tab UI attempts failed; waiting before URL fallback');
      await app.utils.sleep(5000, ctx.token);
      if (this.isVideosRoute()) {
        await ctx.logger.info('[tiktok] Videos tab confirmed', 'route changed during fallback delay');
        return { success: true };
      }
      const fallbackUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`;
      await ctx.logger.warn(`[tiktok] Using last-resort Videos URL fallback: ${fallbackUrl}`);
      window.location.assign(fallbackUrl);
      return { success: false, fallback: true, navigating: true };
    }

    async search(keyword, ctx) {
      if (!(location.pathname.includes('/search') && this.currentQuery() === app.utils.normalizeText(keyword))) {
        const result = await ctx.navigation.search({
          platform: 'TikTok',
          keyword,
          findInput: () => this.searchInput(),
          openSearch: async () => {
            const control = this.visible('[data-e2e="search-button"], button[aria-label*="Search" i], [role="button"][aria-label*="Search" i]');
            if (control) await ctx.navigation.click(control, 'TikTok Search');
          },
          verify: () => location.pathname.includes('/search') && this.currentQuery() === app.utils.normalizeText(keyword),
          clickSearchButton: async () => {
            const button = this.visible('[data-e2e="search-box-button"], form button[type="submit"]');
            return button ? ctx.navigation.click(button, 'TikTok Search submit') : false;
          },
          fallbackUrl: () => `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`
        });
        if (result.navigating) return result;
      } else {
        await ctx.logger.info('Existing TikTok results match keyword');
      }
      const videosResult = await this.switchToVideosTab(keyword, ctx);
      if (videosResult.navigating) return videosResult;
      await this.tryFreshUi(ctx);
      return { success: true };
    }

    async tryFreshUi(ctx) {
      const sortButton = this.findTextControl([/^sort$/, /^sort by$/, /^сортировка$/, /^сортировать$/]);
      if (!sortButton) {
        this.freshUiConfirmed = false;
        await ctx.logger.info('TikTok has no explicit sort control; video IDs will be used for newest-first ordering');
        return false;
      }
      await ctx.navigation.click(sortButton, 'TikTok Sort menu');
      const newest = await app.utils.waitFor(() => this.findTextControl([/^most recent$/, /^newest$/, /^latest$/, /^сначала новые$/, /^недавние$/]), {
        timeoutMs: 3000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!newest) {
        await ctx.logger.warn('TikTok newest sort option not found; local sorting will be used');
        return false;
      }
      await ctx.navigation.click(newest, 'TikTok Most recent');
      this.freshUiConfirmed = true;
      await ctx.logger.info('TikTok newest sort selected in UI');
      return true;
    }

    videoInfo(link) {
      const parsed = parseTikTokVideoUrl(link.href);
      return parsed ? { ...parsed, handle: parsed.author } : null;
    }

    detailCaptionCandidate(info) {
      const selectors = [
        '[data-e2e*="browse-video-desc"]',
        '[data-e2e*="video-desc"]',
        '[data-e2e*="search-card-video-caption"]',
        'h1'
      ];
      for (const selector of selectors) {
        const nodes = this.allVisible(selector);
        for (const node of nodes) {
          const text = cleanTikTokCaption(this.text(node), info.author);
          if (text) return { text, selector, element: node };
        }
      }

      const authorBlock = this.visible('[data-e2e*="browse-username"], [data-e2e*="video-author"], a[href^="/@"]');
      const nearby = authorBlock?.parentElement?.querySelectorAll('div[dir="auto"], span[dir="auto"], div, span') || [];
      for (const node of Array.from(nearby).filter(app.utils.isVisible)) {
        const text = cleanTikTokCaption(this.text(node), info.author);
        if (text && text.length > 1 && !/^@/.test(text)) return { text, selector: 'author-block sibling', element: node };
      }

      for (const selector of ['meta[property="og:description"]', 'meta[property="og:title"]']) {
        const node = document.querySelector(selector);
        const text = cleanTikTokCaption(node?.getAttribute('content'), info.author);
        if (text) return { text, selector, element: node };
      }
      const titleText = cleanTikTokCaption(document.title, info.author);
      return titleText ? { text: titleText, selector: 'document.title', element: null } : null;
    }

    async expandPostText(element, ctx) {
      const before = this.detailCaptionCandidate(parseTikTokVideoUrl(location.href) || { author: '' });
      if (!element || element.matches?.('meta')) return false;
      const root = element.closest('article, main, [data-e2e*="video-detail"]') || element.parentElement?.parentElement || element.parentElement;
      if (!root) return false;
      const controls = this.allVisible('button, [role="button"], span', root);
      const button = controls.find((control) => {
        const label = app.utils.normalizeText(`${control.getAttribute('aria-label') || ''} ${this.text(control)}`);
        return /^(more|see more|read more|ещё|еще|больше|daha çox|daha cox)$/.test(label);
      });
      if (!button) return false;
      await ctx.logger.info('[tiktok] Text expand button found', this.text(button) || button.getAttribute('aria-label') || 'unlabelled');
      const clicked = await ctx.navigation.click(this.clickable(button), 'TikTok caption expand', { scroll: false });
      if (!clicked) return false;
      await app.utils.waitFor(() => {
        const current = this.detailCaptionCandidate(parseTikTokVideoUrl(location.href) || { author: '' });
        return current?.text.length > Number(before?.text.length || 0) || !button.isConnected;
      }, { timeoutMs: 4000, intervalMs: 250, token: ctx.token });
      return true;
    }

    detailMediaUrls() {
      const urls = new Set();
      const add = (value) => {
        const url = String(value || '').trim();
        if (url && !url.startsWith('blob:') && !url.startsWith('data:')) urls.add(url);
      };
      for (const selector of ['meta[property="og:video"]', 'meta[property="og:video:url"]', 'meta[name="twitter:player:stream"]', 'meta[property="og:image"]']) {
        add(document.querySelector(selector)?.getAttribute('content'));
      }
      const videos = this.allVisible('video').sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      });
      const detailVideo = videos[0] || document.querySelector('video');
      for (const video of detailVideo ? [detailVideo] : []) {
        add(video.currentSrc);
        add(video.src);
        add(video.getAttribute('src'));
        add(video.poster);
        for (const source of video.querySelectorAll('source[src]')) add(source.src || source.getAttribute('src'));
      }
      return Array.from(urls);
    }

    async openTikTokVideoAndScrape(videoUrl, ctx) {
      const target = parseTikTokVideoUrl(videoUrl);
      if (!target) {
        await ctx.logger.warn('[tiktok] Invalid video URL; detail page cannot be opened', videoUrl);
        return null;
      }
      await ctx.logger.info('[tiktok] Opening video detail page', target.postUrl);
      const current = parseTikTokVideoUrl(location.href);
      if (!current || current.videoId !== target.videoId) {
        window.location.assign(target.postUrl);
        return { navigating: true };
      }

      const loaded = await app.utils.waitFor(() => {
        return this.detailCaptionCandidate(target) || document.querySelector('video, meta[property="og:video"], meta[property="og:description"]');
      }, { timeoutMs: 12000, intervalMs: 300, token: ctx.token });
      if (loaded) await ctx.logger.info('[tiktok] Video detail loaded', target.postUrl);
      else await ctx.logger.warn('[tiktok] Video detail load was not confirmed; parsing available metadata', target.postUrl);

      const initialCaption = this.detailCaptionCandidate(target);
      await this.expandPostText(initialCaption?.element, ctx);
      const caption = this.detailCaptionCandidate(target);
      if (caption) {
        await ctx.logger.info('[tiktok] Caption selector matched', caption.selector);
        await ctx.logger.info('[tiktok] Caption text length', String(caption.text.length));
        await ctx.logger.info('[tiktok] Full text extracted', target.postUrl);
      } else {
        await ctx.logger.warn('[tiktok] Caption text was not found; post will be saved with text=null', target.postUrl);
      }

      const date = videoIdDate(target.videoId);
      const mediaUrls = this.detailMediaUrls();
      const post = {
        source: 'tiktok',
        keyword: ctx.keyword,
        postUrl: target.postUrl,
        text: caption?.text || null,
        author: target.author,
        authorUrl: target.authorUrl,
        mediaUrls: [...mediaUrls],
        postDate: date ? app.utils.formatTimestamp(date) : null,
        scrapedAt: new Date().toISOString()
      };
      return { ...post, mediaUrls: [...post.mediaUrls] };
    }

    candidateMap(limit) {
      const unique = new Map();
      for (const link of document.querySelectorAll('a[href*="/video/"]')) {
        const info = this.videoInfo(link);
        if (!info || unique.has(info.videoId)) continue;
        unique.set(info.videoId, link);
        if (unique.size >= limit) break;
      }
      return unique;
    }

    async collectVideoUrls(ctx) {
      const remaining = ctx.targetCount === -1 ? 25 : Math.max(1, ctx.targetCount - ctx.currentCount());
      const candidateLimit = ctx.targetCount === -1 ? 60 : Math.min(150, Math.max(40, remaining * 4));
      const candidates = new Map();
      let stableRounds = 0;
      while (candidates.size < candidateLimit && stableRounds < 4) {
        const before = candidates.size;
        for (const [videoId, link] of this.candidateMap(candidateLimit)) candidates.set(videoId, link);
        stableRounds = candidates.size === before ? stableRounds + 1 : 0;
        if (candidates.size < candidateLimit) await this.scrollPage(ctx);
      }
      await ctx.logger.info('[tiktok] Video cards found', String(candidates.size));
      const urls = Array.from(candidates.entries())
        .sort(([left], [right]) => {
          try { return BigInt(right) > BigInt(left) ? 1 : BigInt(right) < BigInt(left) ? -1 : 0; } catch (error) { return 0; }
        })
        .map(([, link]) => parseTikTokVideoUrl(link.href)?.postUrl)
        .filter(Boolean);
      for (const url of urls) await ctx.logger.info('[tiktok] Video URL collected', url);
      return urls;
    }

    async tiktokProgress(ctx) {
      const state = await app.storage.getState();
      const progress = state?.scraperProgress;
      if (!progress || progress.platform !== 'tiktok' || progress.runId !== ctx.runId || progress.keyword !== ctx.keyword) return null;
      return progress;
    }

    async saveTikTokProgress(ctx, progress) {
      await app.storage.patch(ctx.runId, { scraperProgress: progress });
    }

    async startDetailQueue(ctx) {
      const existing = await this.tiktokProgress(ctx);
      const existingUrl = existing?.videoUrls?.[Number(existing.index || 0)];
      if (existingUrl) {
        await ctx.logger.info('[tiktok] Resuming persisted video detail queue', `index=${existing.index}/${existing.videoUrls.length}`);
        return this.openTikTokVideoAndScrape(existingUrl, ctx);
      }
      const videoUrls = await this.collectVideoUrls(ctx);
      if (!videoUrls.length) {
        await ctx.logger.warn('[tiktok] No video URLs were collected from search results');
        return { reason: 'exhausted' };
      }
      const progress = {
        platform: 'tiktok',
        runId: ctx.runId,
        keyword: ctx.keyword,
        resultsUrl: location.href,
        videoUrls,
        index: 0,
        currentVideoUrl: videoUrls[0]
      };
      await this.saveTikTokProgress(ctx, progress);
      return this.openTikTokVideoAndScrape(videoUrls[0], ctx);
    }

    async scrapeCurrentDetail(ctx, currentInfo) {
      let progress = await this.tiktokProgress(ctx);
      if (!progress) {
        await ctx.logger.warn('[tiktok] Detail queue was unavailable after navigation; recovering current video only', currentInfo.postUrl);
        progress = {
          platform: 'tiktok',
          runId: ctx.runId,
          keyword: ctx.keyword,
          resultsUrl: '',
          videoUrls: [currentInfo.postUrl],
          index: 0,
          currentVideoUrl: currentInfo.postUrl
        };
        await this.saveTikTokProgress(ctx, progress);
      }

      let index = Number(progress.index || 0);
      const currentIndex = progress.videoUrls.findIndex((url) => parseTikTokVideoUrl(url)?.videoId === currentInfo.videoId);
      if (currentIndex >= 0) index = currentIndex;
      const expectedUrl = progress.videoUrls[index];
      if (expectedUrl && parseTikTokVideoUrl(expectedUrl)?.videoId !== currentInfo.videoId) {
        return this.openTikTokVideoAndScrape(expectedUrl, ctx);
      }

      const post = await this.openTikTokVideoAndScrape(currentInfo.postUrl, ctx);
      if (post?.navigating) return post;
      if (post) {
        const outcome = await ctx.onPost({ ...post, mediaUrls: [...post.mediaUrls] });
        if (outcome.accepted) await ctx.logger.info('[tiktok] Post saved', post.postUrl);
        else if (outcome.duplicate) await ctx.logger.info('[tiktok] Post skipped as duplicate', post.postUrl);
        else await ctx.logger.warn('[tiktok] Post was not saved', post.postUrl);
        if (outcome.limitReached) {
          await this.saveTikTokProgress(ctx, null);
          return { reason: 'target' };
        }
        if (outcome.older) {
          await this.saveTikTokProgress(ctx, null);
          return { reason: 'date-limit' };
        }
      }

      const nextIndex = index + 1;
      const nextUrl = progress.videoUrls[nextIndex];
      if (!nextUrl) {
        await this.saveTikTokProgress(ctx, null);
        return { reason: 'exhausted' };
      }
      const nextProgress = { ...progress, index: nextIndex, currentVideoUrl: nextUrl };
      await this.saveTikTokProgress(ctx, nextProgress);
      return this.openTikTokVideoAndScrape(nextUrl, ctx);
    }

    async collect(ctx) {
      const currentDetail = parseTikTokVideoUrl(location.href);
      if (currentDetail) return this.scrapeCurrentDetail(ctx, currentDetail);
      return this.startDetailQueue(ctx);
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.tiktokVideoIdDate = videoIdDate;
  app.parsers.tiktokVideoUrl = parseTikTokVideoUrl;
  app.parsers.tiktokCaption = cleanTikTokCaption;
  app.scrapers.tiktok = new TikTokScraper();
})(globalThis.ScraperApp);
