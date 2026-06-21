(function initializeBaseScraper(app) {
  'use strict';

  const AD_PATTERNS = [
    /\bsponsored\b/i,
    /\bpromoted\b/i,
    /\badvertisement\b/i,
    /\bpaid partnership\b/i,
    /\bреклама\b/i,
    /\bспонсировано\b/i,
    /\bпродвигается\b/i,
    /\breklam\b/i,
    /\bsponsorlu\b/i
  ];

  class BaseScraper {
    constructor(platform) {
      this.platform = platform;
    }

    text(element) {
      return String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    visible(selector, root = document) {
      return Array.from(root.querySelectorAll(selector)).find(app.utils.isVisible) || null;
    }

    allVisible(selector, root = document) {
      return Array.from(root.querySelectorAll(selector)).filter(app.utils.isVisible);
    }

    clickable(element) {
      return element?.closest('button, a, label, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="option"]') || element;
    }

    findTextControl(patterns, root = document) {
      const selectors = 'button, a, label, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="option"]';
      return this.allVisible(selectors, root).find((element) => {
        const value = app.utils.normalizeText(`${element.getAttribute('aria-label') || ''} ${this.text(element)}`);
        return value.length <= 120 && patterns.some((pattern) => pattern.test(value));
      }) || null;
    }

    isAdvertisement(element) {
      if (!element) return false;
      const labels = Array.from(element.querySelectorAll('[aria-label], [data-testid], [data-e2e]'))
        .slice(0, 80)
        .map((node) => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('data-testid') || ''} ${node.getAttribute('data-e2e') || ''}`)
        .join(' ');
      const text = `${this.text(element)} ${labels}`;
      return AD_PATTERNS.some((pattern) => pattern.test(text));
    }

    async scrollPage(ctx, pixels = null) {
      ctx.token.throwIfCancelled();
      const amount = pixels || app.utils.randomInt(600, 1200);
      await ctx.logger.info(`Scroll down ${amount}px`);
      window.scrollBy({ top: amount, behavior: 'smooth' });
      await app.utils.sleep(app.utils.randomInt(800, 1500), ctx.token);
    }

    async loginIfPossible(ctx, config) {
      let usernameInput = config.findUsername?.();
      let passwordInput = config.findPassword?.();
      if (!usernameInput && !passwordInput) return true;
      const username = ctx.credentials?.username || '';
      const password = ctx.credentials?.password || '';
      if (!username || !password) {
        await ctx.logger.warn('Login page detected, but credentials were not provided');
        return false;
      }
      if (usernameInput && !usernameInput.value) {
        await ctx.navigation.type(usernameInput, username, `${this.platform} username`);
        if (!passwordInput) {
          await ctx.navigation.pressEnter(usernameInput, () => config.findPassword?.() || config.verifyLoggedIn(), `${this.platform} username`);
          const nextButton = config.findSubmit?.();
          if (nextButton && !config.findPassword?.() && !(await config.verifyLoggedIn())) {
            await ctx.navigation.click(nextButton, `${this.platform} next`);
          }
          passwordInput = await app.utils.waitFor(() => config.findPassword?.() || (config.verifyLoggedIn() ? true : null), {
            timeoutMs: 8000,
            intervalMs: 300,
            token: ctx.token
          });
          if (passwordInput === true) return true;
        }
      }
      passwordInput = config.findPassword?.() || passwordInput;
      if (passwordInput && !passwordInput.value) await ctx.navigation.type(passwordInput, password, `${this.platform} password`);
      const activePassword = config.findPassword?.() || passwordInput;
      if (activePassword) {
        await ctx.navigation.pressEnter(activePassword, config.verifyLoggedIn, `${this.platform} password`);
      }
      const button = config.findSubmit?.();
      if (button && !(await config.verifyLoggedIn())) await ctx.navigation.click(button, `${this.platform} login`);
      const loggedIn = await app.utils.waitFor(config.verifyLoggedIn, { timeoutMs: 12000, intervalMs: 500, token: ctx.token });
      await (loggedIn ? ctx.logger.info('Login completed') : ctx.logger.warn('Login was not confirmed'));
      return !!loggedIn;
    }
  }

  app.BaseScraper = BaseScraper;
  app.scrapers = app.scrapers || {};
})(globalThis.ScraperApp);
