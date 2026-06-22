(function initializeFacebookScraper(app) {
  'use strict';

  const MONTHS = new Map([
    ['january', 0], ['jan', 0], ['января', 0], ['январь', 0], ['янв', 0], ['yanvar', 0],
    ['february', 1], ['feb', 1], ['февраля', 1], ['февраль', 1], ['фев', 1], ['fevral', 1],
    ['march', 2], ['mar', 2], ['марта', 2], ['март', 2], ['мар', 2], ['mart', 2],
    ['april', 3], ['apr', 3], ['апреля', 3], ['апрель', 3], ['апр', 3], ['aprel', 3],
    ['may', 4], ['мая', 4], ['mayıs', 4], ['mayis', 4],
    ['june', 5], ['jun', 5], ['июня', 5], ['июнь', 5], ['июн', 5], ['iyun', 5],
    ['july', 6], ['jul', 6], ['июля', 6], ['июль', 6], ['июл', 6], ['iyul', 6],
    ['august', 7], ['aug', 7], ['августа', 7], ['август', 7], ['авг', 7], ['avqust', 7],
    ['september', 8], ['sep', 8], ['sept', 8], ['сентября', 8], ['сентябрь', 8], ['сен', 8], ['sentyabr', 8],
    ['october', 9], ['oct', 9], ['октября', 9], ['октябрь', 9], ['окт', 9], ['oktyabr', 9],
    ['november', 10], ['nov', 10], ['ноября', 10], ['ноябрь', 10], ['ноя', 10], ['noyabr', 10],
    ['december', 11], ['dec', 11], ['декабря', 11], ['декабрь', 11], ['дек', 11], ['dekabr', 11]
  ]);

  function validDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime()) && date.getFullYear() >= 2004 && date.getTime() <= Date.now() + 300000;
  }

  const MEDIA_TOOLTIP_PATTERN = /(may be an image|may be a video|image may contain|video may contain|может быть изображение|может быть видео|на изображении может быть|на видео может быть)/i;
  const FACEBOOK_EXPAND_PATTERN = /^(see more|see more\.\.\.|more|read more|show more|ещё|еще|показать ещё|показать еще|показать больше|daha çox|daha cox|devamını gör|devamini gor)$/i;

  function isMediaTooltipText(value) {
    return MEDIA_TOOLTIP_PATTERN.test(String(value || '').replace(/\s+/g, ' ').trim());
  }

  function isFacebookExpandLabel(value) {
    return FACEBOOK_EXPAND_PATTERN.test(String(value || '').replace(/\s+/g, ' ').trim());
  }

  function scoreFacebookContainerSignals(signals) {
    let score = 0;
    if (signals.hasAuthor) score += 5;
    if (signals.hasText) score += 6;
    if (signals.hasExpand) score += 4;
    if (signals.hasDateMeta) score += 4;
    if (signals.hasPermalink) score += 6;
    if (signals.hasMedia) score += 2;
    if (signals.hasEngagement) score += 3;
    if (signals.tooLarge) score -= 8;
    if (signals.isFeed) score -= 100;
    return score;
  }

  function hasTemporalEvidence(value) {
    const text = String(value || '').replace(/\u00a0/g, ' ').trim();
    if (!text || isMediaTooltipText(text)) return false;
    return /^\d{10,13}$/.test(text)
      || /^\d{4}-\d{2}-\d{2}[T\s]/.test(text)
      || /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)
      || /\b(19|20)\d{2}\b.*\b\d{1,2}:\d{2}\b/.test(text)
      || /\b(january|february|march|april|may|june|july|august|september|october|november|december|января|январь|февраля|февраль|марта|март|апреля|апрель|мая|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь)\b.*\b\d{1,2}\b/i.test(text)
      || /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december|января|январь|февраля|февраль|марта|март|апреля|апрель|мая|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь)\b/i.test(text)
      || /(?:^|\s)\d+\s*(s|sec|m|min|h|hr|d|day|w|week|mo|month|y|year|сек|мин|ч|час|д|дн|нед|мес|г|год)(?:\.|\s|$)/iu.test(text)
      || /^(just now|today|yesterday|сейчас|только что|сегодня|вчера)$/i.test(text);
  }

  function applyTimeFromText(date, value) {
    const match = String(value || '').match(/(?:at|в)?\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?/i);
    if (!match) return date;
    let hour = Number(match[1]);
    if (/pm/i.test(match[3]) && hour < 12) hour += 12;
    if (/am/i.test(match[3]) && hour === 12) hour = 0;
    date.setHours(hour, Number(match[2]), 0, 0);
    return date;
  }

  function dispatchFacebookKey(element, type, key, code, keyCode, extra = {}) {
    element.dispatchEvent(new KeyboardEvent(type, {
      key,
      code,
      keyCode,
      which: keyCode,
      charCode: type === 'keypress' ? keyCode : 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      ...extra
    }));
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
    if (/^(today|сегодня|bu gün|bu gun)/.test(lower)) return applyTimeFromText(new Date(now), normalized);
    if (/^(yesterday|вчера|dünən|dunen)/.test(lower)) {
      const date = new Date(now);
      date.setDate(date.getDate() - 1);
      return applyTimeFromText(date, normalized);
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
      return this.visible('input[type="search"], input[name="q"], [role="search"] input, input[placeholder*="Search" i], input[aria-label*="Search" i], input[placeholder*="Поиск" i], input[aria-label*="Поиск" i], [role="search"] [contenteditable="true"], [role="combobox"][contenteditable="true"][aria-label*="Search" i], [role="combobox"][contenteditable="true"][aria-label*="Поиск" i], [role="textbox"][contenteditable="true"][aria-label*="Search" i], [role="textbox"][contenteditable="true"][aria-label*="Поиск" i]');
    }

    facebookSearchValue(input) {
      return input?.isContentEditable || input?.getAttribute?.('contenteditable') === 'true'
        ? String(input.innerText || input.textContent || '').replace(/\s+/g, ' ').trim()
        : String(input?.value || '');
    }

    placeFacebookCaretAtEnd(input) {
      if (input?.isContentEditable || input?.getAttribute?.('contenteditable') === 'true') {
        const selection = document.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      if (typeof input?.setSelectionRange === 'function') {
        const end = String(input.value || '').length;
        input.setSelectionRange(end, end);
      }
    }

    facebookSearchFocusState(input) {
      const active = document.activeElement === input;
      const contenteditable = !!(input?.isContentEditable || input?.getAttribute?.('contenteditable') === 'true');
      if (contenteditable) {
        const selection = document.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const inside = !!range && input.contains(range.startContainer) && input.contains(range.endContainer);
        return { active, contenteditable, caretConfirmed: active && inside && range.collapsed };
      }
      const length = String(input?.value || '').length;
      const caretConfirmed = active && typeof input?.selectionStart === 'number' && input.selectionStart === length && input.selectionEnd === length;
      return { active, contenteditable, caretConfirmed };
    }

    async focusFacebookSearchInput(input, ctx) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        ctx.token.throwIfCancelled();
        await ctx.logger.info(`Facebook Search input focus attempt ${attempt}/5`);
        input.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        await ctx.navigation.click(input, 'Facebook search input focus', { scroll: false });
        input.focus({ preventScroll: true });
        input.dispatchEvent(new FocusEvent('focus', { bubbles: true, composed: true }));
        await ctx.navigation.click(input, 'Facebook search input center click', { scroll: false });
        input.focus({ preventScroll: true });
        this.placeFacebookCaretAtEnd(input);
        await app.utils.sleep(200, ctx.token);
        const state = this.facebookSearchFocusState(input);
        if (state.active) await ctx.logger.info('Facebook document.activeElement confirmed');
        if (state.caretConfirmed) await ctx.logger.info('Facebook Caret confirmed in search input');
        if (state.active && state.caretConfirmed) {
          await ctx.logger.info('Facebook Search input is ready for typing');
          return true;
        }
        await ctx.logger.warn('Facebook search focus/caret not confirmed', JSON.stringify(state));
      }
      return false;
    }

    clearFacebookSearchInput(input) {
      const contenteditable = input.isContentEditable || input.getAttribute('contenteditable') === 'true';
      dispatchFacebookKey(input, 'keydown', 'a', 'KeyA', 65, { ctrlKey: true });
      dispatchFacebookKey(input, 'keyup', 'a', 'KeyA', 65, { ctrlKey: true });
      dispatchFacebookKey(input, 'keydown', 'Backspace', 'Backspace', 8);
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward', data: null }));
      if (contenteditable) {
        input.textContent = '';
      } else {
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) return false;
        setter.call(input, '');
      }
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      dispatchFacebookKey(input, 'keyup', 'Backspace', 'Backspace', 8);
      this.placeFacebookCaretAtEnd(input);
      return true;
    }

    async typeFacebookSearchKeyword(input, keyword, ctx) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (!(await this.focusFacebookSearchInput(input, ctx))) return false;
        if (!this.clearFacebookSearchInput(input)) return false;
        await app.utils.sleep(app.utils.randomInt(300, 600), ctx.token);
        const contenteditable = input.isContentEditable || input.getAttribute('contenteditable') === 'true';
        const prototype = !contenteditable ? (input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype) : null;
        const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : null;
        if (!contenteditable && !setter) return false;
        for (const character of String(keyword)) {
          ctx.token.throwIfCancelled();
          const state = this.facebookSearchFocusState(input);
          if (!state.active || !state.caretConfirmed) {
            if (!(await this.focusFacebookSearchInput(input, ctx))) return false;
          }
          const keyCode = character.codePointAt(0) || 0;
          dispatchFacebookKey(input, 'keydown', character, `Key${character.toUpperCase()}`, keyCode);
          input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: character }));
          if (contenteditable) {
            const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, character);
            if (!inserted) input.append(document.createTextNode(character));
          } else {
            setter.call(input, `${input.value}${character}`);
          }
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
          dispatchFacebookKey(input, 'keyup', character, `Key${character.toUpperCase()}`, keyCode);
          this.placeFacebookCaretAtEnd(input);
          await app.utils.sleep(app.utils.randomInt(100, 300), ctx.token);
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const actual = this.facebookSearchValue(input);
        if (actual === String(keyword)) {
          await ctx.logger.info('Facebook keyword verified in search input', actual);
          return true;
        }
        await ctx.logger.warn('Facebook keyword did not appear in search input', `attempt=${attempt}/3, actual=${actual}`);
      }
      return false;
    }

    async pressFacebookSearchEnter(input, verify, ctx) {
      let state = this.facebookSearchFocusState(input);
      if (!state.active || !state.caretConfirmed) {
        if (!(await this.focusFacebookSearchInput(input, ctx))) return false;
        state = this.facebookSearchFocusState(input);
      }
      if (!state.active || !state.caretConfirmed) return false;
      await ctx.logger.info('Facebook Enter pressed after confirmed focus/caret');
      dispatchFacebookKey(input, 'keydown', 'Enter', 'Enter', 13);
      dispatchFacebookKey(input, 'keypress', 'Enter', 'Enter', 13);
      dispatchFacebookKey(input, 'keyup', 'Enter', 'Enter', 13);
      return !!(await app.utils.waitFor(verify, { timeoutMs: 5000, intervalMs: 250, token: ctx.token }));
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
          typeInput: (input, value) => this.typeFacebookSearchKeyword(input, value, ctx),
          pressEnter: (input, verify) => this.pressFacebookSearchEnter(input, verify, ctx),
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

    postUrlForArticle(article) {
      const urls = Array.from(new Set(Array.from(article.querySelectorAll('a[href]'))
        .map((link) => this.normalizePostUrl(link.href))
        .filter(Boolean)));
      const score = (value) => {
        const url = new URL(value);
        if (url.searchParams.has('story_fbid') || /\/(posts|permalink)\//i.test(url.pathname)) return 100;
        if (/\/groups\/[^/]+\/posts\//i.test(url.pathname)) return 95;
        if (/\/(videos|reel)\//i.test(url.pathname)) return 80;
        if (/\/(photo|photos)\//i.test(url.pathname) || url.searchParams.has('fbid')) return 60;
        return 0;
      };
      return urls.sort((left, right) => score(right) - score(left))[0] || '';
    }

    permalinkAnchors(root, postUrl = '') {
      return this.allVisible('a[href]', root).map((link) => {
        const normalizedUrl = this.normalizePostUrl(link.href);
        if (!normalizedUrl || (postUrl && normalizedUrl !== postUrl)) return null;
        const rect = link.getBoundingClientRect();
        const text = this.text(link);
        const media = !!link.querySelector('img, video') || !!link.closest('figure, [data-visualcompletion="media-vc-image"], [data-pagelet*="Media"]');
        const temporal = [text, link.getAttribute('aria-label'), link.getAttribute('title')].some(hasTemporalEvidence);
        const compact = rect.height > 0 && rect.height <= 80 && rect.width <= 420 && text.length <= 80;
        const score = (temporal ? 100 : 0) + (compact ? 40 : 0) + (!media ? 30 : -100);
        return { link, normalizedUrl, media, compact, temporal, score };
      }).filter(Boolean).sort((left, right) => right.score - left.score);
    }

    facebookContainerSignals(element) {
      const rect = element.getBoundingClientRect();
      const text = this.text(element);
      const postUrls = new Set(Array.from(element.querySelectorAll('a[href]')).map((link) => this.normalizePostUrl(link.href)).filter(Boolean));
      const authorLinks = this.allVisible('h2 a[href], h3 a[href], h4 a[href], strong a[href], a[role="link"][href]', element).filter((link) => {
        const value = this.text(link);
        if (!value || value.length > 120 || this.normalizePostUrl(link.href) || hasTemporalEvidence(value)) return false;
        try {
          const url = new URL(link.href, location.origin);
          return /(^|\.)facebook\.com$/i.test(url.hostname) && !/(^|\/)(photos?|videos?|reel|posts|permalink|comments?|reactions?|share)(\/|$)/i.test(url.pathname);
        } catch (error) { return false; }
      });
      const hasExpand = this.allVisible('button, [role="button"], a, span, div, [tabindex]', element).some((node) => {
        return [node.getAttribute('aria-label'), this.text(node)].some(isFacebookExpandLabel);
      });
      const hasDateMeta = !!element.querySelector('time, [data-utime], abbr[title]') || this.allVisible('a, span, [aria-label]', element).some((node) => {
        const value = node.getAttribute('aria-label') || node.getAttribute('title') || this.text(node);
        return String(value || '').length <= 80 && hasTemporalEvidence(value);
      });
      const hasMedia = this.allVisible('img[src], video', element).some((node) => {
        const nodeRect = node.getBoundingClientRect();
        return node.matches('video') || nodeRect.width >= 140 || nodeRect.height >= 140;
      });
      const engagementText = app.utils.normalizeText(text.slice(-1200));
      const hasEngagement = /(like|comment|share|reaction|нравится|комментар|поделиться|bəyən|şərh|paylaş)/i.test(engagementText) ||
        !!element.querySelector('[aria-label*="Like" i], [aria-label*="Comment" i], [aria-label*="Share" i]');
      const role = element.getAttribute('role');
      const nestedPostContainers = element.querySelectorAll('article, [role="article"], [data-pagelet*="FeedUnit"]').length;
      const isFeed = role === 'feed' || element === document.body || element === document.documentElement || nestedPostContainers > 2 || (rect.height > 5000 && postUrls.size > 5);
      const signals = {
        hasAuthor: authorLinks.length > 0,
        hasText: !!this.messageNode(element),
        hasExpand,
        hasDateMeta,
        hasPermalink: postUrls.size > 0,
        hasMedia,
        hasEngagement,
        tooLarge: rect.height > 4500 || rect.width > Math.max(window.innerWidth * 1.25, 1800),
        isFeed
      };
      return { ...signals, score: scoreFacebookContainerSignals(signals), height: rect.height, width: rect.width };
    }

    findFacebookPostContainer(seedElement) {
      const seed = seedElement?.nodeType === 3 ? seedElement.parentElement : seedElement;
      if (!seed) return { element: null, score: -Infinity, signals: null, trace: [] };
      const trace = [];
      let best = null;
      let current = seed.matches?.('a, img, video, span') ? seed.parentElement : seed;
      for (let level = 1; current && level <= 20; level++, current = current.parentElement) {
        if (!app.utils.isVisible(current)) continue;
        const signals = this.facebookContainerSignals(current);
        trace.push({ level, element: current, ...signals });
        const hasContent = signals.hasText || signals.hasExpand || signals.hasMedia;
        const hasIdentity = signals.hasAuthor || signals.hasDateMeta || signals.hasText;
        const sufficient = !signals.isFeed && signals.hasPermalink && hasContent && hasIdentity && signals.score >= 11;
        if (sufficient) {
          best = { element: current, score: signals.score, signals, level };
          break;
        }
        if (!signals.isFeed && (!best || signals.score > best.score)) best = { element: current, score: signals.score, signals, level };
        if (signals.isFeed || current === document.body) break;
      }
      return { ...(best || { element: seed, score: 0, signals: this.facebookContainerSignals(seed), level: 0 }), trace };
    }

    async logFacebookContainerSelection(selection, ctx) {
      for (const candidate of selection.trace || []) {
        await ctx.logger.info(`Facebook Container candidate level=${candidate.level} score=${candidate.score}`, `author=${candidate.hasAuthor}, text=${candidate.hasText}, expand=${candidate.hasExpand}, date=${candidate.hasDateMeta}, permalink=${candidate.hasPermalink}, media=${candidate.hasMedia}, engagement=${candidate.hasEngagement}`);
      }
      const signals = selection.signals || {};
      await ctx.logger.info('Facebook Selected container score', String(selection.score));
      await ctx.logger.info('Facebook Selected container hasAuthor', String(!!signals.hasAuthor));
      await ctx.logger.info('Facebook Selected container hasText', String(!!signals.hasText));
      await ctx.logger.info('Facebook Selected container hasExpand', String(!!signals.hasExpand));
      await ctx.logger.info('Facebook Selected container hasDateMeta', String(!!signals.hasDateMeta));
    }

    resolvePostContext(root) {
      const initialPostUrl = this.postUrlForArticle(root);
      const anchors = this.permalinkAnchors(root, initialPostUrl);
      const seed = anchors.find((candidate) => !candidate.media)?.link || anchors[0]?.link || root;
      const selection = this.findFacebookPostContainer(seed);
      const postElement = selection.element || root;
      const postUrl = this.postUrlForArticle(postElement) || initialPostUrl;
      const permalink = this.permalinkAnchors(postElement, postUrl)[0]?.link || null;
      return { postUrl, postElement, permalink, selection };
    }

    messageNode(article) {
      const preferred = ['[data-ad-rendering-role="story_message"]', '[data-ad-comet-preview="message"]', '[data-ad-preview="message"]', '[data-testid="post_message"]'];
      for (const selector of preferred) {
        const nodes = this.allVisible(selector, article);
        const topLevel = nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
        if (topLevel[0]) return topLevel[0];
      }
      return null;
    }

    facebookExpandCandidates(postElement, tried = new Set()) {
      const storyMessage = this.visible('[data-ad-rendering-role="story_message"]', postElement);
      const message = storyMessage || this.messageNode(postElement);
      const roots = [storyMessage, message, message?.parentElement, postElement].filter(Boolean);
      const found = [];
      roots.forEach((root, priority) => {
        const selector = root === storyMessage
          ? '[role="button"], div[tabindex="0"], span, button, a, [tabindex], [style*="cursor"]'
          : 'button, [role="button"], a, span, div, [tabindex], [style*="cursor"]';
        for (const element of this.allVisible(selector, root)) {
          const labels = [element.getAttribute('aria-label'), element.getAttribute('title'), this.text(element)]
            .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          const label = labels.find((value) => value.length <= 60 && isFacebookExpandLabel(value));
          if (!label || (priority === 2 && /^more$/i.test(label))) continue;
          const clickable = element.closest('div[role="button"], span[role="button"], a, button, [tabindex]') ||
            (getComputedStyle(element).cursor === 'pointer' ? element : null);
          if (!clickable || !postElement.contains(clickable) || tried.has(clickable) || !app.utils.isVisible(clickable)) continue;
          found.push({ element, clickable, label, priority, insideStoryMessage: !!storyMessage?.contains(element) });
        }
      });
      const unique = new Map();
      for (const candidate of found.sort((left, right) => left.priority - right.priority)) {
        if (!unique.has(candidate.clickable)) unique.set(candidate.clickable, candidate);
      }
      return Array.from(unique.values());
    }

    async expandFacebookFullText(postElement, ctx) {
      const tried = new Set();
      let expanded = false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const storyMessage = this.visible('[data-ad-rendering-role="story_message"]', postElement);
        await ctx.logger.info('Facebook Story message found', String(!!storyMessage));
        const candidates = this.facebookExpandCandidates(postElement, tried);
        await ctx.logger.info('Facebook Expand candidates found', String(candidates.length));
        const candidate = candidates[0];
        if (!candidate) break;
        tried.add(candidate.clickable);
        if (candidate.insideStoryMessage) await ctx.logger.info('Facebook Expand button inside story_message found', candidate.label);
        await ctx.logger.info('Facebook Trying expand candidate', `${candidate.label} (attempt=${attempt}/5)`);
        const before = this.extractPostText(postElement, { broad: true }).text;
        await ctx.logger.info('Facebook Text length before', String(before.length));
        await ctx.logger.info('Facebook Clicking expand button', candidate.label);
        await ctx.logger.info('Facebook Click expand via parent', candidate.clickable.tagName || candidate.clickable.getAttribute('role') || 'unknown');
        const clicked = await ctx.navigation.click(candidate.clickable, `Facebook expand text: ${candidate.label}`, { scroll: false });
        if (!clicked) {
          await ctx.logger.warn('Facebook Expand fail', 'click was not performed');
          continue;
        }
        const changed = await app.utils.waitFor(() => {
          return this.extractPostText(postElement, { broad: true }).text.length > before.length;
        }, { timeoutMs: 1500, intervalMs: 100, token: ctx.token });
        const after = this.extractPostText(postElement, { broad: true }).text;
        await ctx.logger.info('Facebook Text length after', String(after.length));
        await ctx.logger.info('Facebook Text length before/after', `${before.length} -> ${after.length}`);
        if (!changed || after.length <= before.length) {
          await ctx.logger.warn('Facebook Expand fail', 'text length did not increase; trying next candidate');
          continue;
        }
        expanded = true;
        await ctx.logger.info('Facebook Expand success', `${before.length} -> ${after.length}`);
        await ctx.logger.info('Facebook Full text expanded', candidate.label);
      }
      return expanded;
    }

    async expandPostText(postElement, ctx) {
      return this.expandFacebookFullText(postElement, ctx);
    }

    cleanPostText(value) {
      return String(value || '')
        .replace(/\s+(see more|more|read more|show more|ещё|еще|показать ещё|показать еще|показать больше|daha çox|daha cox|devamını gör|devamini gor)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    isFacebookUiText(value) {
      const text = app.utils.normalizeText(value);
      if (!text || isMediaTooltipText(text) || isFacebookExpandLabel(text)) return true;
      if (text.length > 180) return false;
      return /^(like|comment|share|send|follow|join|sponsored|all reactions|нравится|комментировать|поделиться|отправить|подписаться|вступить|реклама|bəyən|şərh|paylaş)(\s|$)/i.test(text) ||
        /^\d+[\d.,km]*\s*(likes?|comments?|shares?|reactions?|нравится|комментар|репост)/i.test(text);
    }

    extractPostText(article, options = {}) {
      const message = this.messageNode(article);
      const messageText = this.cleanPostText(this.text(message));
      if (messageText && !this.isFacebookUiText(messageText)) return { text: messageText, source: 'message node' };

      const header = this.facebookHeaderMetaArea(article);
      const author = this.extractFacebookAuthor(article).author;
      const selectors = options.broad
        ? '[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"], [data-testid="post_message"], div[dir="auto"], span[dir="auto"], p, div, span'
        : '[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"], [data-testid="post_message"], div[dir="auto"], span[dir="auto"], p';
      const expandParents = this.facebookExpandCandidates(article).map((candidate) => candidate.clickable.parentElement).filter(Boolean);
      const candidates = this.allVisible(selectors, article).filter((element) => {
        if (header?.contains(element) || element.contains(header)) return false;
        if (element.closest('button, [role="button"], [role="menu"], [role="tooltip"]')) return false;
        if (element.closest('figure, [data-visualcompletion="media-vc-image"], [data-pagelet*="Media"]')) return false;
        if (element.matches('img, video, svg') || element.querySelector('img, video')) return false;
        const text = this.cleanPostText(this.text(element));
        if (!text || text === author || this.isFacebookUiText(text)) return false;
        if (text.length <= 80 && hasTemporalEvidence(text)) return false;
        const rect = element.getBoundingClientRect();
        const articleRect = article.getBoundingClientRect();
        return rect.top >= articleRect.top && rect.height < articleRect.height * 0.8;
      });
      const ranked = candidates.map((element) => {
        const text = this.cleanPostText(this.text(element));
        const preferred = element.matches('[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"], [data-testid="post_message"]');
        const nearExpand = expandParents.some((parent) => parent.contains(element) || element.contains(parent));
        const controls = element.querySelectorAll('button, [role="button"], [role="menu"]').length;
        return { element, text, score: Math.min(text.length, 2000) + (preferred ? 1000 : 0) + (nearExpand ? 300 : 0) - controls * 100 };
      })
        .filter((candidate) => candidate.text.length <= 20000)
        .sort((left, right) => right.score - left.score || right.text.length - left.text.length);
      return ranked[0] ? { text: ranked[0].text, source: options.broad ? 'broad post container' : 'alternate message node' } : { text: '', source: 'none' };
    }

    extractFacebookAuthor(postElement) {
      const permalink = this.permalinkAnchors(postElement)[0]?.link || null;
      const header = this.facebookHeaderMetaArea(postElement, permalink);
      const profile = this.primaryFacebookProfileBlock(postElement);
      const postRect = postElement.getBoundingClientRect();
      const topLimit = postRect.top + Math.min(300, Math.max(160, postRect.height * 0.35));
      const tiers = [
        { source: 'profile_name', priority: 300, links: profile ? this.allVisible('a[role="link"][href]', profile) : [] },
        { source: 'h3 header', priority: 200, links: header ? this.allVisible('h3 a[role="link"][href], h4 a[role="link"][href]', header) : [] },
        { source: 'top header', priority: 100, links: this.allVisible('h1 a[href], h2 a[href], h3 a[href], h4 a[href], strong a[href], a[role="link"][href]', header || postElement) }
      ];
      const diagnostics = [];
      const candidates = [];
      const seen = new Set();
      for (const tier of tiers) for (const link of tier.links) {
        if (seen.has(link)) continue;
        seen.add(link);
        const author = this.text(link);
        let reason = '';
        if (!author || author.length > 120 || hasTemporalEvidence(author)) reason = 'action';
        else if (link.closest('[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]')) reason = 'body';
        else if (this.normalizePostUrl(link.href) || link.querySelector('img, video') || link.closest('figure, [data-visualcompletion="media-vc-image"], [data-pagelet*="Media"]')) reason = 'media';
        else if (link.closest('form, [role="comment"], [data-ad-rendering-role*="comment"], [data-ad-rendering-role*="reaction"], [data-ad-rendering-role*="share"]') || this.isFacebookUiText(author)) reason = 'comment/action';
        const rect = link.getBoundingClientRect();
        if (!reason && rect.top > topLimit) reason = 'link-preview';
        try {
          const url = new URL(link.href, location.origin);
          if (!reason && !/(^|\.)facebook\.com$/i.test(url.hostname)) reason = 'external';
          if (!reason && (/(^|\/)(photos?|videos?|reel|posts|permalink|comments?|reactions?|share)(\/|$)/i.test(url.pathname) || url.searchParams.has('fbid') || url.searchParams.has('story_fbid'))) reason = 'media/comment/action';
          if (reason) {
            diagnostics.push({ accepted: false, source: tier.source, value: author || link.href, reason });
            continue;
          }
          const heading = !!link.closest('h1, h2, h3, h4, strong');
          const score = tier.priority + (header?.contains(link) ? 100 : 0) + (heading ? 80 : 0) + (link.getAttribute('role') === 'link' ? 20 : 0) - author.length / 10;
          candidates.push({ author, authorUrl: link.href || url.toString(), element: link, score, source: tier.source });
          diagnostics.push({ accepted: true, source: tier.source, value: author, reason: '' });
        } catch (error) {
          diagnostics.push({ accepted: false, source: tier.source, value: author || link.href, reason: 'external' });
        }
      }
      candidates.sort((left, right) => right.score - left.score);
      return candidates[0] ? { ...candidates[0], diagnostics } : { author: '', authorUrl: '', element: null, score: 0, source: '', diagnostics };
    }

    extractFacebookMedia(postElement) {
      const urls = new Set();
      const header = this.facebookHeaderMetaArea(postElement, this.permalinkAnchors(postElement)[0]?.link || null);
      const add = (value) => {
        const url = String(value || '').trim();
        if (!url || url.startsWith('data:') || url.startsWith('blob:') || /emoji|rsrc\.php/i.test(url)) return;
        urls.add(url);
      };
      for (const image of postElement.querySelectorAll('img[src]')) {
        if (!app.utils.isVisible(image) || header?.contains(image) || /avatar|profile picture|emoji|icon/i.test(image.alt || '')) continue;
        const rect = image.getBoundingClientRect();
        const url = image.currentSrc || image.src || image.getAttribute('src');
        const largeEnough = rect.width >= 150 || rect.height >= 150 || (rect.width >= 100 && image.naturalWidth >= 300 && /scontent|fbcdn/i.test(url || ''));
        if (largeEnough) add(url);
      }
      for (const video of postElement.querySelectorAll('video')) {
        const videoUrls = [video.currentSrc, video.src, video.getAttribute('src'), ...Array.from(video.querySelectorAll('source[src]')).map((source) => source.src || source.getAttribute('src'))]
          .filter((value) => value && !String(value).startsWith('blob:'));
        videoUrls.forEach(add);
        if (!videoUrls.length) add(video.poster);
      }
      return Array.from(urls);
    }

    dateCandidate(value, element, score, source) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 80 || !looksLikeFacebookDate(text)) return null;
      const parsed = parseFacebookDate(value);
      return parsed ? { value: text, element, score, source, parsed } : null;
    }

    primaryFacebookProfileBlock(postElement) {
      const postRect = postElement.getBoundingClientRect();
      const topLimit = postRect.top + Math.min(320, Math.max(180, postRect.height * 0.35));
      return this.allVisible('[data-ad-rendering-role="profile_name"]', postElement)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top <= topLimit && !!element.querySelector('a[role="link"][href]');
        })
        .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0] || null;
    }

    facebookHeaderFromProfile(postElement, profileBlock = this.primaryFacebookProfileBlock(postElement)) {
      if (!profileBlock) return null;
      const timestampSelector = 'a[aria-label][href*="/posts/"], a[aria-label][href*="story_fbid"], a[aria-label][href*="fbid="], a[role="link"][href*="/posts/"]';
      let fallback = profileBlock.parentElement;
      for (let current = profileBlock.parentElement, depth = 1; current && current !== postElement && depth <= 10; current = current.parentElement, depth++) {
        const rect = current.getBoundingClientRect();
        if (rect.height > 320) break;
        fallback = current;
        if (current.querySelector(timestampSelector)) return current;
      }
      return fallback;
    }

    facebookTimestampLink(postElement, header = null) {
      const selector = 'a[aria-label][href*="/posts/"], a[aria-label][href*="story_fbid"], a[aria-label][href*="fbid="], a[role="link"][href*="/posts/"]';
      const profile = this.primaryFacebookProfileBlock(postElement);
      const profileRect = profile?.getBoundingClientRect();
      const headerLinks = header ? this.allVisible(selector, header) : [];
      const links = headerLinks.length ? headerLinks : this.allVisible(selector, postElement);
      return links.filter((link) => {
        if (this.rejectedDateElement(link, postElement)) return false;
        if (link.closest('[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"], figure, [data-visualcompletion="media-vc-image"]')) return false;
        const label = link.getAttribute('aria-label') || this.text(link);
        if (!label || label.length > 80 || isMediaTooltipText(label) || /(shared with|доступно всем|поделился|may be an image)/i.test(label)) return false;
        if (!profileRect) return true;
        const rect = link.getBoundingClientRect();
        return Math.abs(rect.top - profileRect.bottom) <= 160 || Math.abs(rect.top - profileRect.top) <= 180;
      }).sort((left, right) => {
        const leftLabel = left.getAttribute('aria-label') || this.text(left);
        const rightLabel = right.getAttribute('aria-label') || this.text(right);
        return Number(hasTemporalEvidence(rightLabel)) - Number(hasTemporalEvidence(leftLabel));
      })[0] || null;
    }

    async extractDateFromProfileHeader(postElement, ctx) {
      const profile = this.primaryFacebookProfileBlock(postElement);
      const header = this.facebookHeaderFromProfile(postElement, profile);
      const timestamp = this.facebookTimestampLink(postElement, header);
      if (!timestamp) return null;
      await ctx.logger.info('Facebook Timestamp link found from header', timestamp.href);
      const label = String(timestamp.getAttribute('aria-label') || this.text(timestamp)).replace(/\u00a0/g, ' ').trim();
      await ctx.logger.info('Facebook Timestamp aria-label', label || 'empty');
      if (!label || isMediaTooltipText(label)) {
        await ctx.logger.warn('Facebook Date rejected', 'reason=visibility/media/body');
        return null;
      }
      const labelDate = parseFacebookDate(label);
      const relative = /^(yesterday|вчера|\d+\s*(s|sec|m|min|h|hr|d|day|days|ч|час|д|дн|мин))/iu.test(label.replace(/\./g, ''));
      if (labelDate && relative) await ctx.logger.info('Facebook Relative date parsed', app.utils.formatTimestamp(labelDate));
      if (labelDate && !relative) {
        await ctx.logger.info('Facebook timestamp aria-label parsed', app.utils.formatTimestamp(labelDate));
        return labelDate;
      }
      await ctx.logger.info('Facebook Hovering timestamp link for full date');
      const hovered = await this.hoverHeaderDateCandidate(timestamp, 'profile header timestamp link', ctx);
      if (hovered?.parsed) {
        await ctx.logger.info('Facebook Tooltip date parsed', app.utils.formatTimestamp(hovered.parsed));
        return hovered.parsed;
      }
      return labelDate;
    }

    facebookHeaderMetaArea(article, permalink = null) {
      const profileHeader = this.facebookHeaderFromProfile(article);
      if (profileHeader) return profileHeader;
      const articleRect = article.getBoundingClientRect();
      const inHeaderBand = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= articleRect.top - 30 && rect.top <= articleRect.top + Math.min(320, Math.max(180, articleRect.height * 0.4));
      };
      const postLinks = Array.from(new Set([
        permalink,
        ...this.permalinkAnchors(article).filter((candidate) => !candidate.media && candidate.compact).map((candidate) => candidate.link)
      ].filter(Boolean))).filter(inHeaderBand);
      const separators = this.allVisible('span, div', article).filter((element) => inHeaderBand(element) && this.text(element) === '·');
      const publicIndicators = this.allVisible('[aria-label], svg title', article).filter((element) => {
        const label = app.utils.normalizeText(element.getAttribute('aria-label') || this.text(element));
        return inHeaderBand(element) && /(shared with|public visibility|public|friends|only me|доступно|общедоступно|друзья|видно|herkese|arkadaş|arkadas)/i.test(label);
      });
      const authorLinks = this.allVisible('h2 a[href], h3 a[href], h4 a[href], strong a[href], a[role="link"][href]', article)
        .filter((link) => inHeaderBand(link) && this.text(link) && !this.normalizePostUrl(link.href));
      const seeds = [...postLinks, ...separators, ...publicIndicators.map((element) => element.closest('[aria-label], span, a, div') || element), ...authorLinks];
      let best = null;
      for (const seed of seeds) {
        let current = seed;
        for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
          const rect = current.getBoundingClientRect();
          if (!inHeaderBand(current) || rect.height < 8 || rect.height > 240) {
            if (current === article) break;
            continue;
          }
          const hasPostLink = postLinks.some((element) => current.contains(element));
          const hasSeparator = separators.some((element) => current.contains(element));
          const hasPublic = publicIndicators.some((element) => current.contains(element));
          const hasAuthor = authorLinks.some((element) => current.contains(element));
          const signalCount = [hasPostLink, hasSeparator, hasPublic, hasAuthor].filter(Boolean).length;
          if (signalCount < 2 && !hasPostLink) continue;
          const score = (hasPostLink ? 10 : 0) + (hasSeparator ? 7 : 0) + (hasPublic ? 7 : 0) + (hasAuthor ? 4 : 0) - rect.height / 300;
          if (!best || score > best.score || (score === best.score && rect.height < best.rect.height)) best = { element: current, score, rect };
          if (current === article) break;
        }
      }
      if (!best && postLinks[0]) {
        let current = postLinks[0].parentElement;
        for (let depth = 0; current && current !== article && depth < 5; depth++, current = current.parentElement) {
          const rect = current.getBoundingClientRect();
          if (inHeaderBand(current) && rect.height <= 180) return current;
        }
      }
      return best?.element || null;
    }

    rejectedDateElement(element, article) {
      if (!element || element.matches('img, video') || element.querySelector('img, video')) return true;
      const message = this.messageNode(article);
      if (message?.contains(element)) return true;
      if (element.closest('figure, [data-visualcompletion="media-vc-image"], [data-pagelet*="Media"], [role="tooltip"]')) return true;
      const text = this.text(element);
      const label = app.utils.normalizeText(`${element.getAttribute('aria-label') || ''} ${text}`);
      return text.length > 80 || isMediaTooltipText(label) || /(shared with|public visibility|see more|read more|show more|показать больше)/i.test(label);
    }

    headerDateCandidates(article, header, permalink = null) {
      const scope = header || article;
      const articleRect = article.getBoundingClientRect();
      const topLimit = articleRect.top + Math.min(320, Math.max(180, articleRect.height * 0.4));
      const separators = this.allVisible('span, div', scope).filter((element) => this.text(element) === '·');
      const visibility = this.allVisible('[aria-label], svg title', scope).filter((element) => {
        const label = app.utils.normalizeText(element.getAttribute('aria-label') || this.text(element));
        return /(shared with|public visibility|public|friends|only me|доступно|общедоступно|друзья|herkese|arkadaş|arkadas)/i.test(label);
      });
      const near = (element, signals, maxX = 180) => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return signals.some((signal) => {
          const signalRect = signal.getBoundingClientRect();
          return Math.abs(centerY - (signalRect.top + signalRect.height / 2)) <= 45 && Math.abs(centerX - (signalRect.left + signalRect.width / 2)) <= maxX;
        });
      };
      const definitions = [
        ['[data-utime]', 1000], ['time', 950], ['abbr', 900], ['a[href]', 800], ['[role="link"]', 700], ['[aria-label]', 650], ['span', 400]
      ];
      const found = [];
      for (const [selector, priority] of definitions) {
        const elements = [scope, ...scope.querySelectorAll(selector)].filter((element) => element.matches?.(selector));
        for (const element of elements) {
          if (!app.utils.isVisible(element) || this.rejectedDateElement(element, article)) continue;
          if (element.closest('h1, h2, h3, h4, strong, button, [role="button"]')) continue;
          const rect = element.getBoundingClientRect();
          if (rect.top > topLimit || rect.height > 70 || rect.width > 420) continue;
          if (this.text(element) === '·') continue;
          const values = [
            element.getAttribute('data-utime'),
            element.getAttribute('datetime'),
            element.getAttribute('title'),
            element.getAttribute('aria-label'),
            this.text(element)
          ].filter((value) => String(value).trim().length > 0 && String(value).trim().length <= 80);
          const hasDateValue = values.some(hasTemporalEvidence);
          const postUrl = element.matches('a[href]') ? this.normalizePostUrl(element.href) : '';
          const mediaLink = !!element.querySelector('img, video') || !!element.closest('figure, [data-visualcompletion="media-vc-image"], [data-pagelet*="Media"]');
          const nearSeparator = near(element, separators);
          const nearVisibility = near(element, visibility, 240);
          const isPermalink = element === permalink || (!!postUrl && !mediaLink);
          if (!hasDateValue && !isPermalink && !nearSeparator && !nearVisibility) continue;
          if (postUrl && /\/(photo|photos)\//i.test(new URL(postUrl).pathname) && !hasDateValue && !nearSeparator && !nearVisibility) continue;
          const score = priority + (hasDateValue ? 180 : 0) + (isPermalink ? 140 : 0) + (nearSeparator ? 80 : 0) + (nearVisibility ? 60 : 0) - values.join(' ').length;
          found.push({ element, selector, priority: score, values });
        }
      }
      const unique = new Map();
      for (const candidate of found.sort((left, right) => right.priority - left.priority)) {
        if (!unique.has(candidate.element)) unique.set(candidate.element, candidate);
      }
      return Array.from(unique.values());
    }

    outsideHeaderDateCandidateCount(article, header) {
      const selector = '[data-utime], time, abbr, a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="fbid="], a[href*="/videos/"], a[href*="/photo"], [aria-label]';
      return this.allVisible(selector, article).filter((element) => {
        if (header?.contains(element) || this.rejectedDateElement(element, article)) return false;
        const values = [element.getAttribute('data-utime'), element.getAttribute('datetime'), element.getAttribute('title'), element.getAttribute('aria-label'), this.text(element)];
        return values.some((value) => String(value || '').trim().length <= 80 && hasTemporalEvidence(value)) || (element.matches('a[href]') && !!this.normalizePostUrl(element.href));
      }).length;
    }

    async hoverHeaderDateCandidate(element, selector, ctx) {
      const tooltipSelector = '[role="tooltip"], [data-testid="tooltip"]';
      const before = new Map(Array.from(document.querySelectorAll(tooltipSelector)).map((node) => [node, this.text(node)]));
      await ctx.logger.info('Facebook Header date candidate found', `selector=${selector}, text=${this.text(element).slice(0, 80)}`);
      await ctx.logger.info('Facebook Hovering header date candidate');
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
      for (let attempt = 0; attempt < 6; attempt++) {
        await app.utils.sleep(250, ctx.token);
        const referencedIds = `${element.getAttribute('aria-describedby') || ''} ${element.getAttribute('aria-labelledby') || ''}`.trim().split(/\s+/).filter(Boolean);
        const referenced = referencedIds.map((id) => document.getElementById(id)).filter(Boolean);
        const tooltipNodes = [...referenced, ...Array.from(document.querySelectorAll(tooltipSelector))];
        for (const tooltip of Array.from(new Set(tooltipNodes))) {
          const text = this.text(tooltip) || tooltip.getAttribute('aria-label') || '';
          if (!text) continue;
          const isFresh = !before.has(tooltip) || before.get(tooltip) !== text || referenced.includes(tooltip);
          if (!isFresh) continue;
          await ctx.logger.info('Facebook Tooltip text', text.slice(0, 180));
          if (isMediaTooltipText(text)) {
            await ctx.logger.warn('Facebook Tooltip rejected: media alt text', text.slice(0, 180));
            continue;
          }
          if (!looksLikeFacebookDate(text)) {
            await ctx.logger.warn('Facebook Tooltip rejected: not a publication date', text.slice(0, 180));
            continue;
          }
          const parsed = parseFacebookDate(text);
          await ctx.logger.info('Facebook Tooltip accepted as publication date', text);
          await ctx.logger.info('Facebook Parsed post date', app.utils.formatTimestamp(parsed));
          return { parsed, text, source: `hover:${selector}` };
        }
      }
      return null;
    }

    async findAndHoverFacebookDateElement(article, ctx, postUrl = '') {
      const context = this.resolvePostContext(article);
      const postElement = context.postElement || article;
      const permalink = context.permalink || this.permalinkAnchors(postElement, postUrl)[0]?.link || null;
      const header = this.facebookHeaderMetaArea(postElement, permalink);
      await ctx.logger.info('Facebook Header/meta area found', String(!!header));
      const candidates = this.headerDateCandidates(postElement, header, permalink);
      await ctx.logger.info('Facebook Date candidates in header', String(candidates.length));
      await ctx.logger.info('Facebook Date candidates outside header ignored', String(this.outsideHeaderDateCandidateCount(postElement, header)));
      for (const candidate of candidates.slice(0, 10)) {
        const hovered = await this.hoverHeaderDateCandidate(candidate.element, candidate.selector, ctx);
        if (hovered) return app.utils.formatTimestamp(hovered.parsed);
        for (const value of candidate.values) {
          if (isMediaTooltipText(value)) {
            await ctx.logger.warn('Facebook Tooltip rejected: media alt text', value.slice(0, 180));
            continue;
          }
          const parsed = parseFacebookDate(value);
          if (!parsed) continue;
          await ctx.logger.info('Facebook date accepted from header attribute/text', `selector=${candidate.selector}, value=${value}`);
          await ctx.logger.info('Facebook Parsed post date', app.utils.formatTimestamp(parsed));
          return app.utils.formatTimestamp(parsed);
        }
      }
      return null;
    }

    async parseFacebookDateFromHeaderHover(article, ctx, postUrl = '') {
      return this.findAndHoverFacebookDateElement(article, ctx, postUrl);
    }

    async resolveDateFromPermalink(postUrl, ctx) {
      if (!postUrl || typeof fetch !== 'function') return null;
      await ctx.logger.info('Facebook permalink date fallback started', postUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('timeout'), 8000);
      const unsubscribe = ctx.token.onCancel(() => controller.abort('cancelled'));
      try {
        const response = await fetch(postUrl, { credentials: 'include', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const patterns = [
          ['permalink creation time', /\\?"(?:creation_time|publish_time|publish_timestamp|creation_timestamp)\\?"\s*:\s*\\?"?(\d{10,13})/gi],
          ['permalink data-utime', /data-utime=["'](\d{10,13})["']/gi],
          ['permalink time datetime', /<time[^>]+datetime=["']([^"']{8,80})["']/gi]
        ];
        for (const [source, pattern] of patterns) {
          for (const match of html.matchAll(pattern)) {
            const parsed = parseFacebookDate(match[1]);
            if (!parsed) continue;
            await ctx.logger.info(`Facebook date parsed from ${source}`, app.utils.formatTimestamp(parsed));
            return parsed;
          }
        }
        await ctx.logger.warn('Facebook permalink page did not expose a publication date', postUrl);
      } catch (error) {
        ctx.token.throwIfCancelled();
        await ctx.logger.warn('Facebook permalink date fallback failed', error.message);
      } finally {
        clearTimeout(timeout);
        unsubscribe();
      }
      return null;
    }

    async extractDate(article, ctx, postUrl = '') {
      const profileHeaderDate = await this.extractDateFromProfileHeader(article, ctx);
      if (profileHeaderDate) {
        await ctx.logger.info('Facebook Date parse result', app.utils.formatTimestamp(profileHeaderDate));
        return profileHeaderDate;
      }
      const headerDate = await this.parseFacebookDateFromHeaderHover(article, ctx, postUrl);
      if (headerDate) {
        await ctx.logger.info('Facebook Date parse result', headerDate);
        return new Date(headerDate);
      }
      const fallbackCandidates = [];
      const push = (value, element, score, source) => {
        if (this.rejectedDateElement(element, article)) return;
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
      if (best) {
        await ctx.logger.info(`Facebook date parsed from ${best.source}`, `${best.value} -> ${app.utils.formatTimestamp(best.parsed)}`);
        await ctx.logger.info('Facebook Date parse result', app.utils.formatTimestamp(best.parsed));
        return best.parsed;
      }
      const permalinkDate = await this.resolveDateFromPermalink(postUrl, ctx);
      if (permalinkDate) {
        await ctx.logger.info('Facebook Date parse result', app.utils.formatTimestamp(permalinkDate));
        return permalinkDate;
      }
      await ctx.logger.warn('Facebook publication date not found after all resolver stages');
      await ctx.logger.info('Facebook Date parse result', 'null');
      return null;
    }

    parsePostDate(article, ctx) {
      return this.extractDate(article, ctx);
    }

    shouldSkipPost(post) {
      return !post || post.advertisement === true || !post.postUrl;
    }

    ancestorPostContainer(node) {
      return this.findFacebookPostContainer(node).element || null;
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
      const context = this.resolvePostContext(article);
      const postElement = context.postElement || article;
      const postUrl = context.postUrl;
      await this.logFacebookContainerSelection(context.selection, ctx);
      if (this.isAdvertisement(postElement)) return { advertisement: true };
      await ctx.logger.info('Facebook Post URL', postUrl || 'unavailable');
      await ctx.logger.info('Facebook Date limit enabled', String(!!ctx.state.dateLimit));
      if (!postUrl) {
        await ctx.logger.warn('Facebook Post saved/skipped reason', 'skipped: post URL unavailable');
        return null;
      }
      await this.expandPostText(postElement, ctx);
      let textResult = this.extractPostText(postElement);
      if (!textResult.text) {
        await ctx.logger.warn('Facebook post text is empty after primary extraction; retrying expand and alternate container extraction', postUrl);
        await this.expandPostText(postElement, ctx);
        textResult = this.extractPostText(postElement, { broad: true });
      }
      if (textResult.text) await ctx.logger.info('Facebook post text extracted', `source=${textResult.source}, length=${textResult.text.length}`);
      else await ctx.logger.warn('Facebook post genuinely has no text; saving without synthetic text', postUrl);

      const authorResult = this.extractFacebookAuthor(postElement);
      for (const diagnostic of authorResult.diagnostics || []) {
        if (diagnostic.source === 'profile_name') await ctx.logger.info('Facebook Author candidate from profile_name', diagnostic.value);
        if (!diagnostic.accepted) await ctx.logger.warn('Facebook Author candidate rejected', `reason=${diagnostic.reason}, value=${diagnostic.value}`);
      }
      if (authorResult.author) await ctx.logger.info('Facebook Author accepted', `${authorResult.author} -> ${authorResult.authorUrl}`);
      else await ctx.logger.warn('Facebook author was not found in header/meta area', postUrl);

      const postDate = await this.extractDate(postElement, ctx, postUrl);
      if (!postDate && ctx.state.dateLimit) {
        await ctx.logger.warn('Facebook Post saved/skipped reason', 'skipped: date unavailable while date limit is enabled');
        return null;
      }
      if (!postDate) await ctx.logger.warn('Facebook date unavailable; post will be saved with postDate=null because date limit is disabled', postUrl);
      const mediaUrls = this.extractFacebookMedia(postElement);
      await ctx.logger.info('Facebook media URLs extracted', String(mediaUrls.length));
      const populatedFields = [authorResult.author, textResult.text, postDate, mediaUrls.length ? mediaUrls : null].filter(Boolean).length;
      if (populatedFields < 2) {
        await ctx.logger.warn('Facebook Post saved/skipped reason', `skipped: insufficient parsed fields (author=${!!authorResult.author}, text=${!!textResult.text}, date=${!!postDate}, media=${mediaUrls.length})`);
        return null;
      }
      return {
        postDate: postDate ? app.utils.formatTimestamp(postDate) : null,
        postUrl,
        author: authorResult.author,
        authorUrl: authorResult.authorUrl,
        text: textResult.text,
        mediaUrls
      };
    }

    parsePost(article, ctx) {
      return this.parseArticle(article, ctx);
    }

    postKeyForArticle(article) {
      const postUrl = this.resolvePostContext(article).postUrl;
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
      let candidateIndex = 0;
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
          candidateIndex++;
          await ctx.logger.info('Facebook Post candidate index', String(candidateIndex));
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
            await ctx.logger.info('Facebook Post saved/skipped reason', 'skipped: advertisement');
            continue;
          }
          if (!post) {
            await ctx.logger.info('Facebook Post saved/skipped reason', 'skipped: parser returned no post');
            continue;
          }
          const outcome = await ctx.onPost(post);
          if (outcome.limitReached) {
            await ctx.logger.info('Facebook Post saved/skipped reason', 'saved: target count reached');
            return { reason: 'target' };
          }
          if (outcome.older) {
            await ctx.logger.info('Facebook Post saved/skipped reason', 'skipped: older than date limit');
            await ctx.logger.info('Facebook date limit reached; finishing current keyword', post.postDate);
            return { reason: 'date-limit' };
          }
          if (outcome.accepted) {
            accepted++;
            await ctx.logger.info('Facebook Post saved/skipped reason', 'saved: accepted');
          } else if (outcome.duplicate) {
            await ctx.logger.info('Facebook Post saved/skipped reason', 'skipped: duplicate');
          } else {
            await ctx.logger.info('Facebook Post saved/skipped reason', 'skipped: validation or persistence rejected the post');
          }
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
  app.parsers.facebookContainerScore = scoreFacebookContainerSignals;
  app.parsers.facebookExpandLabel = isFacebookExpandLabel;
  app.scrapers.facebook = new FacebookScraper();
})(globalThis.ScraperApp);
