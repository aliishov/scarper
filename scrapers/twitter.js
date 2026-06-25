(function initializeTwitterScraper(app) {
  'use strict';

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const ADVANCED_SEARCH_PATTERNS = [
    /advanced search/i,
    /\u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u043d\u044b\u0439 \u043f\u043e\u0438\u0441\u043a/i
  ];
  const SEARCH_BUTTON_PATTERNS = [/^search$/i, /^\u043f\u043e\u0438\u0441\u043a$/i];
  const DATES_PATTERNS = [/^dates$/i, /^\u0434\u0430\u0442\u044b$/i];
  const FROM_PATTERNS = [/^from$/i, /^\u043e\u0442$/i, /^\u0441$/i];
  const TO_PATTERNS = [/^to$/i, /^\u0434\u043e$/i, /^\u043f\u043e$/i];

  function pad(number) {
    return String(number).padStart(2, '0');
  }

  function parseTwitterDateLimit(value) {
    const text = String(value || '').trim();
    let year;
    let month;
    let day;
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) return null;
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
    }
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return {
      iso: `${year}-${pad(month)}-${pad(day)}`,
      year: String(year),
      month: String(month),
      monthName: MONTH_NAMES[month - 1],
      day: String(day)
    };
  }

  function twitterSinceSearchUrl(keyword, dateLimit) {
    const parsed = typeof dateLimit === 'string' ? parseTwitterDateLimit(dateLimit) : dateLimit;
    if (!parsed) return '';
    const q = `${String(keyword || '').trim()} since:${parsed.iso}`.trim();
    return `https://x.com/search?f=live&q=${encodeURIComponent(q)}&src=typed_query`;
  }

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

    currentSearchMatchesDateLimit(keyword, dateLimit) {
      if (!dateLimit || !location.pathname.includes('/search')) return false;
      const query = this.currentQuery();
      return query.includes(app.utils.normalizeText(keyword)) && query.includes(`since:${dateLimit.iso}`);
    }

    async search(keyword, ctx) {
      const dateLimit = parseTwitterDateLimit(ctx.state?.dateLimit);
      await ctx.logger.info(`[twitter] Date limit enabled: ${String(!!dateLimit)}`);
      if (dateLimit && this.currentSearchMatchesDateLimit(keyword, dateLimit)) {
        this.latestConfirmed = new URL(location.href).searchParams.get('f') === 'live';
        await ctx.logger.info('[twitter] Advanced search results confirmed');
        return { success: true };
      }

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
      if (dateLimit) return this.applyAdvancedSearchDateLimit(keyword, dateLimit, ctx);
      return { success: true };
    }

    textMatches(text, patterns) {
      const normalized = app.utils.normalizeText(text);
      return patterns.some((pattern) => pattern.test(normalized));
    }

    controlText(element) {
      const aria = element?.getAttribute?.('aria-label') || '';
      const text = this.text(element);
      return app.utils.normalizeText(aria) === app.utils.normalizeText(text) ? text : `${aria} ${text}`.trim();
    }

    clickableForAdvancedSearch(element) {
      return element?.closest?.('a, button, [role="link"], [role="button"]') || element;
    }

    advancedSearchLink() {
      const direct = this.allVisible('a[href="/search-advanced?f=live"], a[href*="search-advanced"]')
        .find((element) => element instanceof HTMLAnchorElement || element.getAttribute('href'));
      if (direct) return this.clickableForAdvancedSearch(direct);
      const controls = this.allVisible('a, button, [role="link"], [role="button"], span');
      const match = controls.find((element) => this.textMatches(this.controlText(element), ADVANCED_SEARCH_PATTERNS));
      return this.clickableForAdvancedSearch(match);
    }

    advancedSearchDialog() {
      const dialogs = this.allVisible('[role="dialog"]');
      return dialogs.find((dialog) => {
        const heading = this.visible('h1, h2, [role="heading"], #modal-header', dialog);
        return dialog.querySelector('input[name="allOfTheseWords"]')
          || this.textMatches(this.controlText(heading || dialog), ADVANCED_SEARCH_PATTERNS);
      }) || null;
    }

    findTextElement(root, patterns) {
      return this.allVisible('h1, h2, h3, label, span, div, [role="heading"]', root)
        .find((element) => this.textMatches(this.controlText(element), patterns)) || null;
    }

    findLabeledInput(root, patterns) {
      const label = this.findTextElement(root, patterns);
      if (!label) return null;
      for (let current = label; current && current !== root.parentElement; current = current.parentElement) {
        const input = this.visible('input[type="text"], input:not([type]), [role="textbox"]', current);
        if (input && !label.contains(input)) return input;
      }
      return null;
    }

    advancedWordsInput(dialog) {
      return this.visible('input[name="allOfTheseWords"]', dialog)
        || this.findLabeledInput(dialog, [/all of these words/i]);
    }

    setNativeInputValue(input, value) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(input, '');
      else input.value = '';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async setAdvancedWordsInput(input, keyword, ctx) {
      await ctx.logger.info('[twitter] Advanced search allOfTheseWords input found');
      const typed = await ctx.navigation.type(input, keyword, 'X Advanced search allOfTheseWords');
      if (!typed || app.utils.normalizeText(input.value) !== app.utils.normalizeText(keyword)) {
        await ctx.logger.warn('[twitter] Human-like advanced input typing was not accepted; dispatching direct input events');
        input.focus({ preventScroll: true });
        this.setNativeInputValue(input, keyword);
      }
      const accepted = app.utils.normalizeText(input.value) === app.utils.normalizeText(keyword);
      if (accepted) {
        await ctx.logger.info(`[twitter] Keyword inserted into advanced search: ${keyword}`);
        await ctx.logger.info('[twitter] allOfTheseWords set');
      }
      return accepted;
    }

    findScrollableDialogBody(dialog) {
      const candidates = [dialog, ...Array.from(dialog.querySelectorAll('div, section'))];
      return candidates.find((element) => element.scrollHeight > element.clientHeight + 40) || dialog;
    }

    findDatesSection(dialog) {
      const marker = this.findTextElement(dialog, DATES_PATTERNS);
      if (!marker) return null;
      let best = marker;
      for (let current = marker; current && current !== dialog.parentElement; current = current.parentElement) {
        const text = app.utils.normalizeText(this.text(current));
        const controls = current.querySelectorAll('select, input, [role="combobox"], [role="button"], button').length;
        const hasDates = /\bdates\b/i.test(text) || text.includes('\u0434\u0430\u0442\u044b');
        const hasFrom = /\bfrom\b/i.test(text) || /\b\u043e\u0442\b/i.test(text) || /\b\u0441\b/i.test(text);
        if (hasDates && hasFrom && controls >= 3) {
          best = current;
          break;
        }
        if (current === dialog) break;
      }
      return best;
    }

    async scrollToDatesSection(dialog, ctx) {
      const scroller = this.findScrollableDialogBody(dialog);
      for (let attempt = 1; attempt <= 6; attempt++) {
        ctx.token.throwIfCancelled();
        const section = this.findDatesSection(dialog);
        if (section) {
          section.scrollIntoView({ block: 'center', inline: 'nearest' });
          await ctx.logger.info('[twitter] Dates section found');
          return section;
        }
        scroller.scrollTop += Math.max(240, Math.floor((scroller.clientHeight || 600) * 0.7));
        scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 400 }));
        await app.utils.sleep(350, ctx.token);
      }
      return null;
    }

    elementAfterBefore(element, after, before) {
      if (after && !(after.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      if (before && !(before.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)) return false;
      return true;
    }

    fromDateControls(section) {
      const from = this.findTextElement(section, FROM_PATTERNS);
      const to = this.findTextElement(section, TO_PATTERNS);
      const selector = 'select, input, [role="combobox"], [role="button"], button';
      let controls = this.allVisible(selector, section).filter((element) => {
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
        if (element.tagName === 'INPUT' && !/^(text|number)?$/i.test(element.getAttribute('type') || 'text')) return false;
        return this.elementAfterBefore(element, from, to);
      });
      if (controls.length < 3) {
        controls = this.allVisible(selector, section)
          .filter((element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true');
      }
      const unique = [];
      for (const control of controls) {
        const clickable = control.tagName === 'SELECT' || control.tagName === 'INPUT' ? control : this.clickableForAdvancedSearch(control);
        if (clickable && !unique.includes(clickable)) unique.push(clickable);
      }
      return unique.slice(0, 3);
    }

    optionMatches(option, desired) {
      const expected = app.utils.normalizeText(desired);
      const value = app.utils.normalizeText(option.value);
      const text = app.utils.normalizeText(this.text(option));
      return value === expected || text === expected || text.includes(expected);
    }

    setSelectValue(select, desired) {
      const option = Array.from(select.options || []).find((candidate) => this.optionMatches(candidate, desired));
      if (!option) return false;
      select.value = option.value;
      option.selected = true;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    async setTextDateControl(input, desired, ctx, label) {
      input.focus({ preventScroll: true });
      this.setNativeInputValue(input, desired);
      await app.utils.sleep(100, ctx.token);
      return app.utils.normalizeText(input.value) === app.utils.normalizeText(desired);
    }

    async chooseCustomDateControl(control, desired, ctx, label, dialog) {
      await ctx.navigation.click(control, `X Advanced Search ${label}`);
      const option = await app.utils.waitFor(() => {
        const roleOptions = this.allVisible('[role="option"], [role="menuitem"]');
        const popupOptions = this.allVisible('[role="listbox"], [role="menu"], [data-testid*="Dropdown"], [data-testid*="dropdown"]')
          .flatMap((popup) => this.allVisible('[role="option"], [role="menuitem"], button, div, span', popup));
        const candidates = Array.from(new Set([...roleOptions, ...popupOptions]))
          .filter((element) => element.getAttribute('role') === 'option' || !dialog.contains(element));
        return candidates.find((element) => {
          const text = app.utils.normalizeText(this.controlText(element));
          return text === app.utils.normalizeText(desired) || text.includes(app.utils.normalizeText(desired));
        }) || null;
      }, { timeoutMs: 3000, intervalMs: 200, token: ctx.token });
      return option ? ctx.navigation.click(this.clickableForAdvancedSearch(option), `X Advanced Search ${label}: ${desired}`) : false;
    }

    async setDateControl(control, desired, ctx, label, dialog) {
      if (!control) return false;
      if (control.tagName === 'SELECT') return this.setSelectValue(control, desired);
      if (control.tagName === 'INPUT') return this.setTextDateControl(control, desired, ctx, label);
      return this.chooseCustomDateControl(control, desired, ctx, label, dialog);
    }

    async selectFromDate(dialog, section, dateLimit, ctx) {
      const controls = this.fromDateControls(section);
      if (controls.length < 3) {
        await ctx.logger.warn('[twitter] From date controls were not found');
        return false;
      }
      const month = await this.setDateControl(controls[0], dateLimit.monthName, ctx, 'From month', dialog)
        || await this.setDateControl(controls[0], dateLimit.month, ctx, 'From month', dialog);
      const day = await this.setDateControl(controls[1], dateLimit.day, ctx, 'From day', dialog);
      const year = await this.setDateControl(controls[2], dateLimit.year, ctx, 'From year', dialog);
      if (month && day && year) {
        await ctx.logger.info(`[twitter] From date selected: ${dateLimit.iso}`);
        return true;
      }
      await ctx.logger.warn('[twitter] From date selection failed', `month=${month}, day=${day}, year=${year}`);
      return false;
    }

    advancedSearchSubmitButton(dialog) {
      return this.allVisible('button, [role="button"]', dialog).find((button) => {
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
        const text = app.utils.normalizeText(this.controlText(button));
        return SEARCH_BUTTON_PATTERNS.some((pattern) => pattern.test(text));
      }) || null;
    }

    async submitAdvancedSearch(dialog, keyword, dateLimit, ctx) {
      const button = this.advancedSearchSubmitButton(dialog);
      if (!button) {
        await ctx.logger.warn('[twitter] Advanced search Search button was not found');
        return false;
      }
      await ctx.logger.info('[twitter] Advanced search Search button found');
      await ctx.logger.info('[twitter] Click: Advanced search submit');
      await ctx.navigation.click(button, 'Advanced search submit');
      const confirmed = await app.utils.waitFor(() => this.currentSearchMatchesDateLimit(keyword, dateLimit), {
        timeoutMs: 12000,
        intervalMs: 400,
        token: ctx.token
      });
      if (!confirmed) return false;
      this.latestConfirmed = new URL(location.href).searchParams.get('f') === 'live';
      await ctx.logger.info('[twitter] Advanced search submitted');
      await ctx.logger.info('[twitter] Advanced search results confirmed');
      return true;
    }

    async applyAdvancedSearchDateLimit(keyword, dateLimit, ctx) {
      await ctx.logger.info('[twitter] Date limit enabled; opening Advanced Search');
      await ctx.logger.info('[twitter] Advanced Search flow started');
      try {
        const link = await app.utils.waitFor(() => this.advancedSearchLink(), {
          timeoutMs: 8000,
          intervalMs: 300,
          token: ctx.token
        });
        if (!link) throw new Error('advanced search link not found');
        await ctx.logger.info('[twitter] Advanced search link found');
        await ctx.logger.info('[twitter] Click: Advanced search');
        await ctx.navigation.click(link, 'Advanced search');
        const dialog = await app.utils.waitFor(() => this.advancedSearchDialog(), {
          timeoutMs: 8000,
          intervalMs: 300,
          token: ctx.token
        });
        if (!dialog) throw new Error('advanced search modal not opened');
        await ctx.logger.info('[twitter] Advanced search modal opened');

        const input = this.advancedWordsInput(dialog);
        if (!input || !(await this.setAdvancedWordsInput(input, keyword, ctx))) throw new Error('allOfTheseWords input failed');
        const datesSection = await this.scrollToDatesSection(dialog, ctx);
        if (!datesSection) throw new Error('dates section not found');
        if (!(await this.selectFromDate(dialog, datesSection, dateLimit, ctx))) throw new Error('from date selection failed');
        if (await this.submitAdvancedSearch(dialog, keyword, dateLimit, ctx)) return { success: true };
        throw new Error('advanced search submit was not confirmed');
      } catch (error) {
        if (error instanceof app.utils.CancellationError) throw error;
        const fallbackUrl = twitterSinceSearchUrl(keyword, dateLimit);
        await ctx.logger.warn('[twitter] Advanced search UI failed; using since: fallback URL', `${error.message}; ${fallbackUrl}`);
        window.location.assign(fallbackUrl);
        return { success: false, navigating: true, fallback: true };
      }
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

  app.parsers = app.parsers || {};
  app.parsers.twitterDateLimit = parseTwitterDateLimit;
  app.parsers.twitterSinceSearchUrl = twitterSinceSearchUrl;
  app.scrapers.twitter = new TwitterScraper();
})(globalThis.ScraperApp);
