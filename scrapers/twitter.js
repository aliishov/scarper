(function initializeTwitterScraper(app) {
  'use strict';

  class TwitterScraper extends app.BaseScraper {
    constructor() {
      super('twitter');
      this.latestConfirmed = false;
    }

    async ensureReady(ctx) {
      if (!/\/(login|i\/flow\/login)/.test(location.pathname)) return true;
      return this.loginIfPossible(ctx, {
        findUsername: () => this.visible('input[name="text"], input[autocomplete*="username" i]'),
        findPassword: () => this.visible('input[type="password"]'),
        findSubmit: () => this.findTextControl([/^log in$/, /^next$/, /^continue$/, /^войти$/, /^далее$/]),
        verifyLoggedIn: () => !!document.querySelector('[data-testid="AppTabBar_Home_Link"], [data-testid="AppTabBar_Explore_Link"]')
      });
    }

    currentQuery() {
      try { return app.utils.normalizeText(new URL(location.href).searchParams.get('q')); } catch (error) { return ''; }
    }

    async search(keyword, ctx) {
      if (location.pathname.includes('/search') && this.currentQuery() === app.utils.normalizeText(keyword)) {
        await ctx.logger.info('Existing X search page matches keyword');
      } else {
        const result = await ctx.navigation.search({
          platform: 'X',
          keyword,
          findInput: () => this.visible('[data-testid="SearchBox_Search_Input"], input[placeholder*="Search" i], [role="search"] input'),
          openSearch: async () => {
            const control = this.visible('[data-testid="AppTabBar_Explore_Link"], a[href="/explore"]');
            if (control) await ctx.navigation.click(control, 'X Explore/Search');
          },
          verify: () => location.pathname.includes('/search') && this.currentQuery() === app.utils.normalizeText(keyword),
          clickSearchButton: async (input) => {
            const button = input.closest('form')?.querySelector('button[type="submit"], [role="button"][data-testid*="search" i]');
            return button ? ctx.navigation.click(button, 'X search button') : false;
          },
          fallbackUrl: () => `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`
        });
        if (result.navigating) return result;
      }
      await this.ensureLatest(ctx);
      return { success: true };
    }

    async ensureLatest(ctx) {
      const alreadyLatest = new URL(location.href).searchParams.get('f') === 'live';
      if (alreadyLatest) {
        this.latestConfirmed = true;
        await ctx.logger.info('X Latest results already active');
        return true;
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        const tab = this.visible('a[href*="f=live"][role="tab"]') || this.findTextControl([/^latest$/, /^последние$/, /^самые свежие$/]);
        if (tab) {
          await ctx.navigation.click(tab, 'X Latest tab');
          const confirmed = await app.utils.waitFor(() => new URL(location.href).searchParams.get('f') === 'live' || tab.getAttribute('aria-selected') === 'true', {
            timeoutMs: 4000,
            token: ctx.token
          });
          if (confirmed) {
            this.latestConfirmed = true;
            await ctx.logger.info('X Latest results confirmed');
            return true;
          }
        }
        await ctx.logger.warn(`X Latest UI attempt ${attempt}/3 failed`);
        await app.utils.sleep(1000, ctx.token);
      }
      this.latestConfirmed = false;
      await ctx.logger.warn('X Latest sort was not confirmed; date cutoff will not stop on the first old post');
      return false;
    }

    parseArticle(article) {
      const time = article.querySelector('time[datetime]');
      const timeLink = time?.closest('a[href*="/status/"]');
      if (!time || !timeLink) return null;
      const postDate = new Date(time.getAttribute('datetime'));
      if (Number.isNaN(postDate.getTime())) return null;
      const user = article.querySelector('[data-testid="User-Name"]');
      const profile = Array.from(user?.querySelectorAll('a[href]') || []).find((link) => /^\/[^/]+\/?$/.test(new URL(link.href).pathname));
      const author = this.text(profile?.querySelector('span')) || this.text(profile) || 'Unknown';
      const text = this.text(article.querySelector('[data-testid="tweetText"]'));
      const mediaUrls = [
        ...Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img')).map((image) => image.currentSrc || image.src),
        ...Array.from(article.querySelectorAll('video')).map((video) => video.poster || video.src)
      ].filter(Boolean);
      return {
        postDate: app.utils.formatTimestamp(postDate),
        postUrl: timeLink.href,
        author,
        authorUrl: profile?.href || '',
        text,
        mediaUrls
      };
    }

    async collect(ctx) {
      let noNewRounds = 0;
      while (noNewRounds < 5) {
        ctx.token.throwIfCancelled();
        const articles = this.allVisible('article[data-testid="tweet"]');
        await ctx.logger.info(`X posts visible: ${articles.length}`);
        let acceptedThisRound = 0;
        for (const article of articles) {
          ctx.token.throwIfCancelled();
          if (this.isAdvertisement(article)) {
            await ctx.logger.info('X promoted post skipped');
            continue;
          }
          const showMore = article.querySelector('[data-testid="tweet-text-show-more-link"]');
          if (showMore) await ctx.navigation.click(showMore, 'X Show more');
          const post = this.parseArticle(article);
          if (!post) {
            await ctx.logger.warn('X post skipped: URL or date unavailable');
            continue;
          }
          const outcome = await ctx.onPost(post);
          if (outcome.limitReached) return { reason: 'target' };
          if (outcome.older && this.latestConfirmed) return { reason: 'date-limit' };
          if (outcome.accepted) acceptedThisRound++;
        }
        noNewRounds = acceptedThisRound ? 0 : noNewRounds + 1;
        await this.scrollPage(ctx);
      }
      return { reason: 'exhausted' };
    }
  }

  app.scrapers.twitter = new TwitterScraper();
})(globalThis.ScraperApp);
