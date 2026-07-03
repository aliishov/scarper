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

    detailCaptionCandidate(info, root = document) {
      const selectors = [
        '[data-e2e*="browse-video-desc"]',
        '[data-e2e*="video-desc"]',
        '[data-e2e*="search-card-video-caption"]',
        'h1'
      ];
      for (const selector of selectors) {
        const nodes = this.allVisible(selector, root);
        for (const node of nodes) {
          const text = cleanTikTokCaption(this.text(node), info.author);
          if (text) return { text, selector, element: node };
        }
      }

      const authorBlock = this.visible('[data-e2e*="browse-username"], [data-e2e*="video-author"], a[href^="/@"]', root);
      const nearby = authorBlock?.parentElement?.querySelectorAll('div[dir="auto"], span[dir="auto"], div, span') || [];
      for (const node of Array.from(nearby).filter(app.utils.isVisible)) {
        const text = cleanTikTokCaption(this.text(node), info.author);
        if (text && text.length > 1 && !/^@/.test(text)) return { text, selector: 'author-block sibling', element: node };
      }

      const metadataInfo = parseTikTokVideoUrl(document.querySelector('meta[property="og:url"]')?.getAttribute('content')) || parseTikTokVideoUrl(location.href);
      if (metadataInfo?.videoId === info.videoId) {
        for (const selector of ['meta[property="og:description"]', 'meta[property="og:title"]']) {
          const node = document.querySelector(selector);
          const text = cleanTikTokCaption(node?.getAttribute('content'), info.author);
          if (text) return { text, selector, element: node };
        }
        const titleText = cleanTikTokCaption(document.title, info.author);
        if (titleText) return { text: titleText, selector: 'document.title', element: null };
      }
      return null;
    }

    async expandPostText(element, ctx, root = document, info = parseTikTokVideoUrl(location.href) || { author: '' }) {
      const before = this.detailCaptionCandidate(info, root);
      if (!element || element.matches?.('meta')) return false;
      const controlRoot = element.closest('article, main, [data-e2e*="video-detail"]') || element.parentElement?.parentElement || element.parentElement;
      if (!controlRoot) return false;
      const controls = this.allVisible('button, [role="button"], span', controlRoot);
      const button = controls.find((control) => {
        const label = app.utils.normalizeText(`${control.getAttribute('aria-label') || ''} ${this.text(control)}`);
        return /^(more|see more|read more|ещё|еще|больше|daha çox|daha cox)$/.test(label);
      });
      if (!button) return false;
      await ctx.logger.info('[tiktok] Text expand button found', this.text(button) || button.getAttribute('aria-label') || 'unlabelled');
      const clicked = await ctx.navigation.click(this.clickable(button), 'TikTok caption expand', { scroll: false });
      if (!clicked) return false;
      await app.utils.waitFor(() => {
        const current = this.detailCaptionCandidate(info, root);
        return current?.text.length > Number(before?.text.length || 0) || !button.isConnected;
      }, { timeoutMs: 4000, intervalMs: 250, token: ctx.token });
      return true;
    }

    currentViewerMedia(root) {
      const urls = new Set();
      const add = (value) => {
        const url = String(value || '').trim();
        if (url && !url.startsWith('blob:') && !url.startsWith('data:')) urls.add(url);
      };
      const videos = this.allVisible('video', root).sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      });
      const detailVideo = videos[0] || root.querySelector?.('video');
      for (const video of detailVideo ? [detailVideo] : []) {
        add(video.currentSrc);
        add(video.src);
        add(video.getAttribute('src'));
        add(video.poster);
        for (const source of video.querySelectorAll('source[src]')) add(source.src || source.getAttribute('src'));
      }
      for (const image of this.allVisible('img[src]', root)) {
        const rect = image.getBoundingClientRect();
        if (rect.width < 180 || rect.height < 180 || /avatar|profile|emoji/i.test(image.alt || '')) continue;
        add(image.currentSrc || image.src || image.getAttribute('src'));
      }
      if (!urls.size && parseTikTokVideoUrl(location.href)) {
        for (const selector of ['meta[property="og:video"]', 'meta[property="og:video:url"]', 'meta[name="twitter:player:stream"]', 'meta[property="og:image"]']) {
          add(document.querySelector(selector)?.getAttribute('content'));
        }
      }
      return urls;
    }

    viewerRoot() {
      const selectors = '[role="dialog"], [data-e2e*="video-detail"], [class*="DivVideoDetail"], [class*="DivBrowserMode"]';
      const roots = this.allVisible(selectors).filter((element) => element.querySelector('video, img[src], a[href*="/video/"]'));
      const activeVideo = this.allVisible('video').sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      })[0];
      if (activeVideo) {
        const closest = activeVideo.closest(selectors);
        if (closest && app.utils.isVisible(closest)) return closest;
      }
      const specificRoot = roots.sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      })[0] || null;
      if (specificRoot) return specificRoot;
      if (!parseTikTokVideoUrl(location.href)) return null;
      return activeVideo?.closest('main') || this.visible('main');
    }

    currentViewerInfo(root = this.viewerRoot()) {
      const locationInfo = parseTikTokVideoUrl(location.href);
      if (!root) return locationInfo;
      const rootRect = root.getBoundingClientRect();
      const candidates = this.allVisible('a[href*="/video/"]', root).map((link) => {
        const info = parseTikTokVideoUrl(link.href);
        if (!info) return null;
        const rect = link.getBoundingClientRect();
        const compact = rect.width <= 500 && rect.height <= 100 && !link.querySelector('img, video');
        const nearTop = rect.top <= rootRect.top + rootRect.height * 0.55;
        const score = (compact ? 60 : 0) + (nearTop ? 30 : 0) + (locationInfo?.videoId === info.videoId ? 100 : 0);
        return { info, score };
      }).filter(Boolean).sort((left, right) => right.score - left.score);
      return candidates[0]?.info || locationInfo;
    }

    viewerFingerprint(root, info = this.currentViewerInfo(root)) {
      const caption = info ? this.detailCaptionCandidate(info, root)?.text || '' : '';
      const media = Array.from(this.currentViewerMedia(root)).sort().join('|');
      return `${info?.videoId || ''}:${caption}:${media}`;
    }

    photoCarouselNextButton(root) {
      const media = this.allVisible('img[src]', root).filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 180 && rect.height >= 180 && !/avatar|profile|emoji/i.test(image.alt || '');
      }).sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      })[0];
      if (!media) return null;
      const mediaRect = media.getBoundingClientRect();
      const controls = this.allVisible('button, [role="button"]', root).filter((button) => {
        const label = app.utils.normalizeText(`${button.getAttribute('aria-label') || ''} ${this.text(button)} ${button.querySelector('svg')?.getAttribute('aria-label') || ''}`);
        if (!/^(next|next photo|next image|далее|следующее фото|sonrakı|sonraki)$/.test(label)) return false;
        const rect = button.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return centerY >= mediaRect.top && centerY <= mediaRect.bottom && centerX >= mediaRect.left + mediaRect.width * 0.55 && centerX <= mediaRect.right + 80;
      });
      return controls[0] || null;
    }

    async collectViewerMedia(root, ctx) {
      const urls = new Set();
      const fingerprints = new Set();
      for (let slide = 1; slide <= 20; slide++) {
        ctx.token.throwIfCancelled();
        const current = this.currentViewerMedia(root);
        current.forEach((url) => urls.add(url));
        const fingerprint = Array.from(current).sort().join('|');
        if (fingerprint && fingerprints.has(fingerprint)) break;
        if (fingerprint) fingerprints.add(fingerprint);
        const next = this.photoCarouselNextButton(root);
        if (!next) break;
        await ctx.logger.info('[tiktok] Photo carousel Next found', `slide=${slide}`);
        const clicked = await ctx.navigation.click(next, 'TikTok photo carousel Next', { scroll: false });
        if (!clicked) break;
        const changed = await app.utils.waitFor(() => {
          const nextFingerprint = Array.from(this.currentViewerMedia(root)).sort().join('|');
          return nextFingerprint && nextFingerprint !== fingerprint;
        }, { timeoutMs: 4000, intervalMs: 250, token: ctx.token });
        if (!changed) break;
      }
      await ctx.logger.info('[tiktok] Viewer media URLs collected', String(urls.size));
      return Array.from(urls);
    }

    async openTikTokVideoAndScrape(videoUrl, ctx) {
      const expected = parseTikTokVideoUrl(videoUrl);
      const loaded = await app.utils.waitFor(() => {
        const root = this.viewerRoot();
        const info = this.currentViewerInfo(root);
        if (!root || !info) return null;
        if (expected && info.videoId !== expected.videoId) return null;
        return { root, info };
      }, { timeoutMs: 12000, intervalMs: 300, token: ctx.token });
      if (!loaded) {
        await ctx.logger.warn('[tiktok] Active viewer post could not be resolved', videoUrl || location.href);
        return null;
      }
      const { root, info } = loaded;
      await ctx.logger.info('[tiktok] Video detail loaded', info.postUrl);
      if (this.isAdvertisement(root)) {
        await ctx.logger.info('[tiktok] Sponsored viewer post skipped', info.postUrl);
        return { advertisement: true, postUrl: info.postUrl, mediaUrls: [] };
      }

      const initialCaption = this.detailCaptionCandidate(info, root);
      await this.expandPostText(initialCaption?.element, ctx, root, info);
      const caption = this.detailCaptionCandidate(info, root);
      if (caption) {
        await ctx.logger.info('[tiktok] Caption selector matched', caption.selector);
        await ctx.logger.info('[tiktok] Caption text length', String(caption.text.length));
        await ctx.logger.info('[tiktok] Full text extracted', info.postUrl);
      } else {
        await ctx.logger.warn('[tiktok] Caption text was not found; post will be saved with text=null', info.postUrl);
      }

      const date = videoIdDate(info.videoId);
      const mediaUrls = await this.collectViewerMedia(root, ctx);
      const post = {
        source: 'tiktok',
        keyword: ctx.keyword,
        postUrl: info.postUrl,
        text: caption?.text || null,
        author: info.author,
        authorUrl: info.authorUrl,
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

    async tiktokProgress(ctx) {
      const state = await app.storage.getState();
      const progress = state?.scraperProgress;
      if (!progress || progress.platform !== 'tiktok' || progress.runId !== ctx.runId || progress.keyword !== ctx.keyword) return null;
      return progress;
    }

    async saveTikTokProgress(ctx, progress) {
      await app.storage.patch(ctx.runId, { scraperProgress: progress });
    }

    async openFirstVideoCard(ctx, progress) {
      let candidates = this.candidateMap(30);
      for (let round = 1; candidates.size === 0 && round <= 3; round++) {
        await ctx.logger.info('[tiktok] Waiting for video cards', `attempt=${round}/3`);
        await this.scrollPage(ctx, 700);
        candidates = this.candidateMap(30);
      }
      await ctx.logger.info('[tiktok] Video cards found', String(candidates.size));
      for (const [videoId, link] of candidates) {
        ctx.token.throwIfCancelled();
        if (progress.seenVideoIds.includes(videoId)) continue;
        const info = parseTikTokVideoUrl(link.href);
        await ctx.logger.info('[tiktok] Clicking first video card', info?.postUrl || link.href);
        const beforeUrl = location.href;
        const clicked = await ctx.navigation.click(this.clickable(link), 'TikTok first video card');
        if (!clicked) continue;
        const opened = await app.utils.waitFor(() => {
          const root = this.viewerRoot();
          const current = this.currentViewerInfo(root);
          return root && current && (current.videoId === videoId || location.href !== beforeUrl) ? current : null;
        }, { timeoutMs: 8000, intervalMs: 300, token: ctx.token });
        if (opened) {
          await ctx.logger.info('[tiktok] Viewer opened from video card', opened.postUrl);
          return opened;
        }
        await ctx.logger.warn('[tiktok] Video card click did not open viewer', info?.postUrl || link.href);
      }
      return null;
    }

    viewerNextButton(root) {
      const rootRect = root.getBoundingClientRect();
      const controls = this.allVisible('button, [role="button"], [data-e2e*="arrow-down"], [data-e2e*="arrow-right"]').map((button) => {
        const label = app.utils.normalizeText(`${button.getAttribute('aria-label') || ''} ${this.text(button)} ${button.querySelector('svg')?.getAttribute('aria-label') || ''} ${button.getAttribute('data-e2e') || ''}`);
        const down = /(scroll down|next video|arrow down|down|прокрутить вниз|следующее видео|вниз|aşağı|asagi)/i.test(label);
        const next = /^(next|далее|следующий|sonrakı|sonraki)$/.test(label);
        if (!down && !next) return null;
        if (button === this.photoCarouselNextButton(root)) return null;
        const rect = button.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const nearViewer = centerX >= rootRect.left + rootRect.width * 0.55 && centerX <= rootRect.right + 180 && centerY >= rootRect.top && centerY <= rootRect.bottom;
        if (!nearViewer) return null;
        return { button, score: down ? 100 : 50, centerY };
      }).filter(Boolean).sort((left, right) => right.score - left.score || right.centerY - left.centerY);
      return controls[0]?.button || null;
    }

    async pressArrowDown(ctx) {
      ctx.token.throwIfCancelled();
      await ctx.logger.info('[tiktok] Using ArrowDown viewer fallback');
      document.activeElement?.blur?.();
      const target = document.body;
      target?.focus?.({ preventScroll: true });
      for (const type of ['keydown', 'keypress', 'keyup']) {
        target?.dispatchEvent(new KeyboardEvent(type, {
          key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true, composed: true
        }));
      }
      await app.utils.sleep(400, ctx.token);
    }

    async moveToNextViewerPost(ctx, previousInfo, previousFingerprint) {
      const root = this.viewerRoot();
      if (!root) return null;
      const next = this.viewerNextButton(root);
      if (next) {
        await ctx.logger.info('[tiktok] Next/down viewer button found', next.getAttribute('aria-label') || this.text(next) || next.getAttribute('data-e2e') || 'unlabelled');
        await ctx.navigation.click(next, 'TikTok next/down video', { scroll: false });
      } else {
        await ctx.logger.warn('[tiktok] Next/down viewer button was not found');
      }
      let changed = await app.utils.waitFor(() => {
        const currentRoot = this.viewerRoot();
        const currentInfo = this.currentViewerInfo(currentRoot);
        if (currentInfo?.videoId && currentInfo.videoId !== previousInfo.videoId) return currentInfo;
        return null;
      }, { timeoutMs: 5000, intervalMs: 250, token: ctx.token });
      if (changed) return changed;

      await this.pressArrowDown(ctx);
      changed = await app.utils.waitFor(() => {
        const currentRoot = this.viewerRoot();
        const currentInfo = this.currentViewerInfo(currentRoot);
        if (currentInfo?.videoId && currentInfo.videoId !== previousInfo.videoId) return currentInfo;
        if (currentRoot && this.viewerFingerprint(currentRoot, currentInfo) !== previousFingerprint && currentInfo?.videoId !== previousInfo.videoId) return currentInfo;
        return null;
      }, { timeoutMs: 5000, intervalMs: 250, token: ctx.token });
      return changed || null;
    }

    async collect(ctx) {
      let progress = await this.tiktokProgress(ctx);
      if (!progress || progress.mode !== 'viewer') {
        progress = {
          platform: 'tiktok',
          mode: 'viewer',
          runId: ctx.runId,
          keyword: ctx.keyword,
          resultsUrl: location.href,
          seenVideoIds: [],
          noNewAttempts: 0
        };
        await this.saveTikTokProgress(ctx, progress);
      }
      progress.seenVideoIds = Array.isArray(progress.seenVideoIds) ? progress.seenVideoIds : [];

      let currentInfo = this.currentViewerInfo();
      if (!currentInfo || !this.viewerRoot()) {
        currentInfo = await this.openFirstVideoCard(ctx, progress);
        if (!currentInfo) {
          await this.saveTikTokProgress(ctx, null);
          return { reason: 'end-of-feed' };
        }
      }

      while (progress.noNewAttempts < 3) {
        ctx.token.throwIfCancelled();
        const root = this.viewerRoot();
        currentInfo = this.currentViewerInfo(root) || currentInfo;
        if (!root || !currentInfo) {
          progress.noNewAttempts++;
          await this.saveTikTokProgress(ctx, progress);
          await app.utils.sleep(1000, ctx.token);
          continue;
        }

        if (!progress.seenVideoIds.includes(currentInfo.videoId)) {
          const post = await this.openTikTokVideoAndScrape(currentInfo.postUrl, ctx);
          progress.seenVideoIds = [...progress.seenVideoIds, currentInfo.videoId].slice(-1000);
          progress.noNewAttempts = 0;
          await this.saveTikTokProgress(ctx, progress);
          if (post) {
            if (post.advertisement) {
              await ctx.logger.info('[tiktok] Advertisement skipped without saving', post.postUrl);
            } else {
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
          }
        } else {
          await ctx.logger.warn('[tiktok] Viewer still shows an already processed post', `attempt=${progress.noNewAttempts + 1}/3`);
        }

        const fingerprint = this.viewerFingerprint(root, currentInfo);
        const nextInfo = await this.moveToNextViewerPost(ctx, currentInfo, fingerprint);
        if (!nextInfo || progress.seenVideoIds.includes(nextInfo.videoId)) {
          progress.noNewAttempts++;
          await ctx.logger.warn('[tiktok] No new unique viewer post after navigation', `attempt=${progress.noNewAttempts}/3`);
        } else {
          progress.noNewAttempts = 0;
          currentInfo = nextInfo;
        }
        await this.saveTikTokProgress(ctx, progress);
      }

      await ctx.logger.info('[tiktok] Viewer feed exhausted; finishing current keyword');
      await this.saveTikTokProgress(ctx, null);
      return { reason: 'end-of-feed' };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.tiktokVideoIdDate = videoIdDate;
  app.parsers.tiktokVideoUrl = parseTikTokVideoUrl;
  app.parsers.tiktokCaption = cleanTikTokCaption;
  app.scrapers.tiktok = new TikTokScraper();
})(globalThis.ScraperApp);
