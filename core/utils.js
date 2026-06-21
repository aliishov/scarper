(function initializeScraperUtils(app) {
  'use strict';

  class CancellationError extends Error {
    constructor(reason = 'cancelled') {
      super(`Operation cancelled: ${reason}`);
      this.name = 'CancellationError';
      this.reason = reason;
    }
  }

  class CancellationToken {
    constructor(parent = null) {
      this.cancelled = false;
      this.reason = '';
      this.listeners = new Set();
      this.parentUnsubscribe = parent?.onCancel((reason) => this.cancel(reason)) || null;
    }

    cancel(reason = 'cancelled') {
      if (this.cancelled) return;
      this.cancelled = true;
      this.reason = reason;
      for (const listener of this.listeners) {
        try { listener(reason); } catch (error) { console.error(error); }
      }
      this.listeners.clear();
      this.parentUnsubscribe?.();
    }

    throwIfCancelled() {
      if (this.cancelled) throw new CancellationError(this.reason);
    }

    onCancel(listener) {
      if (this.cancelled) {
        listener(this.reason);
        return () => {};
      }
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sleep(ms, token = null) {
    token?.throwIfCancelled();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe?.();
        resolve();
      }, Math.max(0, ms));
      const unsubscribe = token?.onCancel((reason) => {
        clearTimeout(timer);
        reject(new CancellationError(reason));
      });
    });
  }

  async function waitFor(check, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10000;
    const intervalMs = options.intervalMs ?? 250;
    const token = options.token || null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      token?.throwIfCancelled();
      try {
        const value = await check();
        if (value) return value;
      } catch (error) {
        if (error instanceof CancellationError) throw error;
      }
      await sleep(intervalMs, token);
    }
    return null;
  }

  function isVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = globalThis.getComputedStyle?.(element);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function absoluteUrl(value, base = globalThis.location?.origin || 'https://example.invalid') {
    try { return new URL(value, base).toString(); } catch (error) { return ''; }
  }

  function parseUserDate(value) {
    const text = String(value || '').trim();
    if (!text) return { value: null, error: null };
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return { value: null, error: 'Используйте формат DD/MM/YYYY.' };
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return { value: null, error: 'Указана несуществующая дата.' };
    }
    return { value: `${match[3]}-${match[2]}-${match[1]}`, error: null };
  }

  function formatDateMask(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length < 2) return digits;
    if (digits.length === 2) return `${digits}/`;
    if (digits.length < 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    if (digits.length === 4) return `${digits.slice(0, 2)}/${digits.slice(2)}/`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  function displayDateFromIso(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function isBeforeDateLimit(value, dateLimit) {
    if (!dateLimit) return false;
    const key = localDateKey(value);
    return !!key && key < dateLimit;
  }

  function formatTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const pad = (number) => String(number).padStart(2, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`;
  }

  function buildFilename(source, now = new Date()) {
    const pad = (number) => String(number).padStart(2, '0');
    const safeSource = String(source || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown';
    return `${safeSource}_result_${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${now.getFullYear()}.jsonl`;
  }

  function canonicalPostKey(post) {
    const source = String(post?.source || '').toLowerCase();
    const rawUrl = post?.postUrl || '';
    try {
      const url = new URL(rawUrl);
      if (source === 'twitter') {
        const match = url.pathname.match(/\/status\/(\d+)/i);
        return match ? `twitter:${match[1]}` : '';
      }
      if (source === 'instagram') {
        const match = url.pathname.match(/\/(p|reel)\/([^/?#]+)/i);
        return match ? `instagram:${match[1].toLowerCase()}:${match[2]}` : '';
      }
      if (source === 'tiktok') {
        const match = url.pathname.match(/\/video\/(\d+)/i);
        return match ? `tiktok:${match[1]}` : '';
      }
      if (source === 'facebook') {
        const id = url.searchParams.get('story_fbid') || url.searchParams.get('fbid');
        if (id) return `facebook:${id}`;
        url.search = '';
        url.hash = '';
        return `facebook:${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
      }
      url.search = '';
      url.hash = '';
      return `${source}:${url.toString().replace(/\/+$/, '')}`;
    } catch (error) {
      return '';
    }
  }

  function normalizePost(rawPost, context) {
    const post = {
      keyword: String(context.keyword || '').trim(),
      source: String(context.source || rawPost.source || '').trim().toLowerCase(),
      scrapedAt: rawPost.scrapedAt || new Date().toISOString(),
      postDate: rawPost.postDate || null,
      postUrl: rawPost.postUrl || '',
      author: String(rawPost.author || '').trim(),
      authorUrl: rawPost.authorUrl || '',
      text: String(rawPost.text || '').trim(),
      mediaUrls: Array.from(new Set((rawPost.mediaUrls || []).filter(Boolean)))
    };
    post.key = canonicalPostKey(post);
    return post;
  }

  function validatePost(post) {
    const required = ['keyword', 'source', 'scrapedAt', 'postDate', 'postUrl', 'author', 'authorUrl', 'text', 'mediaUrls'];
    return required.filter((field) => {
      if (!(field in post)) return true;
      if (field === 'mediaUrls') return !Array.isArray(post.mediaUrls);
      return post[field] === null || post[field] === undefined || post[field] === '';
    });
  }

  app.utils = Object.freeze({
    CancellationError,
    CancellationToken,
    randomInt,
    sleep,
    waitFor,
    isVisible,
    normalizeText,
    absoluteUrl,
    parseUserDate,
    formatDateMask,
    displayDateFromIso,
    localDateKey,
    isBeforeDateLimit,
    formatTimestamp,
    buildFilename,
    canonicalPostKey,
    normalizePost,
    validatePost
  });
})(globalThis.ScraperApp);
