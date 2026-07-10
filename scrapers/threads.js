(function initializeThreadsScraper(app) {
  'use strict';

  const SOURCE_CONFIG = Object.freeze({
    source: 'threads',
    baseUrl: 'https://www.threads.com/',
    authorUrlBase: 'https://www.threads.com'
  });
  const REPLY_MARKERS = [
    'replying to',
    'in reply to',
    'replied to',
    '\u0432 \u043e\u0442\u0432\u0435\u0442',
    'cavab olaraq',
    'cavab verir'
  ];
  const AFTER_LABELS = [
    'after',
    'after date',
    '\u043f\u043e\u0441\u043b\u0435',
    'sonra',
    'tarixd\u0259n sonra'
  ];
  const RECENT_LABELS = [
    'recent',
    'recent posts',
    'latest',
    'newest',
    '\u043d\u0435\u0434\u0430\u0432\u043d\u0438\u0435',
    '\u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435',
    '\u0259n yeni',
    'son'
  ];
  const EXPAND_LABELS = [
    'see more',
    'show more',
    'read more',
    '\u0435\u0449\u0451',
    '\u0435\u0449\u0435',
    '\u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435',
    'daha \u00e7ox',
    'daha cox',
    'davam\u0131n\u0131 g\u00f6r',
    'devam\u0131n\u0131 g\u00f6r'
  ];
  const MONTH_ALIASES = Object.freeze([
    ['january', 'jan', '\u044f\u043d\u0432\u0430\u0440\u044c', '\u044f\u043d\u0432\u0430\u0440\u044f', '\u044f\u043d\u0432', 'yanvar'],
    ['february', 'feb', '\u0444\u0435\u0432\u0440\u0430\u043b\u044c', '\u0444\u0435\u0432\u0440\u0430\u043b\u044f', '\u0444\u0435\u0432', 'fevral'],
    ['march', 'mar', '\u043c\u0430\u0440\u0442', '\u043c\u0430\u0440\u0442\u0430', '\u043c\u0430\u0440', 'mart'],
    ['april', 'apr', '\u0430\u043f\u0440\u0435\u043b\u044c', '\u0430\u043f\u0440\u0435\u043b\u044f', '\u0430\u043f\u0440', 'aprel'],
    ['may', '\u043c\u0430\u0439', '\u043c\u0430\u044f'],
    ['june', 'jun', '\u0438\u044e\u043d\u044c', '\u0438\u044e\u043d\u044f', '\u0438\u044e\u043d', 'iyun'],
    ['july', 'jul', '\u0438\u044e\u043b\u044c', '\u0438\u044e\u043b\u044f', '\u0438\u044e\u043b', 'iyul'],
    ['august', 'aug', '\u0430\u0432\u0433\u0443\u0441\u0442', '\u0430\u0432\u0433\u0443\u0441\u0442\u0430', '\u0430\u0432\u0433', 'avqust'],
    ['september', 'sep', 'sept', '\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044c', '\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044f', '\u0441\u0435\u043d', 'sentyabr'],
    ['october', 'oct', '\u043e\u043a\u0442\u044f\u0431\u0440\u044c', '\u043e\u043a\u0442\u044f\u0431\u0440\u044f', '\u043e\u043a\u0442', 'oktyabr'],
    ['november', 'nov', '\u043d\u043e\u044f\u0431\u0440\u044c', '\u043d\u043e\u044f\u0431\u0440\u044f', '\u043d\u043e\u044f', 'noyabr'],
    ['december', 'dec', '\u0434\u0435\u043a\u0430\u0431\u0440\u044c', '\u0434\u0435\u043a\u0430\u0431\u0440\u044f', '\u0434\u0435\u043a', 'dekabr']
  ]);

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function parseThreadsDateLimit(value) {
    const text = String(value || '').trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let year;
    let month;
    let day;
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
    return { day, month, year, iso: `${year}-${pad(month)}-${pad(day)}` };
  }

  function buildThreadsSearchUrl(keyword, dateLimit = null, recent = false) {
    const parsedDate = typeof dateLimit === 'string' ? parseThreadsDateLimit(dateLimit) : dateLimit;
    const url = new URL('/search', SOURCE_CONFIG.baseUrl);
    if (parsedDate?.iso) url.searchParams.set('after_date', parsedDate.iso);
    url.searchParams.set('q', String(keyword || '').trim());
    url.searchParams.set('serp_type', 'default');
    if (recent) url.searchParams.set('filter', 'recent');
    return url.href;
  }

  function getCanonicalThreadsPostUrl(value) {
    try {
      const url = new URL(value, SOURCE_CONFIG.baseUrl);
      if (!/(^|\.)threads\.com$/i.test(url.hostname)) return '';
      const match = url.pathname.match(/^\/@([^/]+)\/post\/([^/?#]+)/i);
      if (!match) return '';
      return `${SOURCE_CONFIG.authorUrlBase}/@${match[1]}/post/${match[2]}`;
    } catch (error) {
      return '';
    }
  }

  function getThreadsAuthorFromUrl(value) {
    try {
      const url = new URL(value, SOURCE_CONFIG.baseUrl);
      const match = url.pathname.match(/^\/@([^/]+)(?:\/|$)/i);
      return match ? decodeURIComponent(match[1]) : '';
    } catch (error) {
      return '';
    }
  }

  function parseThreadsDatetime(value) {
    const date = new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function isThreadsReplyText(value) {
    const normalized = app.utils.normalizeText(value);
    return REPLY_MARKERS.some((marker) => normalized.includes(marker));
  }

  function uniqueThreadsMediaUrls(values) {
    const urls = new Set();
    for (const value of values || []) {
      const text = String(value || '').trim();
      if (!/^https?:\/\//i.test(text)) continue;
      urls.add(text);
    }
    return Array.from(urls);
  }

  function monthIndexFromText(value) {
    const tokens = app.utils.normalizeText(value).split(/[^\p{L}]+/u).filter(Boolean);
    return MONTH_ALIASES.findIndex((aliases) => aliases.some((alias) => tokens.includes(alias)));
  }

  function threadsMonthYearFromText(value) {
    const monthIndex = monthIndexFromText(value);
    const year = Number(String(value || '').match(/\b(20\d{2})\b/)?.[1]);
    return monthIndex >= 0 && year ? { month: monthIndex + 1, year } : null;
  }

  function threadsDatePartsFromText(value) {
    const monthYear = threadsMonthYearFromText(value);
    if (!monthYear) return null;
    const numbers = Array.from(String(value || '').matchAll(/\b(\d{1,4})\b/g), (match) => Number(match[1]));
    const day = numbers.find((number) => number >= 1 && number <= 31);
    return day ? { ...monthYear, day, iso: `${monthYear.year}-${pad(monthYear.month)}-${pad(day)}` } : null;
  }

  function isThreadsCandidateNested(candidate, candidates) {
    const index = candidates.indexOf(candidate);
    return candidates.some((other, otherIndex) => {
      if (other === candidate || !other.root || !candidate.root) return false;
      if (other.root === candidate.root) return otherIndex < index;
      return typeof other.root.contains === 'function' && other.root.contains(candidate.root);
    });
  }

  class ThreadsScraper extends app.BaseScraper {
    constructor() {
      super(SOURCE_CONFIG.source);
      this.seenPostUrls = new Set();
      this.processedPostUrls = new Set();
      this.recentConfirmed = false;
    }

    async ensureReady(ctx) {
      this.stopped = false;
      await ctx.logger.info('[threads] Opening Threads home');
      const complete = await app.utils.waitFor(() => document.readyState === 'complete', {
        timeoutMs: 15000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!complete) await ctx.logger.warn('[threads] document.readyState did not reach complete before timeout');

      const state = await app.utils.waitFor(() => this.pageState(), {
        timeoutMs: 12000,
        intervalMs: 300,
        token: ctx.token
      });
      if (state === 'challenge') throw new Error('Threads security challenge/checkpoint detected');
      if (state === 'unavailable') throw new Error('Threads page is unavailable');
      if (state === 'login-required') {
        await ctx.logger.error('[threads] \u0130stifad\u0259\u00e7i Threads hesab\u0131na daxil olmay\u0131b');
        return false;
      }
      if (!state) throw new Error('Threads application did not become ready');
      await ctx.logger.info('[threads] Threads authenticated application detected');
      return true;
    }

    pageState() {
      const path = location.pathname.toLowerCase();
      const bodyText = app.utils.normalizeText(document.body?.innerText || '').slice(0, 12000);
      if (/\/(challenge|checkpoint|security)/.test(path)
        || /security check|confirm your identity|\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u043b\u0438\u0447\u043d\u043e\u0441\u0442\u044c|t\u0259hl\u00fck\u0259sizlik yoxlamas\u0131/i.test(bodyText)) {
        return 'challenge';
      }
      if (/page isn't available|page unavailable|\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430|s\u0259hif\u0259 \u0259l\u00e7atan deyil/i.test(bodyText)) {
        return 'unavailable';
      }
      const loginLink = this.allVisible('a[href^="/login"], a[href*="show_choice_screen"]')[0];
      const loginPrompt = /log in or sign up for threads|continue with instagram|log in with username|threads-\u0259 daxil ol|\u0432\u043e\u0439\u0442\u0438 \u0438\u043b\u0438 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f/i.test(bodyText);
      if (/^\/login(?:\/|$)/.test(path) || (loginLink && loginPrompt)) return 'login-required';
      if (document.querySelector('a[href="/search"], input[type="search"], a[href*="/post/"]')) return 'authenticated';
      return null;
    }

    progress(ctx) {
      const current = ctx.state?.scraperProgress;
      return current?.platform === SOURCE_CONFIG.source && current.keyword === ctx.state.currentKeyword
        ? { ...current }
        : { platform: SOURCE_CONFIG.source, keyword: ctx.state.currentKeyword, dateFallbacks: 0, recentFallbacks: 0 };
    }

    async patchProgress(ctx, patch) {
      const next = { ...this.progress(ctx), ...patch };
      ctx.state.scraperProgress = next;
      await app.storage.patch(ctx.state.runId, { scraperProgress: next });
      return next;
    }

    controlText(element) {
      return app.utils.normalizeText(`${element?.getAttribute?.('aria-label') || ''} ${this.text(element)}`);
    }

    findSearchInput() {
      return this.visible([
        'input[type="search"]',
        'input[placeholder="Search"]',
        'input[placeholder="\u041f\u043e\u0438\u0441\u043a"]',
        'input[placeholder="Axtar\u0131\u015f"]'
      ].join(', '));
    }

    findSearchNavigation() {
      const direct = this.allVisible('a[href="/search"], a[href^="/search?"]')
        .find((link) => {
          try { return new URL(link.href, location.origin).pathname === '/search'; } catch (error) { return false; }
        });
      if (direct) return direct;
      const icon = this.allVisible('svg[aria-label]')
        .find((svg) => /^(search|\u043f\u043e\u0438\u0441\u043a|axtar\u0131\u015f)$/i.test(app.utils.normalizeText(svg.getAttribute('aria-label'))));
      return icon?.closest('a[href], button, [role="link"], [role="button"]') || null;
    }

    async openSearchPage(ctx) {
      if (location.pathname === '/search' && this.findSearchInput()) return { success: true };
      for (let attempt = 1; attempt <= 3; attempt++) {
        ctx.token.throwIfCancelled();
        const control = this.findSearchNavigation();
        if (!control) {
          await ctx.logger.warn(`[threads] Search navigation control not found (${attempt}/3)`);
          await app.utils.sleep(700 + attempt * 250, ctx.token);
          continue;
        }
        await ctx.logger.info('[threads] Search navigation control found');
        await ctx.logger.info('[threads] Click: Threads search navigation');
        await ctx.navigation.click(control, 'Threads search navigation');
        const opened = await app.utils.waitFor(() => location.pathname === '/search' && this.findSearchInput(), {
          timeoutMs: 6000,
          intervalMs: 250,
          token: ctx.token
        });
        if (opened) {
          await ctx.logger.info('[threads] Search page opened');
          return { success: true };
        }
      }
      await ctx.logger.warn('[threads] Search UI failed; waiting before /search fallback');
      await app.utils.sleep(3500, ctx.token);
      await ctx.logger.warn('[threads] Search UI failed; using /search fallback');
      location.assign(`${SOURCE_CONFIG.authorUrlBase}/search`);
      return { success: false, navigating: true, fallback: true };
    }

    currentQuery() {
      try { return new URL(location.href).searchParams.get('q') || ''; } catch (error) { return ''; }
    }

    searchMatchesKeyword(keyword) {
      return location.pathname.replace(/\/+$/, '') === '/search'
        && app.utils.normalizeText(this.currentQuery()) === app.utils.normalizeText(keyword);
    }

    resultsHeadingMatches(keyword) {
      return this.allVisible('a[aria-label="Column title"], h1, [role="heading"]')
        .some((element) => app.utils.normalizeText(this.text(element)) === app.utils.normalizeText(keyword));
    }

    postFingerprint() {
      return Array.from(document.querySelectorAll('a[href*="/post/"]'))
        .map((link) => getCanonicalThreadsPostUrl(link.href || link.getAttribute('href')))
        .filter(Boolean)
        .slice(0, 12)
        .join('|');
    }

    noResultsVisible() {
      const text = app.utils.normalizeText(document.body?.innerText || '');
      return /no results|no threads found|\u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e|n\u0259tic\u0259 tap\u0131lmad\u0131/i.test(text);
    }

    async waitForSearchResults(keyword, previousFingerprint, ctx) {
      await ctx.logger.info('[threads] Waiting for search results');
      const ready = await app.utils.waitFor(() => {
        if (!this.searchMatchesKeyword(keyword)) return false;
        const fingerprint = this.postFingerprint();
        return this.noResultsVisible()
          || this.resultsHeadingMatches(keyword)
          || (fingerprint && (!previousFingerprint || fingerprint !== previousFingerprint));
      }, { timeoutMs: 15000, intervalMs: 300, token: ctx.token });
      if (!ready) {
        await ctx.logger.warn('[threads] Search results were not confirmed before timeout', location.href);
        return false;
      }
      await ctx.logger.info('[threads] Search results confirmed');
      return true;
    }

    urlHasDate(dateLimit) {
      try { return new URL(location.href).searchParams.get('after_date') === dateLimit?.iso; } catch (error) { return false; }
    }

    labelMatches(value, labels) {
      const normalized = app.utils.normalizeText(value);
      return labels.some((label) => normalized === label || normalized.startsWith(`${label} `));
    }

    findFilterButton() {
      const controls = this.allVisible('button, [role="button"]');
      const direct = controls.find((element) => /^(filter|add filter|\u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0444\u0438\u043b\u044c\u0442\u0440|filtr \u0259lav\u0259 et)$/i.test(this.controlText(element)));
      if (direct) return direct;
      const icon = this.allVisible('svg[aria-label]').find((element) => /^(filter|add filter|\u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0444\u0438\u043b\u044c\u0442\u0440|filtr \u0259lav\u0259 et)$/i.test(app.utils.normalizeText(element.getAttribute('aria-label'))));
      return icon?.closest('button, [role="button"], [role="menuitem"], a') || null;
    }

    findAfterMenuItem() {
      return this.allVisible('[role="menuitem"]')
        .find((element) => this.labelMatches(this.controlText(element), AFTER_LABELS)) || null;
    }

    activeAfterChip() {
      return this.allVisible('[role="button"][aria-haspopup="dialog"]')
        .find((element) => {
          if (!this.labelMatches(this.controlText(element), AFTER_LABELS)) return false;
          return !/^(clear|\u043e\u0447\u0438\u0441\u0442\u0438\u0442\u044c|t\u0259mizl\u0259)$/i.test(this.controlText(element));
        }) || null;
    }

    activeChipMatches(dateLimit) {
      const chip = this.activeAfterChip();
      const parsed = chip ? threadsDatePartsFromText(this.text(chip)) : null;
      return !!parsed && parsed.iso === dateLimit.iso;
    }

    async addAfterFilter(ctx) {
      if (this.activeAfterChip()) return true;
      const button = this.findFilterButton();
      if (!button) return false;
      await ctx.logger.info('[threads] Filter button found');
      await ctx.navigation.click(button, 'Threads filter');
      const menuItem = await app.utils.waitFor(() => this.findAfterMenuItem(), {
        timeoutMs: 4000,
        intervalMs: 200,
        token: ctx.token
      });
      if (!menuItem) return false;
      await ctx.logger.info('[threads] Filter menu opened');
      await ctx.logger.info('[threads] After filter menu item found');
      await ctx.logger.info('[threads] Click: Threads After filter');
      await ctx.navigation.click(menuItem, 'Threads After filter');
      const chip = await app.utils.waitFor(() => this.activeAfterChip(), {
        timeoutMs: 4000,
        intervalMs: 200,
        token: ctx.token
      });
      if (chip) await ctx.logger.info('[threads] After filter added');
      return !!chip;
    }

    calendarGrid() {
      return this.allVisible('[role="grid"]').find((grid) => {
        const label = app.utils.normalizeText(grid.getAttribute('aria-label'));
        return /choose date|date picker|\u0432\u044b\u0431\u043e\u0440 \u0434\u0430\u0442\u044b|tarix se\u00e7/i.test(label)
          || grid.querySelectorAll('[role="gridcell"]').length >= 28;
      }) || null;
    }

    calendarHeading(grid) {
      const scope = grid?.closest('[role="menu"], [role="dialog"], [role="presentation"]') || document;
      return this.allVisible('h1, h2, [role="heading"], [role="status"]', scope)
        .find((element) => threadsMonthYearFromText(this.text(element))) || null;
    }

    calendarMoveButton(direction, grid) {
      const scope = grid?.closest('[role="menu"], [role="dialog"], [role="presentation"]') || document;
      const previous = direction < 0;
      const labels = previous
        ? ['previous month', '\u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0439 \u043c\u0435\u0441\u044f\u0446', '\u0259vv\u0259lki ay']
        : ['next month', '\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u043c\u0435\u0441\u044f\u0446', 'n\u00f6vb\u0259ti ay'];
      return this.allVisible('button[aria-label], [role="button"][aria-label]', scope)
        .find((element) => labels.includes(app.utils.normalizeText(element.getAttribute('aria-label')))) || null;
    }

    targetCalendarCell(grid, dateLimit) {
      return this.allVisible('[role="gridcell"]', grid).find((cell) => {
        if (cell.getAttribute('aria-disabled') === 'true') return false;
        const value = `${cell.getAttribute('aria-label') || ''} ${this.text(cell)}`;
        return threadsDatePartsFromText(value)?.iso === dateLimit.iso;
      }) || null;
    }

    async openCalendar(ctx) {
      const chip = this.activeAfterChip();
      if (!chip) return null;
      await ctx.logger.info('[threads] Active After date filter found');
      const clear = chip.querySelector('svg[aria-label], button[aria-label]');
      if (clear && /clear|\u043e\u0447\u0438\u0441\u0442\u0438\u0442\u044c|t\u0259mizl\u0259/i.test(clear.getAttribute('aria-label') || '')) {
        await ctx.logger.info('[threads] Clear filter button ignored');
      }
      await ctx.logger.info('[threads] Date picker trigger found');
      await ctx.navigation.click(chip, 'Threads date picker', { scroll: false });
      const grid = await app.utils.waitFor(() => this.calendarGrid(), {
        timeoutMs: 4000,
        intervalMs: 200,
        token: ctx.token
      });
      if (grid) await ctx.logger.info('[threads] Date picker opened');
      return grid;
    }

    async selectCalendarDate(grid, dateLimit, ctx) {
      for (let move = 0; move <= 120; move++) {
        ctx.token.throwIfCancelled();
        const heading = this.calendarHeading(grid);
        const current = threadsMonthYearFromText(this.text(heading));
        if (!current) return false;
        await ctx.logger.info(`[threads] Calendar current month: ${current.year}-${pad(current.month)}`);
        const currentIndex = current.year * 12 + current.month;
        const targetIndex = dateLimit.year * 12 + dateLimit.month;
        if (currentIndex === targetIndex) break;
        const direction = targetIndex < currentIndex ? -1 : 1;
        const button = this.calendarMoveButton(direction, grid);
        if (!button) return false;
        const before = this.text(heading);
        await ctx.logger.info(direction < 0 ? '[threads] Moving calendar to previous month' : '[threads] Moving calendar to next month');
        await ctx.navigation.click(button, direction < 0 ? 'Threads Previous Month' : 'Threads Next Month', { scroll: false });
        const changed = await app.utils.waitFor(() => {
          const nextHeading = this.calendarHeading(this.calendarGrid() || grid);
          return nextHeading && this.text(nextHeading) !== before;
        }, { timeoutMs: 4000, intervalMs: 200, token: ctx.token });
        if (!changed) return false;
        grid = this.calendarGrid() || grid;
      }

      const cell = this.targetCalendarCell(grid, dateLimit);
      if (!cell) return false;
      await ctx.logger.info('[threads] Target calendar date found');
      await ctx.navigation.click(cell, `Threads calendar date ${dateLimit.iso}`, { scroll: false });
      const selected = await app.utils.waitFor(() => this.urlHasDate(dateLimit) || this.activeChipMatches(dateLimit) || !this.calendarGrid(), {
        timeoutMs: 5000,
        intervalMs: 200,
        token: ctx.token
      });
      if (selected) await ctx.logger.info(`[threads] Date selected: ${dateLimit.iso}`);
      return !!selected;
    }

    async ensureDateFilter(dateLimit, ctx) {
      await ctx.logger.info('[threads] Date limit enabled: true');
      await ctx.logger.info(`[threads] Target filter date: ${dateLimit.iso}`);
      if (this.urlHasDate(dateLimit) || this.activeChipMatches(dateLimit)) return true;

      for (let attempt = 1; attempt <= 3; attempt++) {
        ctx.token.throwIfCancelled();
        await ctx.logger.info(`[threads] Date filter UI attempt ${attempt}/3`);
        try {
          if (!(await this.addAfterFilter(ctx))) throw new Error('After filter was not added');
          if (this.activeChipMatches(dateLimit)) return true;
          const grid = await this.openCalendar(ctx);
          if (!grid) throw new Error('calendar did not open');
          if (!(await this.selectCalendarDate(grid, dateLimit, ctx))) throw new Error('target date was not selected');
          await this.patchProgress(ctx, { dateSelected: dateLimit.iso });
          return true;
        } catch (error) {
          if (error instanceof app.utils.CancellationError) throw error;
          await ctx.logger.warn(`[threads] Date filter UI attempt ${attempt} failed`, error.message);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          await app.utils.sleep(600 + attempt * 250, ctx.token);
        }
      }
      return false;
    }

    findRecentControl() {
      const direct = this.allVisible('a[href*="filter=recent"]')[0];
      if (direct) return direct;
      return this.allVisible('a[role="link"], [role="tab"], button[role="tab"], [aria-label]')
        .find((element) => {
          const text = this.controlText(element);
          if (!RECENT_LABELS.includes(text)) return false;
          const href = element.getAttribute('href') || '';
          return !href || href.includes('/search');
        }) || null;
    }

    recentIsConfirmed() {
      try {
        if (new URL(location.href).searchParams.get('filter') === 'recent') return true;
      } catch (error) {}
      const control = this.findRecentControl();
      return !!control && (control.getAttribute('aria-selected') === 'true' || control.getAttribute('aria-current') === 'page');
    }

    async ensureRecent(keyword, dateLimit, ctx) {
      if (this.recentIsConfirmed()) {
        this.recentConfirmed = true;
        await this.patchProgress(ctx, { recentConfirmed: true });
        await ctx.logger.info('[threads] Recent results confirmed');
        return { success: true };
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        ctx.token.throwIfCancelled();
        const control = this.findRecentControl();
        if (!control) {
          await ctx.logger.warn(`[threads] Recent tab not found (${attempt}/3)`);
          await app.utils.sleep(600 + attempt * 250, ctx.token);
          continue;
        }
        await ctx.logger.info('[threads] Recent tab found');
        await ctx.logger.info('[threads] Click: Threads Recent');
        await ctx.navigation.click(control, 'Threads Recent');
        const confirmed = await app.utils.waitFor(() => this.recentIsConfirmed(), {
          timeoutMs: 6000,
          intervalMs: 250,
          token: ctx.token
        });
        if (confirmed) {
          this.recentConfirmed = true;
          await this.patchProgress(ctx, { recentConfirmed: true });
          await ctx.logger.info('[threads] Recent results confirmed');
          return { success: true };
        }
      }

      const progress = this.progress(ctx);
      if (Number(progress.recentFallbacks || 0) >= 2) {
        this.recentConfirmed = false;
        await ctx.logger.warn('[threads] Recent could not be confirmed after UI and URL fallbacks; continuing with local date ordering');
        return { success: true, recentUnconfirmed: true };
      }
      const fallbackUrl = buildThreadsSearchUrl(keyword, dateLimit, true);
      await this.patchProgress(ctx, { recentFallbacks: Number(progress.recentFallbacks || 0) + 1 });
      await ctx.logger.warn('[threads] Recent UI failed; applying filter=recent fallback', fallbackUrl);
      location.assign(fallbackUrl);
      return { success: false, navigating: true, fallback: true };
    }

    async search(keyword, ctx) {
      this.stopped = false;
      await ctx.logger.info(`[threads] Keyword started: ${keyword}`);
      const dateLimit = parseThreadsDateLimit(ctx.state?.dateLimit);
      const progress = this.progress(ctx);

      if (this.searchMatchesKeyword(keyword)) {
        const dateSatisfied = !dateLimit
          || this.urlHasDate(dateLimit)
          || this.activeChipMatches(dateLimit)
          || progress.dateSelected === dateLimit.iso
          || Number(progress.dateFallbacks || 0) > 0;
        if (dateSatisfied) {
          if (dateLimit && !this.urlHasDate(dateLimit) && !this.activeChipMatches(dateLimit)) {
            await ctx.logger.warn('[threads] after_date was not confirmed by Threads; per-post date validation remains active');
          }
          await this.waitForSearchResults(keyword, '', ctx);
          return this.ensureRecent(keyword, dateLimit, ctx);
        }
      }

      const searchPage = await this.openSearchPage(ctx);
      if (searchPage.navigating) return searchPage;
      const input = await app.utils.waitFor(() => this.findSearchInput(), {
        timeoutMs: 8000,
        intervalMs: 250,
        token: ctx.token
      });
      if (!input) throw new Error('Threads search input was not found');
      await ctx.logger.info('[threads] Search input found');

      if (dateLimit && !(await this.ensureDateFilter(dateLimit, ctx))) {
        const currentProgress = this.progress(ctx);
        const fallbackUrl = buildThreadsSearchUrl(keyword, dateLimit, false);
        await this.patchProgress(ctx, { dateFallbacks: Number(currentProgress.dateFallbacks || 0) + 1 });
        await ctx.logger.warn('[threads] Date filter UI failed; using after_date URL fallback', fallbackUrl);
        location.assign(fallbackUrl);
        return { success: false, navigating: true, fallback: true };
      }
      if (!dateLimit) await ctx.logger.info('[threads] Date limit enabled: false');

      const beforeFingerprint = this.postFingerprint();
      const result = await ctx.navigation.search({
        platform: 'Threads',
        keyword,
        attempts: 3,
        findInput: () => this.findSearchInput(),
        verify: () => this.searchMatchesKeyword(keyword),
        fallbackUrl: () => buildThreadsSearchUrl(keyword, dateLimit, false),
        typeInput: async (activeInput, value) => {
          await ctx.logger.info('[threads] Search input focused');
          await ctx.logger.info(`[threads] Typing keyword: ${value}`);
          const typed = await ctx.navigation.type(activeInput, value, 'Threads search input');
          if (typed) await ctx.logger.info('[threads] Keyword verified');
          return typed;
        },
        pressEnter: async (activeInput, verify) => {
          const success = await ctx.navigation.pressEnter(activeInput, verify, 'Threads search input');
          await ctx.logger.info('[threads] Enter pressed');
          return success;
        }
      });
      if (result.navigating) return result;
      if (!(await this.waitForSearchResults(keyword, beforeFingerprint, ctx))) {
        const fallbackUrl = buildThreadsSearchUrl(keyword, dateLimit, false);
        await ctx.logger.warn('[threads] Search confirmation failed after Enter; using URL fallback', fallbackUrl);
        location.assign(fallbackUrl);
        return { success: false, navigating: true, fallback: true };
      }
      return this.ensureRecent(keyword, dateLimit, ctx);
    }

    belongsToRoot(element, root) {
      const nearest = element?.closest?.('[data-pressable-container="true"]');
      if (root.matches?.('[data-pressable-container="true"]')) return !nearest || nearest === root;
      return !nearest || nearest === root || !root.contains(nearest);
    }

    exactPermalinkLinks(root) {
      return Array.from(root.querySelectorAll('a[href*="/post/"]')).filter((link) => {
        try {
          const url = new URL(link.href || link.getAttribute('href'), SOURCE_CONFIG.baseUrl);
          return /^\/@[^/]+\/post\/[^/]+\/?$/i.test(url.pathname) && !!link.querySelector('time[datetime]');
        } catch (error) {
          return false;
        }
      });
    }

    rootSignals(root) {
      const profileLinks = Array.from(root.querySelectorAll('a[href^="/@"]')).filter((link) => {
        try { return /^\/@[^/]+\/?$/i.test(new URL(link.href, location.origin).pathname); } catch (error) { return false; }
      });
      const permalinks = this.exactPermalinkLinks(root);
      const media = root.querySelectorAll('img[src], video').length;
      const textNodes = root.querySelectorAll('[dir="auto"]').length;
      return {
        hasAuthor: profileLinks.length > 0,
        hasPermalink: permalinks.length > 0,
        hasDate: root.querySelectorAll('time[datetime]').length > 0,
        hasContent: textNodes > 1 || media > 0,
        permalinkCount: permalinks.length,
        textLength: this.text(root).length
      };
    }

    findThreadsPostRoot(seedElement) {
      const permalink = seedElement?.matches?.('a[href*="/post/"]')
        ? seedElement
        : seedElement?.closest?.('a[href*="/post/"]') || seedElement?.querySelector?.('a[href*="/post/"]');
      if (!permalink) return null;
      const pressable = permalink.closest('[data-pressable-container="true"]');
      if (pressable && this.rootSignals(pressable).permalinkCount === 1) return pressable;
      const article = permalink.closest('article, [role="article"]');
      if (article && this.rootSignals(article).permalinkCount === 1) return article;

      let best = null;
      let current = permalink.parentElement;
      for (let level = 1; current && level <= 12 && current !== document.body; level++, current = current.parentElement) {
        const signals = this.rootSignals(current);
        if (signals.hasAuthor && signals.hasPermalink && signals.hasDate && signals.hasContent && signals.textLength < 12000) {
          best = current;
          if (signals.permalinkCount === 1) break;
        }
        if (current === pressable || current === article) break;
      }
      return best || pressable || article;
    }

    collectThreadsPostCandidates() {
      const unique = new Map();
      const links = Array.from(document.querySelectorAll('a[href*="/post/"]')).filter((link) => {
        try {
          const url = new URL(link.href || link.getAttribute('href'), SOURCE_CONFIG.baseUrl);
          return /^\/@[^/]+\/post\/[^/]+\/?$/i.test(url.pathname) && !!link.querySelector('time[datetime]');
        } catch (error) { return false; }
      });
      for (const permalink of links) {
        const postUrl = getCanonicalThreadsPostUrl(permalink.href || permalink.getAttribute('href'));
        const root = this.findThreadsPostRoot(permalink);
        if (!postUrl || !root) continue;
        if (!unique.has(postUrl)) unique.set(postUrl, { postUrl, permalink, root });
        this.seenPostUrls.add(postUrl);
      }
      return Array.from(unique.values());
    }

    ownText(root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('[data-pressable-container="true"]').forEach((nested) => nested.remove());
      return this.text(clone);
    }

    isThreadsReply(root) {
      return isThreadsReplyText(this.ownText(root));
    }

    primaryPermalink(root, postUrl = '') {
      const links = this.exactPermalinkLinks(root).filter((link) => this.belongsToRoot(link, root));
      return links.find((link) => getCanonicalThreadsPostUrl(link.href || link.getAttribute('href')) === postUrl) || links[0] || null;
    }

    parsePostDate(root, postUrl = '') {
      const permalink = this.primaryPermalink(root, postUrl);
      const time = permalink?.querySelector('time[datetime]')
        || Array.from(root.querySelectorAll('time[datetime]')).find((element) => this.belongsToRoot(element, root));
      return parseThreadsDatetime(time?.getAttribute('datetime'));
    }

    parsePostText(root, postUrl) {
      const permalink = this.primaryPermalink(root, postUrl);
      const candidates = this.allVisible('span[dir="auto"], div[dir="auto"]', root).filter((element) => {
        if (!this.belongsToRoot(element, root)) return false;
        if (element.closest('time, button, [role="button"], [role="menu"], [role="dialog"]')) return false;
        if (permalink && !(permalink.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        const link = element.closest('a[href]');
        if (link) {
          const href = link.getAttribute('href') || '';
          if (/^\/@[^/]+\/?$/i.test(href) || /\/post\//i.test(href) && link.querySelector('time')) return false;
          if (link.querySelector('img, video') || /\/post\/[^/]+\/media/i.test(href)) return false;
        }
        const value = this.text(element);
        if (!value || /^\d+[km.,]?$/i.test(value)) return false;
        const normalized = app.utils.normalizeText(value);
        if (/^(translate|see translation|\u043f\u0435\u0440\u0435\u0432\u0435\u0441\u0442\u0438|t\u0259rc\u00fcm\u0259 et)$/.test(normalized)) return false;
        if (REPLY_MARKERS.some((marker) => normalized.startsWith(marker))) return false;
        return true;
      });
      const segments = [];
      for (const element of candidates) {
        const value = this.text(element);
        if (!value || segments.includes(value)) continue;
        if (candidates.some((other) => other !== element && other.contains(element) && this.text(other) === value)) continue;
        segments.push(value);
      }
      return segments.join('\n').trim();
    }

    imageIsContent(image, root) {
      if (!this.belongsToRoot(image, root)) return false;
      const url = image.currentSrc || image.src || image.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(url)) return false;
      const alt = app.utils.normalizeText(image.getAttribute('alt'));
      if (/profile picture|avatar|emoji|\u0444\u043e\u0442\u043e \u043f\u0440\u043e\u0444\u0438\u043b\u044f|profil \u015f\u0259kli/i.test(alt)) return false;
      const profileLink = image.closest('a[href^="/@"]');
      if (profileLink) {
        try {
          if (/^\/@[^/]+\/?$/i.test(new URL(profileLink.href, location.origin).pathname)) return false;
        } catch (error) {}
      }
      const width = Math.max(image.width || 0, image.naturalWidth || 0);
      const height = Math.max(image.height || 0, image.naturalHeight || 0);
      const renderedLargeEnough = (image.width || 0) >= 80 || (image.height || 0) >= 80;
      return renderedLargeEnough && width >= 120 && height >= 120;
    }

    collectMediaUrls(root) {
      const values = [];
      for (const image of root.querySelectorAll('img[src]')) {
        if (this.imageIsContent(image, root)) values.push(image.currentSrc || image.src || image.getAttribute('src'));
      }
      for (const video of root.querySelectorAll('video')) {
        if (!this.belongsToRoot(video, root)) continue;
        values.push(video.currentSrc, video.src, video.getAttribute('src'));
        for (const source of video.querySelectorAll('source[src]')) values.push(source.src || source.getAttribute('src'));
        values.push(video.poster || video.getAttribute('poster'));
      }
      return uniqueThreadsMediaUrls(values);
    }

    async expandPostText(root, ctx) {
      let expanded = false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        ctx.token.throwIfCancelled();
        const permalink = this.primaryPermalink(root);
        const candidates = this.allVisible('button, [role="button"], span', root).filter((element) => {
          if (!this.belongsToRoot(element, root)) return false;
          if (permalink && !(permalink.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
          const value = this.controlText(element);
          return EXPAND_LABELS.includes(value) && !element.closest('a[href*="/media"], video');
        });
        if (!candidates.length) return expanded;
        await ctx.logger.info(`[threads] Expand candidates found: ${candidates.length}`);
        const before = this.parsePostText(root, getCanonicalThreadsPostUrl(permalink?.href)).length;
        let changed = false;
        for (const candidate of candidates) {
          const clickable = candidate.closest('button, [role="button"], a, [tabindex]') || candidate;
          await ctx.logger.info(`[threads] Trying expand candidate: ${this.text(candidate)}`);
          await ctx.navigation.click(clickable, 'Threads expand post text', { scroll: false });
          changed = !!(await app.utils.waitFor(() => {
            const after = this.parsePostText(root, getCanonicalThreadsPostUrl(permalink?.href)).length;
            return after > before || !candidate.isConnected;
          }, { timeoutMs: 3500, intervalMs: 200, token: ctx.token }));
          if (changed) {
            expanded = true;
            await ctx.logger.info('[threads] Post text expanded');
            break;
          }
        }
        if (!changed) return expanded;
      }
      return expanded;
    }

    parsePost(root, postUrl = '') {
      const canonicalUrl = getCanonicalThreadsPostUrl(postUrl || this.primaryPermalink(root)?.href);
      if (!canonicalUrl) return null;
      if (this.isAdvertisement(root)) return { advertisement: true, postUrl: canonicalUrl };
      if (this.isThreadsReply(root)) return { reply: true, postUrl: canonicalUrl };
      const author = getThreadsAuthorFromUrl(canonicalUrl);
      const postDate = this.parsePostDate(root, canonicalUrl);
      const mediaUrls = this.collectMediaUrls(root);
      return {
        source: SOURCE_CONFIG.source,
        postDate,
        postUrl: canonicalUrl,
        author,
        authorUrl: author ? `${SOURCE_CONFIG.authorUrlBase}/@${author}` : '',
        text: this.parsePostText(root, canonicalUrl),
        mediaUrls
      };
    }

    shouldSkipPost(post) {
      if (!post || post.advertisement || post.reply) return true;
      if (!post.postUrl || !post.author || !post.authorUrl || !post.postDate) return true;
      return !post.text && !(post.mediaUrls || []).length;
    }

    endOfResultsVisible() {
      const text = app.utils.normalizeText(document.body?.innerText || '');
      return /no more threads|end of results|no more results|\u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435\u0442 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u043e\u0432|daha n\u0259tic\u0259 yoxdur/i.test(text);
    }

    async finishKeyword(ctx, reason) {
      await ctx.logger.info(`[threads] Keyword finished: ${reason}`);
      return { reason };
    }

    async collect(ctx) {
      let noNewRounds = 0;
      let consecutiveOld = 0;
      while (noNewRounds < 5) {
        ctx.token.throwIfCancelled();
        const allCandidates = this.collectThreadsPostCandidates();
        await ctx.logger.info(`[threads] Post candidates found: ${allCandidates.length}`);
        const candidates = allCandidates
          .filter((candidate) => !this.processedPostUrls.has(candidate.postUrl))
          .sort((left, right) => {
            const leftDate = this.parsePostDate(left.root, left.postUrl) || '';
            const rightDate = this.parsePostDate(right.root, right.postUrl) || '';
            return new Date(rightDate || 0).getTime() - new Date(leftDate || 0).getTime();
          });
        let processedThisRound = 0;

        for (const candidate of candidates) {
          ctx.token.throwIfCancelled();
          this.processedPostUrls.add(candidate.postUrl);
          processedThisRound++;
          if (isThreadsCandidateNested(candidate, allCandidates)) {
            await ctx.logger.info('[threads] Nested quoted post ignored', candidate.postUrl);
            continue;
          }
          if (this.isThreadsReply(candidate.root)) {
            await ctx.logger.info('[threads] Reply post detected', candidate.postUrl);
            await ctx.logger.info('[threads] Reply skipped', candidate.postUrl);
            continue;
          }
          if (this.isAdvertisement(candidate.root)) {
            await ctx.logger.info('[threads] Sponsored post skipped', candidate.postUrl);
            continue;
          }

          await this.expandPostText(candidate.root, ctx);
          const post = this.parsePost(candidate.root, candidate.postUrl);
          if (this.shouldSkipPost(post)) {
            await ctx.logger.warn('[threads] Invalid post skipped', candidate.postUrl);
            continue;
          }
          await ctx.logger.info(`[threads] Author extracted: ${post.author}`);
          await ctx.logger.info(`[threads] Date extracted: ${post.postDate}`);
          await ctx.logger.info(`[threads] Text length: ${post.text.length}`);
          await ctx.logger.info(`[threads] Media URLs collected: ${post.mediaUrls.length}`);
          const outcome = await ctx.onPost(post);
          if (outcome.accepted) await ctx.logger.info('[threads] Post saved', post.postUrl);
          if (outcome.limitReached) return this.finishKeyword(ctx, 'target');
          if (outcome.older) {
            consecutiveOld++;
            if (this.recentConfirmed && consecutiveOld >= 3) return this.finishKeyword(ctx, 'date-limit');
          } else if (outcome.accepted) {
            consecutiveOld = 0;
          }
        }

        if (this.endOfResultsVisible()) return this.finishKeyword(ctx, 'exhausted');
        const beforeSeen = this.seenPostUrls.size;
        await ctx.logger.info('[threads] Scrolling for more posts');
        await this.scrollPage(ctx);
        const loaded = await app.utils.waitFor(() => {
          this.collectThreadsPostCandidates();
          return this.seenPostUrls.size > beforeSeen;
        }, { timeoutMs: 5000, intervalMs: 300, token: ctx.token });
        noNewRounds = processedThisRound || loaded ? 0 : noNewRounds + 1;
      }
      return this.finishKeyword(ctx, 'exhausted');
    }

    async cleanup() {
      this.seenPostUrls.clear();
      this.processedPostUrls.clear();
      this.recentConfirmed = false;
      await super.cleanup();
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.threadsDateLimit = parseThreadsDateLimit;
  app.parsers.threadsSearchUrl = buildThreadsSearchUrl;
  app.parsers.threadsCanonicalPostUrl = getCanonicalThreadsPostUrl;
  app.parsers.threadsAuthorFromUrl = getThreadsAuthorFromUrl;
  app.parsers.threadsDatetime = parseThreadsDatetime;
  app.parsers.threadsReplyText = isThreadsReplyText;
  app.parsers.threadsMediaUrls = uniqueThreadsMediaUrls;
  app.parsers.threadsMonthYear = threadsMonthYearFromText;
  app.parsers.threadsDateParts = threadsDatePartsFromText;
  app.parsers.threadsCandidateNested = isThreadsCandidateNested;
  app.scrapers[SOURCE_CONFIG.source] = new ThreadsScraper();
})(globalThis.ScraperApp);
