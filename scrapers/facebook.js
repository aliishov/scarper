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

  const MEDIA_TOOLTIP_PATTERN = /(may be an image|may be a video|image may contain|video may contain|может быть изображение|может быть видео|на изображении может быть|на видео может быть)/i;

  function isMediaTooltipText(value) {
    return MEDIA_TOOLTIP_PATTERN.test(String(value || '').replace(/\s+/g, ' ').trim());
  }

  function hasTemporalEvidence(value) {
    const text = String(value || '').replace(/\u00a0/g, ' ').trim();
    if (!text || isMediaTooltipText(text)) return false;
    return /^\d{10,13}$/.test(text)
      || /^\d{4}-\d{2}-\d{2}[T\s]/.test(text)
      || /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)
      || /\b(19|20)\d{2}\b.*\b\d{1,2}:\d{2}\b/.test(text)
      || /\b(january|february|march|april|may|june|july|august|september|october|november|december|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b.*\b\d{1,2}\b/i.test(text)
      || /(?:^|\s)\d+\s*(s|sec|m|min|h|hr|d|day|w|week|mo|month|y|year|сек|мин|ч|час|д|дн|нед|мес|г|год)(?:\.|\s|$)/iu.test(text)
      || /^(just now|today|yesterday|сейчас|только что|сегодня|вчера)$/i.test(text);
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
    if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(original)) {
      const parsed = new Date(original);
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

    return null;
  }

  function looksLikeFacebookDate(value) {
    return hasTemporalEvidence(value) && !!parseFacebookDate(value);
  }

  class FacebookScraper extends app.BaseScraper {
    constructor() {
      super('facebook');
      this.recentConfirmed = false;
      this.processedPostKeys = new Map();
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

    async expandPostText(article, ctx) {
      let expanded = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const message = this.messageNode(article) || article;
        const beforeText = this.text(message);
        const controls = this.allVisible('button, [role="button"], a, span', article);
        const button = controls.find((element) => {
          const labels = [element.getAttribute('aria-label'), this.text(element)].map(app.utils.normalizeText).filter(Boolean);
          return labels.some((label) => /^(see more|read more|ещё|еще|показать ещё|показать еще|показать больше|daha çox|daha cox)$/.test(label));
        });
        if (!button) {
          if (!expanded) await ctx.logger.info('Facebook expand text button not found; text is already complete or unavailable');
          break;
        }
        const label = button.getAttribute('aria-label') || this.text(button);
        await ctx.logger.info(`Facebook expand text button found: ${label}`, `attempt=${attempt}/3`);
        await ctx.logger.info('Facebook text length before expand', String(beforeText.length));
        const clicked = await ctx.navigation.click(this.clickable(button), `Facebook expand text: ${label}`, { scroll: false });
        if (!clicked) {
          await ctx.logger.warn('Facebook expand text click was not performed');
          continue;
        }
        const changed = await app.utils.waitFor(() => {
          const currentText = this.text(this.messageNode(article) || article);
          return currentText.length > beforeText.length || !button.isConnected || !app.utils.isVisible(button);
        }, { timeoutMs: 5000, intervalMs: 250, token: ctx.token });
        const afterText = this.text(this.messageNode(article) || article);
        await ctx.logger.info('Facebook text length after expand', String(afterText.length));
        if (!changed) await ctx.logger.warn('Facebook text did not change after expand click');
        else expanded = true;
      }
      return expanded;
    }

    dateCandidate(value, element, score, source) {
      if (!looksLikeFacebookDate(value)) return null;
      const parsed = parseFacebookDate(value);
      return parsed ? { value: String(value).trim(), element, score, source, parsed } : null;
    }

    async hoverDateCandidate(element, selector, ctx) {
      const tooltipSelector = '[role="tooltip"], [data-testid="tooltip"]';
      const before = new Map(Array.from(document.querySelectorAll(tooltipSelector)).map((node) => [node, this.text(node)]));
      await ctx.logger.info(`Facebook date candidate found: selector=${selector}`, this.text(element).slice(0, 80));
      await ctx.logger.info('Facebook hovering date candidate');
      const rect = element.getBoundingClientRect();
      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: Math.max(0, rect.left + Math.min(rect.width / 2, 16)),
        clientY: Math.max(0, rect.top + Math.min(rect.height / 2, 10))
      };
      if (typeof PointerEvent === 'function') {
        element.dispatchEvent(new PointerEvent('pointerover', { ...eventOptions, pointerType: 'mouse' }));
        element.dispatchEvent(new PointerEvent('pointerenter', { ...eventOptions, pointerType: 'mouse' }));
      }
      for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
        element.dispatchEvent(new MouseEvent(type, eventOptions));
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        await app.utils.sleep(250, ctx.token);
        const referencedIds = `${element.getAttribute('aria-describedby') || ''} ${element.getAttribute('aria-labelledby') || ''}`.trim().split(/\s+/).filter(Boolean);
        const referenced = referencedIds.map((id) => document.getElementById(id)).filter(Boolean);
        const tooltipNodes = [...referenced, ...Array.from(document.querySelectorAll(tooltipSelector))];
        for (const tooltip of Array.from(new Set(tooltipNodes))) {
          const text = this.text(tooltip) || tooltip.getAttribute('aria-label') || '';
          if (!text) continue;
          const isFresh = !before.has(tooltip) || before.get(tooltip) !== text || referenced.includes(tooltip);
          if (!isFresh) continue;
          await ctx.logger.info('Facebook tooltip text', text.slice(0, 180));
          if (isMediaTooltipText(text)) {
            await ctx.logger.warn('Facebook tooltip rejected: image/media accessibility text', text.slice(0, 180));
            continue;
          }
          if (!looksLikeFacebookDate(text)) {
            await ctx.logger.warn('Facebook tooltip rejected: not a publication date', text.slice(0, 180));
            continue;
          }
          const parsed = parseFacebookDate(text);
          await ctx.logger.info('Facebook tooltip accepted as date', text);
          await ctx.logger.info('Facebook parsed post date', app.utils.formatTimestamp(parsed));
          return { parsed, text, source: `hover:${selector}` };
        }
      }
      return null;
    }

    facebookDateElements(article) {
      const articleRect = article.getBoundingClientRect();
      const inAuthorHeader = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= articleRect.top - 20 && rect.top <= articleRect.top + Math.min(240, articleRect.height * 0.32);
      };
      const definitions = [
        ['[data-utime]', 1000],
        ['time', 950],
        ['abbr', 900],
        ['a[href*="/posts/"]', 850],
        ['a[href*="/photo"]', 830],
        ['a[href*="/videos/"]', 830],
        ['a[href*="story_fbid"]', 850],
        ['a[href*="fbid="]', 840],
        ['a[aria-label]', 700],
        ['span', 400]
      ];
      const found = [];
      for (const [selector, priority] of definitions) {
        for (const element of this.allVisible(selector, article)) {
          if (!inAuthorHeader(element)) continue;
          if (element.closest('img, video, [role="img"]')) continue;
          const values = [
            element.getAttribute('data-utime'),
            element.getAttribute('datetime'),
            element.getAttribute('title'),
            element.getAttribute('aria-label'),
            this.text(element)
          ].filter(Boolean);
          const hasDateValue = values.some(hasTemporalEvidence);
          const hasPostHref = element.matches('a[href]') && !!this.normalizePostUrl(element.href);
          if (!hasDateValue && !hasPostHref) continue;
          found.push({ element, selector, priority, values });
        }
      }
      const unique = new Map();
      for (const candidate of found.sort((left, right) => right.priority - left.priority)) {
        if (!unique.has(candidate.element)) unique.set(candidate.element, candidate);
      }
      return Array.from(unique.values());
    }

    async getFacebookDateFromHover(article, ctx) {
      const candidates = this.facebookDateElements(article);
      await ctx.logger.info(`Facebook date hover candidates: ${candidates.length}`);
      for (const candidate of candidates.slice(0, 8)) {
        for (const value of candidate.values) {
          if (isMediaTooltipText(value)) {
            await ctx.logger.warn('Facebook date value rejected: image/media accessibility text', value.slice(0, 180));
            continue;
          }
          if (looksLikeFacebookDate(value) && /^(\d{10,13}|\d{4}-\d{2}-\d{2})/.test(value)) {
            const parsed = parseFacebookDate(value);
            await ctx.logger.info(`Facebook date accepted from ${candidate.selector}`, `${value} -> ${app.utils.formatTimestamp(parsed)}`);
            return parsed;
          }
        }
        const hovered = await this.hoverDateCandidate(candidate.element, candidate.selector, ctx);
        if (hovered) return hovered.parsed;
      }
      return null;
    }

    async extractDate(article, ctx) {
      const hovered = await this.getFacebookDateFromHover(article, ctx);
      if (hovered) return hovered;
      const fallbackCandidates = [];
      const push = (value, element, score, source) => {
        const candidate = this.dateCandidate(value, element, score, source);
        if (candidate) fallbackCandidates.push(candidate);
      };
      for (const element of article.querySelectorAll('[data-utime]')) push(element.getAttribute('data-utime'), element, 1000, 'data-utime fallback');
      for (const element of article.querySelectorAll('time')) {
        push(element.getAttribute('datetime'), element, 950, 'time datetime fallback');
        push(element.getAttribute('aria-label'), element, 850, 'time aria-label fallback');
        push(this.text(element), element, 500, 'time text fallback');
      }
      for (const element of article.querySelectorAll('abbr[title]')) push(element.getAttribute('title'), element, 900, 'abbr title fallback');
      fallbackCandidates.sort((left, right) => right.score - left.score);
      const best = fallbackCandidates[0] || null;
      if (best) await ctx.logger.info(`Facebook date parsed from ${best.source}`, `${best.value} -> ${app.utils.formatTimestamp(best.parsed)}`);
      else await ctx.logger.warn('Facebook publication date not found; post will be skipped');
      return best?.parsed || null;
    }

    parsePostDate(article, ctx) {
      return this.extractDate(article, ctx);
    }

    shouldSkipPost(post) {
      return !post || post.advertisement === true || !post.postUrl || !post.postDate;
    }

    ancestorPostContainer(node) {
      const semantic = node?.closest?.('article, [role="article"], [data-pagelet*="FeedUnit"]');
      if (semantic && app.utils.isVisible(semantic)) return semantic;
      let current = node?.parentElement || null;
      for (let depth = 0; current && depth < 14; depth++, current = current.parentElement) {
        const rect = current.getBoundingClientRect();
        if (rect.height > 140 && rect.height < 4200 && rect.width > 280) {
          const hasPermalink = Array.from(current.querySelectorAll('a[href]')).some((link) => this.normalizePostUrl(link.href));
          const hasContent = !!this.messageNode(current) || !!current.querySelector('time, [data-utime]');
          if (hasPermalink && hasContent) return current;
        }
        if (rect.height >= 5000) break;
      }
      return null;
    }

    discoverPostContainers() {
      const article = this.allVisible('article');
      const roleArticle = this.allVisible('[role="article"]');
      const feedChildren = this.allVisible('[role="feed"] > div, [data-pagelet*="FeedUnit"]');
      const permalinkLinks = this.allVisible('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], a[href*="fbid="], a[href*="/groups/"][href*="/posts/"], a[href*="/reel/"], a[href*="/videos/"]');
      const timeLinks = this.allVisible('time, [data-utime], abbr[title], a[aria-label], a[title]')
        .filter((element) => parseFacebookDate(element.getAttribute('datetime') || element.getAttribute('data-utime') || element.getAttribute('aria-label') || element.getAttribute('title') || this.text(element)));
      const permalinkBlocks = permalinkLinks.map((node) => this.ancestorPostContainer(node)).filter(Boolean);
      const timeBlocks = timeLinks.map((node) => this.ancestorPostContainer(node)).filter(Boolean);
      const candidates = Array.from(new Set([
        ...article,
        ...roleArticle,
        ...feedChildren.filter((element) => this.ancestorPostContainer(element) === element || Array.from(element.querySelectorAll('a[href]')).some((link) => this.normalizePostUrl(link.href))),
        ...permalinkBlocks,
        ...timeBlocks
      ])).filter((element) => app.utils.isVisible(element) && element.getBoundingClientRect().height < 5000);
      const minimal = candidates.filter((candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other) && other.getBoundingClientRect().height > 140));
      return {
        containers: minimal,
        counts: {
          article: article.length,
          roleArticle: roleArticle.length,
          feedChildren: feedChildren.length,
          permalinkBlocks: new Set(permalinkBlocks).size,
          timeLinkBlocks: new Set(timeBlocks).size
        }
      };
    }

    async logContainerDiagnostics(discovery, ctx) {
      const counts = discovery.counts;
      await ctx.logger.info(
        'Facebook selector candidates',
        `article=${counts.article}, [role="article"]=${counts.roleArticle}, feed children=${counts.feedChildren}, permalink blocks=${counts.permalinkBlocks}, time/link blocks=${counts.timeLinkBlocks}, unique=${discovery.containers.length}`
      );
    }

    async waitForPostContainers(ctx) {
      let discovery = this.discoverPostContainers();
      await this.logContainerDiagnostics(discovery, ctx);
      if (discovery.containers.length) return discovery.containers;
      await ctx.logger.info('Facebook feed is still empty; waiting up to 15 seconds for post containers');
      const loaded = await app.utils.waitFor(() => {
        discovery = this.discoverPostContainers();
        return discovery.containers.length ? discovery : null;
      }, { timeoutMs: 15000, intervalMs: 750, token: ctx.token });
      if (loaded) {
        await this.logContainerDiagnostics(loaded, ctx);
        await ctx.logger.info('Facebook feed containers appeared after waiting');
        return loaded.containers;
      }
      await ctx.logger.warn('Facebook feed did not expose post containers after 15 seconds');
      return [];
    }

    async parseArticle(article, ctx) {
      if (this.isAdvertisement(article)) return { advertisement: true };
      const postUrl = Array.from(article.querySelectorAll('a[href]')).map((link) => this.normalizePostUrl(link.href)).find(Boolean) || '';
      if (!postUrl) return null;
      await this.expandPostText(article, ctx);
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

    parsePost(article, ctx) {
      return this.parseArticle(article, ctx);
    }

    postKeyForArticle(article) {
      const postUrl = Array.from(article.querySelectorAll('a[href]')).map((link) => this.normalizePostUrl(link.href)).find(Boolean);
      if (postUrl) return postUrl;
      const signature = this.text(this.messageNode(article) || article).slice(0, 240);
      return signature ? `facebook:text:${signature}` : '';
    }

    nearCurrentViewport(element) {
      const rect = element.getBoundingClientRect();
      return rect.bottom >= -80 && rect.top <= window.innerHeight * 1.6;
    }

    findAlternativeScrollContainer() {
      const candidates = [];
      const addWithAncestors = (element) => {
        let current = element;
        for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) candidates.push(current);
      };
      document.querySelectorAll('[role="feed"], [role="main"], main, [data-pagelet*="Feed"]').forEach(addWithAncestors);
      document.querySelectorAll('div[style*="overflow"]').forEach((element) => candidates.push(element));
      return Array.from(new Set(candidates)).find((element) => {
        if (!app.utils.isVisible(element)) return false;
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 200;
      }) || null;
    }

    async scrollForward(ctx, lastScrollY) {
      const amount = app.utils.randomInt(650, 1100);
      const beforeWindow = window.scrollY;
      await ctx.logger.info('Facebook scroll position before', String(beforeWindow));
      if (beforeWindow < lastScrollY - 40) {
        await ctx.logger.warn(`Facebook WARNING: scroll jumped up from ${lastScrollY} to ${beforeWindow}`);
        window.scrollTo({ top: lastScrollY, behavior: 'auto' });
        await app.utils.sleep(200, ctx.token);
      }

      let containerName = 'window';
      let customBefore = null;
      let customAfter = null;
      window.scrollBy({ top: amount, behavior: 'smooth' });
      await app.utils.sleep(1200, ctx.token);
      let afterWindow = window.scrollY;

      if (afterWindow <= Math.max(beforeWindow, lastScrollY) + 5) {
        const alternative = this.findAlternativeScrollContainer();
        if (alternative) {
          containerName = alternative.getAttribute('role') === 'feed' ? 'feed' : 'custom';
          customBefore = alternative.scrollTop;
          alternative.scrollBy({ top: amount, behavior: 'smooth' });
          await app.utils.sleep(1200, ctx.token);
          customAfter = alternative.scrollTop;
          afterWindow = window.scrollY;
        }
      }

      if (afterWindow < beforeWindow - 40) {
        await ctx.logger.warn(`Facebook WARNING: scroll jumped up from ${beforeWindow} to ${afterWindow}`);
        window.scrollTo({ top: Math.max(beforeWindow, lastScrollY), behavior: 'auto' });
        afterWindow = window.scrollY;
      }
      await ctx.logger.info('Facebook scroll container', containerName);
      await ctx.logger.info('Facebook scroll position after', customAfter === null ? String(afterWindow) : `window=${afterWindow}, container=${customBefore}->${customAfter}`);
      if (containerName === 'window' && afterWindow <= beforeWindow + 5) {
        await ctx.logger.warn('Facebook scroll position did not increase and no usable alternative container was found');
      }
      return Math.max(lastScrollY, afterWindow);
    }

    async collect(ctx) {
      let noNewRounds = 0;
      let emptyRounds = 0;
      let lastScrollY = window.scrollY;
      const setKey = `${ctx.runId}:${ctx.keyword}`;
      if (!this.processedPostKeys.has(setKey)) {
        this.processedPostKeys.set(setKey, new Set());
        if (this.processedPostKeys.size > 20) this.processedPostKeys.delete(this.processedPostKeys.keys().next().value);
      }
      const processedPostKeys = this.processedPostKeys.get(setKey);
      while (noNewRounds < 6 && emptyRounds < 8) {
        ctx.token.throwIfCancelled();
        const articles = await this.waitForPostContainers(ctx);
        if (!articles.length) {
          emptyRounds++;
          await ctx.logger.warn(`Facebook post containers are still unavailable (${emptyRounds}/8)`);
          lastScrollY = await this.scrollForward(ctx, lastScrollY);
          continue;
        }
        emptyRounds = 0;
        let accepted = 0;
        let alreadyProcessed = 0;
        const processable = articles.filter((article) => this.nearCurrentViewport(article)).sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
        const uniqueVisible = processable.filter((article) => {
          const key = this.postKeyForArticle(article);
          if (!key || processedPostKeys.has(key)) {
            alreadyProcessed++;
            return false;
          }
          return true;
        });
        await ctx.logger.info('Facebook new unique posts discovered', String(uniqueVisible.length));
        await ctx.logger.info('Facebook already processed visible posts', String(alreadyProcessed));
        for (const article of uniqueVisible) {
          ctx.token.throwIfCancelled();
          const postKey = this.postKeyForArticle(article);
          if (postKey) processedPostKeys.add(postKey);
          const beforePostScrollY = window.scrollY;
          const post = await this.parseArticle(article, ctx);
          if (window.scrollY < beforePostScrollY - 40 || window.scrollY < lastScrollY - 40) {
            const jumpedTo = window.scrollY;
            await ctx.logger.warn(`Facebook WARNING: scroll jumped up from ${Math.max(beforePostScrollY, lastScrollY)} to ${jumpedTo}`);
            window.scrollTo({ top: Math.max(beforePostScrollY, lastScrollY), behavior: 'auto' });
          }
          if (post?.advertisement) {
            await ctx.logger.info('Facebook sponsored post skipped');
            continue;
          }
          if (!post) continue;
          const outcome = await ctx.onPost(post);
          if (outcome.limitReached) return { reason: 'target' };
          if (outcome.older) {
            await ctx.logger.info('Facebook date limit reached; finishing current keyword', post.postDate);
            return { reason: 'date-limit' };
          }
          if (outcome.accepted) accepted++;
        }
        noNewRounds = accepted ? 0 : noNewRounds + 1;
        lastScrollY = await this.scrollForward(ctx, lastScrollY);
      }
      return { reason: 'exhausted' };
    }
  }

  app.parsers = app.parsers || {};
  app.parsers.facebookDate = parseFacebookDate;
  app.parsers.facebookDateText = looksLikeFacebookDate;
  app.parsers.facebookMediaTooltip = isMediaTooltipText;
  app.scrapers.facebook = new FacebookScraper();
})(globalThis.ScraperApp);
