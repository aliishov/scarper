(function initializeFacebookScraper(app) {
  'use strict';

  const MONTHS = new Map([
    ['january', 0], ['jan', 0], ['января', 0], ['янв', 0], ['yanvar', 0],
    ['february', 1], ['feb', 1], ['февраля', 1], ['фев', 1], ['fevral', 1],
    ['march', 2], ['mar', 2], ['марта', 2], ['мар', 2], ['mart', 2],
    ['april', 3], ['apr', 3], ['апреля', 3], ['апр', 3], ['aprel', 3],
    ['may', 4], ['мая', 4], ['mayıs', 4], ['mayis', 4],
    ['june', 5], ['jun', 5], ['июня', 5], ['июн', 5], ['iyun', 5],
    ['july', 6], ['jul', 6], ['июля', 6], ['июл', 6], ['iyul', 6],
    ['august', 7], ['aug', 7], ['августа', 7], ['авг', 7], ['avqust', 7],
    ['september', 8], ['sep', 8], ['sept', 8], ['сентября', 8], ['сен', 8], ['sentyabr', 8],
    ['october', 9], ['oct', 9], ['октября', 9], ['окт', 9], ['oktyabr', 9],
    ['november', 10], ['nov', 10], ['ноября', 10], ['ноя', 10], ['noyabr', 10],
    ['december', 11], ['dec', 11], ['декабря', 11], ['дек', 11], ['dekabr', 11]
  ]);

  function validDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime()) && date.getFullYear() >= 2004 && date.getTime() <= Date.now() + 300000;
  }

  function parseFacebookDate(value, now = new Date()) {
    if (value === null || value === undefined) return null;
    const original = String(value).replace(/\u00a0/g, ' ').replace(/[\u200e\u200f]/g, '').trim();
    if (!original) return null;
    if (/^\d{10,13}$/.test(original)) {
      const number = Number(original);
      const parsed = new Date(number < 1e12 ? number * 1000 : number);
      return validDate(parsed) ? parsed : null;
    }

    const normalized = original
      .replace(/\bwensday\b/gi, 'Wednesday')
      .replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье),?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const lower = normalized.toLowerCase().replace(/\./g, '');

    if (/^(just now|сейчас|только что|indi)$/.test(lower)) return new Date(now);
    if (/^(today|сегодня|bu gün|bu gun)/.test(lower)) return new Date(now);
    if (/^(yesterday|вчера|dünən|dunen)/.test(lower)) {
      const date = new Date(now);
      date.setDate(date.getDate() - 1);
      return date;
    }

    const relative = lower.match(/(?:about\s+)?(\d+)\s*([a-zа-яёəğıöşüç]+)/iu);
    if (relative) {
      const amount = Number(relative[1]);
      const unit = relative[2];
      const date = new Date(now);
      let recognized = true;
      if (/^(s|sec|secs|second|seconds|сек|секунд|saniyə|saniye)/iu.test(unit)) date.setSeconds(date.getSeconds() - amount);
      else if (/^(m|min|mins|minute|minutes|мин|минут|dəq|deq|dəqiqə|deqiqe)/iu.test(unit)) date.setMinutes(date.getMinutes() - amount);
      else if (/^(h|hr|hrs|hour|hours|ч|час|saat)/iu.test(unit)) date.setHours(date.getHours() - amount);
      else if (/^(d|day|days|д|дн|день|дня|дней|gün|gun)/iu.test(unit)) date.setDate(date.getDate() - amount);
      else if (/^(w|wk|wks|week|weeks|нед|неделя|недели|həftə|hefte)/iu.test(unit)) date.setDate(date.getDate() - amount * 7);
      else if (/^(mo|mon|month|months|мес|месяц|месяца|ay)/iu.test(unit)) date.setMonth(date.getMonth() - amount);
      else if (/^(y|yr|yrs|year|years|г|год|года|лет|il)/iu.test(unit)) date.setFullYear(date.getFullYear() - amount);
      else recognized = false;
      if (recognized) return validDate(date) ? date : null;
    }

    const numeric = normalized.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(?:at|в)?\s*(\d{1,2})[:.](\d{2})(?:\s*(am|pm))?)?/i);
    if (numeric) {
      let year = Number(numeric[3]);
      if (year < 100) year += 2000;
      let hour = Number(numeric[4] || 0);
      if (/pm/i.test(numeric[6]) && hour < 12) hour += 12;
      if (/am/i.test(numeric[6]) && hour === 12) hour = 0;
      const date = new Date(year, Number(numeric[2]) - 1, Number(numeric[1]), hour, Number(numeric[5] || 0));
      return validDate(date) ? date : null;
    }

    const englishAbsolute = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i);
    if (englishAbsolute) {
      let hour = Number(englishAbsolute[4] || 0);
      if (/pm/i.test(englishAbsolute[6]) && hour < 12) hour += 12;
      if (/am/i.test(englishAbsolute[6]) && hour === 12) hour = 0;
      const date = new Date(
        Number(englishAbsolute[3]),
        MONTHS.get(englishAbsolute[1]),
        Number(englishAbsolute[2]),
        hour,
        Number(englishAbsolute[5] || 0)
      );
      return validDate(date) ? date : null;
    }

    const monthPattern = Array.from(MONTHS.keys()).sort((a, b) => b.length - a.length).join('|');
    const monthFirst = lower.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:[,]?\\s+(\\d{4}))?(?:\\s+(?:at|в)?\\s*(\\d{1,2})[:.](\\d{2})\\s*(am|pm)?)?`, 'iu'));
    const dayFirst = lower.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})(?:[,]?\\s+(\\d{4}))?(?:\\s+(?:at|в)?\\s*(\\d{1,2})[:.](\\d{2})\\s*(am|pm)?)?`, 'iu'));
    const match = monthFirst || dayFirst;
    if (match) {
      const monthName = monthFirst ? match[1] : match[2];
      const day = Number(monthFirst ? match[2] : match[1]);
      const explicitYear = match[3] ? Number(match[3]) : null;
      let hour = Number(match[4] || 0);
      if (/pm/i.test(match[6]) && hour < 12) hour += 12;
      if (/am/i.test(match[6]) && hour === 12) hour = 0;
      const date = new Date(explicitYear || now.getFullYear(), MONTHS.get(monthName), day, hour, Number(match[5] || 0));
      if (!explicitYear && date > now) date.setFullYear(date.getFullYear() - 1);
      return validDate(date) ? date : null;
    }

    const cleaned = normalized.replace(/\bat\b/gi, ' ').replace(/\s+/g, ' ');
    const direct = new Date(cleaned);
    return validDate(direct) ? direct : null;
  }

  class FacebookScraper extends app.BaseScraper {
    constructor() {
      super('facebook');
      this.recentConfirmed = false;
    }

    async ensureReady(ctx) {
      if (!location.pathname.includes('/login') && !document.querySelector('#email, input[name="email"]')) return true;
      return this.loginIfPossible(ctx, {
        findUsername: () => this.visible('#email, input[name="email"]'),
        findPassword: () => this.visible('#pass, input[name="pass"], input[type="password"]'),
        findSubmit: () => this.visible('button[name="login"], button[type="submit"]'),
        verifyLoggedIn: () => !!document.querySelector('[aria-label="Home"], [aria-label="Facebook"], div[role="navigation"]')
      });
    }

    currentQuery() {
      try { return app.utils.normalizeText(new URL(location.href).searchParams.get('q')); } catch (error) { return ''; }
    }

    searchInput() {
      return this.visible('input[type="search"], input[name="q"], [role="search"] input, input[placeholder*="Search" i], input[aria-label*="Search" i], input[placeholder*="Поиск" i], input[aria-label*="Поиск" i]');
    }

    async clickExactSuggestion(keyword, ctx) {
      const expected = app.utils.normalizeText(keyword);
      const candidates = this.allVisible('a[href*="/search/"][href*="q="], [role="option"] a[href]');
      const exact = candidates.find((link) => {
        try { return app.utils.normalizeText(new URL(link.href).searchParams.get('q')) === expected; } catch (error) { return false; }
      });
      return exact ? ctx.navigation.click(exact, 'Facebook exact search suggestion') : false;
    }

    async search(keyword, ctx) {
      if (!(location.pathname.includes('/search/') && this.currentQuery() === app.utils.normalizeText(keyword))) {
        const result = await ctx.navigation.search({
          platform: 'Facebook',
          keyword,
          findInput: () => this.searchInput(),
          openSearch: async () => {
            const control = this.visible('[role="button"][aria-label*="Search" i], a[aria-label*="Search" i], [role="button"][aria-label*="Поиск" i]');
            if (control) await ctx.navigation.click(control, 'Facebook Search');
          },
          verify: () => location.pathname.includes('/search/') && this.currentQuery() === app.utils.normalizeText(keyword),
          clickSuggestion: () => this.clickExactSuggestion(keyword, ctx),
          clickSearchButton: async (input) => {
            const formButton = input.closest('form')?.querySelector('button[type="submit"]');
            const button = formButton || this.visible('button[aria-label*="Search" i], [role="button"][aria-label*="Search" i], button[aria-label*="Поиск" i]');
            return button ? ctx.navigation.click(button, 'Facebook search button') : false;
          },
          fallbackUrl: () => `https://www.facebook.com/search/top/?q=${encodeURIComponent(keyword)}`
        });
        if (result.navigating) return result;
      } else {
        await ctx.logger.info('Existing Facebook search page matches keyword');
      }
      return this.ensureRecent(ctx);
    }

    feedFingerprint() {
      return this.allVisible('[role="article"], [data-pagelet*="FeedUnit"]')
        .slice(0, 4)
        .map((article) => this.text(article).slice(0, 120))
        .join('|');
    }

    checked(control) {
      if (!control) return null;
      if (control.checked === true || control.getAttribute('aria-checked') === 'true') return true;
      if (control.checked === false || control.getAttribute('aria-checked') === 'false') return false;
      const nested = control.querySelector('input[type="checkbox"], [role="switch"], [role="checkbox"]');
      if (nested && nested !== control) return this.checked(nested);
      return null;
    }

    findRecentControl() {
      const direct = this.allVisible('[role="switch"], [role="checkbox"], input[type="checkbox"]').find((element) => {
        const value = app.utils.normalizeText(`${element.getAttribute('aria-label') || ''} ${this.text(element.closest('label, [role="listitem"], div'))}`);
        return /(recent posts|недавн.*публикац|son paylaşımlar|son paylasimlar)/i.test(value);
      });
      if (direct) return direct;
      const labels = this.allVisible('span, label, div').filter((element) => {
        const value = app.utils.normalizeText(this.text(element));
        return value.length < 80 && /^(recent posts|недавние публикации|son paylaşımlar|son paylasimlar)$/i.test(value);
      });
      for (const label of labels) {
        let parent = label;
        for (let depth = 0; depth < 5 && parent; depth++, parent = parent.parentElement) {
          const control = parent.querySelector?.('[role="switch"], [role="checkbox"], input[type="checkbox"]');
          if (control && app.utils.isVisible(control)) return control;
        }
        const clickable = this.clickable(label);
        if (clickable) return clickable;
      }
      return null;
    }

    async openFilters(ctx) {
      const control = this.findTextControl([/^filters?$/, /search filters/, /^фильтры?$/, /^filtr$/]) ||
        this.visible('[aria-label*="Filter" i], [aria-label*="Фильтр" i], [aria-label*="Filtr" i]');
      return control ? ctx.navigation.click(this.clickable(control), 'Facebook Filters') : false;
    }

    async toggleRecent(control, expected, ctx) {
      const before = this.checked(control);
      const fingerprint = this.feedFingerprint();
      await ctx.navigation.click(this.clickable(control), `Facebook Recent ${expected ? 'on' : 'off'}`);
      return !!(await app.utils.waitFor(() => {
        const current = this.findRecentControl();
        const state = this.checked(current);
        if (state === expected) return true;
        if (before === null && this.feedFingerprint() && this.feedFingerprint() !== fingerprint) return true;
        return false;
      }, { timeoutMs: 5000, intervalMs: 300, token: ctx.token }));
    }

    async ensureRecent(ctx) {
      const currentUrl = new URL(location.href);
      if (currentUrl.searchParams.has('filters') && currentUrl.searchParams.get('scraper_recent_fallback') === '1') {
        this.recentConfirmed = true;
        await ctx.logger.info('Facebook Recent filter URL fallback confirmed after reload');
        return { success: true, fallback: true };
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        await ctx.logger.info(`Facebook Recent filter attempt ${attempt}/3`);
        let control = this.findRecentControl();
        if (!control) {
          await this.openFilters(ctx);
          control = await app.utils.waitFor(() => this.findRecentControl(), { timeoutMs: 4000, intervalMs: 250, token: ctx.token });
        }
        if (!control) {
          await ctx.logger.warn('Facebook Recent control not found');
          continue;
        }
        const state = this.checked(control);
        if (state === true) {
          const disabled = await this.toggleRecent(control, false, ctx);
          control = this.findRecentControl();
          if (!disabled || !control) {
            await ctx.logger.warn('Facebook Recent off transition was not confirmed');
            continue;
          }
        }
        control = this.findRecentControl() || control;
        if (await this.toggleRecent(control, true, ctx)) {
          this.recentConfirmed = true;
          await app.utils.sleep(2000, ctx.token);
          await ctx.logger.info('Facebook Recent posts confirmed and feed refreshed');
          return { success: true };
        }
        await ctx.logger.warn('Facebook Recent on transition was not confirmed');
      }

      this.recentConfirmed = false;
      await ctx.logger.warn('Facebook Recent UI failed; using filter URL as last fallback');
      const url = new URL(location.href);
      url.pathname = '/search/top/';
      url.searchParams.set('filters', 'eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9In0=');
      url.searchParams.set('scraper_recent_fallback', '1');
      window.location.assign(url.toString());
      return { success: false, fallback: true, navigating: true };
    }

    normalizePostUrl(rawUrl) {
      try {
        const url = new URL(rawUrl, location.origin);
        if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return '';
        const isPost = /\/(posts|permalink|photos|videos|reel)\//i.test(url.pathname) || /\/groups\/[^/]+\/posts\//i.test(url.pathname) || url.searchParams.has('story_fbid') || url.searchParams.has('fbid');
        if (!isPost) return '';
        const canonical = new URL(`https://www.facebook.com${url.pathname.replace(/\/+$/, '')}`);
        for (const key of ['story_fbid', 'fbid', 'id']) if (url.searchParams.has(key)) canonical.searchParams.set(key, url.searchParams.get(key));
        return canonical.toString();
      } catch (error) { return ''; }
    }

    messageNode(article) {
      const preferred = ['[data-ad-comet-preview="message"]', '[data-testid="post_message"]'];
      for (const selector of preferred) {
        const nodes = this.allVisible(selector, article);
        const topLevel = nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
        if (topLevel[0]) return topLevel[0];
      }
      return null;
    }

    async expandText(article, ctx) {
      const message = this.messageNode(article) || article;
      const controls = this.allVisible('button, [role="button"], span', message);
      const button = controls.find((element) => /^(see more|read more|ещё|еще|показать ещё|daha çox|daha cox)$/i.test(this.text(element)));
      if (!button) return false;
      await ctx.navigation.click(this.clickable(button), 'Facebook See more');
      await ctx.logger.info('Facebook full post text expanded');
      return true;
    }

    dateCandidate(value, element, score, source) {
      const parsed = parseFacebookDate(value);
      return parsed ? { value: String(value).trim(), element, score, source, parsed } : null;
    }

    async tooltipDate(element, ctx) {
      const before = new Set(this.allVisible('[role="tooltip"]').map((node) => this.text(node)));
      element.scrollIntoView({ behavior: 'auto', block: 'center' });
      const rect = element.getBoundingClientRect();
      for (const type of ['pointerover', 'mouseenter', 'mouseover', 'mousemove']) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
      }
      for (let attempt = 0; attempt < 6; attempt++) {
        await app.utils.sleep(250, ctx.token);
        const label = element.getAttribute('aria-label') || element.getAttribute('title');
        if (parseFacebookDate(label)) return label;
        const fresh = this.allVisible('[role="tooltip"]').map((node) => this.text(node)).find((text) => !before.has(text) && parseFacebookDate(text));
        if (fresh) return fresh;
      }
      return '';
    }

    async extractDate(article, ctx) {
      const candidates = [];
      const push = (value, element, score, source) => {
        const candidate = this.dateCandidate(value, element, score, source);
        if (candidate) candidates.push(candidate);
      };
      for (const element of article.querySelectorAll('[data-utime]')) push(element.getAttribute('data-utime'), element, 1000, 'data-utime');
      for (const element of article.querySelectorAll('time')) {
        push(element.getAttribute('datetime'), element, 950, 'time datetime');
        push(element.getAttribute('aria-label'), element, 850, 'time aria-label');
        push(this.text(element), element, 500, 'time text');
      }
      for (const element of article.querySelectorAll('abbr[title]')) push(element.getAttribute('title'), element, 900, 'abbr title');

      const articleRect = article.getBoundingClientRect();
      const headerLinks = this.allVisible('a[href], [role="link"]', article).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= articleRect.top + Math.min(260, articleRect.height * 0.35);
      }).slice(0, 30);
      for (const link of headerLinks) {
        push(link.getAttribute('aria-label'), link, 700, 'header aria-label');
        push(link.getAttribute('title'), link, 680, 'header title');
        const text = this.text(link);
        if (text.length <= 80) push(text, link, 400, 'header text');
      }

      candidates.sort((left, right) => right.score - left.score);
      const hoverTargets = candidates.filter((candidate) => candidate.score < 900).slice(0, 3).map((candidate) => candidate.element);
      for (const link of headerLinks.filter((element) => this.normalizePostUrl(element.href)).slice(0, 3)) hoverTargets.push(link);
      for (const target of Array.from(new Set(hoverTargets)).slice(0, 5)) {
        const tooltip = await this.tooltipDate(target, ctx);
        if (tooltip) push(tooltip, target, 1100, 'fresh tooltip');
      }
      candidates.sort((left, right) => right.score - left.score);
      const best = candidates[0] || null;
      if (best) await ctx.logger.info(`Facebook date parsed from ${best.source}`, `${best.value} -> ${app.utils.formatTimestamp(best.parsed)}`);
      else await ctx.logger.warn('Facebook publication date not found; post will be skipped');
      return best?.parsed || null;
    }

    async parseArticle(article, ctx) {
      if (this.isAdvertisement(article)) return { advertisement: true };
      const postUrl = Array.from(article.querySelectorAll('a[href]')).map((link) => this.normalizePostUrl(link.href)).find(Boolean) || '';
      if (!postUrl) return null;
      await this.expandText(article, ctx);
      const postDate = await this.extractDate(article, ctx);
      if (!postDate) return null;
      const authorLink = this.allVisible('h2 a[href], h3 a[href], h4 a[href], strong a[href], a[role="link"][href]', article)
        .find((link) => !this.normalizePostUrl(link.href) && this.text(link));
      const message = this.messageNode(article);
      const mediaUrls = [
        ...Array.from(article.querySelectorAll('img[src]')).filter((image) => image.width > 150 || image.naturalWidth > 150).map((image) => image.currentSrc || image.src),
        ...Array.from(article.querySelectorAll('video')).map((video) => video.poster || video.src)
      ].filter(Boolean);
      return {
        postDate: app.utils.formatTimestamp(postDate),
        postUrl,
        author: this.text(authorLink) || 'Unknown',
        authorUrl: authorLink?.href || '',
        text: this.text(message),
        mediaUrls
      };
    }

    async collect(ctx) {
      let noNewRounds = 0;
      while (noNewRounds < 5) {
        ctx.token.throwIfCancelled();
        const articles = this.allVisible('[role="article"], [data-pagelet*="FeedUnit"]');
        await ctx.logger.info(`Facebook post containers visible: ${articles.length}`);
        let accepted = 0;
        for (const article of articles) {
          ctx.token.throwIfCancelled();
          const post = await this.parseArticle(article, ctx);
          if (post?.advertisement) {
            await ctx.logger.info('Facebook sponsored post skipped');
            continue;
          }
          if (!post) continue;
          const outcome = await ctx.onPost(post);
          if (outcome.limitReached) return { reason: 'target' };
          if (outcome.older && this.recentConfirmed) return { reason: 'date-limit' };
          if (outcome.accepted) accepted++;
        }
        noNewRounds = accepted ? 0 : noNewRounds + 1;
        await this.scrollPage(ctx);
      }
      return { reason: 'exhausted' };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.facebookDate = parseFacebookDate;
  app.scrapers.facebook = new FacebookScraper();
})(globalThis.ScraperApp);
