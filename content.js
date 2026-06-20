console.log("Scraper Content Script Loaded");

class ScrapeStopError extends Error {
  constructor() {
    super('Scraping stopped');
    this.name = 'ScrapeStopError';
  }
}

let stopRequested = false;
let skipKeywordRequested = false;

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (stopRequested) {
        reject(new ScrapeStopError());
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0 || skipKeywordRequested) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(remaining, 120));
    };
    tick();
  });
}

const SEARCH_FALLBACK_DELAY_MS = 10000;
const TAB_FALLBACK_DELAY_MS = 8000;
const SERVER_SEND_RETRIES = 3;
const MAX_SEEN_POST_URLS = 5000;

let stateMachineRunning = false;
let stateMachineRerunRequested = false;
let storageWriteQueue = Promise.resolve();
const tikTokDateInfoCache = new Map();
const originalRuntimeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

chrome.runtime.sendMessage = function(message, responseCallback) {
  if (!message || message.action !== 'sendPostToServer') {
    return originalRuntimeSendMessage(message, responseCallback);
  }

  const doSend = async () => {
    const currentState = await getScrapeState();
    const payload = {
      ...(message.data || {}),
      keyword: message.data?.keyword || currentState?.currentKeyword || '',
      scrapedAt: message.data?.scrapedAt || new Date().toISOString()
    };

    let lastError = null;
    for (let attempt = 1; attempt <= SERVER_SEND_RETRIES; attempt++) {
      try {
        const response = await originalRuntimeSendMessage({
          ...message,
          data: payload
        });
        if (response?.success) {
          return response;
        }
        lastError = new Error(response?.error || response?.status || 'sendPostToServer failed');
      } catch (error) {
        lastError = error;
      }
      await sleep(500 * attempt);
    }
    return { success: false, error: lastError?.message || 'sendPostToServer retry limit reached' };
  };

  const promise = doSend();
  if (typeof responseCallback === 'function') {
    promise.then((result) => responseCallback(result)).catch((error) => responseCallback({ success: false, error: error.message }));
    return;
  }
  return promise;
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) {
    return;
  }

  if (request.action === 'stopScraping') {
    stopRequested = true;
    skipKeywordRequested = false;
    mutateScrapeState((state) => {
      state.active = false;
      state.skipCurrentKeyword = false;
      return state;
    }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'skipCurrentKeyword') {
    skipKeywordRequested = true;
    mutateScrapeState((state) => {
      state.skipCurrentKeyword = true;
      return state;
    }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'resetScraperControl') {
    stopRequested = false;
    skipKeywordRequested = false;
    sendResponse({ success: true });
    return true;
  }
});

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function queueStorageWrite(task) {
  storageWriteQueue = storageWriteQueue.then(task, task);
  return storageWriteQueue;
}

async function getScrapeState() {
  const res = await chrome.storage.local.get(['scrapeState']);
  return res.scrapeState || null;
}

async function setScrapeState(state) {
  await chrome.storage.local.set({ scrapeState: state });
}

async function mutateScrapeState(mutator) {
  return queueStorageWrite(async () => {
    const state = await getScrapeState();
    if (!state) return null;
    const nextState = await mutator(state);
    await setScrapeState(nextState || state);
    return nextState || state;
  });
}

async function waitForCondition(checkFn, timeoutMs, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (stopRequested) {
      throw new ScrapeStopError();
    }
    if (skipKeywordRequested) {
      return false;
    }
    try {
      if (checkFn()) return true;
    } catch (e) {
      console.warn('waitForCondition check failed', e);
    }
    await sleep(intervalMs);
  }
  return false;
}

function getNativeValueSetter(element) {
  const proto = element instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, 'value')?.set || function(val) { this.value = val; };
}

function dispatchKeyboardEvent(element, type, key, extra = {}) {
  const event = new KeyboardEvent(type, {
    key,
    code: extra.code || key,
    keyCode: extra.keyCode || key.charCodeAt(0),
    which: extra.which || extra.keyCode || key.charCodeAt(0),
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(event);
  return event;
}

async function humanClick(element, label = 'element') {
  if (!element || stopRequested || skipKeywordRequested) return false;
  try {
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  } catch (e) {}
  await sleep(randomInt(250, 700));
  if (stopRequested || skipKeywordRequested) return false;
  await addLog(`Clicking UI control: ${label}.`);
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
  await sleep(randomInt(80, 180));
  if (stopRequested || skipKeywordRequested) return false;
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  await sleep(randomInt(60, 160));
  if (stopRequested || skipKeywordRequested) return false;
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  element.click();
  await sleep(randomInt(350, 900));
  if (stopRequested || skipKeywordRequested) return false;
  return true;
}

async function pressEnterLikeUser(element, label = 'input') {
  if (!element || stopRequested || skipKeywordRequested) return;
  await addLog(`Pressing Enter in ${label}.`);
  element.focus();
  await sleep(randomInt(120, 280));
  if (stopRequested || skipKeywordRequested) return;
  dispatchKeyboardEvent(element, 'keydown', 'Enter', { code: 'Enter', keyCode: 13, which: 13 });
  dispatchKeyboardEvent(element, 'keypress', 'Enter', { code: 'Enter', keyCode: 13, which: 13 });
  dispatchKeyboardEvent(element, 'keyup', 'Enter', { code: 'Enter', keyCode: 13, which: 13 });
  const form = element.closest('form');
  if (form) {
    await addLog('Input is inside a form; submitting it through a UI event.');
    try {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    } catch (e) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }
}

async function typeIntoInputLikeUser(element, text, options = {}) {
  if (!element || stopRequested || skipKeywordRequested) return;
  const label = options.label || 'input';
  await addLog(`Focusing ${label} and clearing its previous value.`);
  await humanClick(element, label);
  if (stopRequested || skipKeywordRequested) return;
  element.focus();

  const setter = getNativeValueSetter(element);
  setter.call(element, '');
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
  await sleep(randomInt(350, 800));
  if (stopRequested || skipKeywordRequested) return;

  await addLog(`Typing text like a user: "${text}".`);
  for (let i = 0; i < text.length; i++) {
    if (stopRequested) return;
    if (skipKeywordRequested) return;
    const ch = text[i];
    dispatchKeyboardEvent(element, 'keydown', ch, { code: ch.length === 1 ? `Key${ch.toUpperCase()}` : ch });
    element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
    setter.call(element, element.value + ch);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    dispatchKeyboardEvent(element, 'keyup', ch, { code: ch.length === 1 ? `Key${ch.toUpperCase()}` : ch });
    if (Math.random() < 0.08) await sleep(randomInt(250, 650));
    await sleep(randomInt(options.minDelay || 90, options.maxDelay || 260));
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(randomInt(450, 900));
}

function getPlatformSearchUrl(platform, text) {
  if (platform === 'facebook') {
    return `https://www.facebook.com/search/top/?q=${encodeURIComponent(text)}&filters=eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9In0%3D`;
  }
  if (platform === 'tiktok') {
    return `https://www.tiktok.com/search/video?q=${encodeURIComponent(text)}`;
  }
  if (platform === 'instagram') {
    return `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(text)}`;
  }
  return `https://x.com/search?q=${encodeURIComponent(text)}&src=typed_query&f=live`;
}

function buildResultFilename(platform = 'unknown', now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${now.getFullYear()}`;
  const safePlatform = String(platform || 'unknown').trim().toLowerCase() || 'unknown';
  return `${safePlatform}_result_${datePart}.jsonl`;
}

function isOlderThanDateLimit(postDate, dateLimit) {
  if (dateLimit === null || dateLimit === undefined || dateLimit === '') return false;
  const limitTs = Number(dateLimit);
  if (!(postDate instanceof Date) || Number.isNaN(postDate.getTime())) return false;
  if (!Number.isFinite(limitTs)) return false;
  return postDate.getTime() < limitTs;
}

function isReasonablePostDate(date, options = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const minYear = Number.isFinite(options.minYear) ? options.minYear : 2004;
  const maxFutureMs = Number.isFinite(options.maxFutureMs) ? options.maxFutureMs : 5 * 60 * 1000;
  const minTs = new Date(minYear, 0, 1).getTime();
  const maxTs = Date.now() + maxFutureMs;
  const ts = date.getTime();
  return ts >= minTs && ts <= maxTs;
}

function isSearchResultPage(platform) {
  if (platform === 'facebook') return window.location.href.includes('/search/');
  if (platform === 'tiktok') return window.location.href.includes('/search');
  if (platform === 'instagram') {
    return window.location.href.includes('/explore/tags/')
      || window.location.href.includes('/explore/search/')
      || document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]').length > 0;
  }
  return window.location.href.includes('/search');
}

async function clickSearchButtonOrSuggestion(platform, searchInput, text) {
  const form = searchInput.closest('form');
  let candidates = [];

  if (platform === 'instagram') {
    await addLog('Instagram: Ð¶Ð´Ñƒ Ñ€ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚Ñ‹ Ð¿Ð¾Ð¸ÑÐºÐ¾Ð²Ð¾Ð¹ Ð¿Ð¾Ð´ÑÐºÐ°Ð·ÐºÐ¸...');
    await sleep(1500);
    const expectedKeyword = normalizeInstagramKeyword(text);
    candidates = Array.from(document.querySelectorAll('a[href*="/explore/tags/"], a[href*="/explore/search/keyword/"], a[href*="/search/"]'))
      .filter(a => {
        const href = a.getAttribute('href') || '';
        const hrefKeyword = getInstagramKeywordFromUrl(href);
        const bodyKeyword = normalizeInstagramKeyword(a.innerText || a.textContent || '');
        return hrefKeyword === expectedKeyword
          || bodyKeyword.includes(expectedKeyword)
          || href.includes('/explore/tags/')
          || href.includes('/explore/search/keyword/');
      })
      .sort((a, b) => {
        const hrefA = (a.getAttribute('href') || '').toLowerCase();
        const hrefB = (b.getAttribute('href') || '').toLowerCase();
        const hrefKeywordA = getInstagramKeywordFromUrl(hrefA);
        const hrefKeywordB = getInstagramKeywordFromUrl(hrefB);
        const bodyA = normalizeInstagramKeyword(a.innerText || a.textContent || '');
        const bodyB = normalizeInstagramKeyword(b.innerText || b.textContent || '');
        const score = (href, hrefKeyword, bodyKeyword) => {
          let value = 0;
          if (hrefKeyword === expectedKeyword) value += 7;
          if (href.includes('/explore/search/keyword/')) value += 4;
          if (href.includes('/explore/tags/')) value += 3;
          if (bodyKeyword === expectedKeyword) value += 4;
          if (bodyKeyword.includes(expectedKeyword)) value += 2;
          if (href.includes('/explore/tags/')) value += 1;
          return value;
        };
        return score(hrefB, hrefKeywordB, bodyB) - score(hrefA, hrefKeywordA, bodyA);
      });
  } else {
    candidates = Array.from(document.querySelectorAll('button[aria-label*="Search" i], button[aria-label*="ÐŸÐ¾Ð¸ÑÐº" i], [role="button"][aria-label*="Search" i], [role="button"][aria-label*="ÐŸÐ¾Ð¸ÑÐº" i], button[data-e2e="search-box-button"], [data-e2e="search-box-button"], button[type="submit"]'));
    if (platform === 'tiktok' && form) {
      candidates.push(...Array.from(form.querySelectorAll('button')));
    }
  }

  const visible = candidates.find(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  if (visible) {
    return await humanClick(visible, `${platform} search control`);
  }
  await addLog(`ÐÐµ Ð½Ð°ÑˆÐµÐ» Ð²Ð¸Ð´Ð¸Ð¼ÑƒÑŽ ÐºÐ½Ð¾Ð¿ÐºÑƒ/Ð¿Ð¾Ð´ÑÐºÐ°Ð·ÐºÑƒ Ð¿Ð¾Ð¸ÑÐºÐ° Ð´Ð»Ñ ${platform}.`);
  return false;
}

async function submitFacebookSearchLikeUser(searchInput, text, currentUrl) {
  await addLog('Facebook: after typing, trying Enter via UI events before any fallback.');
  searchInput.focus();
  try {
    if (typeof searchInput.setSelectionRange === 'function') {
      const cursor = searchInput.value.length;
      searchInput.setSelectionRange(cursor, cursor);
    }
  } catch (e) {}

  await pressEnterLikeUser(searchInput, 'facebook search');
  const navigatedAfterEnter = await waitForCondition(() => hasFacebookSearchMovedToKeyword(text, currentUrl), 4500, 300);
  if (navigatedAfterEnter) {
    await addLog(`Facebook: search UI navigated after Enter: ${window.location.href}`);
    return true;
  }

  await addLog('Facebook: Enter did not navigate yet, trying visible search suggestion/control.');
  const cleanText = text.trim().toLowerCase();
  const suggestionCandidates = Array.from(document.querySelectorAll('a[href*="/search/"], a[href*="q="], [role="option"] a, [role="listbox"] a'))
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const body = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      const href = el.getAttribute('href') || '';
      const hrefQuery = normalizeKeywordForComparison(getFacebookUrlQueryValue(href));
      return (href.includes('/search/') || href.includes('q=')) && (!hrefQuery || hrefQuery === cleanText || body.includes(cleanText));
    });

  const bestCandidate = suggestionCandidates.find((el) => {
    const href = el.getAttribute('href') || '';
    const hrefQuery = normalizeKeywordForComparison(getFacebookUrlQueryValue(href));
    return href.includes('/search/') && hrefQuery === cleanText;
  }) || suggestionCandidates[0];

  if (bestCandidate) {
    await humanClick(bestCandidate, 'facebook search suggestion');
    const navigatedAfterClick = await waitForCondition(() => hasFacebookSearchMovedToKeyword(text, currentUrl), 7000, 400);
    if (navigatedAfterClick) {
      await addLog(`Facebook: search UI navigated after clicking suggestion/control: ${window.location.href}`);
      return true;
    }
  } else {
    await addLog('Facebook: no visible suggestion/control found after Enter.');
  }

  return false;
}

function getTikTokVideoIdFromUrl(url) {
  const match = String(url || '').match(/\/video\/(\d+)/);
  return match ? match[1] : '';
}

function getTikTokAuthorHandleFromVideoUrl(url) {
  const match = String(url || '').match(/\/@([^/?#]+)\/video\/\d+/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : '';
}

function getTikTokDateFromVideoId(videoId) {
  if (!/^\d{16,22}$/.test(String(videoId || ''))) return null;
  try {
    const unixSeconds = Number(BigInt(videoId) >> 32n);
    const date = new Date(unixSeconds * 1000);
    return isReasonablePostDate(date) ? date : null;
  } catch (error) {
    return null;
  }
}

function normalizeFacebookPostUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return '';

    const path = url.pathname.replace(/\/+$/, '');
    const isPostPath = /\/posts\/[^/]+/i.test(path)
      || /\/permalink\//i.test(path)
      || /\/groups\/[^/]+\/(posts|permalink)\/[^/]+/i.test(path)
      || /\/(photos|videos|reel)\/[^/]+/i.test(path)
      || /\/watch\//i.test(path);
    const storyId = url.searchParams.get('story_fbid') || url.searchParams.get('fbid');
    if (!isPostPath && !storyId) return '';

    const canonical = new URL(`https://www.facebook.com${path || '/'}`);
    if (storyId) canonical.searchParams.set(url.searchParams.has('story_fbid') ? 'story_fbid' : 'fbid', storyId);
    const ownerId = url.searchParams.get('id');
    if (ownerId) canonical.searchParams.set('id', ownerId);
    return canonical.toString();
  } catch (error) {
    return '';
  }
}

function getActiveTikTokPostContainer(postUrl) {
  const videoId = getTikTokVideoIdFromUrl(postUrl);
  const directAnchor = videoId
    ? document.querySelector(`a[href*="/video/${videoId}"]`)
    : null;

  const anchorBasedContainer = directAnchor?.closest('article, section, [data-e2e], [class*="DivVideo"], [class*="ItemContainer"], main > div');
  if (anchorBasedContainer) {
    return anchorBasedContainer;
  }

  const visibleVideo = Array.from(document.querySelectorAll('video')).find((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width > 200 && rect.height > 200 && rect.top < window.innerHeight && rect.bottom > 0;
  });
  const videoBasedContainer = visibleVideo?.closest('article, section, [data-e2e], [class*="DivVideo"], [class*="ItemContainer"], main > div');
  if (videoBasedContainer) {
    return videoBasedContainer;
  }

  return document.querySelector('main') || document.body;
}

function isSponsoredElement(element, platform) {
  if (!element) return false;
  const text = (element?.innerText || '').toLowerCase();
  const sponsoredPatterns = [
    'promoted',
    'sponsored',
    'advertisement',
    'ad Â·',
    'Ñ€ÐµÐºÐ»Ð°Ð¼Ð°',
    'ÑÐ¿Ð¾Ð½ÑÐ¸Ñ€Ð¾Ð²Ð°Ð½Ð¾',
    'Ð¿Ñ€Ð¾Ð´Ð²Ð¸Ð³Ð°ÐµÑ‚ÑÑ',
    'Ñ€ÐµÐºÐ»Ð°Ð¼Ð½Ñ‹Ð¹'
  ];
  if (sponsoredPatterns.some(pattern => text.includes(pattern))) return true;

  if (platform === 'twitter') {
    const socialContext = element.querySelector('[data-testid="socialContext"]');
    const socialText = (socialContext?.innerText || '').toLowerCase();
    return sponsoredPatterns.some(pattern => socialText.includes(pattern));
  }

  return false;
}

function normalizePostUrlForDedup(rawUrl, platform = '') {
  if (!rawUrl) return '';
  if (platform === 'facebook') return normalizeFacebookPostUrl(rawUrl);
  try {
    const url = new URL(rawUrl, window.location.origin);
    const source = String(platform || '').toLowerCase();

    if (source === 'twitter') {
      const statusMatch = url.pathname.match(/\/(?:i\/web\/)?status\/(\d+)/i)
        || url.pathname.match(/\/[^/]+\/status\/(\d+)/i);
      return statusMatch ? `twitter:status:${statusMatch[1]}` : '';
    }
    if (source === 'instagram') {
      const postMatch = url.pathname.match(/\/(p|reel)\/([^/?#]+)/i);
      return postMatch ? `instagram:${postMatch[1].toLowerCase()}:${postMatch[2]}` : '';
    }
    if (source === 'tiktok') {
      const videoId = getTikTokVideoIdFromUrl(url.toString());
      return videoId ? `tiktok:video:${videoId}` : '';
    }

    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function collectSeenPostUrlKeys(state, platform = '') {
  const keys = new Set();
  for (const value of state?.seenPostUrls || []) {
    if (!value) continue;
    if (/^(twitter:status:|instagram:(p|reel):|tiktok:video:)/i.test(value)) {
      keys.add(value);
      continue;
    }
    const normalized = normalizePostUrlForDedup(value, platform);
    if (normalized) keys.add(normalized);
  }
  for (const post of state?.currentPosts || []) {
    const key = normalizePostUrlForDedup(post?.url, post?.source || platform);
    if (key) keys.add(key);
  }
  for (const result of state?.allResults || []) {
    for (const post of result?.posts || []) {
      const key = normalizePostUrlForDedup(post?.url, post?.source || platform);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function rememberSeenPost(state, url, platform = '') {
  const key = normalizePostUrlForDedup(url, platform);
  if (!key) return;
  if (!Array.isArray(state.seenPostUrls)) state.seenPostUrls = [];
  if (!state.seenPostUrls.includes(key)) {
    state.seenPostUrls.push(key);
    if (state.seenPostUrls.length > MAX_SEEN_POST_URLS) {
      state.seenPostUrls = state.seenPostUrls.slice(-MAX_SEEN_POST_URLS);
    }
  }
}

function parseDateValue(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function sortPostsByDateDesc(posts) {
  return (posts || []).slice().sort((a, b) => {
    const bt = parseDateValue(b.date || b.scrapedAt);
    const at = parseDateValue(a.date || a.scrapedAt);
    return (bt || 0) - (at || 0);
  });
}

function buildJsonlContent(allResults, fallbackPlatform = 'unknown') {
  let output = '';
  const emitted = new Set();
  for (const result of allResults || []) {
    const sortedPosts = sortPostsByDateDesc(result.posts || []);
    for (const post of sortedPosts) {
      const source = post.source || fallbackPlatform;
      if ((source === 'facebook' || source === 'tiktok') && !parseDateValue(post.date)) continue;
      const canonicalFacebookUrl = source === 'facebook' ? normalizeFacebookPostUrl(post.url) : '';
      const urlKey = normalizePostUrlForDedup(post.url, source);
      const uniqueKey = urlKey || post.id || `${result.keyword}:${source}:${post.author}:${post.date}:${post.text}`;
      if (uniqueKey && emitted.has(uniqueKey)) continue;
      if (uniqueKey) emitted.add(uniqueKey);
      const line = {
        keyword: result.keyword,
        scrapedAt: post.scrapedAt || result.timestamp,
        source,
        ...post
      };
      if (source === 'facebook') line.url = canonicalFacebookUrl || null;
      output += JSON.stringify(line) + '\n';
    }
  }
  return output;
}

function scoreReadableText(value) {
  const text = String(value || '');
  const mojibakeCount = (text.match(/[ÐÑÃÂâ]/g) || []).length;
  const replacementCount = (text.match(/�/g) || []).length;
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  return (cyrillicCount * 3) + latinCount - (mojibakeCount * 4) - (replacementCount * 6);
}

function repairMojibakeText(value) {
  const text = String(value ?? '');
  if (!/[ÐÑÃÂâ]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(Array.from(text).map((char) => char.charCodeAt(0) & 0xFF));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return scoreReadableText(decoded) >= scoreReadableText(text) ? decoded : text;
  } catch (error) {
    return text;
  }
}

function normalizeKeywordForComparison(value) {
  return String(value || '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getFacebookUrlQueryValue(url) {
  try {
    return new URL(url, window.location.origin).searchParams.get('q') || '';
  } catch (error) {
    return '';
  }
}

function hasFacebookSearchMovedToKeyword(text, previousUrl) {
  const expected = normalizeKeywordForComparison(text);
  const previousQuery = normalizeKeywordForComparison(getFacebookUrlQueryValue(previousUrl));
  const currentQuery = normalizeKeywordForComparison(getFacebookUrlQueryValue(window.location.href));
  if (!expected || !currentQuery) return false;
  return currentQuery === expected && (window.location.href !== previousUrl || currentQuery !== previousQuery);
}

function normalizeInstagramKeyword(value) {
  return String(value || '')
    .replace(/#/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function getInstagramKeywordFromUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    const tagMatch = parsed.pathname.match(/\/explore\/tags\/([^/?#]+)/i);
    if (tagMatch) {
      return normalizeInstagramKeyword(decodeURIComponent(tagMatch[1]));
    }
    const keywordQuery = parsed.searchParams.get('q') || '';
    if (keywordQuery) {
      return normalizeInstagramKeyword(keywordQuery);
    }
    return '';
  } catch (error) {
    return '';
  }
}

function hasInstagramSearchMovedToKeyword(text, previousUrl) {
  const expected = normalizeInstagramKeyword(text);
  const previousKeyword = getInstagramKeywordFromUrl(previousUrl);
  const currentKeyword = getInstagramKeywordFromUrl(window.location.href);
  if (!expected || !currentKeyword) return false;
  return currentKeyword === expected && (window.location.href !== previousUrl || currentKeyword !== previousKeyword);
}

async function downloadJsonlContent(output, platform = 'unknown') {
  const filename = buildResultFilename(platform);
  if (!output) {
    await addLog('JSONL is empty; downloading an empty file as requested.');
  }
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'downloadJsonl',
      filename,
      content: output
    });
    if (response?.success) {
      await addLog(`JSONL download started: ${filename}`);
      return;
    }
    await addLog(`Background download failed (${response?.error || 'unknown'}); trying DOM fallback.`);
  } catch (e) {
    await addLog(`Background download error: ${e.message}; trying DOM fallback.`);
  }

  const blob = new Blob([output], { type: 'application/x-ndjson;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function sendPostToServer(state, postData) {
  if (state.sendToServer === false) {
    await addLog(`Server sending is disabled; post saved locally only: ${postData.url || postData.id}`);
    return;
  }

  const payload = {
    keyword: state.currentKeyword,
    source: postData.source || state.platform || 'unknown',
    author: postData.author,
    authorUrl: postData.authorUrl,
    date: postData.date,
    postUrl: postData.url || postData.id,
    postMedia: postData.media || [],
    postText: postData.text || '',
    scrapedAt: postData.scrapedAt || new Date().toISOString()
  };

  for (let attempt = 1; attempt <= SERVER_SEND_RETRIES; attempt++) {
    try {
      await addLog(`Sending post to server (${attempt}/${SERVER_SEND_RETRIES}): ${payload.postUrl}`);
      const response = await originalRuntimeSendMessage({
        action: 'sendPostToServer',
        data: payload
      });
      if (response?.success) {
        await addLog(`Post sent to server: ${payload.postUrl}`);
        return;
      }
      await addLog(`Server rejected post ${payload.postUrl}: ${response?.status || response?.error || 'unknown'}`);
    } catch (err) {
      await addLog(`Background/server error for ${payload.postUrl}: ${err.message}`);
    }
    await sleep(750 * attempt);
  }
  await addLog(`Post could not be sent after retries; keeping it in JSONL: ${payload.postUrl}`);
}

async function tryClickTextControl(patterns, label) {
  const controls = Array.from(document.querySelectorAll('a, button, [role="button"], [role="tab"], span, div'))
    .filter(el => {
      const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      if (!text || text.length > 80) return false;
      return patterns.some(pattern => pattern.test(text));
    });
  const visible = controls.find(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (!visible) {
    await addLog(`${label}: Ð¿Ð¾Ð´Ñ…Ð¾Ð´ÑÑ‰Ð¸Ð¹ UI-ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð» Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½.`);
    return false;
  }
  const clickable = visible.closest('a, button, [role="button"], [role="tab"]') || visible;
  return await humanClick(clickable, label);
}

async function tryApplyInstagramFreshSort() {
  await addLog('Instagram: Ð¿Ñ€Ð¾Ð±ÑƒÑŽ Ð²ÐºÐ»ÑŽÑ‡Ð¸Ñ‚ÑŒ ÑÐ²ÐµÐ¶ÑƒÑŽ/Ð½ÐµÐ´Ð°Ð²Ð½ÑŽÑŽ ÑÐ¾Ñ€Ñ‚Ð¸Ñ€Ð¾Ð²ÐºÑƒ, ÐµÑÐ»Ð¸ Ñ‚Ð°ÐºÐ°Ñ Ð²ÐºÐ»Ð°Ð´ÐºÐ° Ð´Ð¾ÑÑ‚ÑƒÐ¿Ð½Ð°.');
  const clicked = await tryClickTextControl([
    /^recent$/,
    /recent posts/,
    /latest/,
    /newest/,
    /^Ð½ÐµÐ´Ð°Ð²Ð½/,
    /Ð½Ð¾Ð²Ñ‹Ðµ/,
    /ÑÐ½Ð°Ñ‡Ð°Ð»Ð° Ð½Ð¾Ð²Ñ‹Ðµ/
  ], 'Instagram recent sort/tab');
  if (clicked) {
    await waitForCondition(() => document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]').length > 0, TAB_FALLBACK_DELAY_MS, 500);
  }
  return clicked;
}

async function tryApplyTikTokFreshSort() {
  await addLog('TikTok: Ð¿Ñ€Ð¾Ð±ÑƒÑŽ Ð²ÐºÐ»ÑŽÑ‡Ð¸Ñ‚ÑŒ ÑÐ¾Ñ€Ñ‚Ð¸Ñ€Ð¾Ð²ÐºÑƒ Ð¿Ð¾ ÑÐ²ÐµÐ¶ÐµÑÑ‚Ð¸ Ñ‡ÐµÑ€ÐµÐ· UI.');
  const openedFilter = await tryClickTextControl([
    /filter/,
    /sort/,
    /date posted/,
    /upload date/,
    /Ñ„Ð¸Ð»ÑŒÑ‚Ñ€/,
    /ÑÐ¾Ñ€Ñ‚/,
    /Ð´Ð°Ñ‚Ð°/
  ], 'TikTok filter/sort menu');
  if (openedFilter) {
    await sleep(1000);
  }
  const clickedFresh = await tryClickTextControl([
    /latest/,
    /newest/,
    /recent/,
    /upload date/,
    /date posted/,
    /this week/,
    /this month/,
    /ÑÐ½Ð°Ñ‡Ð°Ð»Ð° Ð½Ð¾Ð²Ñ‹Ðµ/,
    /Ð½ÐµÐ´Ð°Ð²/,
    /Ð¿Ð¾ÑÐ»ÐµÐ´Ð½/,
    /Ð·Ð° Ð½ÐµÐ´ÐµÐ»ÑŽ/,
    /Ð·Ð° Ð¼ÐµÑÑÑ†/
  ], 'TikTok fresh sort option');
  if (clickedFresh) {
    await waitForCondition(() => document.querySelectorAll('[data-e2e="search-video-card-v2"], [data-e2e="search_video-item"], a[href*="/video/"]').length > 0, TAB_FALLBACK_DELAY_MS, 500);
  }
  return clickedFresh;
}

function isVisibleElement(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function getClickableElement(element) {
  return element?.closest?.('button, a, label, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="link"], [role="option"], [role="listitem"]') || element;
}

function normalizeUiText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findVisibleBySelectors(selectors) {
  for (const selector of selectors) {
    const match = Array.from(document.querySelectorAll(selector)).find(isVisibleElement);
    if (match) return match;
  }
  return null;
}

function isCheckedControl(element) {
  if (!element) return false;
  if (element.checked === true) return true;
  if (element.getAttribute?.('aria-checked') === 'true') return true;
  const root = element.closest?.('[role="switch"], [role="checkbox"], label, [role="listitem"], [role="button"]') || element;
  if (root.getAttribute?.('aria-checked') === 'true') return true;
  return !!root.querySelector?.('input[type="checkbox"]:checked, input[role="switch"]:checked');
}

function findInstagramSearchInput() {
  const selectors = [
    'input[aria-label*="Search input" i]',
    'input[aria-label*="Search" i]',
    'input[placeholder*="Search" i]',
    'input[placeholder*="Type to search" i]',
    'input[name="queryBox"]',
    'input[type="search"]',
    'input[type="text"]'
  ];
  const candidates = [];
  for (const selector of selectors) {
    for (const input of document.querySelectorAll(selector)) {
      if (!isVisibleElement(input)) continue;
      candidates.push(input);
    }
  }

  return candidates.find((input) => {
    const meta = normalizeUiText([
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder'),
      input.getAttribute('name')
    ].filter(Boolean).join(' '));
    if (/(search|query|explore)/.test(meta)) return true;
    return !!input.closest('nav, header, [role="dialog"], aside');
  }) || candidates[0] || null;
}

async function ensureInstagramSearchInput() {
  let input = findInstagramSearchInput();
  if (input) {
    await addLog('Instagram: search input found in current UI.');
    return input;
  }

  await addLog('Instagram: search input is not visible yet, trying to open search UI.');
  const rawControls = Array.from(document.querySelectorAll(
    'a[href="/explore/"], a[href*="/explore/search/"], a[href*="/search/"], a[aria-label*="Search" i], button[aria-label*="Search" i], [role="button"][aria-label*="Search" i], svg[aria-label*="Search" i], svg[aria-label*="Search input" i]'
  ));
  const controls = rawControls
    .map((element) => getClickableElement(element))
    .filter((element, index, array) => element && array.indexOf(element) === index && isVisibleElement(element))
    .sort((a, b) => {
      const aHref = a.getAttribute?.('href') || '';
      const bHref = b.getAttribute?.('href') || '';
      const aScore = /\/explore\/search\/|\/search\//.test(aHref) ? 2 : /\/explore\/$/.test(aHref) ? 1 : 0;
      const bScore = /\/explore\/search\/|\/search\//.test(bHref) ? 2 : /\/explore\/$/.test(bHref) ? 1 : 0;
      return bScore - aScore;
    });

  for (const control of controls) {
    await humanClick(control, 'Instagram search UI');
    await sleep(900);
    input = findInstagramSearchInput();
    if (input) {
      await addLog('Instagram: search input appeared after opening the search UI.');
      return input;
    }
  }

  return null;
}

function extractTikTokRawDateValue(timeEl) {
  if (!timeEl) return '';
  const candidates = [
    timeEl.getAttribute?.('datetime'),
    timeEl.dateTime,
    timeEl.getAttribute?.('title'),
    timeEl.getAttribute?.('aria-label'),
    timeEl.textContent,
    timeEl.innerText
  ];
  return candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function collectTikTokDateCandidate(candidates, rawValue, source, priority = 0) {
  const raw = String(rawValue || '').trim();
  if (!raw) return;
  const parsedDate = parseTikTokDate(raw);
  if (!isReasonablePostDate(parsedDate)) return;
  candidates.push({ raw, source, priority, parsedDate });
}

function collectTikTokStructuredDateCandidates(root, videoId, sourcePrefix, candidates) {
  if (!root || typeof root !== 'object') return;
  const queue = [root];
  const visited = new Set();
  const dateKeys = new Set(['uploadDate', 'dateCreated', 'datePublished', 'createTime', 'create_time', 'createdAt', 'publishTime', 'itemCreateTime']);
  const idKeys = ['id', 'videoId', 'awemeId', 'groupId', 'itemId', 'item_id'];

  while (queue.length > 0 && visited.size < 5000) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    const matchedVideo = videoId && idKeys.some((key) => String(current[key] || '') === videoId);
    for (const [key, value] of Object.entries(current)) {
      if (dateKeys.has(key)) {
        collectTikTokDateCandidate(candidates, value, `${sourcePrefix}:${key}`, matchedVideo ? 280 : 200);
      }
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
}

function extractTikTokDateInfo(postUrl, container) {
  const candidates = [];
  const videoId = getTikTokVideoIdFromUrl(postUrl);
  const videoAuthorHandle = getTikTokAuthorHandleFromVideoUrl(postUrl);
  if (videoId && tikTokDateInfoCache.has(videoId)) {
    return tikTokDateInfoCache.get(videoId);
  }
  const finalize = () => {
    candidates.sort((a, b) => b.priority - a.priority || a.parsedDate.getTime() - b.parsedDate.getTime());
    const best = candidates[0] || { raw: '', source: '', parsedDate: null };
    if (videoId && best.parsedDate) {
      tikTokDateInfoCache.set(videoId, best);
      if (tikTokDateInfoCache.size > 1500) {
        const oldestKey = tikTokDateInfoCache.keys().next().value;
        tikTokDateInfoCache.delete(oldestKey);
      }
    }
    return best;
  };

  const inlineProfileDateSpans = container
    ? Array.from(container.querySelectorAll('a[href*="/@"] [data-e2e="browser-nickname"] span, [data-e2e="browser-nickname"] span')).slice(0, 8)
    : [];
  for (const element of inlineProfileDateSpans) {
    collectTikTokDateCandidate(candidates, element.textContent || element.innerText, 'container profile meta date', 220);
  }

  const exactProfileAnchors = Array.from(document.querySelectorAll('a[href*="/@"]')).filter((anchor) => {
    if (!videoAuthorHandle) return false;
    return extractTikTokHandleFromUrl(anchor.href).replace(/^@/, '').toLowerCase() === videoAuthorHandle;
  });
  for (const anchor of exactProfileAnchors) {
    const nicknameSpans = Array.from(anchor.querySelectorAll('[data-e2e="browser-nickname"] span'));
    for (const element of nicknameSpans) {
      collectTikTokDateCandidate(candidates, element.textContent || element.innerText, 'matching profile meta date', 360);
    }
  }
  if (candidates.some((candidate) => candidate.priority >= 360)) {
    return finalize();
  }

  const videoIdDate = getTikTokDateFromVideoId(videoId);
  if (videoIdDate) {
    candidates.push({
      raw: String(Math.floor(videoIdDate.getTime() / 1000)),
      source: 'video id timestamp',
      priority: 300,
      parsedDate: videoIdDate
    });
  }

  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:video:release_date"]',
    'meta[itemprop="uploadDate"]',
    'meta[name="uploadDate"]'
  ];
  for (const selector of metaSelectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    collectTikTokDateCandidate(candidates, element.getAttribute('content') || element.getAttribute('value'), selector, 260);
  }
  if (candidates.some((candidate) => candidate.priority >= 300)) {
    return finalize();
  }

  const scriptSelectors = [
    'script[type="application/ld+json"]',
    'script#__UNIVERSAL_DATA_FOR_REHYDRATION__',
    'script#SIGI_STATE'
  ];
  for (const selector of scriptSelectors) {
    for (const script of document.querySelectorAll(selector)) {
      const raw = script.textContent?.trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        collectTikTokStructuredDateCandidates(parsed, videoId, selector, candidates);
      } catch (error) {}
    }
  }

  try {
    if (window.SIGI_STATE) {
      collectTikTokStructuredDateCandidates(window.SIGI_STATE, videoId, 'window.SIGI_STATE', candidates);
    }
  } catch (error) {}

  try {
    if (window.__UNIVERSAL_DATA_FOR_REHYDRATION__) {
      collectTikTokStructuredDateCandidates(window.__UNIVERSAL_DATA_FOR_REHYDRATION__, videoId, 'window.__UNIVERSAL_DATA_FOR_REHYDRATION__', candidates);
    }
  } catch (error) {}

  const containerTimeNodes = container
    ? Array.from(container.querySelectorAll('time[datetime], [datetime], time')).slice(0, 8)
    : [];
  for (const element of containerTimeNodes) {
    collectTikTokDateCandidate(candidates, extractTikTokRawDateValue(element), 'container time', 170);
  }

  const fallbackNodes = Array.from(document.querySelectorAll('time[datetime], [datetime], time')).slice(0, 12);
  for (const element of fallbackNodes) {
    collectTikTokDateCandidate(candidates, extractTikTokRawDateValue(element), 'document time', 120);
  }

  return finalize();
}

function getFacebookDateCandidateScore(value, element, baseScore) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 160) return -1;

  const hasYear = /\b(19|20)\d{2}\b/.test(normalized);
  const hasClock = /\b\d{1,2}[:.]\d{2}\b/.test(normalized);
  const isUnix = /^\d{10,13}$/.test(normalized);
  const looksRelative = /(just\s*now|today|yesterday|\b\d+\s*(sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years|[smhdwy])\b)/i.test(normalized);
  const hasDigits = /\d/.test(normalized);
  const hasMonthWord = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(normalized);

  if (!isUnix && !looksRelative && !hasDigits && !hasMonthWord) return -1;

  const rect = element?.getBoundingClientRect?.() || { top: 9999 };
  const topDistance = Math.abs(rect.top || 9999);
  let score = baseScore;
  if (hasYear) score += 140;
  if (hasClock) score += 50;
  if (isUnix) score += 170;
  if (looksRelative) score += 25;
  score += Math.max(0, 2000 - Math.min(topDistance, 2000)) / 20;
  return score;
}

function getDomDepth(element) {
  let depth = 0;
  let current = element;
  while (current?.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function resolveAriaLabelledbyText(element) {
  if (!element?.getAttribute) return '';
  const ids = [
    element.getAttribute('aria-labelledby'),
    element.getAttribute('aria-describedby')
  ]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.length === 0) return '';
  const values = ids
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .flatMap((node) => [
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('title'),
      node.getAttribute?.('data-tooltip-content'),
      node.innerText,
      node.textContent
    ])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => value.replace(/\s+/g, ' ').trim());
  return values.find((value) => parseFacebookDate(value)) || values[0] || '';
}

function getFacebookMessageNodes(article) {
  const selectors = [
    '[data-testid="post_message"]',
    '[data-ad-comet-preview="message"]',
    'div[dir="auto"]'
  ];
  const nodes = [];
  for (const selector of selectors) {
    for (const node of article.querySelectorAll(selector)) {
      if (!isVisibleElement(node)) continue;
      const text = String(node.innerText || node.textContent || '').trim();
      if (!text) continue;
      nodes.push(node);
    }
  }
  return nodes.filter((node, index, array) => array.indexOf(node) === index);
}

function getFacebookMessageText(article) {
  const text = getFacebookMessageNodes(article)
    .map((node) => String(node.innerText || node.textContent || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || String(article.innerText || article.textContent || '').trim();
}

function isFacebookSeeMoreLabel(value) {
  const text = normalizeUiText(value);
  if (!text) return false;
  if (text === 'see more' || text === 'read more' || text === '\u0435\u0449\u0451' || text === '\u0435\u0449\u0435') return true;
  if (text === '\u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0435\u0449\u0435') return true;
  if (text === 'daha cox' || text === 'daha çox') return true;
  return text.includes('see more')
    || text.includes('read more')
    || text.includes('\u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0435\u0449')
    || text.includes('\u0435\u0449\u0451')
    || text.includes('\u0435\u0449\u0435')
    || text.includes('daha cox')
    || text.includes('daha çox');
}

async function expandFacebookPostText(article) {
  const beforeText = getFacebookMessageText(article);
  const messageNodes = getFacebookMessageNodes(article);
  const scopes = [article, ...messageNodes];
  const pool = [];

  for (const scope of scopes) {
    const elements = [
      scope,
      ...Array.from(scope.querySelectorAll('div[role="button"], button, a, span, [role="button"]'))
    ];
    for (const element of elements) {
      if (!element || !isVisibleElement(element)) continue;
      const labels = [element.getAttribute('aria-label'), element.innerText, element.textContent].filter(Boolean);
      if (!labels.some(isFacebookSeeMoreLabel)) continue;
      pool.push(element);
    }
  }

  const candidates = pool
    .filter((element, index, array) => array.indexOf(element) === index)
    .sort((a, b) => {
      const textLenA = normalizeUiText(a.innerText || a.textContent || a.getAttribute('aria-label')).length || 999;
      const textLenB = normalizeUiText(b.innerText || b.textContent || b.getAttribute('aria-label')).length || 999;
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const areaA = Math.max(1, rectA.width * rectA.height);
      const areaB = Math.max(1, rectB.width * rectB.height);
      const depthA = getDomDepth(a);
      const depthB = getDomDepth(b);
      return textLenA - textLenB || areaA - areaB || depthB - depthA;
    });

  for (const candidate of candidates.slice(0, 6)) {
    const targets = [candidate, getClickableElement(candidate)].filter((element, index, array) => element && array.indexOf(element) === index);
    for (const target of targets) {
      await addLog('Facebook: expanding full post text before parsing.');
      const clicked = await humanClick(target, 'Facebook See more');
      if (!clicked) continue;
      await sleep(randomInt(700, 1200));
      const afterText = getFacebookMessageText(article);
      const candidateStillVisible = article.contains(candidate) && isVisibleElement(candidate) && isFacebookSeeMoreLabel(candidate.innerText || candidate.textContent || candidate.getAttribute('aria-label'));
      if (afterText.length > beforeText.length + 20 || !candidateStillVisible) {
        return true;
      }
    }
  }

  return false;
}

async function readFacebookTooltipDate(element) {
  if (!element) return '';
  try {
    const hoverTarget = element.closest?.('a') || element.closest?.('abbr, span, div') || element;
    hoverTarget.scrollIntoView({ behavior: 'auto', block: 'center' });
    if (typeof PointerEvent === 'function') {
      hoverTarget.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
      hoverTarget.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    }
    hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
    const rect = hoverTarget.getBoundingClientRect();
    hoverTarget.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: Math.max(0, rect.left + Math.min(rect.width / 2, 20)),
      clientY: Math.max(0, rect.top + Math.min(rect.height / 2, 10))
    }));

    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(260);
      const referencedText = resolveAriaLabelledbyText(element)
        || resolveAriaLabelledbyText(hoverTarget)
        || resolveAriaLabelledbyText(hoverTarget.querySelector?.('[aria-labelledby], [aria-describedby]'));
      if (referencedText && parseFacebookDate(referencedText)) return referencedText;
      const tooltip = Array.from(document.querySelectorAll('[role="tooltip"], div[role="tooltip"], [data-tooltip-id], [data-testid="tooltip"]')).find((candidate) => {
        const text = String(candidate.getAttribute?.('aria-label') || candidate.innerText || candidate.textContent || '').trim();
        return text.length > 0 && !!parseFacebookDate(text);
      });
      if (tooltip) {
        return String(tooltip.getAttribute?.('aria-label') || tooltip.innerText || tooltip.textContent || '').trim();
      }
    }
    return '';
  } catch (error) {
    return '';
  }
}

async function extractFacebookRawDate(article) {
  const candidates = [];
  const pushCandidate = (value, element, baseScore) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    const parsedDate = parseFacebookDate(normalized);
    if (!isReasonablePostDate(parsedDate)) return;
    const score = getFacebookDateCandidateScore(normalized, element, baseScore);
    if (score < 0) return;
    candidates.push({
      value: normalized,
      element,
      score,
      top: Math.abs(element?.getBoundingClientRect?.().top || 9999),
      parsedDate
    });
  };

  Array.from(article.querySelectorAll('[data-utime]')).slice(0, 6).forEach((element) => {
    pushCandidate(element.getAttribute('data-utime'), element, 650);
  });

  Array.from(article.querySelectorAll('time')).slice(0, 6).forEach((element) => {
    pushCandidate(element.getAttribute('datetime'), element, 600);
    pushCandidate(element.getAttribute('data-utime'), element, 580);
    pushCandidate(element.innerText || element.textContent, element, 360);
    pushCandidate(element.closest('a')?.getAttribute('aria-label'), element, 610);
    pushCandidate(element.closest('a')?.getAttribute('title'), element, 590);
    pushCandidate(resolveAriaLabelledbyText(element), element, 620);
    pushCandidate(resolveAriaLabelledbyText(element.closest('a')), element, 630);
  });

  Array.from(article.querySelectorAll('abbr[title]')).slice(0, 6).forEach((element) => {
    pushCandidate(element.getAttribute('title'), element, 560);
  });

  Array.from(article.querySelectorAll('[aria-label], [title], [aria-labelledby], [aria-describedby]')).slice(0, 80).forEach((element) => {
    pushCandidate(element.getAttribute('aria-label'), element, 430);
    pushCandidate(element.getAttribute('title'), element, 420);
    pushCandidate(resolveAriaLabelledbyText(element), element, 460);
  });

  Array.from(article.querySelectorAll('a, [role="link"], span')).filter(isVisibleElement).slice(0, 120).forEach((element) => {
    const text = String(element.innerText || '').replace(/\s+/g, ' ').trim();
    if (text.length > 0 && text.length <= 100) pushCandidate(text, element, 180);
  });

  const anchorSelectors = [
    'a[href*="/posts/"]',
    'a[href*="/permalink/"]',
    'a[href*="story_fbid="]',
    'a[href*="/groups/"]',
    'a[href*="/photos/"]',
    'a[href*="/videos/"]',
    'a[href*="/watch/"]'
  ].join(', ');

  const anchorCandidates = Array.from(article.querySelectorAll(anchorSelectors))
    .filter((element) => isVisibleElement(element) && !!normalizeFacebookPostUrl(element.href || element.getAttribute('href')))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    .slice(0, 8);

  anchorCandidates.forEach((element) => {
    pushCandidate(element.getAttribute('aria-label'), element, 520);
    pushCandidate(element.getAttribute('title'), element, 500);
    pushCandidate(element.innerText || element.textContent, element, 320);
    pushCandidate(resolveAriaLabelledbyText(element), element, 640);
    Array.from(element.querySelectorAll('[aria-labelledby]')).slice(0, 4).forEach((child) => {
      pushCandidate(resolveAriaLabelledbyText(child), child, 635);
      pushCandidate(child.innerText || child.textContent, child, 300);
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.top - b.top);
  let best = candidates[0] || null;

  const hoverTargets = [];
  for (const anchor of anchorCandidates.slice(0, 4)) {
    const labelled = Array.from(anchor.querySelectorAll('[aria-labelledby]')).find(isVisibleElement);
    hoverTargets.push(labelled || anchor);
  }
  for (const candidate of candidates.slice(0, 3)) {
    if (candidate?.element && !/\b(19|20)\d{2}\b/.test(candidate.value) && !/^\d{10,13}$/.test(candidate.value)) {
      hoverTargets.push(candidate.element);
    }
  }

  for (const target of hoverTargets.filter((element, index, array) => element && array.indexOf(element) === index).slice(0, 5)) {
    const tooltipText = await readFacebookTooltipDate(target);
    if (tooltipText) {
      pushCandidate(tooltipText, target, 720);
      candidates.sort((a, b) => b.score - a.score || a.top - b.top);
      best = candidates[0] || best;
      if (/\b(19|20)\d{2}\b/.test(tooltipText)) break;
    }
  }

  await addLog(`Facebook: date candidates found: ${candidates.length}; selected: ${best?.value || 'none'}.`);
  return best?.value || '';
}

function findFacebookFilterButton() {
  const selectorMatch = findVisibleBySelectors([
    'button[aria-label*="Filter" i]',
    '[role="button"][aria-label*="Filter" i]',
    '[role="button"][aria-label*="Search" i][aria-label*="Filter" i]',
    'div[role="button"][aria-label*="Filter" i]',
    'button[aria-label*="\u0424\u0438\u043b\u044c\u0442\u0440" i]',
    '[role="button"][aria-label*="\u0424\u0438\u043b\u044c\u0442\u0440" i]',
    'button[aria-label*="Filtr" i]',
    '[role="button"][aria-label*="Filtr" i]'
  ]);
  if (selectorMatch) {
    return getClickableElement(selectorMatch);
  }

  const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], [role="link"], [role="tab"], [role="listitem"], span'))
    .map((element) => getClickableElement(element))
    .filter((element, index, array) => element && array.indexOf(element) === index && isVisibleElement(element));

  return candidates.find((element) => {
    const text = normalizeUiText(element.innerText || element.textContent || element.getAttribute('aria-label'));
    if (!text || text.length > 100) return false;
    const href = element.getAttribute('href') || '';
    return text === 'filters'
      || text === 'filter'
      || text.includes('all filters')
      || text.includes('search filters')
      || text.includes('filter results')
      || text.includes('\u0444\u0438\u043b\u044c\u0442\u0440')
      || text.includes('filtr')
      || (href.includes('/search/') && text.includes('filter'));
  }) || null;
}

function findFacebookRecentPostsControl() {
  const direct = findVisibleBySelectors([
    'input[role="switch"][aria-label*="Недав" i]',
    'input[role="switch"][aria-label*="Recent" i]',
    'input[type="checkbox"][aria-label*="Недав" i]',
    'input[type="checkbox"][aria-label*="Recent" i]',
    '[role="switch"][aria-label*="Недав" i]',
    '[role="switch"][aria-label*="Recent" i]',
    '[role="checkbox"][aria-label*="Недав" i]',
    '[role="checkbox"][aria-label*="Recent" i]'
  ]);
  if (direct) return direct;

  const textNodes = Array.from(document.querySelectorAll('span, div, label, a, button'))
    .filter(isVisibleElement)
    .map((element) => ({
      element,
      text: normalizeUiText(element.innerText || element.textContent || element.getAttribute('aria-label'))
    }))
    .filter(({ text }) => {
      if (!text || text.length > 100) return false;
      return text === 'recent posts'
        || (text.includes('recent') && text.includes('post'))
        || (/\u043d\u0435\u0434\u0430\u0432/.test(text) && /\u043f\u0443\u0431\u043b\u0438\u043a/.test(text));
    })
    .sort((a, b) => a.text.length - b.text.length || getDomDepth(b.element) - getDomDepth(a.element));

  return textNodes[0] ? getClickableElement(textNodes[0].element) : null;
}

async function openFacebookFilterMenu() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const filterButton = findFacebookFilterButton();
    if (filterButton) {
      await humanClick(filterButton, 'Facebook filters');
      const opened = await waitForCondition(() => !!findFacebookRecentPostsControl(), 3000, 250);
      if (opened) {
        await sleep(500);
        return true;
      }
    }
    await sleep(700);
  }
  return false;
}

async function ensureFacebookRecentPostsFilter(options = {}) {
  const forceRefresh = options.forceRefresh !== false;
  await addLog('Facebook: preparing Recent posts filter in the UI.');

  let recentControl = findFacebookRecentPostsControl();
  if (!recentControl) {
    const menuOpened = await openFacebookFilterMenu();
    if (!menuOpened) {
      await addLog('Facebook: filter button was not found in the current UI.');
      return false;
    }
    recentControl = findFacebookRecentPostsControl();
  }
  if (!recentControl) {
    await addLog('Facebook: Recent posts control was not found after opening filters.');
    return false;
  }

  const refreshResults = async (label) => {
    await humanClick(getClickableElement(recentControl), label);
    await sleep(randomInt(900, 1300));
  };

  if (isCheckedControl(recentControl) && forceRefresh) {
    await addLog('Facebook: Recent posts is already enabled, toggling it off/on to refresh the feed.');
    await refreshResults('Facebook Recent posts off');

    recentControl = findFacebookRecentPostsControl();
    if (!recentControl) {
      await openFacebookFilterMenu();
      recentControl = findFacebookRecentPostsControl();
    }
    if (!recentControl) {
      await addLog('Facebook: failed to reopen Recent posts after the refresh toggle.');
      return false;
    }

    await refreshResults('Facebook Recent posts on');
    await waitForCondition(() => document.querySelectorAll('[role="article"], [data-pagelet*="FeedUnit"]').length > 0, 6000, 400);
    await sleep(randomInt(1500, 2200));
    return true;
  }

  if (!isCheckedControl(recentControl)) {
    await addLog('Facebook: enabling Recent posts.');
    await refreshResults('Facebook Recent posts on');
    await waitForCondition(() => document.querySelectorAll('[role="article"], [data-pagelet*="FeedUnit"]').length > 0, 6000, 400);
    await sleep(randomInt(1500, 2200));
    return true;
  }

  await addLog('Facebook: Recent posts is already enabled.');
  await sleep(1000);
  return true;
}

function extractTikTokHandleFromUrl(url) {
  const match = String(url || '').match(/(?:tiktok\.com)?\/(@[A-Za-z0-9._-]+)/i);
  return match ? match[1] : '';
}

function normalizeTikTokAuthorUrl(url) {
  const handle = extractTikTokHandleFromUrl(url);
  return handle ? `https://www.tiktok.com/${handle}` : '';
}

function extractTikTokHandleFromText(value) {
  const match = String(value || '').match(/@[A-Za-z0-9._-]+/);
  return match ? match[0] : '';
}

function cleanTikTokHandle(handle) {
  return String(handle || '').replace(/^@/, '').trim();
}

function sanitizeTikTokAuthorFallback(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const beforeMeta = text.split('·')[0].split('•')[0].trim();
  const withoutTimeTail = beforeMeta.replace(/\s+\d+\s*(sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|назад|дн\.?|день|дня|дней).*$/i, '').trim();
  const handleMatch = withoutTimeTail.match(/^@?[A-Za-z0-9._-]+/);
  if (handleMatch) {
    return cleanTikTokHandle(handleMatch[0]);
  }
  return withoutTimeTail;
}

function extractTikTokStructuredAuthor() {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? parsed.slice() : [parsed];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== 'object') continue;
        if (Array.isArray(current)) {
          queue.push(...current);
          continue;
        }

        const author = current.author;
        const authorName = String(author?.alternateName || author?.identifier || author?.name || '').trim();
        const authorUrl = normalizeTikTokAuthorUrl(author?.url || author?.sameAs || '');
        if (authorName || authorUrl) {
          return { authorName, authorUrl };
        }

        for (const value of Object.values(current)) {
          if (value && typeof value === 'object') {
            queue.push(value);
          }
        }
      }
    } catch (error) {}
  }
  return { authorName: '', authorUrl: '' };
}

function extractTikTokAuthorInfo(container) {
  const structured = extractTikTokStructuredAuthor();
  const anchorPool = Array.from(new Set([
    ...Array.from(container.querySelectorAll('a[href*="/@"]')),
    ...Array.from(document.querySelectorAll('a[href*="/@"]'))
  ]));
  const profileAnchors = anchorPool
    .filter((anchor) => !/\/video\//i.test(anchor.href || ''))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  const richProfileAnchor = profileAnchors.find((anchor) =>
    anchor.querySelector('[data-e2e="browse-username"], [data-e2e="browse-user-unique-id"], [data-e2e="browser-nickname"]')
  ) || null;
  const bestAnchor = richProfileAnchor || profileAnchors.find((anchor) => extractTikTokHandleFromUrl(anchor.href)) || null;
  const nicknameSpans = Array.from(bestAnchor?.querySelectorAll('[data-e2e="browser-nickname"] span') || [])
    .map((node) => String(node.textContent || node.innerText || '').trim())
    .filter(Boolean);
  const inlineDisplayName = nicknameSpans.find((value) => !isReasonablePostDate(parseTikTokDate(value))) || '';
  const textSources = [
    structured.authorName,
    bestAnchor?.getAttribute('aria-label'),
    bestAnchor?.textContent,
    container.querySelector('[data-e2e="browse-username"]')?.textContent,
    bestAnchor?.querySelector('[data-e2e="browse-username"]')?.textContent,
    inlineDisplayName,
    container.querySelector('[data-e2e="browse-user-unique-id"]')?.textContent,
    container.querySelector('[data-e2e="browse-user-title"]')?.textContent,
    container.querySelector('[data-e2e="browser-nickname"] span')?.textContent,
    container.querySelector('h3[data-e2e="video-author"]')?.textContent,
    container.querySelector('[class*="UniqueId"]')?.textContent,
    document.querySelector('[data-e2e="browse-username"]')?.textContent,
    document.querySelector('[data-e2e="browse-user-unique-id"]')?.textContent,
    document.querySelector('[data-e2e="browse-user-title"]')?.textContent
  ].filter(Boolean).map((value) => String(value).trim());

  let handle = bestAnchor ? extractTikTokHandleFromUrl(bestAnchor.href) : '';
  if (!handle && structured.authorUrl) {
    handle = extractTikTokHandleFromUrl(structured.authorUrl);
  }
  if (!handle) {
    for (const value of textSources) {
      const match = extractTikTokHandleFromText(value);
      if (match) {
        handle = match;
        break;
      }
    }
  }

  const authorUrl = normalizeTikTokAuthorUrl(bestAnchor?.href || structured.authorUrl || (handle ? `https://www.tiktok.com/${handle}` : '')) || 'Unknown';
  const normalizedHandle = cleanTikTokHandle(handle || extractTikTokHandleFromUrl(authorUrl));
  const preferredDisplayName = inlineDisplayName || textSources.find((value) => {
    const trimmed = String(value || '').trim();
    return trimmed && !extractTikTokHandleFromText(trimmed);
  }) || '';
  const fallbackAuthor = sanitizeTikTokAuthorFallback(preferredDisplayName || structured.authorName || textSources[0] || '');
  const authorName = normalizedHandle || fallbackAuthor || 'Unknown';
  return { authorName, authorUrl };
}

async function addLog(message, localState = null) {
  const normalizedMessage = repairMojibakeText(message);
  console.log(normalizedMessage);
  const time = new Date().toLocaleTimeString();
  const logMsg = `[${time}] ${normalizedMessage}`;
  
  if (localState) {
    if (!localState.logs) localState.logs = [];
    localState.logs.push(logMsg);
    if (localState.logs.length > 100) localState.logs.shift();
    await chrome.storage.local.set({ scrapeState: localState });
  } else {
    await mutateScrapeState((state) => {
      if (!state.logs) state.logs = [];
      state.logs.push(logMsg);
      if (state.logs.length > 100) state.logs.shift();
      return state;
    });
  }
}

async function simulateTypingSimple(element, text) {
  await typeIntoInputLikeUser(element, text, { label: 'login/password field', minDelay: 70, maxDelay: 180 });
}

async function simulateTyping(element, text, platform) {
  await addLog('Focusing the search input and clearing its previous value.');
  element.focus();
  element.click();
  
  // React input clearing hack
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  const setter = nativeInputValueSetter || function(val) { this.value = val; };
  
  setter.call(element, '');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(500);
  
  await addLog('Starting human-like typing.');
  for (let i = 0; i < text.length; i++) {
    setter.call(element, element.value + text[i]);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(Math.floor(Math.random() * 200) + 100);
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
  
  await addLog('Typing completed; submitting the search through UI events.');
  await sleep(800);
  
  const currentUrl = window.location.href;
  
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  
  const form = element.closest('form');
  if (form) {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  
  // ÐŸÐ¾Ð¿Ñ‹Ñ‚ÐºÐ° Ð½Ð°Ð¹Ñ‚Ð¸ ÐºÐ½Ð¾Ð¿ÐºÑƒ Ð¿Ð¾Ð¸ÑÐºÐ° (Ð»ÑƒÐ¿Ñƒ) Ð¸ Ð½Ð°Ð¶Ð°Ñ‚ÑŒ ÐµÑ‘
  let searchBtn = document.querySelector('button[aria-label="Search"], button[aria-label="ÐŸÐ¾Ð¸ÑÐº"], [role="button"][aria-label="Search"], [role="button"][aria-label="ÐŸÐ¾Ð¸ÑÐº"], button[data-e2e="search-box-button"], [data-e2e="search-box-button"]');
  if (!searchBtn && platform === 'tiktok' && form) {
    searchBtn = form.querySelector('button');
  }
  if (searchBtn) {
    searchBtn.click();
  }
  
  await sleep(2000);
  
  if (window.location.href === currentUrl || (platform === 'facebook' && !window.location.href.includes('/search/')) || (platform === 'tiktok' && !window.location.href.includes('/search'))) {
    await addLog('Enter did not open search results; using the direct URL fallback.');
    let searchUrl = '';
    if (platform === 'facebook') {
      searchUrl = `https://www.facebook.com/search/top/?q=${encodeURIComponent(text)}&filters=eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9In0%3D`;
    } else if (platform === 'tiktok') {
      searchUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(text)}`;
    } else {
      searchUrl = `https://x.com/search?q=${encodeURIComponent(text)}&src=typed_query&f=live`;
    }
    window.location.assign(searchUrl);
  } else {
    runStateMachine();
  }
}

async function simulateTyping(element, text, platform) {
  await typeIntoInputLikeUser(element, text, { label: `${platform} search input`, minDelay: 110, maxDelay: 310 });
  if (stopRequested || skipKeywordRequested) {
    return;
  }

  const currentUrl = window.location.href;
  let navigated = false;

  if (platform === 'facebook') {
    navigated = await submitFacebookSearchLikeUser(element, text, currentUrl);
  } else {
    await pressEnterLikeUser(element, `${platform} search`);
    if (stopRequested || skipKeywordRequested) {
      return;
    }
    await clickSearchButtonOrSuggestion(platform, element, text);
    if (stopRequested || skipKeywordRequested) {
      return;
    }
  }

  if (!navigated) {
    await addLog(`Waiting up to ${SEARCH_FALLBACK_DELAY_MS / 1000} seconds for the UI to open search results.`);
    navigated = await waitForCondition(() => {
      if (platform === 'facebook') {
        return hasFacebookSearchMovedToKeyword(text, currentUrl);
      }
      if (platform === 'instagram') {
        return hasInstagramSearchMovedToKeyword(text, currentUrl);
      }
      return window.location.href !== currentUrl && isSearchResultPage(platform);
    }, SEARCH_FALLBACK_DELAY_MS, 500);
  }
  if (stopRequested || skipKeywordRequested) {
    return;
  }

  const facebookSearchReady = platform === 'facebook' ? hasFacebookSearchMovedToKeyword(text, currentUrl) : false;
  const instagramSearchReady = platform === 'instagram' ? hasInstagramSearchMovedToKeyword(text, currentUrl) : false;
  if ((!navigated && !isSearchResultPage(platform)) || (platform === 'facebook' && !facebookSearchReady) || (platform === 'instagram' && !instagramSearchReady)) {
    const searchUrl = getPlatformSearchUrl(platform, text);
    await addLog(`UI search did not open results in time; using fallback URL: ${searchUrl}`);
    window.location.assign(searchUrl);
  } else {
    await addLog(`Search results opened through the UI: ${window.location.href}`);
    runStateMachine();
  }
}

async function runStateMachine() {
  if (stopRequested) {
    return;
  }
  if (stateMachineRunning) {
    stateMachineRerunRequested = true;
    await addLog('State machine is already running; queuing another pass.');
    return;
  }

  stateMachineRunning = true;
  try {
    await runStateMachineImpl();
  } catch (error) {
    if (error && error.name === 'ScrapeStopError') {
      return;
    }
    throw error;
  } finally {
    stateMachineRunning = false;
    if (stateMachineRerunRequested) {
      stateMachineRerunRequested = false;
      if (!stopRequested) {
        setTimeout(runStateMachine, 250);
      }
    }
  }
}

async function runStateMachineImpl() {
  const res = await chrome.storage.local.get(['scrapeState']);
  const state = res.scrapeState;
  
  if (!state || !state.active) return;
  if (state.step === 'INITIAL_CHECK') {
    stopRequested = false;
    skipKeywordRequested = false;
  }

  if (state.step === 'INITIAL_CHECK') {
    if (state.platform === 'twitter') {
      const isLoggedOut = document.querySelector('a[href="/login"]') || document.querySelector('a[href="/i/flow/login"]') || window.location.href.includes('login') || window.location.href.includes('onboarding');
      if (isLoggedOut) {
         let isNavigating = false;
         if (!window.location.href.includes('/login') && !window.location.href.includes('login_enter_password') && !window.location.href.includes('onboarding')) {
             window.location.assign('https://x.com/login');
             isNavigating = true;
             return;
         }
        await addLog(`Twitter: Ð½Ðµ Ð·Ð°Ð»Ð¾Ð³Ð¸Ð½ÐµÐ½. ÐÐ°Ñ‡Ð¸Ð½Ð°ÑŽ Ð¿Ñ€Ð¾Ñ†ÐµÑÑ Ð²Ñ…Ð¾Ð´Ð°...`);
        if (!window.location.href.includes('/i/flow/login')) {
          // removed
        }
        
        await sleep(3000);
        let passwordInput = document.querySelector('input[type="password"]:not([aria-hidden="true"]):not([tabindex="-1"])') || document.querySelector('input[name="password"]:not([aria-hidden="true"])');
        let usernameInput = document.querySelector('input[name="username_or_email"]') || document.querySelector('input[autocomplete*="username"]') || document.querySelector('input[name="text"]') || document.querySelector('input:not([type="hidden"])');
        
        if (!passwordInput && usernameInput) {
           const twUser = state.twUsername || "AlexeyMoro51303";
           await simulateTypingSimple(usernameInput, twUser);
           
           usernameInput.blur();
           await sleep(500);

           // Look for Continue, Next, etc.
           const nextBtn = Array.from(document.querySelectorAll('div[data-testid*="next"], button')).find(b => {
               const t = b.innerText?.trim().toLowerCase();
               return t === 'next' || t === 'Ð´Ð°Ð»ÐµÐµ' || t === 'continue' || t === 'Ð´Ð°Ð»ÑŒÑˆÐµ';
           });
           
           const textNode = Array.from(document.querySelectorAll('span, p')).find(b => {
             const text = b.innerText?.trim().toLowerCase();
             return (text === 'next' || text === 'Ð´Ð°Ð»ÐµÐµ' || text === 'continue' || text === 'Ð´Ð°Ð»ÑŒÑˆÐµ') && b.children.length === 0;
           });

           if (nextBtn) {
             nextBtn.click();
           } else if (textNode) {
             textNode.click();
             if (textNode.parentElement) textNode.parentElement.click();
             if (textNode.parentElement?.parentElement) textNode.parentElement.parentElement.click();
           }
           
           // Also try pressing enter on the input just in case
            await pressEnterLikeUser(usernameInput, 'twitter username');

           await sleep(3000);
        }
        
        passwordInput = document.querySelector('input[type="password"]:not([aria-hidden="true"]):not([tabindex="-1"])') || document.querySelector('input[name="password"]:not([aria-hidden="true"])');
        if (passwordInput) {
           const twPass = state.twPassword || "!pLYpMKQb3iz+ys";
           await simulateTypingSimple(passwordInput, twPass);
           
           passwordInput.blur();
           await sleep(500);

           const loginBtn = document.querySelector('[data-testid="LoginForm_Login_Button"]') || Array.from(document.querySelectorAll('div[data-testid*="Login"], button')).find(b => {
               const t = b.innerText?.trim().toLowerCase();
               return t === 'log in' || t === 'Ð²Ð¾Ð¹Ñ‚Ð¸' || t === 'Ð²Ñ…Ð¾Ð´' || t === 'login' || t === 'continue';
           });
           
           const loginText = Array.from(document.querySelectorAll('span, p')).find(b => {
             const text = b.innerText?.trim().toLowerCase();
             return (text === 'log in' || text === 'Ð²Ð¾Ð¹Ñ‚Ð¸' || text === 'Ð²Ñ…Ð¾Ð´' || text === 'login' || text === 'continue') && b.children.length === 0;
           });

           if (loginBtn) {
             loginBtn.click();
           } else if (loginText) {
             loginText.click();
             if (loginText.parentElement) loginText.parentElement.click();
             if (loginText.parentElement?.parentElement) loginText.parentElement.parentElement.click();
           }
           
            await pressEnterLikeUser(passwordInput, 'twitter password');

           await sleep(5000); // Wait for login to finish
        }
        
        // Check if login was successful, redirect to explore
        if (document.querySelector('[data-testid="AppTabBar_Explore_Link"]')) {
           window.location.assign('https://x.com/explore');
           return;
        }
        
        await addLog('ÐžÐ¶Ð¸Ð´Ð°Ð½Ð¸Ðµ Ð»Ð¾Ð³Ð¸Ð½Ð° (X)...');
        setTimeout(runStateMachine, 3000);
        return;

      } else {
         await addLog(`Twitter: Ð·Ð°Ð»Ð¾Ð³Ð¸Ð½ÐµÐ½. ÐŸÐµÑ€ÐµÑ…Ð¾Ð´ Ðº Ð¿Ð¾Ð¸ÑÐºÑƒ...`);
         state.step = 'SEARCHING';
         await chrome.storage.local.set({ scrapeState: state });
         if (!window.location.href.includes('/explore') && !window.location.href.includes('/search')) {
            window.location.assign('https://x.com/explore');
            return;
         }
         runStateMachine();
         return;
      }
    } else if (state.platform === 'facebook') {
      const emailInputExists = document.getElementById('email') || document.querySelector('input[name="email"]');
      const passInputExists = document.getElementById('pass') || document.querySelector('input[name="pass"]');
      const isLoggedIn = document.querySelector('div[role="navigation"]') || document.querySelector('a[aria-label="Facebook"]') || document.querySelector('a[href*="profile.php"]') || document.querySelector('[aria-label="Home"]');

      const isLoggedOut = emailInputExists || passInputExists || window.location.href.includes('/login');

      if (isLoggedOut) {
         await addLog('Facebook: logged out; entering credentials.');
         const emailInput = document.getElementById('email') || document.querySelector('input[name="email"]') || document.querySelector('input[type="text"]') || document.getElementById('_r_6_');
         const passInput = document.getElementById('pass') || document.querySelector('input[name="pass"]') || document.querySelector('input[type="password"]') || document.getElementById('_r_9_');
         
         if (emailInput && passInput) {
           const fbUser = state.fbUsername || "raulalishov849@gmail.com";
           const fbPass = state.fbPassword || "Ds7B*R@qjgMdudw";
           
           await simulateTypingSimple(emailInput, fbUser);
           await sleep(500);
           await simulateTypingSimple(passInput, fbPass);
           await sleep(500);
           
            await pressEnterLikeUser(passInput, 'facebook password');
           
           const loginBtn = document.querySelector('button[name="login"]') || document.querySelector('button[type="submit"]') || document.querySelector('div[aria-label="Log In"][role="button"]') || document.querySelector('div[aria-label="Ð’Ð¾Ð¹Ñ‚Ð¸"][role="button"]');
           
           if (loginBtn) {
               loginBtn.click();
           } else {
               const loginForm = document.getElementById('login_form') || document.querySelector('form');
               if (loginForm) loginForm.submit();
           }
           await sleep(5000);
           window.location.assign('https://www.facebook.com/');
           return;
         }
         return;
      } else if (isLoggedIn) {
         await addLog('Facebook: logged in; proceeding to search.');
         state.step = 'SEARCHING';
         await chrome.storage.local.set({ scrapeState: state });
         runStateMachine();
         return;
      } else {
         await addLog('Facebook: waiting for page load or login status.');
         setTimeout(runStateMachine, 2000);
         return;
      }
    } else if (state.platform === 'tiktok') {
        await addLog(`TikTok: Ð¿ÐµÑ€ÐµÑ…Ð¾Ð´ Ðº Ð¿Ð¾Ð¸ÑÐºÑƒ...`);
        state.step = 'SEARCHING';
        await chrome.storage.local.set({ scrapeState: state });
        runStateMachine();
        return;
     } else if (state.platform === 'instagram') {
      const isLoggedOut = document.querySelector('input[name="username"]') || document.querySelector('input[name="email"]') || window.location.href.includes('/accounts/login/');
      if (isLoggedOut) {
         const usernameToUse = state.igUsername || "raulalishov849@gmail.com";
         const passwordToUse = state.igPassword || "2v7$s4N+9RLsQhG";
         if (usernameToUse && passwordToUse && window.location.href.includes('/accounts/login/')) {
             const userField = document.querySelector('input[name="username"]') || document.querySelector('input[name="email"]') || document.querySelector('input[type="text"]');
             const passField = document.querySelector('input[name="password"]') || document.querySelector('input[name="pass"]') || document.querySelector('input[type="password"]');
             if (userField && passField && !userField.value) {
                 await simulateTypingSimple(userField, usernameToUse);
                 await sleep(500);
                 await simulateTypingSimple(passField, passwordToUse);
                 await sleep(500);
                 
                  await pressEnterLikeUser(passField, 'instagram password');
                 
                 const loginBtn = document.querySelector('button[type="submit"]') || document.querySelector('div[aria-label="Log In"][role="button"]') || Array.from(document.querySelectorAll('div[role="button"]')).find(b => {
                     const t = b.innerText?.trim().toLowerCase();
                     return t === 'log in' || t === 'Ð²Ð¾Ð¹Ñ‚Ð¸' || t === 'login';
                 });
                 if (loginBtn) {
                     loginBtn.click();
                     const childSpan = loginBtn.querySelector('span');
                     if (childSpan) childSpan.click();
                     const htmlDiv = loginBtn.querySelector('.html-div');
                     if (htmlDiv) htmlDiv.click();
                 } else {
                     const loginForm = document.getElementById('login_form') || document.querySelector('form');
                     if (loginForm) loginForm.submit();
                 }
                 
                 await addLog(`Instagram: Ð°Ð²Ñ‚Ð¾Ñ€Ð¸Ð·Ð°Ñ†Ð¸Ñ Ð² Ð¿Ñ€Ð¾Ñ†ÐµÑÑÐµ...`);
                 setTimeout(runStateMachine, 6000);
                 return;
             }
         }
         
         await addLog(`Instagram: Ð¾Ð¶Ð¸Ð´Ð°ÐµÐ¼ Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸ Ð¾ÐºÐ½Ð° Ð²Ñ…Ð¾Ð´Ð° Ð¸Ð»Ð¸ Ñ€ÑƒÑ‡Ð½Ð¾Ð³Ð¾ Ð²Ñ…Ð¾Ð´Ð°...`);
         if (!window.location.href.includes('/accounts/login/')) {
             window.location.assign('https://www.instagram.com/accounts/login/');
             return;
         }
         setTimeout(runStateMachine, 3000);
         return;
      } else {
         await addLog(`Instagram: Ð·Ð°Ð»Ð¾Ð³Ð¸Ð½ÐµÐ½. ÐŸÐµÑ€ÐµÑ…Ð¾Ð´ Ðº ÑÐ±Ð¾Ñ€Ñƒ...`);
         state.step = 'SEARCHING';
         await chrome.storage.local.set({ scrapeState: state });
         runStateMachine();
         return;
      }
    }
  } else if (state.step === 'SEARCHING') {

    await addLog('Looking for the search input on the current page.');
    let searchInput = null;
    for(let i=0; i<10; i++) {
      if (stopRequested || skipKeywordRequested) {
        break;
      }
      if (state.platform === 'instagram') {
        searchInput = await ensureInstagramSearchInput();
      } else if (state.platform === 'facebook') {
        searchInput = document.querySelector('input[type="search"], input[name="q"], input[name="search"], [role="search"] input, input[placeholder*="Search" i], input[aria-label*="Search" i]');
      } else if (state.platform === 'tiktok') {
        searchInput = document.querySelector('input[type="search"], [role="search"] input, input[placeholder*="Search" i], input[placeholder*="ÐŸÐ¾Ð¸ÑÐº" i], [data-e2e="search-user-input"]');
      } else {
        searchInput = document.querySelector('[data-testid="SearchBox_Search_Input"]') || document.querySelector('input[aria-label*="Search" i]') || document.querySelector('input[placeholder*="Search" i]') || document.querySelector('input[aria-label*="ÐŸÐ¾Ð¸ÑÐº" i]') || document.querySelector('input[placeholder*="ÐŸÐ¾Ð¸ÑÐº" i]') || document.querySelector('[role="search"] input');
      }
      if (searchInput) break;
      await sleep(1000);
    }
    if (skipKeywordRequested || state.skipCurrentKeyword) {
      skipKeywordRequested = false;
      state.skipCurrentKeyword = false;
      await chrome.storage.local.set({ scrapeState: state });
      await finishKeyword(state);
      return;
    }
    
    if (searchInput) {
      state.step = 'SCRAPING';
      await chrome.storage.local.set({ scrapeState: state });
      await simulateTyping(searchInput, state.currentKeyword, state.platform);
      if (skipKeywordRequested || state.skipCurrentKeyword) {
        skipKeywordRequested = false;
        state.skipCurrentKeyword = false;
        await chrome.storage.local.set({ scrapeState: state });
        await finishKeyword(state);
        return;
      }
    } else {
      if (state.platform === 'instagram') {
        const fallbackUrl = getPlatformSearchUrl('instagram', state.currentKeyword);
        await addLog(`Instagram: Ð¿Ð¾Ð»Ðµ Ð¿Ð¾Ð¸ÑÐºÐ° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾ Ð¿Ð¾ÑÐ»Ðµ Ð¾Ð¶Ð¸Ð´Ð°Ð½Ð¸Ñ, Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÑŽ fallback Ð¿Ð¾ keyword: ${fallbackUrl}`);
        state.step = 'SCRAPING';
        await chrome.storage.local.set({ scrapeState: state });
        window.location.assign(fallbackUrl);
        return;
      }
      await addLog('Search input was not found; retrying in 5 seconds.');
      setTimeout(runStateMachine, 5000);
    }
  } 
  else if (state.step === 'SCRAPING') {
    if (state.platform !== 'instagram' && !window.location.href.includes('/search')) {
      await addLog('Waiting for the search results page to load.');
      setTimeout(runStateMachine, 2000);
      return;
    }
    
    if (state.platform === 'twitter') {
      if (!window.location.href.includes('f=live')) {
        await addLog(`Ð˜Ñ‰Ñƒ Ð²ÐºÐ»Ð°Ð´ÐºÑƒ "ÐŸÐ¾ÑÐ»ÐµÐ´Ð½Ð¸Ðµ" (Latest)...`);
        const latestTab = document.querySelector('a[href*="f=live"][role="tab"]');
        if (latestTab) {
          await addLog(`ÐšÐ»Ð¸ÐºÐ°ÑŽ Ð½Ð° Ð²ÐºÐ»Ð°Ð´ÐºÑƒ "ÐŸÐ¾ÑÐ»ÐµÐ´Ð½Ð¸Ðµ"...`);
          await humanClick(latestTab, 'X Latest tab');
          const latestLoaded = await waitForCondition(() => window.location.href.includes('f=live') || document.querySelectorAll('article[data-testid="tweet"]').length > 0, TAB_FALLBACK_DELAY_MS, 500);
          if (!latestLoaded) {
            await addLog(`Ð’ÐºÐ»Ð°Ð´ÐºÐ° Latest Ð½Ðµ Ð¿Ð¾Ð´Ñ‚Ð²ÐµÑ€Ð´Ð¸Ð»Ð° Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÑƒ Ð·Ð° ${TAB_FALLBACK_DELAY_MS / 1000} ÑÐµÐº.`);
          }
        } else {
          await addLog(`Ð’ÐºÐ»Ð°Ð´ÐºÐ° Latest Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð° Ð² DOM, Ð¿Ð¾Ð´Ð¾Ð¶Ð´Ñƒ Ð¿ÐµÑ€ÐµÐ´ fallback...`);
          await sleep(TAB_FALLBACK_DELAY_MS);
        }
        if (!window.location.href.includes('f=live')) {
          await addLog(`ÐŸÑ€Ð¸Ð¼ÐµÐ½ÑÑŽ Latest Ñ‡ÐµÑ€ÐµÐ· ÑÑÑ‹Ð»ÐºÑƒ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð¿Ð¾ÑÐ»Ðµ Ð¾Ð¶Ð¸Ð´Ð°Ð½Ð¸Ñ UI.`);
          const url = new URL(window.location.href);
          url.searchParams.set('f', 'live');
          window.location.href = url.toString();
          return;
        }
      }
      await addLog(`ÐžÐ¶Ð¸Ð´Ð°Ð½Ð¸Ðµ Ð¿Ð¾ÑÐ²Ð»ÐµÐ½Ð¸Ñ Ñ‚Ð²Ð¸Ñ‚Ð¾Ð²...`);
      let foundTweets = false;
      for(let i=0; i<15; i++) {
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        if (tweets.length > 0) {
          foundTweets = true;
          break;
        }
        const emptyState = document.querySelector('[data-testid="emptyState"]');
        const pageText = document.body.innerText || "";
        if (emptyState || /No results for|Nothing to see here|ÐÐ¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾|ÐÐµÑ‚ Ñ€ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚Ð¾Ð² Ð´Ð»Ñ|Ð ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚Ð¾Ð² Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾|Ð¿Ð¾ Ð·Ð°Ð¿Ñ€Ð¾ÑÑƒ Ð½Ð¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾/i.test(pageText)) {
          await addLog(`âš ï¸ ÐŸÐ¾ÑÑ‚Ñ‹ Ð¿Ð¾ ÑÐ»Ð¾Ð²Ñƒ "${state.currentKeyword}" Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ‹ (X Empty State). ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÐµÐ¼ ÑÐ»Ð¾Ð²Ð¾.`);
          await finishKeyword(state);
          return;
        }
        await sleep(1000);
      }
      if (!foundTweets) {
        await addLog(`âš ï¸ Ð¢Ð²Ð¸Ñ‚Ñ‹ Ð¿Ð¾ ÑÐ»Ð¾Ð²Ñƒ "${state.currentKeyword}" Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ‹ Ð¿Ð¾ÑÐ»Ðµ 15 ÑÐµÐº Ð¾Ð¶Ð¸Ð´Ð°Ð½Ð¸Ñ. ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÐµÐ¼.`);
        await finishKeyword(state);
        return;
      }
      await addLog(`ÐÐ°Ñ‡Ð¸Ð½Ð°ÑŽ ÑÐ±Ð¾Ñ€ Ð¿Ð¾ÑÑ‚Ð¾Ð² Ð¿Ð¾ ÑÐ»Ð¾Ð²Ñƒ "${state.currentKeyword}"...`);
      await scrapeTwitterLoop(state);
    } else if (state.platform === 'facebook') {
      let filterApplied = await ensureFacebookRecentPostsFilter({ forceRefresh: true });

      
      // Fallback to URL modification if UI click failed
      if (!filterApplied && !window.location.href.includes('filters=')) {
        await addLog(`Facebook: Recent posts UI filter was not confirmed; waiting ${TAB_FALLBACK_DELAY_MS / 1000} seconds before fallback.`);
        await sleep(TAB_FALLBACK_DELAY_MS);
        await addLog('Facebook: applying the Recent posts filter through the fallback URL.');
        const url = new URL(window.location.href);
        // Ð£Ð±ÐµÐ¶Ð´Ð°ÐµÐ¼ÑÑ Ñ‡Ñ‚Ð¾ Ð¼Ñ‹ Ð½Ð° /search/top/
        if (url.pathname.includes('/search/posts')) {
          url.pathname = url.pathname.replace('/search/posts', '/search/top');
        } else if (!url.pathname.includes('/search/top')) {
          url.pathname = '/search/top/';
        }
        url.searchParams.set('filters', 'eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9In0=');
        window.location.assign(url.toString());
        return;
      }
      
      await addLog('Facebook: waiting for posts to appear.');
      let foundFB = false;
      for(let i=0; i<15; i++) {
        if (document.querySelectorAll('[role="article"], [data-pagelet*="FeedUnit"], div[data-ad-comet-preview="message"], div[data-ad-preview="message"]').length > 0) {
          foundFB = true;
          break;
        }
        const pageText = document.body.innerText || "";
        if (/We couldn't find anything|ÐÐ¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾|ÐœÑ‹ Ð½Ðµ Ð½Ð°ÑˆÐ»Ð¸ Ð½Ð¸Ñ‡ÐµÐ³Ð¾|Ð¿Ð¾ Ð²Ð°ÑˆÐµÐ¼Ñƒ Ð·Ð°Ð¿Ñ€Ð¾ÑÑƒ Ð½Ð¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾|Ð ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚Ð¾Ð² Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾/i.test(pageText)) {
          await addLog(`Facebook: no posts found for keyword "${state.currentKeyword}"; skipping it.`);
          await finishKeyword(state);
          return;
        }
        await sleep(1000);
      }
      if (!foundFB) {
        await addLog(`Facebook: no posts appeared for keyword "${state.currentKeyword}" after waiting; skipping it.`);
        await finishKeyword(state);
        return;
      }
      await addLog(`Facebook: starting post collection for keyword "${state.currentKeyword}".`);
      await scrapeFacebookLoop(state);
    } else if (state.platform === 'instagram') {
      await tryApplyInstagramFreshSort();
      await sleep(1500);
      await addLog(`ÐžÐ¶Ð¸Ð´Ð°Ð½Ð¸Ðµ Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸ Ð¿Ð¾ÑÑ‚Ð¾Ð² Ð¿Ð¾ Ñ…ÑÑˆÑ‚ÐµÐ³Ñƒ...`);
      let foundIG = false;
      for(let i=0; i<15; i++) {
        if (document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]').length > 0) {
          foundIG = true;
          break;
        }
        const pageText = document.body.innerText || "";
        if (/isn't available|Ð½ÐµÐ´ÐµÐ¹ÑÑ‚Ð²Ð¸Ñ‚ÐµÐ»ÑŒÐ½Ð°|Ð½ÐµÐ´Ð¾ÑÑ‚ÑƒÐ¿Ð½Ð°|No posts yet|ÐŸÑƒÐ±Ð»Ð¸ÐºÐ°Ñ†Ð¸Ð¹ Ð¿Ð¾ÐºÐ° Ð½ÐµÑ‚|Ð ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚Ð¾Ð² Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾|ÐŸÐ¾ Ð·Ð°Ð¿Ñ€Ð¾ÑÑƒ Ð½Ð¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾|ÐÐ¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾|No results for/i.test(pageText)) {
          await addLog(`âš ï¸ Ð¥ÑÑˆÑ‚ÐµÐ³ "${state.currentKeyword}" Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½ Ð½Ð° Instagram. ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÐµÐ¼.`);
          await finishKeyword(state);
          return;
        }
        await sleep(1000);
      }
      if (!foundIG) {
        await addLog(`âš ï¸ ÐŸÐ¾ÑÑ‚Ñ‹ Ð¿Ð¾ Ñ…ÑÑˆÑ‚ÐµÐ³Ñƒ "${state.currentKeyword}" Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ‹ Ð½Ð° Instagram Ð¿Ð¾ÑÐ»Ðµ Ð¾Ð¶Ð¸Ð´Ð°Ð½Ð¸Ñ. ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÐµÐ¼.`);
        await finishKeyword(state);
        return;
      }
      await addLog(`ÐÐ°Ñ‡Ð¸Ð½Ð°ÑŽ ÑÐ±Ð¾Ñ€ Ð¿Ð¾ÑÑ‚Ð¾Ð² Ð¿Ð¾ Ñ…ÑÑˆÑ‚ÐµÐ³Ñƒ "${state.currentKeyword}"...`);
      await scrapeInstagramLoop(state);
    } else if (state.platform === 'tiktok') {
      if (window.location.href.includes('/search') && !window.location.href.includes('/search/video')) {
         await addLog(`TikTok: Ð¿ÐµÑ€ÐµÑ…Ð¾Ð¶Ñƒ Ð½Ð° Ð²ÐºÐ»Ð°Ð´ÐºÑƒ "Ð’Ð¸Ð´ÐµÐ¾"...`);
         window.location.assign(`https://www.tiktok.com/search/video?q=${encodeURIComponent(state.currentKeyword)}`);
         return;
      }
      await tryApplyTikTokFreshSort();
      await addLog(`ÐžÐ¶Ð¸Ð´Ð°Ð½Ð¸Ðµ Ð¿Ð¾ÑÐ²Ð»ÐµÐ½Ð¸Ñ Ð²Ð¸Ð´ÐµÐ¾ TikTok...`);
      let foundTikTok = false;
      for(let i=0; i<15; i++) {
        const cards = document.querySelectorAll('[data-e2e="search-video-card-v2"], [data-e2e="search_video-item"], div[class*="DivVideoItemContainer"], div[class*="search-item"], a[href*="/video/"]');
        if (cards.length > 0) {
          foundTikTok = true;
          break;
        }
        const pageText = document.body.innerText || "";
        if (/No results|ÐÐ¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾|ÐÐµÑ‚ Ñ€ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚Ð¾Ð²|Ð¿Ð¾ Ð²Ð°ÑˆÐµÐ¼Ñƒ Ð·Ð°Ð¿Ñ€Ð¾ÑÑƒ Ð½Ð¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾/i.test(pageText)) {
          await addLog(`âš ï¸ Ð’Ð¸Ð´ÐµÐ¾ Ð¿Ð¾ ÑÐ»Ð¾Ð²Ñƒ "${state.currentKeyword}" Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ‹ Ð² TikTok. ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÐµÐ¼.`);
          await finishKeyword(state);
          return;
        }
        await sleep(1000);
      }
      if (!foundTikTok) {
        await addLog(`âš ï¸ Ð’Ð¸Ð´ÐµÐ¾ Ð¿Ð¾ ÑÐ»Ð¾Ð²Ñƒ "${state.currentKeyword}" Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ‹ Ð¿Ð¾ÑÐ»Ðµ 15 ÑÐµÐº Ð¾Ð¶Ð¸Ð´Ð°Ð½Ð¸Ñ. ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÐµÐ¼.`);
        await finishKeyword(state);
        return;
      }
      await addLog(`ÐÐ°Ñ‡Ð¸Ð½Ð°ÑŽ ÑÐ±Ð¾Ñ€ Ð²Ð¸Ð´ÐµÐ¾ Ð¿Ð¾ ÑÐ»Ð¾Ð²Ñƒ "${state.currentKeyword}"...`);
      await scrapeTikTokLoop(state);
    }
  }
}

// --- TWITTER SCRAPER ---
async function scrapeTwitterLoop(state) {
  let noNewPostsCount = 0;
  let lastPostCount = state.currentPosts.length;
  const seenUrls = collectSeenPostUrlKeys(state, 'twitter');
  
  while ((state.targetCount === -1 || state.currentPosts.length < state.targetCount) && state.active) {
    const currentRes = await chrome.storage.local.get(['scrapeState']);
    if (!currentRes.scrapeState || !currentRes.scrapeState.active) {
      await addLog(`Ð¡ÐºÑ€Ð°Ð¿Ð¸Ð½Ð³ Ð¿Ñ€ÐµÑ€Ð²Ð°Ð½.`);
      state.active = false;
      break;
    }
    state = currentRes.scrapeState;
    
    if (skipKeywordRequested || state.skipCurrentKeyword) {
      await addLog(`ÐžÑÑ‚Ð°Ð½Ð¾Ð²ÐºÐ° ÑÐ±Ð¾Ñ€Ð° Ð´Ð»Ñ ÑÑ‚Ð¾Ð³Ð¾ ÑÐ»Ð¾Ð²Ð° (Ð¿Ñ€Ð¾Ð¿ÑƒÑÐº).`);
      skipKeywordRequested = false;
      state.skipCurrentKeyword = false;
      await chrome.storage.local.set({ scrapeState: state });
      break;
    }

    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    let foundOldPost = false;
    let newPostsInThisScroll = 0;
    
    for (const article of articles) {
      if (state.targetCount !== -1 && state.currentPosts.length >= state.targetCount) break;
      
      try {
        const timeEl = article.querySelector('time');
        if (!timeEl) continue;
        
        const links = Array.from(article.querySelectorAll('a[role="link"]'));
        const timeLink = links.find(a => a.contains(timeEl));
        const postUrl = timeLink ? timeLink.href : null;
        const postUrlKey = normalizePostUrlForDedup(postUrl, 'twitter');
        
        if (!postUrlKey) continue;
        if (seenUrls.has(postUrlKey)) {
          await addLog(`Twitter: post already scraped, skipping duplicate URL: ${postUrl}`);
          continue;
        }
        
        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        const userEl = article.querySelector('[data-testid="User-Name"]');
        let authorName = "Unknown";
        let authorUrl = "Unknown";
        if (userEl) {
          const authorLinks = Array.from(userEl.querySelectorAll('a[role="link"]'));
          if (authorLinks.length > 0) {
            authorName = authorLinks[0].textContent;
            authorUrl = authorLinks[0].href;
          }
        }
        
        await addLog(`Ð§Ð¸Ñ‚Ð°ÑŽ Ð¿Ð¾ÑÑ‚ Ð¾Ñ‚ ${authorName}...`);
        await sleep(Math.floor(Math.random() * 2000) + 1500);
        
        if (isSponsoredElement(article, 'twitter')) {
          await addLog(`ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÑŽ Ñ€ÐµÐºÐ»Ð°Ð¼Ð½Ñ‹Ð¹/Ð¿Ñ€Ð¾Ð¼Ð¾-Ð¿Ð¾ÑÑ‚ Twitter Ð¾Ñ‚ ${authorName}.`);
          continue;
        }

        const dateStr = timeEl.getAttribute('datetime');
        const parsedDate = new Date(dateStr);
        const postDate = Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
        
        if (isOlderThanDateLimit(postDate, state.dateLimit)) {
          foundOldPost = true;
          const limitStr = new Date(state.dateLimit).toLocaleString();
          await addLog(`ÐÐ°Ð¹Ð´ÐµÐ½ Ð¿Ð¾ÑÑ‚ Ð¾Ñ‚ ${postDate.toLocaleString()}, Ñ‡Ñ‚Ð¾ ÑÑ‚Ð°Ñ€ÑˆÐµ Ð¾Ð³Ñ€Ð°Ð½Ð¸Ñ‡ÐµÐ½Ð¸Ñ (${limitStr}). ÐžÑÑ‚Ð°Ð½Ð¾Ð²ÐºÐ°.`);
          break;
        }
        
        const showMoreBtn = article.querySelector('[data-testid="tweet-text-show-more-link"]');
        if (showMoreBtn) {
          await addLog(`Ð Ð°ÑÐºÑ€Ñ‹Ð²Ð°ÑŽ Ð´Ð»Ð¸Ð½Ð½Ñ‹Ð¹ Ñ‚ÐµÐºÑÑ‚...`);
          showMoreBtn.click();
          await sleep(Math.floor(Math.random() * 1000) + 800);
        }
        
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText : "";
        
        const mediaUrls = [];
        const photos = article.querySelectorAll('[data-testid="tweetPhoto"] img');
        photos.forEach(img => mediaUrls.push(img.src));
        const videos = article.querySelectorAll('video');
        videos.forEach(vid => mediaUrls.push(vid.src));
        
        const pad = (n) => n.toString().padStart(2, '0');
        let javaOffsetDateTime = null;
        if (postDate) {
          const tzo = -postDate.getTimezoneOffset();
          const dif = tzo >= 0 ? '+' : '-';
          const offset = dif + pad(Math.floor(Math.abs(tzo) / 60)) + ':' + pad(Math.abs(tzo) % 60);
          javaOffsetDateTime = `${postDate.getFullYear()}-${pad(postDate.getMonth() + 1)}-${pad(postDate.getDate())}T${pad(postDate.getHours())}:${pad(postDate.getMinutes())}:${pad(postDate.getSeconds())}${offset}`;
        } else {
          javaOffsetDateTime = dateStr || null;
        }
        
        const postData = {
          source: 'twitter',
          author: authorName,
          authorUrl: authorUrl,
          date: javaOffsetDateTime,
          url: postUrl,
          text: text,
          media: mediaUrls,
          scrapedAt: new Date().toISOString()
        };
        state.currentPosts.push(postData);
        seenUrls.add(postUrlKey);
        rememberSeenPost(state, postUrl, 'twitter');
        
        if (state.sendToServer !== false) {
          chrome.runtime.sendMessage({
            action: 'sendPostToServer',
            data: {
              source: 'twitter',
              author: postData.author,
              authorUrl: postData.authorUrl,
              date: javaOffsetDateTime,
              postUrl: postData.url,
              postMedia: postData.media,
              postText: postData.text
            }
          }).then(async (response) => {
            if (response.success) {
              await addLog(`âœ… ÐŸÐ¾ÑÑ‚ Ð¾Ñ‚ ${authorName} ÑƒÑÐ¿ÐµÑˆÐ½Ð¾ Ð¾Ñ‚Ð¿Ñ€Ð°Ð²Ð»ÐµÐ½ Ð½Ð° ÑÐµÑ€Ð²ÐµÑ€.`);
            } else if (response.status) {
              await addLog(`âš ï¸ ÐžÑˆÐ¸Ð±ÐºÐ° ÑÐµÑ€Ð²ÐµÑ€Ð° Ð¿Ñ€Ð¸ Ð¾Ñ‚Ð¿Ñ€Ð°Ð²ÐºÐµ Ð¿Ð¾ÑÑ‚Ð°: ${response.status}`);
            } else {
              await addLog(`âŒ ÐžÑˆÐ¸Ð±ÐºÐ° ÑÐµÑ‚Ð¸ Ð¿Ñ€Ð¸ Ð¾Ñ‚Ð¿Ñ€Ð°Ð²ÐºÐµ Ð¿Ð¾ÑÑ‚Ð°: ${response.error}`);
            }
          }).catch(async (err) => {
            await addLog(`âŒ ÐžÑˆÐ¸Ð±ÐºÐ° ÑÐ²ÑÐ·Ð¸ Ñ Ñ€Ð°ÑÑˆÐ¸Ñ€ÐµÐ½Ð¸ÐµÐ¼: ${err.message}`);
          });
        }
        
        newPostsInThisScroll++;
        await chrome.storage.local.set({ scrapeState: state });
        
      } catch (e) {
        if (e && e.name === 'ScrapeStopError') {
          throw e;
        }
        console.error("Error parsing tweet", e);
      }
    }
    
    if (newPostsInThisScroll > 0) {
      await addLog(`Ð¡Ð¾Ð±Ñ€Ð°Ð½Ð¾ Ð¿Ð¾ÑÑ‚Ð¾Ð²: ${state.currentPosts.length}${state.targetCount !== -1 ? ' Ð¸Ð· ' + state.targetCount : ''}`);
    }
    
    if ((state.targetCount !== -1 && state.currentPosts.length >= state.targetCount) || foundOldPost) {
      break;
    }
    
    await addLog(`Ð¡ÐºÑ€Ð¾Ð»Ð»Ð¸Ð½Ð³ Ð²Ð½Ð¸Ð· Ð´Ð»Ñ Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸ Ð½Ð¾Ð²Ñ‹Ñ… Ð¿Ð¾ÑÑ‚Ð¾Ð²...`);
    if (stopRequested || skipKeywordRequested) {
      break;
    }
    window.scrollBy({ top: Math.floor(Math.random() * 800) + 600, behavior: 'smooth' });
    await sleep(Math.floor(Math.random() * 1500) + 2000);
    if (stopRequested || skipKeywordRequested) {
      break;
    }
    
    if (state.currentPosts.length === lastPostCount) {
      noNewPostsCount++;
      if (noNewPostsCount > 4) {
        await addLog(`ÐÐ¾Ð²Ñ‹Ðµ Ð¿Ð¾ÑÑ‚Ñ‹ Ð½Ðµ Ð¿Ð¾Ð´Ð³Ñ€ÑƒÐ¶Ð°ÑŽÑ‚ÑÑ. ÐŸÐµÑ€ÐµÑ…Ð¾Ð´ Ðº ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÐµÐ¼Ñƒ ÑˆÐ°Ð³Ñƒ.`);
        break;
      }
    } else {
      noNewPostsCount = 0;
      lastPostCount = state.currentPosts.length;
    }
  }
  
  await finishKeyword(state);
}

// --- FACEBOOK SCRAPER ---
function parseFacebookDateLegacy(dateStr) {
  if (!dateStr) return new Date();
  
  const trimmed = String(dateStr).trim();
  
  // 1. UNIX timestamp (10 or 13 digits)
  if (/^d{10,13}$/.test(trimmed)) {
    const val = parseInt(trimmed, 10);
    return new Date(val < 10000000000 ? val * 1000 : val);
  }

  // 2. Direct ISO or standard format
  let d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  // 3. Clean up common fluff and try again
  // Remove day of week (English and Russian)
  let cleanStr = trimmed
    .replace(/^(Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»ÑŒÐ½Ð¸Ðº|Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº|ÑÑ€ÐµÐ´Ð°|Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³|Ð¿ÑÑ‚Ð½Ð¸Ñ†Ð°|ÑÑƒÐ±Ð±Ð¾Ñ‚Ð°|Ð²Ð¾ÑÐºÑ€ÐµÑÐµÐ½ÑŒÐµ|monday|tuesday|wednesday|thursday|friday|saturday|sunday|Ð¿Ð½|Ð²Ñ‚|ÑÑ€|Ñ‡Ñ‚|Ð¿Ñ‚|ÑÐ±|Ð²Ñ|mon|tue|wed|thu|fri|sat|sun)[,s]*/i, '')
    .replace(/s+ats+|s+Ð²s+|s+Ð³.s*/gi, ' ')
    .replace(/,/g, ' ')
    .replace(/s+/g, ' ')
    .trim();
    
  d = new Date(cleanStr);
  if (!isNaN(d.getTime())) return d;
  
  // 4. Try manual parsing for "Month Day Year" or "Day Month Year" (English/Russian mixed)
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthNamesRU = ['ÑÐ½Ð²Ð°Ñ€Ñ', 'Ñ„ÐµÐ²Ñ€Ð°Ð»Ñ', 'Ð¼Ð°Ñ€Ñ‚Ð°', 'Ð°Ð¿Ñ€ÐµÐ»Ñ', 'Ð¼Ð°Ñ', 'Ð¸ÑŽÐ½Ñ', 'Ð¸ÑŽÐ»Ñ', 'Ð°Ð²Ð³ÑƒÑÑ‚Ð°', 'ÑÐµÐ½Ñ‚ÑÐ±Ñ€Ñ', 'Ð¾ÐºÑ‚ÑÐ±Ñ€Ñ', 'Ð½Ð¾ÑÐ±Ñ€Ñ', 'Ð´ÐµÐºÐ°Ð±Ñ€Ñ'];
  
  const allMonthRegex = '(january|february|march|april|may|june|july|august|september|october|november|december|ÑÐ½Ð²Ð°Ñ€Ñ|Ñ„ÐµÐ²Ñ€Ð°Ð»Ñ|Ð¼Ð°Ñ€Ñ‚Ð°|Ð°Ð¿Ñ€ÐµÐ»Ñ|Ð¼Ð°Ñ|Ð¸ÑŽÐ½Ñ|Ð¸ÑŽÐ»Ñ|Ð°Ð²Ð³ÑƒÑÑ‚Ð°|ÑÐµÐ½Ñ‚ÑÐ±Ñ€Ñ|Ð¾ÐºÑ‚ÑÐ±Ñ€Ñ|Ð½Ð¾ÑÐ±Ñ€Ñ|Ð´ÐµÐºÐ°Ð±Ñ€Ñ)';
  
  // Format: Month Day [Year] [Time]
  const mdyMatch = cleanStr.toLowerCase().match(new RegExp(allMonthRegex + '\s+(\d{1,2})([\s,]+(\d{4}))?(\s+(\d{1,2})[:.](\d{2})(\s+(am|pm))?)?', 'i'));
  // Format: Day Month [Year] [Time]
  const dmyMatch = cleanStr.toLowerCase().match(new RegExp('(\d{1,2})\s+' + allMonthRegex + '([\s,]+(\d{4}))?(\s+(\d{1,2})[:.](\d{2})(\s+(am|pm))?)?', 'i'));
  
  const mMatch = mdyMatch || dmyMatch;
  if (mMatch) {
    const isMDY = !!mdyMatch;
    const monthStr = isMDY ? mMatch[1] : mMatch[2];
    const dayStr = isMDY ? mMatch[2] : mMatch[1];
    const yearStr = isMDY ? mMatch[4] : mMatch[4]; // Indices change due to wrapping group (\s,]+(\d{4}))?
    const hourStr = isMDY ? mMatch[6] : mMatch[6];
    const minStr = isMDY ? mMatch[7] : mMatch[7];
    const ampmStr = isMDY ? mMatch[9] : mMatch[9];

    let month = monthNames.indexOf(monthStr);
    if (month === -1) month = monthNamesRU.indexOf(monthStr);
    
    if (month !== -1) {
      const day = parseInt(dayStr, 10);
      const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
      const dateObj = new Date(year, month, day);
      if (hourStr) {
         let hour = parseInt(hourStr, 10);
         const min = parseInt(minStr, 10);
         const ampm = ampmStr ? ampmStr.toLowerCase() : null;
         if (ampm === 'pm' && hour < 12) hour += 12;
         if (ampm === 'am' && hour === 12) hour = 0;
         dateObj.setHours(hour, min);
      }
      // If we assumed current year but it resulted in a future date, it was likely last year
      if (!yearStr && dateObj > new Date()) {
          dateObj.setFullYear(dateObj.getFullYear() - 1);
      }
      return dateObj;
    }
  }

  const str = trimmed.toLowerCase();
  d = new Date();

  if (/justs*now|Ñ‚Ð¾Ð»ÑŒÐºÐ¾s*Ñ‡Ñ‚Ð¾|today|ÑÐµÐ³Ð¾Ð´Ð½Ñ/i.test(str)) {
    return d;
  }
  if (/yesterday|Ð²Ñ‡ÐµÑ€Ð°/i.test(str)) {
    d.setDate(d.getDate() - 1);
    return d;
  }

  const relMatch = str.match(/(d+)s*(m|h|d|w|y|Ð¼Ð¸Ð½|Ñ‡|Ð´|Ð½ÐµÐ´|Ð³|Ð»|sec|min|hour|day|week|month|year|Ð¼ÐµÑ|cÐµÐº)/i);
  if (relMatch) {
    const val = parseInt(relMatch[1], 10);
    const unit = relMatch[2];

    if (unit.startsWith('s') || unit.startsWith('Ñ')) d.setSeconds(d.getSeconds() - val);
    else if (unit.startsWith('Ð¼ÐµÑ')) d.setMonth(d.getMonth() - val);
    else if (unit.startsWith('m') || unit.startsWith('Ð¼Ð¸Ð½')) d.setMinutes(d.getMinutes() - val);
    else if (unit.startsWith('h') || unit.startsWith('Ñ‡')) d.setHours(d.getHours() - val);
    else if (unit.startsWith('d') || unit.startsWith('Ð´')) d.setDate(d.getDate() - val);
    else if (unit.startsWith('w') || unit.startsWith('Ð½')) d.setDate(d.getDate() - val * 7);
    else if (unit.startsWith('y') || unit.startsWith('Ð³') || unit.startsWith('Ð»')) d.setFullYear(d.getFullYear() - val);
    return d;
  }

  const monthsRU = ['ÑÐ½Ð²', 'Ñ„ÐµÐ²', 'Ð¼Ð°Ñ€', 'Ð°Ð¿Ñ€', 'Ð¼Ð°Ñ', 'Ð¸ÑŽÐ½', 'Ð¸ÑŽÐ»', 'Ð°Ð²Ð³', 'ÑÐµÐ½', 'Ð¾ÐºÑ‚', 'Ð½Ð¾Ñ', 'Ð´ÐµÐº'];
  const monthsRUFull = ['ÑÐ½Ð²Ð°Ñ€Ñ', 'Ñ„ÐµÐ²Ñ€Ð°Ð»Ñ', 'Ð¼Ð°Ñ€Ñ‚Ð°', 'Ð°Ð¿Ñ€ÐµÐ»Ñ', 'Ð¼Ð°Ñ', 'Ð¸ÑŽÐ½Ñ', 'Ð¸ÑŽÐ»Ñ', 'Ð°Ð²Ð³ÑƒÑÑ‚Ð°', 'ÑÐµÐ½Ñ‚ÑÐ±Ñ€Ñ', 'Ð¾ÐºÑ‚ÑÐ±Ñ€Ñ', 'Ð½Ð¾ÑÐ±Ñ€Ñ', 'Ð´ÐµÐºÐ°Ð±Ñ€Ñ'];
  const monthsEN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  let monthIndex = -1;
  monthsRUFull.forEach((m, i) => { if (str.includes(m)) monthIndex = i; });
  if (monthIndex === -1) monthsRU.forEach((m, i) => { if (str.includes(m)) monthIndex = i; });
  if (monthIndex === -1) monthsEN.forEach((m, i) => { if (str.includes(m)) monthIndex = i; });

  if (monthIndex !== -1) {
    const dayMatch = str.match(/(d{1,2})/);
    if (dayMatch) {
      d.setMonth(monthIndex);
      d.setDate(parseInt(dayMatch[1], 10));
      const yearMatch = str.match(/(20d{2})/);
      if (yearMatch) d.setFullYear(parseInt(yearMatch[1], 10));
      else if (d > new Date()) d.setFullYear(d.getFullYear() - 1);
      
      const timeMatch = str.match(/(d{1,2}):(d{2})/);
      if (timeMatch) {
          d.setHours(parseInt(timeMatch[1], 10));
          d.setMinutes(parseInt(timeMatch[2], 10));
      }
      return d;
    }
  }

  // Final attempt: manual conversion of Russian months and cleaning for Date()
  let finalStr = cleanStr;
  monthsRUFull.forEach((m, i) => {
    if (finalStr.toLowerCase().includes(m)) {
      finalStr = finalStr.toLowerCase().replace(m, ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][i]);
    }
  });
  d = new Date(finalStr);
  if (!isNaN(d.getTime())) return d;
  
  return new Date();
}

function formatDateToOffsetString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const pad = (n) => n.toString().padStart(2, '0');
  const tzo = -date.getTimezoneOffset();
  const dif = tzo >= 0 ? '+' : '-';
  const offset = dif + pad(Math.floor(Math.abs(tzo) / 60)) + ':' + pad(Math.abs(tzo) % 60);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`;
}

function parseFacebookDate(dateStr) {
  if (!dateStr) return null;

  const original = String(dateStr).replace(/\u00a0/g, ' ').trim();
  if (!original) return null;

  const normalized = original
    .replace(/\bwensday\b/gi, 'Wednesday')
    .replace(/[\u200e\u200f,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = normalized.toLowerCase();
  const now = new Date();

  const unixMatch = normalized.match(/^\d{10,13}$/);
  if (unixMatch) {
    const value = parseInt(normalized, 10);
    return new Date(value < 10000000000 ? value * 1000 : value);
  }

  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) return direct;

  const cleanedEnglish = normalized
    .replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*/i, '')
    .replace(/\bat\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const directCleaned = new Date(cleanedEnglish);
  if (!Number.isNaN(directCleaned.getTime())) return directCleaned;

  if (/(just\s*now|today|\u0441\u0435\u0433\u043e\u0434\u043d\u044f|\u0441\u0435\u0439\u0447\u0430\u0441|\u0442\u043e\u043b\u044c\u043a\u043e\s*\u0447\u0442\u043e)/i.test(lower)) {
    return new Date(now);
  }
  if (/(yesterday|\u0432\u0447\u0435\u0440\u0430)/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  const relative = lower.replace(/\./g, '').match(/(\d+)\s*([a-z\u00c0-\u024f\u0400-\u04ff]+)/i);
  if (relative) {
    const amount = parseInt(relative[1], 10);
    const unit = relative[2];
    const d = new Date(now);

    if (/^(s|sec|secs|second|seconds|\u0441\u0435\u043a\w*|\u0441\u0435\u043a\u0443\u043d\u0434\w*)$/i.test(unit)) d.setSeconds(d.getSeconds() - amount);
    else if (/^(m|min|mins|minute|minutes|\u043c\u0438\u043d\w*|d\u0259q\w*|deq\w*)$/i.test(unit)) d.setMinutes(d.getMinutes() - amount);
    else if (/^(h|hr|hrs|hour|hours|\u0447\w*|saat\w*)$/i.test(unit)) d.setHours(d.getHours() - amount);
    else if (/^(d|day|days|\u0434\w*|g\u00fcn\w*|gun\w*)$/i.test(unit)) d.setDate(d.getDate() - amount);
    else if (/^(w|wk|wks|week|weeks|\u043d\u0435\u0434\w*|h\u0259ft\u0259\w*|hefte\w*)$/i.test(unit)) d.setDate(d.getDate() - amount * 7);
    else if (/^(mo|mon|month|months|\u043c\u0435\u0441\w*|ay)$/i.test(unit)) d.setMonth(d.getMonth() - amount);
    else if (/^(y|yr|yrs|year|years|\u0433\w*|\u043b\w*|il)$/i.test(unit)) d.setFullYear(d.getFullYear() - amount);
    else return null;

    return d;
  }

  const numeric = cleanedEnglish.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?:\s+(\d{1,2})[:.](\d{2})(?:\s*(am|pm))?)?\b/i);
  if (numeric) {
    const first = parseInt(numeric[1], 10);
    const second = parseInt(numeric[2], 10);
    const yearRaw = numeric[3];
    const hourRaw = numeric[4];
    const minuteRaw = numeric[5];
    const ampmRaw = (numeric[6] || '').toLowerCase();
    const year = yearRaw ? (yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10)) : now.getFullYear();
    const dayFirst = first > 12;
    const month = dayFirst ? second - 1 : first - 1;
    const day = dayFirst ? first : second;
    const d = new Date(year, month, day);

    if (hourRaw && minuteRaw) {
      let hour = parseInt(hourRaw, 10);
      if (ampmRaw === 'pm' && hour < 12) hour += 12;
      if (ampmRaw === 'am' && hour === 12) hour = 0;
      d.setHours(hour, parseInt(minuteRaw, 10), 0, 0);
    }

    if (!yearRaw && d > now) d.setFullYear(d.getFullYear() - 1);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

async function scrapeFacebookLoop(state) {
  let noNewPostsCount = 0;
  let lastPostCount = state.currentPosts.length;
  const seenSignatures = new Set(state.currentPosts.map(p => p.url));
  const seenUrls = collectSeenPostUrlKeys(state, 'facebook');
  
  while ((state.targetCount === -1 || state.currentPosts.length < state.targetCount) && state.active) {
    const currentRes = await chrome.storage.local.get(['scrapeState']);
    if (!currentRes.scrapeState || !currentRes.scrapeState.active) {
      await addLog('Facebook: scraping stopped.');
      state.active = false;
      break;
    }
    state = currentRes.scrapeState;
    
    if (skipKeywordRequested || state.skipCurrentKeyword) {
      await addLog('Facebook: current keyword was skipped.');
      skipKeywordRequested = false;
      state.skipCurrentKeyword = false;
      await chrome.storage.local.set({ scrapeState: state });
      break;
    }

    let articles = Array.from(document.querySelectorAll('[role="article"], [data-pagelet*="FeedUnit"]'))
      .filter(isVisibleElement);
    if (articles.length === 0) {
      const timeLinks = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], a[href*="/photos/"], a[href*="/videos/"], h2 a[href], h3 a[href], h4 a[href], strong a[href]'));
      const uniqueParents = new Set(articles);
      for (const link of timeLinks) {
        let parent = link.parentElement;
        let found = null;
        for (let depth = 0; depth < 15; depth++) {
          if (!parent) break;
          const rect = parent.getBoundingClientRect();
          if (rect.height > 100 && rect.height < 3000 && parent.querySelector('[data-ad-comet-preview="message"], [data-testid="post_message"], div[dir="auto"]')) {
            found = parent;
            break;
          }
          if (rect.height > 3500) break;
          parent = parent.parentElement;
        }
        if (found) uniqueParents.add(found);
      }
      articles = Array.from(uniqueParents);
    }
    await addLog(`Facebook: loaded article containers: ${articles.length}.`);
    
    let foundOldPost = false;
    let newPostsInThisScroll = 0;
    
    for (const article of articles) {
      if (state.targetCount !== -1 && state.currentPosts.length >= state.targetCount) break;
      
      try {
        let postUrl = null;
        for (const anchor of article.querySelectorAll('a[href]')) {
          const canonicalUrl = normalizeFacebookPostUrl(anchor.href || anchor.getAttribute('href'));
          if (canonicalUrl) {
            postUrl = canonicalUrl;
            break;
          }
        }
        
        const textContent = getFacebookMessageText(article);
        const postUrlKey = normalizePostUrlForDedup(postUrl, 'facebook');
        if (postUrlKey && seenUrls.has(postUrlKey)) {
          await addLog(`Facebook: post already scraped; skipping duplicate URL: ${postUrl}`);
          continue;
        }
        
        const signature = postUrl || textContent.substring(0, 100);
        if (!signature || seenSignatures.has(signature)) continue;

        article.scrollIntoView({ behavior: 'smooth', block: 'center' });

        let authorName = "Unknown";
        let authorUrl = "Unknown";
        for (const sel of ['h2 a[href]', 'h3 a[href]', 'h4 a[href]', 'strong a[href]', 'a[role="link"][href]']) {
          const el = article.querySelector(sel);
          if (el && el.innerText?.trim().length > 0) {
            authorName = el.innerText.trim();
            authorUrl = el.href;
            break;
          }
        }
        await addLog(`Facebook: reading post from ${authorName}.`);
        await sleep(Math.floor(Math.random() * 2000) + 1500);

        if (isSponsoredElement(article, 'facebook')) {
          await addLog(`Facebook: sponsored post skipped: ${postUrl || 'URL unavailable'}.`);
          continue;
        }

        const expanded = await expandFacebookPostText(article);
        await addLog(`Facebook: full text expansion ${expanded ? 'completed' : 'not needed or button not found'}.`);
        
        // Date extraction
        let rawDate = await extractFacebookRawDate(article);
        if (!rawDate) {
           const possibleTime = article.querySelector('span[id^="jsc_"]');
           if (possibleTime && /\d+\s*[hmd]/i.test(possibleTime.innerText)) {
             rawDate = possibleTime.innerText;
           }
        }
        
        await addLog(`Facebook: raw publication date: ${rawDate || 'not found'}.`);
        const postDate = parseFacebookDate(rawDate);
        if (!postDate) {
          await addLog('Facebook: publication date could not be resolved; post skipped to avoid date: null.');
          continue;
        } else {
          await addLog(`Facebook: normalized publication date: ${formatDateToOffsetString(postDate)}.`);
        }
        
        // Final sanity check: if the date is EXACTLY NOW, and we have many posts, 
        // it likely means we failed to parse. We'll add 1ms jitter to avoid "all same" problem
        // but only as a last resort diagnostic. 
        // To be real: if we return current time, let's log it.
        if (postDate && Math.abs(postDate.getTime() - Date.now()) < 1000 && !/justs*now|Ñ‚Ð¾Ð»ÑŒÐºÐ¾s*Ñ‡Ñ‚Ð¾|ÑÐµÐ³Ð¾Ð´Ð½Ñ|today/i.test(rawDate)) {
           // await addLog(`âš ï¸ ÐŸÑ€ÐµÐ´ÑƒÐ¿Ñ€ÐµÐ¶Ð´ÐµÐ½Ð¸Ðµ: Ð”Ð°Ñ‚Ð° Ð¿Ð¾ÑÑ‚Ð° Ð½Ðµ Ð¾Ð¿Ñ€ÐµÐ´ÐµÐ»ÐµÐ½Ð° Ñ‚Ð¾Ñ‡Ð½Ð¾, Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐµÑ‚ÑÑ Ñ‚ÐµÐºÑƒÑ‰ÐµÐµ Ð²Ñ€ÐµÐ¼Ñ.`);
        }
        
        if (isOlderThanDateLimit(postDate, state.dateLimit)) {
          foundOldPost = true;
          const limitStr = new Date(state.dateLimit).toLocaleString();
          await addLog(`Facebook: post date ${postDate.toLocaleString()} is older than limit ${limitStr}.`);
          await addLog('Facebook: finishing the current keyword immediately.');
          break;
        }

        await addLog(`Facebook: collecting post from ${authorName}.`);

        // Text
        let text = getFacebookMessageText(article);
        
        // Media
        const mediaUrls = [];
        const fbDomains = ['facebook.com', 'fb.com', 'fb.me', 'l.facebook.com', 'instagram.com'];
        Array.from(article.querySelectorAll('a[href]')).forEach(a => {
          try {
            const url = new URL(a.href);
            if (url.protocol.startsWith('http') && !fbDomains.some(d => url.hostname.includes(d))) {
              mediaUrls.push(url.href);
            }
          } catch(e) {}
        });
        Array.from(article.querySelectorAll('img')).forEach(img => {
          if (img.src && img.src.includes('scontent')) mediaUrls.push(img.src);
        });
        seenSignatures.add(signature);
        
        const javaOffsetDateTime = formatDateToOffsetString(postDate);
        
        const postData = {
          source: 'facebook',
          author: authorName,
          authorUrl: authorUrl,
          date: javaOffsetDateTime,
          url: postUrl || null,
          text: text,
          media: Array.from(new Set(mediaUrls)),
          scrapedAt: new Date().toISOString()
        };
        state.currentPosts.push(postData);
        if (postUrlKey) seenUrls.add(postUrlKey);
        rememberSeenPost(state, postUrl, 'facebook');
        
        if (state.sendToServer !== false) {
          chrome.runtime.sendMessage({
            action: 'sendPostToServer',
            data: {
              source: 'facebook',
              author: postData.author,
              authorUrl: postData.authorUrl,
              date: javaOffsetDateTime,
              postUrl: postData.url,
              postMedia: postData.media,
              postText: postData.text
            }
          }).then(async (response) => {
            if (response.success) {
              await addLog(`Facebook: post from ${authorName} was sent to the server.`);
            } else if (response.status) {
              await addLog(`Facebook: server rejected the post with status ${response.status}.`);
            } else {
              await addLog(`Facebook: network error while sending the post: ${response.error}.`);
            }
          }).catch(async (err) => {
            await addLog(`Facebook: extension communication error: ${err.message}.`);
          });
        }
        
        newPostsInThisScroll++;
        await chrome.storage.local.set({ scrapeState: state });
        
      } catch (e) {
        if (e && e.name === 'ScrapeStopError') {
          throw e;
        }
        console.error("Error parsing facebook post", e);
      }
    }
    
    if (newPostsInThisScroll > 0) {
      await addLog(`Facebook: collected posts: ${state.currentPosts.length}${state.targetCount !== -1 ? '/' + state.targetCount : ''}.`);
    }
    
    if ((state.targetCount !== -1 && state.currentPosts.length >= state.targetCount) || foundOldPost) {
      break;
    }
    
    await addLog('Facebook: scrolling down to load more posts.');
    if (stopRequested || skipKeywordRequested) {
      break;
    }
    window.scrollBy({ top: Math.floor(Math.random() * 800) + 600, behavior: 'smooth' });
    await sleep(Math.floor(Math.random() * 1500) + 2000);
    if (stopRequested || skipKeywordRequested) {
      break;
    }
    
    if (state.currentPosts.length === lastPostCount) {
      noNewPostsCount++;
      if (noNewPostsCount > 4) {
        await addLog('Facebook: no new posts appeared after repeated scrolling; finishing the current keyword.');
        break;
      }
    } else {
      noNewPostsCount = 0;
      lastPostCount = state.currentPosts.length;
    }
  }
  
  await finishKeyword(state);
}

// --- INSTAGRAM SCRAPER ---
async function scrapeInstagramLoop(state) {
  let noNewPostsCount = 0;
  let lastPostCount = state.currentPosts.length;
  const seenUrls = collectSeenPostUrlKeys(state, 'instagram');
  
  await sleep(3000);
  
  const postLinks1 = Array.from(document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]'));
  const firstPost = postLinks1.find(a => !seenUrls.has(normalizePostUrlForDedup(a.href, 'instagram')));
  if (firstPost) {
    firstPost.click();
    await sleep(3000);
  } else {
     await addLog(`ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÐºÐ»Ð¸ÐºÐ½ÑƒÑ‚ÑŒ Ð½Ð° Ð¿Ð¾ÑÑ‚ (Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½ Ð¸Ð»Ð¸ Ð²ÑÐµ ÑÐ¾Ð±Ñ€Ð°Ð½Ñ‹).`);
  }
  
  while ((state.targetCount === -1 || state.currentPosts.length < state.targetCount) && state.active) {
    const currentRes = await chrome.storage.local.get(['scrapeState']);
    if (!currentRes.scrapeState || !currentRes.scrapeState.active) {
      await addLog(`Ð¡ÐºÑ€Ð°Ð¿Ð¸Ð½Ð³ Ð¿Ñ€ÐµÑ€Ð²Ð°Ð½.`);
      state.active = false;
      break;
    }
    state = currentRes.scrapeState;
    
    if (skipKeywordRequested || state.skipCurrentKeyword) {
      await addLog(`ÐžÑÑ‚Ð°Ð½Ð¾Ð²ÐºÐ° ÑÐ±Ð¾Ñ€Ð° Ð´Ð»Ñ ÑÑ‚Ð¾Ð³Ð¾ ÑÐ»Ð¾Ð²Ð° (Ð¿Ñ€Ð¾Ð¿ÑƒÑÐº).`);
      skipKeywordRequested = false;
      state.skipCurrentKeyword = false;
      await chrome.storage.local.set({ scrapeState: state });
      break;
    }
    
    let container = document.querySelector('div[role="dialog"]');
    if (!container && (window.location.href.includes('/p/') || window.location.href.includes('/reel/'))) {
        container = document.querySelector('article') || document.body;
    }
    
    if (!container) {
       await addLog(`ÐŸÐ¾ÑÑ‚ Ð½Ðµ Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚. ÐÐ°Ð¶Ð¸Ð¼Ð°ÐµÐ¼ Ð½Ð° Ð¿Ð¾ÑÑ‚...`);
       const postLinks2 = Array.from(document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]'));
       const post = postLinks2.find(a => !seenUrls.has(normalizePostUrlForDedup(a.href, 'instagram')));
       if (post) post.click();
       await sleep(3000);
       
       container = document.querySelector('div[role="dialog"]') || (window.location.href.includes('/p/') || window.location.href.includes('/reel/') ? (document.querySelector('article') || document.body) : null);
       if (!container) {
           await addLog(`ÐÐµÐ²Ð¾Ð·Ð¼Ð¾Ð¶Ð½Ð¾ Ð½Ð°Ð¹Ñ‚Ð¸ ÐºÐ¾Ð½Ñ‚ÐµÐ½Ñ‚ Ð¿Ð¾ÑÑ‚Ð°. Ð—Ð°Ð²ÐµÑ€ÑˆÐµÐ½Ð¸Ðµ ÑÐ±Ð¾Ñ€Ð° Ð´Ð»Ñ ÑÐ»Ð¾Ð²Ð°.`);
           break;
       }
    }
    
    const postUrl = window.location.href;
    const postUrlKey = normalizePostUrlForDedup(postUrl, 'instagram');
    if (postUrlKey && seenUrls.has(postUrlKey)) {
      await addLog(`Instagram: post already scraped, skipping duplicate URL: ${postUrl}`);
    }
    
    if (postUrlKey && !seenUrls.has(postUrlKey) && (postUrl.includes('/p/') || postUrl.includes('/reel/'))) {
       if (isSponsoredElement(container, 'instagram')) {
         await addLog(`ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÑŽ Ñ€ÐµÐºÐ»Ð°Ð¼Ð½Ñ‹Ð¹/Ð¿Ñ€Ð¾Ð¼Ð¾-Ð¿Ð¾ÑÑ‚ Instagram: ${postUrl}`);
         seenUrls.add(postUrlKey);
         continue;
       }
       const authorEl = container.querySelector('header a[href^="/"]') || container.querySelector('a[href^="/"][role="link"]');
       const authorTextEl = container.querySelector('header a[href^="/"] span') ||
         container.querySelector('header h2 span') ||
         container.querySelector('header span[dir="auto"]') ||
         container.querySelector('a[href^="/"][role="link"] span');
       let author = "Unknown";
       let authorUrl = "";
       if (authorEl) {
         author = (authorTextEl?.innerText || authorTextEl?.textContent || authorEl.innerText || authorEl.textContent || '').trim();
         authorUrl = authorEl.href;
       }
       if ((!author || author === 'Unknown') && authorUrl) {
         try {
           const authorPath = new URL(authorUrl).pathname.split('/').filter(Boolean)[0] || '';
           if (authorPath && !['p', 'reel', 'explore'].includes(authorPath.toLowerCase())) {
             author = authorPath;
           }
         } catch (error) {}
       }
       
        const timeEl = container.querySelector('time');
        let postDate = null;
        let javaOffsetDateTime = null;
        
        if (timeEl) {
          const dateStr = timeEl.getAttribute('datetime');
          const parsedDate = new Date(dateStr);
          postDate = Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
          if (isOlderThanDateLimit(postDate, state.dateLimit)) {
             const limitStr = new Date(state.dateLimit).toLocaleString();
             await addLog(`ÐÐ°Ð¹Ð´ÐµÐ½ Ð¿Ð¾ÑÑ‚ Ð¾Ñ‚ ${postDate.toLocaleString()}, Ñ‡Ñ‚Ð¾ ÑÑ‚Ð°Ñ€ÑˆÐµ Ð¾Ð³Ñ€Ð°Ð½Ð¸Ñ‡ÐµÐ½Ð¸Ñ (${limitStr}). ÐžÑÑ‚Ð°Ð½Ð¾Ð²ÐºÐ°.`);
             break;
          }
          javaOffsetDateTime = dateStr || null;
        } else {
          javaOffsetDateTime = null;
        }
       
       const textContainer = container.querySelector('div[role="button"][tabindex="0"]')?.closest('ul')?.querySelector('span[dir="auto"]') || container.querySelector('h1[dir="auto"]')?.closest('span')?.querySelector('span[dir="auto"]');
       const h1Text = container.querySelector('h1[dir="auto"], span h1[dir="auto"]');
       let text = "";
       if (h1Text) {
         text = h1Text.innerText || h1Text.textContent || "";
       } else if (textContainer) {
         text = textContainer.innerText || textContainer.textContent || "";
       }
       
       const mediaSet = new Set();
       let carouselLoops = 0;
       
       while (carouselLoops < 10) {
           const imgs = container.querySelectorAll('img');
           imgs.forEach(i => {
               // Skip profile pictures and small icons
               if (i.src && !i.alt.includes('profile picture') && !i.src.includes('150x150')) {
                   if ((i.width > 100 || !i.width) && !i.src.startsWith('data:image')) {
                       mediaSet.add(i.src);
                   }
               }
           });
           
           const videos = container.querySelectorAll('video');
           videos.forEach(v => {
               if (v.src && !v.src.startsWith('blob:') && !v.src.startsWith('data:')) {
                   mediaSet.add(v.src);
               } else if (v.poster && !v.poster.startsWith('data:')) {
                   mediaSet.add(v.poster);
               } else {
                  // Try to find source elements inside video, or sibling elements
                  const srcEl = v.querySelector('source');
                  if (srcEl && srcEl.src && !srcEl.src.startsWith('blob:') && !srcEl.src.startsWith('data:')) mediaSet.add(srcEl.src);
               }
           });
           
           // Look for carousel Next button (inside the article)
           let cNext = null;
           const articleElement = container.tagName === 'ARTICLE' ? container : container.querySelector('article');
           if (articleElement) {
               const buttons = Array.from(articleElement.querySelectorAll('button[aria-label="Next"], button[aria-label="Ð”Ð°Ð»ÐµÐµ"], button[aria-label="Right chevron"]'));
               cNext = buttons.find(btn => btn.offsetParent !== null && window.getComputedStyle(btn).display !== 'none');
           }
           
           if (cNext) {
               cNext.click();
               await new Promise(r => setTimeout(r, 1000)); // manual sleep
               carouselLoops++;
           } else {
               break;
           }
       }
       
       const media = Array.from(mediaSet);
       
       const postData = {
          source: 'instagram',
          url: postUrl,
          author: author,
          authorUrl: authorUrl,
          date: javaOffsetDateTime,
          media: media,
          text: text,
          scrapedAt: new Date().toISOString()
       };
       state.currentPosts.push(postData);
       seenUrls.add(postUrlKey);
       rememberSeenPost(state, postUrl, 'instagram');
       
       if (state.sendToServer !== false) {
           chrome.runtime.sendMessage({
            action: 'sendPostToServer',
            data: {
              source: 'instagram',
              author: postData.author,
              authorUrl: postData.authorUrl,
              date: javaOffsetDateTime,
              postUrl: postData.url,
              postMedia: postData.media,
              postText: postData.text
            }
          }).then(async (response) => {
            if (response.success) {
              await addLog(`âœ… ÐŸÐ¾ÑÑ‚ Ð¾Ñ‚ ${author} ÑƒÑÐ¿ÐµÑˆÐ½Ð¾ Ð¾Ñ‚Ð¿Ñ€Ð°Ð²Ð»ÐµÐ½ Ð½Ð° ÑÐµÑ€Ð²ÐµÑ€.`);
            } else if (response.status) {
              await addLog(`âš ï¸ ÐžÑˆÐ¸Ð±ÐºÐ° ÑÐµÑ€Ð²ÐµÑ€Ð°: ${response.status}`);
            } else {
              await addLog(`âŒ ÐžÑˆÐ¸Ð±ÐºÐ° ÑÐµÑ‚Ð¸: ${response.error}`);
            }
          }).catch(async (err) => {
            await addLog(`âŒ ÐžÑˆÐ¸Ð±ÐºÐ° ÑÐ²ÑÐ·Ð¸ Ñ Ñ€Ð°ÑÑˆÐ¸Ñ€ÐµÐ½Ð¸ÐµÐ¼: ${err.message}`);
          });
       } else {
           await addLog(`Ð¡Ð¾Ð±Ñ€Ð°Ð½ Ð¿Ð¾ÑÑ‚: ${postUrl}`);
       }
       await chrome.storage.local.set({ scrapeState: state });
    }
    
    if (state.targetCount !== -1 && state.currentPosts.length >= state.targetCount) {
      await addLog(`Ð”Ð¾ÑÑ‚Ð¸Ð³Ð½ÑƒÑ‚Ð¾ Ð¾Ð³Ñ€Ð°Ð½Ð¸Ñ‡ÐµÐ½Ð¸Ðµ Ð² ${state.targetCount} Ð¿Ð¾ÑÑ‚Ð¾Ð² Ð´Ð»Ñ ÑÐ»Ð¾Ð²Ð°.`);
      break;
    }
    
    const svgNext = document.querySelector('svg[aria-label="Next"], svg[aria-label="Ð”Ð°Ð»ÐµÐµ"]');
    let clicked = false;
    
    if (svgNext) {
       const btn = svgNext.closest('button, [role="button"]');
       if (btn) {
         btn.click();
         clicked = true;
       }
    }
    
    if (!clicked) {
        if (!document.querySelector('div[role="dialog"]') && (window.location.href.includes('/p/') || window.location.href.includes('/reel/'))) {
            window.history.back();
            clicked = true;
        } else {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }));
        }
    }
    
    await sleep(2000);
    
    if (seenUrls.has(normalizePostUrlForDedup(window.location.href, 'instagram'))) {
       noNewPostsCount++;
       if (noNewPostsCount > 3) {
          await addLog(`ÐÐµÑ‚ Ð½Ð¾Ð²Ñ‹Ñ… Ð¿Ð¾ÑÑ‚Ð¾Ð². Ð‘Ð¾Ð»ÑŒÑˆÐµ Ð»Ð¸ÑÑ‚Ð°Ñ‚ÑŒ Ð½ÐµÐºÑƒÐ´Ð°.`);
          break;
       }
    } else {
       noNewPostsCount = 0;
    }
  }
  
  if (state.active) {
    if (window.location.href.includes('/p/')) {
        const closeBtn = document.querySelector('svg[aria-label="Close"], svg[aria-label="Ð—Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ"]')?.closest('button') || document.querySelector('svg[aria-label="Close"], svg[aria-label="Ð—Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ"]')?.closest('[role="button"]');
        if (closeBtn) closeBtn.click();
        else window.history.back();
    }
    await finishKeyword(state);
  }
}

// --- TIKTOK SCRAPER ---
function parseTikTokDate(dateStr) {
  if (!dateStr) return null;
  const original = String(dateStr).replace(/\u00a0/g, ' ').trim();
  if (!original) return null;

  const direct = new Date(original);
  if (!Number.isNaN(direct.getTime())) return direct;

  dateStr = original
    .replace(/[\u200e\u200f,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const now = new Date();

  const unixMatch = dateStr.match(/^\d{10,13}$/);
  if (unixMatch) {
    const value = parseInt(unixMatch[0], 10);
    return new Date(value < 10000000000 ? value * 1000 : value);
  }

  const relativeMatch = dateStr.replace(/\./g, '').match(/(\d+)\s*([a-z\u0400-\u04ff]+)/iu);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    if (/^(s|sec|secs|second|seconds|\u0441\u0435\u043a|\u0441\u0435\u043a\u0443\u043d\u0434)/i.test(unit)) {
      return new Date(now.getTime() - amount * 1000);
    }
    if (/^(m|min|mins|minute|minutes|\u043c\u0438\u043d)/i.test(unit)) {
      return new Date(now.getTime() - amount * 60 * 1000);
    }
    if (/^(h|hr|hrs|hour|hours|\u0447|\u0447\u0430\u0441)/i.test(unit)) {
      return new Date(now.getTime() - amount * 60 * 60 * 1000);
    }
    if (/^(d|day|days|\u0434|\u0434\u0435\u043d\u044c|\u0434\u043d\u044f|\u0434\u043d\u0435\u0439)/i.test(unit)) {
      return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
    }
    if (/^(w|wk|wks|week|weeks|\u043d\u0435\u0434)/i.test(unit)) {
      return new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
    }
    if (/^(mo|mon|month|months|\u043c\u0435\u0441)/i.test(unit)) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - amount);
      return d;
    }
    if (/^(y|yr|yrs|year|years|\u0433|\u043b\u0435\u0442)/i.test(unit)) {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - amount);
      return d;
    }
  }

  const isYmd = dateStr.match(/^([0-9]{4})[-.]([0-9]{1,2})[-.]([0-9]{1,2})$/);
  if (isYmd) {
    return new Date(parseInt(isYmd[1]), parseInt(isYmd[2]) - 1, parseInt(isYmd[3]));
  }
  
  const isMd = dateStr.match(/^([0-9]{1,2})[-.]([0-9]{1,2})$/);
  if (isMd) {
    return new Date(now.getFullYear(), parseInt(isMd[1]) - 1, parseInt(isMd[2]));
  }
  
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }
  return null;
}

async function scrapeTikTokLoop(state) {
  let noNewPostsCount = 0;
  const seenUrls = collectSeenPostUrlKeys(state, 'tiktok');
  
  await sleep(3000);
  
  // ÐšÐ»Ð¸ÐºÐ°ÐµÐ¼ Ð½Ð° Ð¿ÐµÑ€Ð²Ð¾Ðµ Ð²Ð¸Ð´ÐµÐ¾, ÐµÑÐ»Ð¸ Ð¼Ñ‹ ÐµÑ‰Ðµ Ð½Ðµ Ð½Ð°Ñ…Ð¾Ð´Ð¸Ð¼ÑÑ Ð¿Ñ€ÑÐ¼Ð¾ Ð½Ð° ÑÑ‚Ñ€Ð°Ð½Ð¸Ñ†Ðµ Ð²Ð¸Ð´ÐµÐ¾
  if (!window.location.href.includes('/video/')) {
    const videoLink = document.querySelector('a[href*="/video/"]');
    if (videoLink) {
      await addLog(`ÐšÐ»Ð¸ÐºÐ°ÑŽ Ð½Ð° Ð¿ÐµÑ€Ð²Ð¾Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð½Ð¾Ðµ Ð²Ð¸Ð´ÐµÐ¾ TikTok...`);
      videoLink.click();
      await sleep(4000);
    } else {
      await addLog(`âš ï¸ ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð½Ð°Ð¹Ñ‚Ð¸ ÑÑÑ‹Ð»ÐºÑƒ Ð½Ð° Ð¿ÐµÑ€Ð²Ð¾Ðµ Ð²Ð¸Ð´ÐµÐ¾ Ð² Ñ€ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚Ð°Ñ….`);
    }
  }
  
  while ((state.targetCount === -1 || state.currentPosts.length < state.targetCount) && state.active) {
    const currentRes = await chrome.storage.local.get(['scrapeState']);
    if (!currentRes.scrapeState || !currentRes.scrapeState.active) {
      await addLog(`Ð¡ÐºÑ€Ð°Ð¿Ð¸Ð½Ð³ Ð¿Ñ€ÐµÑ€Ð²Ð°Ð½.`);
      state.active = false;
      break;
    }
    state = currentRes.scrapeState;
    
    if (skipKeywordRequested || state.skipCurrentKeyword) {
      await addLog(`ÐžÑÑ‚Ð°Ð½Ð¾Ð²ÐºÐ° ÑÐ±Ð¾Ñ€Ð° Ð´Ð»Ñ ÑÑ‚Ð¾Ð³Ð¾ ÑÐ»Ð¾Ð²Ð° (Ð¿Ñ€Ð¾Ð¿ÑƒÑÐº).`);
      skipKeywordRequested = false;
      state.skipCurrentKeyword = false;
      await chrome.storage.local.set({ scrapeState: state });
      break;
    }

    const postUrl = window.location.href;
    const postUrlKey = normalizePostUrlForDedup(postUrl, 'tiktok');
    if (postUrlKey && seenUrls.has(postUrlKey)) {
      await addLog(`TikTok: post already scraped, skipping duplicate URL: ${postUrl}`);
    }
    
    // ÐŸÐ°Ñ€ÑÐ¸Ð¼ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ ÐµÑÐ»Ð¸ ÑÑ‚Ð¾ Ð´ÐµÐ¹ÑÑ‚Ð²Ð¸Ñ‚ÐµÐ»ÑŒÐ½Ð¾ ÑÑ‚Ñ€Ð°Ð½Ð¸Ñ†Ð° Ð²Ð¸Ð´ÐµÐ¾ Ð¸ Ð¼Ñ‹ ÐµÐ³Ð¾ ÐµÑ‰Ðµ Ð½Ðµ Ð¿Ð°Ñ€ÑÐ¸Ð»Ð¸
    if (postUrlKey && !seenUrls.has(postUrlKey) && postUrl.includes('/video/')) {
      try {
        const activeContainer = getActiveTikTokPostContainer(postUrl);

        if (isSponsoredElement(activeContainer, 'tiktok')) {
          await addLog(`ÐŸÑ€Ð¾Ð¿ÑƒÑÐºÐ°ÑŽ Ñ€ÐµÐºÐ»Ð°Ð¼Ð½Ñ‹Ð¹/Ð¿Ñ€Ð¾Ð¼Ð¾-Ð²Ð¸Ð´ÐµÐ¾ TikTok: ${postUrl}`);
          seenUrls.add(postUrlKey);
          continue;
        }

        const authorInfo = extractTikTokAuthorInfo(activeContainer);
        let authorName = authorInfo.authorName;
        let authorUrl = authorInfo.authorUrl;

        
        await addLog(`Ð§Ð¸Ñ‚Ð°ÑŽ Ð²Ð¸Ð´ÐµÐ¾ TikTok Ð¾Ñ‚ ${authorName}...`);
        
        const descEl = activeContainer.querySelector('[data-e2e="browse-video-desc"]') || 
                       activeContainer.querySelector('[data-e2e="video-desc"]') || 
                       activeContainer.querySelector('[class*="DivVideoDesc"]') || 
                       activeContainer.querySelector('[class*="Caption"]') ||
                       activeContainer.querySelector('h1[class*="H1VideoDesc"]') ||
                       document.querySelector('[data-e2e="browse-video-desc"]');
        let text = descEl ? descEl.textContent?.trim() : "";
        
        const dateInfo = extractTikTokDateInfo(postUrl, activeContainer);
        const rawDateStr = dateInfo.raw;
        const postDate = dateInfo.parsedDate;
        await addLog(`TikTok: raw date (${dateInfo.source || 'unknown source'}): ${rawDateStr || 'not found'}`);
        if (!postDate) {
          seenUrls.add(postUrlKey);
          await addLog('TikTok: publication date was not resolved; skipping this video so JSONL never receives date: null.');
        } else {
          await addLog(`TikTok: timestamp resolved as ${formatDateToOffsetString(postDate)}`);
          
          if (isOlderThanDateLimit(postDate, state.dateLimit)) {
            const limitStr = new Date(state.dateLimit).toLocaleString();
            await addLog(`ÐÐ°Ð¹Ð´ÐµÐ½ Ð¿Ð¾ÑÑ‚ Ð¾Ñ‚ ${postDate.toLocaleString()}, Ñ‡Ñ‚Ð¾ ÑÑ‚Ð°Ñ€ÑˆÐµ Ð¾Ð³Ñ€Ð°Ð½Ð¸Ñ‡ÐµÐ½Ð¸Ñ (${limitStr}). ÐžÑÑ‚Ð°Ð½Ð¾Ð²ÐºÐ°.`);
            await addLog('TikTok: date limit reached; finishing this keyword immediately.');
            break;
          }
        
        const mediaUrls = [];
        const videoPoster = activeContainer.querySelector('video')?.getAttribute('poster');
        if (videoPoster) {
          mediaUrls.push(videoPoster);
        } else {
          const imgs = activeContainer.querySelectorAll('img');
          imgs.forEach(i => {
            if (i.src && !i.src.includes('profile') && !i.src.startsWith('data:image')) {
              mediaUrls.push(i.src);
            }
          });
        }
        
        const javaOffsetDateTime = formatDateToOffsetString(postDate);
        
        const postData = {
          source: 'tiktok',
          author: authorName,
          authorUrl: authorUrl,
          date: javaOffsetDateTime,
          url: postUrl,
          text: text,
          media: mediaUrls,
          scrapedAt: new Date().toISOString()
        };
        state.currentPosts.push(postData);
        seenUrls.add(postUrlKey);
        rememberSeenPost(state, postUrl, 'tiktok');
        
        if (state.sendToServer !== false) {
          chrome.runtime.sendMessage({
            action: 'sendPostToServer',
            data: {
              source: 'tiktok',
              author: postData.author,
              authorUrl: postData.authorUrl,
              date: javaOffsetDateTime,
              postUrl: postData.url,
              postMedia: postData.media,
              postText: postData.text
            
            }
          }).then((response) => {
            // sent
          }).catch(err => {});
        }
        
        await chrome.storage.local.set({ scrapeState: state });
        await addLog(`Ð¡Ð¾Ð±Ñ€Ð°Ð½Ð¾ Ð²Ð¸Ð´ÐµÐ¾: ${postUrl} (${state.currentPosts.length}${state.targetCount !== -1 ? '/' + state.targetCount : ''})`);
        }
        
      } catch (err) {
        if (err && err.name === 'ScrapeStopError') {
          throw err;
        }
        await addLog(`ÐžÑˆÐ¸Ð±ÐºÐ° Ð¿Ñ€Ð¸ Ð¿Ð°Ñ€ÑÐ¸Ð½Ð³Ðµ Ð²Ð¸Ð´ÐµÐ¾: ${err.message}`);
      }
    }
    
    if (state.targetCount !== -1 && state.currentPosts.length >= state.targetCount) {
      await addLog(`Ð”Ð¾ÑÑ‚Ð¸Ð³Ð½ÑƒÑ‚Ð¾ Ñ†ÐµÐ»ÐµÐ²Ð¾Ðµ ÐºÐ¾Ð»Ð¸Ñ‡ÐµÑÑ‚Ð²Ð¾ Ð¿Ð¾ÑÑ‚Ð¾Ð² Ð´Ð»Ñ ÑÑ‚Ð¾Ð³Ð¾ ÑÐ»Ð¾Ð²Ð°.`);
      break;
    }
    
    // ÐŸÐµÑ€ÐµÑ…Ð¾Ð´ Ðº ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÐµÐ¼Ñƒ Ð²Ð¸Ð´ÐµÐ¾
    const nextBtn = document.querySelector('[data-e2e="arrow-down"], button[aria-label="Next video"], button[aria-label="Ð¡Ð»ÐµÐ´ÑƒÑŽÑ‰ÐµÐµ Ð²Ð¸Ð´ÐµÐ¾"], [class*="ButtonPlayBackControlDown"], [class*="arrowDown"], [class*="ArrowDown"]');
    if (nextBtn) {
      nextBtn.click();
    } else {
      const keyEvent = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(keyEvent);
      document.documentElement.dispatchEvent(keyEvent);
      window.dispatchEvent(keyEvent);
    }
    
    await sleep(2500);
    if (stopRequested || skipKeywordRequested) {
      break;
    }
    
    if (seenUrls.has(normalizePostUrlForDedup(window.location.href, 'tiktok'))) {
      noNewPostsCount++;
      await addLog(`ÐžÐ¶Ð¸Ð´Ð°Ð½Ð¸Ðµ Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸ ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÐµÐ³Ð¾ Ð²Ð¸Ð´ÐµÐ¾... (${noNewPostsCount}/7)`);
      if (noNewPostsCount >= 7) {
        await addLog(`ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð¿ÐµÑ€ÐµÐ¹Ñ‚Ð¸ Ð½Ð° ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÐµÐµ Ð²Ð¸Ð´ÐµÐ¾ (Ð·Ð°Ð²Ð¸ÑÐ»Ð¾ Ð¸Ð»Ð¸ ÐºÐ¾Ð½ÐµÑ† Ð»ÐµÐ½Ñ‚Ñ‹).`);
        break;
      }
    } else {
      noNewPostsCount = 0;
    }
  }
  
  await finishKeyword(state);
}

async function finishKeyword(state) {
  if (state.active) {
    state.allResults.push({
      keyword: state.currentKeyword,
      posts: state.currentPosts,
      timestamp: new Date().toISOString()
    });
  }
  
  if (state.active && (state.queue.length > 0 || state.infiniteLoop)) {
    if (state.queue.length === 0) {
      state.queue = [...state.originalKeywords];
      await addLog('Keyword list completed; starting the next infinite-loop cycle.');
    }
    state.currentKeyword = state.queue.shift();
    state.currentPosts = [];
    state.step = 'INITIAL_CHECK';
    await addLog(`Moving to the next keyword: ${state.currentKeyword}`);
    await chrome.storage.local.set({ scrapeState: state });
    
    runStateMachine();
  } else if (state.active) {
    state.active = false;
    await addLog('Scraping completed.');
    await chrome.storage.local.set({ scrapeState: state });
    if (state.saveToPC !== false) {
      await addLog('Saving the JSONL file.');
      await downloadResults(state.allResults, state.platform || 'unknown');
    }
  }
}

async function downloadResults(allResults, platform = 'unknown') {
  const output = buildJsonlContent(allResults, platform);
  await downloadJsonlContent(output, platform);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(runStateMachine, 2000));
} else {
  setTimeout(runStateMachine, 2000);
}


