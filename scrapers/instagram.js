(function initializeInstagramScraper(app) {
  'use strict';

  class InstagramScraper extends app.BaseScraper {
    constructor() {
      super('instagram');
      this.freshUiConfirmed = false;
      this.searchOpenAttempt = 0;
    }

    async ensureReady(ctx) {
      if (!location.pathname.includes('/accounts/login')) return true;
      return this.loginIfPossible(ctx, {
        findUsername: () => this.visible('input[name="username"], input[name="email"]'),
        findPassword: () => this.visible('input[name="password"], input[type="password"]'),
        findSubmit: () => this.visible('button[type="submit"]'),
        verifyLoggedIn: () => !!document.querySelector('a[href="/"], nav a[href*="/explore/"]') && !location.pathname.includes('/accounts/login')
      });
    }

    normalizedKeyword(value) {
      return app.utils.normalizeText(value).replace(/^#/, '').replace(/\s+/g, '');
    }

    urlKeyword(url = location.href) {
      try {
        const parsed = new URL(url, location.origin);
        const tag = parsed.pathname.match(/\/explore\/tags\/([^/?#]+)/i);
        return this.normalizedKeyword(tag ? decodeURIComponent(tag[1]) : parsed.searchParams.get('q'));
      } catch (error) { return ''; }
    }

    searchInput() {
      return this.visible('input[aria-label*="Search input" i], input[placeholder*="Search" i], input[aria-label*="Search" i], input[placeholder*="Поиск" i], input[aria-label*="Поиск" i], input[name="queryBox"], input[type="search"]');
    }

    async openSearch(ctx) {
      this.searchOpenAttempt++;
      const attempt = Math.min(this.searchOpenAttempt, 3);
      let control = null;
      let strategy = '';

      if (attempt === 1) {
        const searchSvg = this.allVisible('svg[aria-label], svg').find((svg) => {
          const labels = [svg.getAttribute('aria-label'), svg.querySelector('title')?.textContent].map(app.utils.normalizeText).filter(Boolean);
          return labels.some((label) => /^(search|поиск|axtarış|axtaris)$/.test(label));
        });
        if (searchSvg) {
          await ctx.logger.info('Instagram Search icon found by svg aria-label/title');
          control = searchSvg.closest('a, button, [role="button"], [role="link"]');
          strategy = 'svg aria-label/title';
        }
      } else if (attempt === 2) {
        control = this.allVisible('a[href="/explore/"], a[href^="/explore"]')
          .find((link) => link.querySelector('svg') || /search|поиск|axtar/i.test(`${link.getAttribute('aria-label') || ''} ${this.text(link)}`));
        strategy = 'explore link';
      } else {
        const rawControls = this.allVisible('a, button, [role="button"], [role="link"]');
        control = rawControls.find((element) => {
          const labels = [element.getAttribute('aria-label'), this.text(element)].map(app.utils.normalizeText).filter(Boolean);
          return labels.some((label) => /^(search|поиск|axtarış|axtaris)$/.test(label));
        });
        strategy = 'visible navigation text';
      }

      if (!control) {
        await ctx.logger.warn(`Instagram Search navigation control was not found by ${strategy || `attempt ${attempt}`}`);
        return false;
      }
      const clickable = control.closest?.('a, button, [role="button"], [role="link"]') || control;
      await ctx.logger.info(`Instagram Search clickable ancestor found: ${clickable.tagName}`, `href=${clickable.getAttribute('href') || 'none'}, strategy=${strategy}`);
      const clicked = await ctx.navigation.click(clickable, 'Instagram Search navigation');
      if (!clicked) return false;
      await ctx.logger.info('Instagram waiting for search input');
      const input = await app.utils.waitFor(() => this.searchInput(), { timeoutMs: 4500, intervalMs: 250, token: ctx.token });
      if (input) await ctx.logger.info('Instagram search input found');
      else await ctx.logger.warn(`Instagram search input did not appear after ${strategy}`);
      return !!input;
    }

    async clickExactSuggestion(keyword, ctx) {
      const expected = this.normalizedKeyword(keyword);
      const exact = await app.utils.waitFor(() => {
        const candidates = this.allVisible('a[href*="/explore/tags/"], a[href*="/explore/search/keyword/"], [role="option"] a[href]');
        return candidates.find((link) => {
          const fromUrl = this.urlKeyword(link.href);
          const text = this.normalizedKeyword(this.text(link));
          return fromUrl === expected || text === expected || text === `#${expected}`;
        });
      }, { timeoutMs: 4500, intervalMs: 250, token: ctx.token });
      return exact ? ctx.navigation.click(exact, 'Instagram exact keyword result') : false;
    }

    resultsMatch(keyword) {
      const expected = this.normalizedKeyword(keyword);
      if (this.urlKeyword() === expected) return true;
      const heading = this.allVisible('h1, h2, [role="heading"]').find((element) => this.normalizedKeyword(this.text(element)) === expected);
      return !!heading && document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]').length > 0;
    }

    async search(keyword, ctx) {
      this.searchOpenAttempt = 0;
      await ctx.logger.info(`Instagram search started: ${keyword}`);
      await ctx.logger.info(`Instagram search input visible before opening UI: ${!!this.searchInput()}`);
      if (!this.resultsMatch(keyword)) {
        const result = await ctx.navigation.search({
          platform: 'Instagram',
          keyword,
          findInput: () => this.searchInput(),
          openSearch: () => this.openSearch(ctx),
          verify: () => this.resultsMatch(keyword),
          clickSuggestion: () => this.clickExactSuggestion(keyword, ctx),
          clickSearchButton: async (input) => {
            const button = input.closest('form')?.querySelector('button[type="submit"]');
            return button ? ctx.navigation.click(button, 'Instagram search button') : false;
          },
          fallbackUrl: () => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(keyword)}`
        });
        if (result.navigating) return result;
      } else {
        await ctx.logger.info('Existing Instagram results match keyword');
      }
      await ctx.logger.info(`Instagram results confirmed for keyword: ${keyword}`);
      await this.tryFreshUi(ctx);
      return { success: true };
    }

    async tryFreshUi(ctx) {
      const control = this.findTextControl([/^recent$/, /^latest$/, /^newest$/, /^недавние$/, /^последние$/, /^свежие$/]);
      if (!control) {
        this.freshUiConfirmed = false;
        await ctx.logger.info('Instagram has no freshness control; posts will be buffered and sorted by publication date');
        return false;
      }
      const before = this.gridFingerprint();
      await ctx.navigation.click(control, 'Instagram Recent/Latest');
      const changed = await app.utils.waitFor(() => control.getAttribute('aria-selected') === 'true' || this.gridFingerprint() !== before, {
        timeoutMs: 5000,
        intervalMs: 300,
        token: ctx.token
      });
      this.freshUiConfirmed = !!changed;
      await (changed ? ctx.logger.info('Instagram fresh UI sorting confirmed') : ctx.logger.warn('Instagram fresh UI sorting was not confirmed; local sorting will be used'));
      return this.freshUiConfirmed;
    }

    gridFingerprint() {
      return Array.from(document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]')).slice(0, 8).map((link) => link.href).join('|');
    }

    collectCandidateLinks(limit) {
      const links = Array.from(document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]'));
      const unique = new Map();
      for (const link of links) {
        const url = new URL(link.href, location.origin);
        url.search = '';
        url.hash = '';
        if (!unique.has(url.toString())) unique.set(url.toString(), link);
        if (unique.size >= limit) break;
      }
      return Array.from(unique, ([postUrl, element]) => ({ postUrl, element }));
    }

    async openPost(candidate, ctx) {
      let element = candidate.element;
      if (!element?.isConnected) {
        element = Array.from(document.querySelectorAll('a[href]')).find((link) => link.href.split('?')[0] === candidate.postUrl.split('?')[0]);
      }
      if (!element) return null;
      await ctx.logger.info('Instagram opening post card', candidate.postUrl);
      await ctx.navigation.click(element, 'Instagram post card');
      const container = await app.utils.waitFor(() => document.querySelector('div[role="dialog"] article, div[role="dialog"]'), {
        timeoutMs: 6000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!container) return null;
      const ready = await app.utils.waitFor(() => {
        const hasDate = !!container.querySelector('time[datetime], time[title]');
        const hasIdentity = !!this.profileLink(container);
        const hasMedia = !!container.querySelector('img[src], video');
        return hasDate && (hasIdentity || hasMedia);
      }, { timeoutMs: 7000, intervalMs: 300, token: ctx.token });
      if (!ready) await ctx.logger.warn('Instagram modal opened but did not become fully ready', candidate.postUrl);
      else await ctx.logger.info('Instagram post modal is ready', candidate.postUrl);
      return container;
    }

    profileLink(container) {
      return this.allVisible('header a[href], a[role="link"][href]', container).find((link) => {
        try {
          const parts = new URL(link.href).pathname.split('/').filter(Boolean);
          return parts.length === 1 && !['p', 'reel', 'explore', 'accounts'].includes(parts[0].toLowerCase());
        } catch (error) { return false; }
      }) || null;
    }

    parsePostDate(container) {
      const elements = Array.from(container.querySelectorAll('time[datetime], time[title], time'));
      for (const element of elements) {
        for (const value of [element.getAttribute('datetime'), element.getAttribute('title'), element.getAttribute('aria-label')]) {
          if (!value) continue;
          const date = new Date(value);
          if (!Number.isNaN(date.getTime())) return date;
        }
      }
      return null;
    }

    async expandPostText(container, ctx) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const before = this.text(container);
        const button = this.allVisible('button, [role="button"], span', container).find((element) => {
          const value = app.utils.normalizeText(element.getAttribute('aria-label') || this.text(element));
          return /^(more|see more|ещё|еще|показать больше|daha çox|daha cox)$/.test(value);
        });
        if (!button) return attempt > 1;
        await ctx.logger.info(`Instagram expand caption attempt ${attempt}/3`, this.text(button));
        await ctx.navigation.click(this.clickable(button), 'Instagram expand caption');
        const changed = await app.utils.waitFor(() => this.text(container).length > before.length || !button.isConnected, {
          timeoutMs: 3500,
          intervalMs: 250,
          token: ctx.token
        });
        if (changed) await ctx.logger.info('Instagram caption expanded', `${before.length} -> ${this.text(container).length}`);
        else await ctx.logger.warn('Instagram caption length did not change after expand click');
      }
      return true;
    }

    currentSlideMedia(container) {
      const urls = new Set();
      const add = (value) => {
        const url = String(value || '').trim();
        if (url && !url.startsWith('data:')) urls.add(url);
      };
      for (const image of this.allVisible('img[src]', container)) {
        if (/profile picture|avatar|emoji/i.test(image.alt || '')) continue;
        const largeEnough = image.width > 120 || image.naturalWidth > 120 || /cdninstagram|fbcdn/i.test(image.currentSrc || image.src || '');
        if (largeEnough) add(image.currentSrc || image.src || image.getAttribute('src'));
      }
      for (const video of this.allVisible('video', container)) {
        add(video.currentSrc);
        add(video.src);
        add(video.getAttribute('src'));
        add(video.poster);
        for (const source of video.querySelectorAll('source[src]')) add(source.src || source.getAttribute('src'));
      }
      return urls;
    }

    carouselNextButton(container) {
      const direct = this.allVisible(
        'button[aria-label="Next"], button[aria-label="Далее"], button[aria-label="Sonrakı"], [role="button"][aria-label="Next"], [role="button"][aria-label="Далее"], [role="button"][aria-label="Sonrakı"]',
        container
      );
      const svgParents = this.allVisible('svg[aria-label], svg', container)
        .filter((svg) => {
          const labels = [svg.getAttribute('aria-label'), svg.querySelector('title')?.textContent].map(app.utils.normalizeText).filter(Boolean);
          return labels.some((label) => /^(next|далее|sonrakı|sonraki)$/.test(label));
        })
        .map((svg) => svg.closest('button, [role="button"]'))
        .filter(Boolean);
      const candidates = Array.from(new Set([...direct, ...svgParents])).filter((button) => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
      if (!candidates.length) return null;

      const media = this.allVisible('img[src], video', container)
        .filter((element) => element.getBoundingClientRect().width > 160 && element.getBoundingClientRect().height > 160)
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
        })[0];
      if (!media) return candidates[0];
      const mediaRect = media.getBoundingClientRect();
      return candidates.find((button) => {
        const rect = button.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        return centerY >= mediaRect.top && centerY <= mediaRect.bottom && rect.left >= mediaRect.left + mediaRect.width * 0.45 && rect.left <= mediaRect.right + 120;
      }) || null;
    }

    async collectCarouselMedia(container, ctx) {
      const mediaUrls = new Set();
      const slideFingerprints = new Set();
      for (let slide = 1; slide <= 20; slide++) {
        ctx.token.throwIfCancelled();
        const current = this.currentSlideMedia(container);
        const fingerprint = Array.from(current).sort().join('|');
        if (fingerprint && slideFingerprints.has(fingerprint)) {
          await ctx.logger.warn('Instagram carousel repeated an already processed slide; stopping carousel traversal');
          break;
        }
        if (fingerprint) slideFingerprints.add(fingerprint);
        const beforeTotal = mediaUrls.size;
        current.forEach((url) => mediaUrls.add(url));
        await ctx.logger.info('Instagram media collected from current slide', `slide=${slide}, found=${current.size}, new=${mediaUrls.size - beforeTotal}`);

        const next = this.carouselNextButton(container);
        if (!next) break;
        await ctx.logger.info('Instagram carousel next button found', `slide=${slide}`);
        const beforeFingerprint = fingerprint;
        const clicked = await ctx.navigation.click(next, 'Instagram carousel Next', { scroll: false });
        if (!clicked) break;
        const changed = await app.utils.waitFor(() => {
          const nextFingerprint = Array.from(this.currentSlideMedia(container)).sort().join('|');
          return nextFingerprint && nextFingerprint !== beforeFingerprint;
        }, { timeoutMs: 5000, intervalMs: 250, token: ctx.token });
        if (!changed) {
          await ctx.logger.warn('Instagram carousel did not change after Next click');
          break;
        }
        await ctx.logger.info('Instagram carousel slide changed', `nextSlide=${slide + 1}`);
      }
      await ctx.logger.info('Instagram total mediaUrls collected', String(mediaUrls.size));
      return Array.from(mediaUrls);
    }

    parsePost(container, postUrl, collectedMediaUrls = null) {
      if (this.isAdvertisement(container)) return { advertisement: true };
      const date = this.parsePostDate(container);
      if (!date) return null;
      const profile = this.profileLink(container);
      let handle = '';
      try { handle = new URL(profile?.href || '').pathname.split('/').filter(Boolean)[0] || ''; } catch (error) {}
      const author = this.text(profile?.querySelector('span')) || this.text(profile) || handle || 'Unknown';
      const captionNodes = this.allVisible('h1[dir="auto"], [data-testid="post-comment-root"] span[dir="auto"], ul li span[dir="auto"], article span[dir="auto"]', container)
        .filter((node) => {
          const value = this.text(node);
          if (!value || value === author || value === handle) return false;
          if (/^(like|reply|see translation|нравится|ответить|перевод)$/i.test(value)) return false;
          return !node.closest('time');
        });
      const text = this.text(captionNodes.sort((left, right) => this.text(right).length - this.text(left).length)[0]);
      const mediaUrls = collectedMediaUrls || Array.from(this.currentSlideMedia(container));
      return {
        postDate: app.utils.formatTimestamp(date),
        postUrl,
        author,
        authorUrl: profile?.href || (handle ? `https://www.instagram.com/${handle}/` : ''),
        text,
        mediaUrls
      };
    }

    shouldSkipPost(post) {
      return !post || post.advertisement === true || !post.postUrl || !post.postDate;
    }

    async closePost(ctx) {
      const close = this.visible('div[role="dialog"] button[aria-label*="Close" i], button[aria-label="Close"], button[aria-label="Закрыть"], svg[aria-label="Close"], svg[aria-label="Закрыть"]');
      if (close) await ctx.navigation.click(this.clickable(close), 'Instagram Close post');
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      const closed = await app.utils.waitFor(() => !document.querySelector('div[role="dialog"]'), { timeoutMs: 3500, intervalMs: 200, token: ctx.token });
      if (closed) await ctx.logger.info('Instagram post modal closed; returning to result list');
      else await ctx.logger.warn('Instagram post modal did not close cleanly');
      return !!closed;
    }

    async collect(ctx) {
      const remaining = ctx.targetCount === -1 ? 15 : Math.max(1, ctx.targetCount - ctx.currentCount());
      const candidateLimit = ctx.targetCount === -1 ? 40 : Math.min(100, Math.max(30, remaining * 3));
      let stableRounds = 0;
      let candidates = [];
      while (candidates.length < candidateLimit && stableRounds < 3) {
        const before = candidates.length;
        candidates = this.collectCandidateLinks(candidateLimit);
        stableRounds = candidates.length === before ? stableRounds + 1 : 0;
        if (candidates.length < candidateLimit) await this.scrollPage(ctx);
      }
      await ctx.logger.info(`Instagram unique post candidates: ${candidates.length}`);

      for (const candidate of candidates) {
        ctx.token.throwIfCancelled();
        const container = await this.openPost(candidate, ctx);
        if (!container) {
          await ctx.logger.warn('Instagram card did not open', candidate.postUrl);
          continue;
        }
        await this.expandPostText(container, ctx);
        const mediaUrls = await this.collectCarouselMedia(container, ctx);
        if (!mediaUrls.length) await ctx.logger.warn('Instagram media URL was not found; post will still be saved', candidate.postUrl);
        const post = this.parsePost(container, candidate.postUrl, mediaUrls);
        let outcome = null;
        if (post?.advertisement) {
          await ctx.logger.info('Instagram sponsored post skipped', candidate.postUrl);
        } else if (post) {
          await ctx.logger.info('Instagram post parsed', `${post.author} | ${post.postDate} | ${post.postUrl}`);
          outcome = await ctx.onPost(post);
        } else {
          await ctx.logger.warn('Instagram post skipped: publication date was not resolved', candidate.postUrl);
        }
        await this.closePost(ctx);
        if (outcome?.limitReached) {
          await ctx.logger.info(`Instagram keyword limit reached: ${ctx.currentCount()}/${ctx.targetCount}`);
          return { reason: 'target' };
        }
        if (outcome?.older) {
          await ctx.logger.info('Instagram date limit reached; finishing current keyword', post.postDate);
          return { reason: 'date-limit' };
        }
      }
      return { reason: 'exhausted' };
    }
  }

  app.scrapers.instagram = new InstagramScraper();
})(globalThis.ScraperApp);
