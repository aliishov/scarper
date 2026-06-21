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
      if (!location.pathname.includes('/search/video')) {
        const videosTab = this.findTextControl([/^videos$/, /^video$/, /^видео$/]);
        if (videosTab) {
          await ctx.navigation.click(videosTab, 'TikTok Videos tab');
          await app.utils.waitFor(() => location.pathname.includes('/search/video') || document.querySelector('a[href*="/video/"]'), { timeoutMs: 5000, token: ctx.token });
        }
      }
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

    cardFor(link) {
      return link.closest('[data-e2e="search-video-card-v2"], [data-e2e="search_video-item"], article, [class*="DivItemContainer"], [class*="DivVideoItem"]') || link.parentElement;
    }

    parseCard(link) {
      const info = this.videoInfo(link);
      if (!info) return null;
      const card = this.cardFor(link);
      if (!card) return null;
      if (this.isAdvertisement(card)) return { advertisement: true, postUrl: info.postUrl };
      let date = videoIdDate(info.videoId);
      if (!date) {
        const raw = card.querySelector('time[datetime], [data-create-time]')?.getAttribute('datetime') || card.querySelector('[data-create-time]')?.getAttribute('data-create-time');
        const parsed = raw ? new Date(/^\d{10}$/.test(raw) ? Number(raw) * 1000 : raw) : null;
        if (parsed && !Number.isNaN(parsed.getTime())) date = parsed;
      }
      if (!date) return null;
      const textNode = card.querySelector('[data-e2e="search-card-video-caption"], [data-e2e="video-desc"], [data-e2e="browse-video-desc"], [class*="Desc"], [class*="Caption"]');
      const image = card.querySelector('img[src]');
      return {
        postDate: app.utils.formatTimestamp(date),
        postUrl: info.postUrl,
        author: info.handle,
        authorUrl: `https://www.tiktok.com/@${info.handle}`,
        text: this.text(textNode) || link.getAttribute('title') || '',
        mediaUrls: [image?.currentSrc || image?.src].filter(Boolean)
      };
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

    async collect(ctx) {
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
      await ctx.logger.info(`TikTok unique video cards: ${candidates.size}`);

      const posts = [];
      for (const link of candidates.values()) {
        const post = this.parseCard(link);
        if (post?.advertisement) {
          await ctx.logger.info('TikTok sponsored video skipped', post.postUrl);
          continue;
        }
        if (!post) {
          await ctx.logger.warn('TikTok card skipped: unique URL or publication date unavailable');
          continue;
        }
        posts.push({ ...post, mediaUrls: [...post.mediaUrls] });
      }
      posts.sort((left, right) => new Date(right.postDate).getTime() - new Date(left.postDate).getTime());
      await ctx.logger.info(`TikTok posts sorted newest first: ${posts.length}`);
      for (const post of posts) {
        const outcome = await ctx.onPost(post);
        if (outcome.limitReached) return { reason: 'target' };
        if (outcome.older) return { reason: 'date-limit' };
      }
      return { reason: 'exhausted' };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.tiktokVideoIdDate = videoIdDate;
  app.parsers.tiktokVideoUrl = parseTikTokVideoUrl;
  app.scrapers.tiktok = new TikTokScraper();
})(globalThis.ScraperApp);
