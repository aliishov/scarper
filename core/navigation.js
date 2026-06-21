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

  function focusAndCaretState(element, documentRef = document) {
    const active = documentRef.activeElement === element;
    const supportsCaret = typeof element?.selectionStart === 'number' && typeof element?.selectionEnd === 'number';
    const expected = String(element?.value || '').length;
    return {
      active,
      supportsCaret,
      selectionStart: supportsCaret ? element.selectionStart : null,
      selectionEnd: supportsCaret ? element.selectionEnd : null,
      caretAtEnd: !supportsCaret || (element.selectionStart === expected && element.selectionEnd === expected)
    };
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

    async ensureFocusedWithCaret(element, label) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        this.token.throwIfCancelled();
        if (document.activeElement !== element) {
          await this.logger.info(`Focus attempt ${attempt}/3: ${label}`);
          await this.click(element, label);
          element.focus({ preventScroll: true });
          element.dispatchEvent(new FocusEvent('focus', { bubbles: true, composed: true }));
        }
        if (typeof element.setSelectionRange === 'function') {
          const end = String(element.value || '').length;
          element.setSelectionRange(end, end);
        }
        const state = focusAndCaretState(element);
        if (state.active && state.caretAtEnd) {
          await this.logger.info(`Focus and caret confirmed in ${label}`, `caret=${state.selectionStart ?? 'n/a'}`);
          return true;
        }
        await this.logger.warn(`Focus/caret was not confirmed in ${label}`, JSON.stringify(state));
        await sleep(randomInt(100, 300), this.token);
      }
      return false;
    }

    async type(element, text, label = 'search input') {
      this.token.throwIfCancelled();
      await this.click(element, label);
      if (!(await this.ensureFocusedWithCaret(element, label))) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) throw new Error(`Native value setter unavailable for ${label}`);
      setter.call(element, '');
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      await sleep(randomInt(300, 800), this.token);
      await this.logger.info(`Typing keyword into ${label}`);
      for (const character of String(text)) {
        this.token.throwIfCancelled();
        if (document.activeElement !== element) {
          await this.logger.warn(`Focus was lost while typing in ${label}; restoring it`);
          if (!(await this.ensureFocusedWithCaret(element, label))) return false;
        }
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
      if (String(element.value) !== String(text)) {
        await this.logger.warn(`Typed value mismatch in ${label}`, `expected="${text}", actual="${element.value}"`);
        return false;
      }
      if (!(await this.ensureFocusedWithCaret(element, label))) return false;
      await this.logger.info(`Keyword and caret verified in ${label}`, `length=${String(text).length}`);
      return true;
    }

    async pressEnter(element, verify, label = 'search input') {
      this.token.throwIfCancelled();
      if (!(await this.ensureFocusedWithCaret(element, label))) {
        await this.logger.warn(`Enter cancelled because ${label} is not active`);
        return false;
      }
      const activeInput = document.activeElement;
      await this.logger.info(`Enter pressed in ${label}`);
      dispatchKey(activeInput, 'keydown', 'Enter', 'Enter', 13);
      dispatchKey(activeInput, 'keypress', 'Enter', 'Enter', 13);
      dispatchKey(activeInput, 'keyup', 'Enter', 'Enter', 13);
      return !!(await waitFor(verify, { timeoutMs: 5000, intervalMs: 250, token: this.token }));
    }

    async submitForm(element, verify, label) {
      const form = element.closest('form');
      if (!form) return false;
      await this.logger.warn(`Submitting search form after UI controls failed: ${label}`);
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return !!(await waitFor(verify, { timeoutMs: 5000, intervalMs: 250, token: this.token }));
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

        const typed = await this.type(input, options.keyword, `${options.platform} search input`);
        if (!typed) {
          await this.logger.warn(`Typing/focus validation failed on search attempt ${attempt}`);
          continue;
        }
        let success = await this.pressEnter(input, options.verify, `${options.platform} search input`);
        if (!success && options.clickSuggestion) {
          await this.logger.warn('Enter was not confirmed; trying an exact UI suggestion');
          success = await options.clickSuggestion(input);
          if (success) success = !!(await waitFor(options.verify, { timeoutMs: 5000, intervalMs: 300, token: this.token }));
        }
        if (!success && options.clickSearchButton) {
          await this.logger.warn('Suggestion was not confirmed; trying the visible search button');
          success = await options.clickSearchButton(input);
          if (success) success = !!(await waitFor(options.verify, { timeoutMs: 5000, intervalMs: 300, token: this.token }));
        }
        if (!success) success = await this.submitForm(input, options.verify, `${options.platform} search input`);
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
  app.navigationInternals = Object.freeze({ focusAndCaretState });
})(globalThis.ScraperApp);
