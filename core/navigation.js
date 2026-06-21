(function initializeScraperNavigation(app) {
  'use strict';

  const { isVisible, randomInt, sleep, waitFor } = app.utils;

  function dispatchKey(element, type, key, code, keyCode) {
    element.dispatchEvent(new KeyboardEvent(type, {
      key,
      code,
      keyCode,
      which: keyCode,
      charCode: type === 'keypress' ? keyCode : 0,
      bubbles: true,
      cancelable: true,
      composed: true
    }));
  }

  class Navigation {
    constructor(logger, token) {
      this.logger = logger;
      this.token = token;
    }

    async click(element, label) {
      this.token.throwIfCancelled();
      if (!element || !isVisible(element)) return false;
      await this.logger.info(`Click: ${label}`);
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      await sleep(randomInt(100, 300), this.token);
      for (const type of ['pointerover', 'mouseover', 'mousemove', 'mousedown', 'mouseup']) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        await sleep(randomInt(35, 90), this.token);
      }
      element.click();
      await sleep(randomInt(300, 800), this.token);
      return true;
    }

    async type(element, text, label = 'search input') {
      this.token.throwIfCancelled();
      await this.click(element, label);
      element.focus();
      element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) throw new Error(`Native value setter unavailable for ${label}`);
      setter.call(element, '');
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      await sleep(randomInt(300, 800), this.token);
      await this.logger.info(`Typing keyword into ${label}`);
      for (const character of String(text)) {
        this.token.throwIfCancelled();
        const keyCode = character.length === 1 ? character.toUpperCase().charCodeAt(0) : 0;
        dispatchKey(element, 'keydown', character, `Key${character.toUpperCase()}`, keyCode);
        element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: character }));
        setter.call(element, `${element.value}${character}`);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
        dispatchKey(element, 'keyup', character, `Key${character.toUpperCase()}`, keyCode);
        await sleep(randomInt(100, 300), this.token);
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(randomInt(300, 800), this.token);
    }

    async pressEnter(element, verify, label = 'search input') {
      this.token.throwIfCancelled();
      element.focus();
      await this.logger.info(`Enter pressed in ${label}`);
      dispatchKey(element, 'keydown', 'Enter', 'Enter', 13);
      dispatchKey(element, 'keypress', 'Enter', 'Enter', 13);
      dispatchKey(element, 'keyup', 'Enter', 'Enter', 13);
      let verified = await waitFor(verify, { timeoutMs: 3500, intervalMs: 250, token: this.token });
      if (verified) return true;

      const form = element.closest('form');
      if (!form) return false;
      await this.logger.warn(`Enter had no confirmed effect in ${label}; submitting its form`);
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      verified = await waitFor(verify, { timeoutMs: 3500, intervalMs: 250, token: this.token });
      return !!verified;
    }

    async search(options) {
      const attempts = options.attempts || app.constants.MAX_SEARCH_ATTEMPTS;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        this.token.throwIfCancelled();
        await this.logger.info(`Search attempt ${attempt}/${attempts}`);
        let input = await options.findInput();
        if (!input && options.openSearch) {
          await this.logger.warn('Search input is not visible; opening search UI');
          await options.openSearch();
          input = await waitFor(options.findInput, { timeoutMs: 5000, intervalMs: 300, token: this.token });
        }
        if (!input) {
          await this.logger.warn(`Search input was not found on attempt ${attempt}`);
          await sleep(randomInt(800, 1500), this.token);
          continue;
        }

        await this.type(input, options.keyword, `${options.platform} search input`);
        let success = await this.pressEnter(input, options.verify, `${options.platform} search input`);
        if (!success && options.clickSuggestion) {
          await this.logger.warn('Enter was not confirmed; trying an exact UI suggestion');
          success = await options.clickSuggestion(input);
          if (success) success = !!(await waitFor(options.verify, { timeoutMs: 5000, intervalMs: 300, token: this.token }));
        }
        if (success) {
          await this.logger.info('Search results confirmed through UI');
          return { success: true, fallback: false };
        }
        await this.logger.warn(`Search attempt ${attempt} was not confirmed`);
        await sleep(randomInt(800, 1500), this.token);
      }

      await this.logger.warn('All UI search attempts failed; waiting before URL fallback');
      await sleep(5000, this.token);
      if (await options.verify()) return { success: true, fallback: false };
      const fallbackUrl = options.fallbackUrl();
      await this.logger.warn(`Using last-resort URL fallback: ${fallbackUrl}`);
      window.location.assign(fallbackUrl);
      return { success: false, fallback: true, navigating: true };
    }
  }

  app.Navigation = Navigation;
})(globalThis.ScraperApp);
