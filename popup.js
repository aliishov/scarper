
const i18n = {
  ru: {
    title: "Multi platform scarper",
    socialNetwork: "Социальная сеть:",
    keywords: "Ключевые слова (каждое с новой строки):",
    keywordsPlaceholder: "Например:\nmercedes\nbmw",
    maxPosts: "Макс. постов на слово:",
    infiniteLoop: "Бесконечный сбор (зациклить)",
    timeLimit: "Ограничение по времени (собирать до)",
    sendToServer: "Отправлять посты на сервер",
    saveToPC: "Сохранять результаты в файл (на ПК)",
    statusReady: "Готов к запуску",
    startScraping: "Начать сбор",
    stop: "Остановить",
    skipKeyword: "Пропустить текущее слово",
    logs: "Логи:",
    alertKeywords: "Пожалуйста, введите хотя бы одно ключевое слово.",
    statusInProgress: "В процессе",
    statusStopped: "Остановлено / Ожидание",
    startAgain: "Начать заново"
  },
  az: {
    title: "Çoxplatformalı skreper",
    socialNetwork: "Sosial şəbəkə:",
    keywords: "Açar sözlər (hər biri yeni sətirdə):",
    keywordsPlaceholder: "Məsələn:\nmercedes\nbmw",
    maxPosts: "Hər söz üçün maksimum post:",
    infiniteLoop: "Sonsuz toplama (dövrə sal)",
    timeLimit: "Zaman məhdudiyyəti (qədər topla)",
    sendToServer: "Postları serverə göndər",
    saveToPC: "Nəticələri fayla yadda saxla (Kompüterə)",
    statusReady: "Başlamağa hazırdır",
    startScraping: "Toplamağa başla",
    stop: "Dayandır",
    skipKeyword: "Cari sözü atla",
    logs: "Loqlar:",
    alertKeywords: "Zəhmət olmasa, ən azı bir açar söz daxil edin.",
    statusInProgress: "Prosesdə",
    statusStopped: "Dayandırılıb / Gözləyir",
    startAgain: "Yenidən başla"
  }
};

let currentLang = localStorage.getItem('scraper_lang') || 'ru';

function applyTranslations() {
  document.getElementById('langSelect').value = currentLang;
  const dict = i18n[currentLang];
  document.querySelectorAll('[data-translate]').forEach(el => {
    const key = el.getAttribute('data-translate');
    if (dict[key]) {
      el.innerText = dict[key];
    }
  });
  document.getElementById('keywords').placeholder = dict.keywordsPlaceholder;
}

function parseDateValue(value) {
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

function isReliableFacebookPostUrl(rawUrl) {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return /\/posts\/[^/]+/i.test(url.pathname)
      || /\/permalink\//i.test(url.pathname)
      || /\/groups\/[^/]+\/(posts|permalink)\/[^/]+/i.test(url.pathname)
      || /\/(photos|videos|reel)\/[^/]+/i.test(url.pathname)
      || /\/watch\//i.test(url.pathname)
      || url.searchParams.has('story_fbid')
      || url.searchParams.has('fbid');
  } catch (error) {
    return false;
  }
}

function buildPostUrlKey(rawUrl, platform = '') {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    const source = String(platform || '').toLowerCase();
    if (source === 'twitter') {
      const match = url.pathname.match(/\/status\/(\d+)/i);
      return match ? `twitter:status:${match[1]}` : '';
    }
    if (source === 'instagram') {
      const match = url.pathname.match(/\/(p|reel)\/([^/?#]+)/i);
      return match ? `instagram:${match[1].toLowerCase()}:${match[2]}` : '';
    }
    if (source === 'tiktok') {
      const match = url.pathname.match(/\/video\/(\d+)/i);
      return match ? `tiktok:video:${match[1]}` : '';
    }
    if (source === 'facebook') {
      if (!isReliableFacebookPostUrl(url.toString())) return '';
      const storyId = url.searchParams.get('story_fbid') || url.searchParams.get('fbid');
      const ownerId = url.searchParams.get('id') || '';
      if (storyId) return `facebook:post:${storyId}:${ownerId}`;
      return `facebook:${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch (error) {
    return '';
  }
}

function buildJsonlContent(allResults, fallbackPlatform = 'unknown') {
  let output = '';
  const emitted = new Set();
  for (const result of allResults || []) {
    const sortedPosts = sortPostsByDateDesc(result.posts || []);
    for (const post of sortedPosts) {
      const source = post.source || fallbackPlatform;
      if ((source === 'facebook' || source === 'tiktok') && !parseDateValue(post.date)) continue;
      const reliableUrl = source === 'facebook' && !isReliableFacebookPostUrl(post.url) ? '' : post.url;
      const urlKey = buildPostUrlKey(post.url, source);
      const uniqueKey = urlKey || post.id || `${result.keyword}:${source}:${post.author}:${post.date}:${post.text}`;
      if (uniqueKey && emitted.has(uniqueKey)) continue;
      if (uniqueKey) emitted.add(uniqueKey);
      const line = {
        keyword: result.keyword,
        scrapedAt: post.scrapedAt || result.timestamp,
        source,
        ...post
      };
      if (source === 'facebook' && !reliableUrl) line.url = null;
      output += JSON.stringify(line) + '\n';
    }
  }
  return output;
}

function buildResultFilename(platform = 'unknown', now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${now.getFullYear()}`;
  const safePlatform = String(platform || 'unknown').trim().toLowerCase() || 'unknown';
  return `${safePlatform}_result_${datePart}.jsonl`;
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

function signalActiveTab(action) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        resolve(false);
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action }, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  });
}

function downloadJsonlFile(content, filename) {
  return new Promise((resolve) => {
    const blob = new Blob([content || ''], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      const error = chrome.runtime.lastError?.message || null;
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      if (!error) {
        resolve({ success: true, downloadId });
        return;
      }

      console.warn(error);
      chrome.runtime.sendMessage({
        action: 'downloadJsonl',
        filename,
        content: content || ''
      }, (response) => {
        resolve(response || { success: false, error });
      });
    });
  });
}

function renderLogs(logsEl, logs) {
  logsEl.textContent = '';
  const fragment = document.createDocumentFragment();
  for (const log of logs || []) {
    const row = document.createElement('div');
    row.className = 'log-entry';
    const renderedLog = repairMojibakeText(log);
    const parts = String(renderedLog).split('] ');
    if (parts.length > 1) {
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = `${parts[0]}]`;
      row.appendChild(time);
      row.appendChild(document.createTextNode(` ${parts.slice(1).join('] ')}`));
    } else {
      row.textContent = String(renderedLog);
    }
    fragment.appendChild(row);
  }
  logsEl.appendChild(fragment);
  logsEl.scrollTop = logsEl.scrollHeight;
}

document.getElementById('langSelect').addEventListener('change', (e) => {
  currentLang = e.target.value;
  localStorage.setItem('scraper_lang', currentLang);
  applyTranslations();
  chrome.storage.local.get(['scrapeState'], (res) => {
    updateUI(res.scrapeState);
  });
});

document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();

  const platformSelect = document.getElementById('platform');
  const igAuthFields = document.getElementById('igAuthFields');
  const fbAuthFields = document.getElementById('fbAuthFields');
  const twAuthFields = document.getElementById('twAuthFields');

  function updateAuthFieldsVisibility() {
      const platform = platformSelect.value;
      igAuthFields.style.display = platform === 'instagram' ? 'block' : 'none';
      fbAuthFields.style.display = platform === 'facebook' ? 'block' : 'none';
      twAuthFields.style.display = platform === 'twitter' ? 'block' : 'none';
  }

  if (platformSelect) {
      platformSelect.addEventListener('change', updateAuthFieldsVisibility);
      updateAuthFieldsVisibility();
  }
});

function updateUI(state) {
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const skipBtn = document.getElementById('skip');
  const statusEl = document.getElementById('status');
  const logsEl = document.getElementById('logs');
  
  if (state && state.active) {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    skipBtn.style.display = 'block';
    statusEl.innerText = `${i18n[currentLang].statusInProgress}: ${state.currentKeyword} (${state.currentPosts?.length || 0}${state.targetCount !== -1 ? '/' + state.targetCount : ''})`;
  } else {
    startBtn.style.display = 'block';
    startBtn.innerText = state && state.allResults?.length > 0 ? i18n[currentLang].startAgain : i18n[currentLang].startScraping;
    stopBtn.style.display = 'none';
    skipBtn.style.display = 'none';
    statusEl.innerText = i18n[currentLang].statusStopped;
  }
  
  if (state && state.logs) {
    renderLogs(logsEl, state.logs);
  }
}

  document.getElementById('limitCountToggle').addEventListener('change', (e) => {
    document.getElementById('count').disabled = !e.target.checked;
  });

  document.getElementById('dateLimitToggle').addEventListener('change', (e) => {
    document.getElementById('dateLimit').disabled = !e.target.checked;
  });

  document.getElementById('start').addEventListener('click', () => {
    const keywordsRaw = document.getElementById('keywords').value;
    const limitCountEnabled = document.getElementById('limitCountToggle').checked;
    const parsedCount = parseInt(document.getElementById('count').value, 10);
    const count = limitCountEnabled ? (Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1) : -1;
    const dateLimitEnabled = document.getElementById('dateLimitToggle').checked;
    const dateLimitVal = document.getElementById('dateLimit').value; // YYYY-MM-DDTHH:mm
    const parsedDateLimit = (dateLimitEnabled && dateLimitVal) ? new Date(dateLimitVal).getTime() : null;
    const dateLimit = Number.isFinite(parsedDateLimit) ? parsedDateLimit : null;
    const platform = document.getElementById('platform').value;
    const infiniteLoop = document.getElementById('infiniteLoopToggle').checked;
    const sendToServer = document.getElementById('sendToServerToggle').checked;
    const saveToPC = document.getElementById('saveToPCToggle').checked;
    const igUsername = document.getElementById('igUsername')?.value.trim() || '';
    const igPassword = document.getElementById('igPassword')?.value.trim() || '';
    const fbUsername = document.getElementById('fbUsername')?.value.trim() || '';
    const fbPassword = document.getElementById('fbPassword')?.value.trim() || '';
    const twUsername = document.getElementById('twUsername')?.value.trim() || '';
    const twPassword = document.getElementById('twPassword')?.value.trim() || '';
  
  const keywords = keywordsRaw.split('\n').map(k => k.trim()).filter(k => k.length > 0);
  
  if (keywords.length === 0) {
    alert(i18n[currentLang].alertKeywords);
    return;
  }
  
  const initialState = {
    active: true,
    platform: platform,
    queue: keywords.slice(1),
    originalKeywords: keywords,
    currentKeyword: keywords[0],
    targetCount: count,
    dateLimit: dateLimit,
    infiniteLoop: infiniteLoop,
    sendToServer: sendToServer,
    saveToPC: saveToPC,
    igUsername: igUsername,
    igPassword: igPassword,
    fbUsername: fbUsername,
    fbPassword: fbPassword,
    twUsername: twUsername,
    twPassword: twPassword,
    currentPosts: [],
    allResults: [],
    seenPostUrls: [],
    step: 'INITIAL_CHECK',
    logs: [`[${new Date().toLocaleTimeString()}] Starting scraper (${platform}). First keyword: ${keywords[0]}`]
  };
  
  chrome.storage.local.set({ scrapeState: initialState }, () => {
    // Navigate to explore to ensure a clean search state
    signalActiveTab('resetScraperControl').catch(() => {});
    chrome.tabs.query({active: true, lastFocusedWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      
      let targetUrl = 'https://x.com/explore';
      let domainName = 'x.com';
      if (platform === 'facebook') {
        targetUrl = 'https://www.facebook.com/';
        domainName = 'facebook.com';
      } else if (platform === 'instagram') {
        targetUrl = 'https://www.instagram.com/';
        domainName = 'instagram.com';
      } else if (platform === 'tiktok') {
        targetUrl = 'https://www.tiktok.com/';
        domainName = 'tiktok.com';
      }
      
      if (currentTab && currentTab.url && currentTab.url.includes(domainName)) {
        chrome.tabs.update(currentTab.id, { url: targetUrl });
      } else if (currentTab) {
        chrome.tabs.update(currentTab.id, { url: targetUrl });
      } else {
        chrome.tabs.create({ url: targetUrl });
      }
    });
  });
});

document.getElementById('stop').addEventListener('click', () => {
  chrome.storage.local.get(['scrapeState'], (res) => {
    if (res.scrapeState) {
      const state = res.scrapeState;
      state.active = false;
      state.logs.push(`[${new Date().toLocaleTimeString()}] Scraping stopped by user.`);
      
      if (state.currentPosts && state.currentPosts.length > 0) {
        state.allResults.push({
          keyword: state.currentKeyword,
          posts: state.currentPosts,
          timestamp: new Date().toISOString()
        });
        state.currentPosts = [];
      }
      
      chrome.storage.local.set({ scrapeState: state }, () => {
        signalActiveTab('stopScraping').catch(() => {});
        if (state.saveToPC !== false) {
          const output = buildJsonlContent(state.allResults, state.platform || 'unknown');
          const filename = buildResultFilename(state.platform || 'unknown');
          downloadJsonlFile(output, filename).catch((error) => console.error(error));
        }
      });
    }
  });
});

document.getElementById('skip').addEventListener('click', () => {
  chrome.storage.local.get(['scrapeState'], (res) => {
    if (res.scrapeState) {
      const state = res.scrapeState;
      if (state.active) {
        state.skipCurrentKeyword = true;
        state.logs.push(`[${new Date().toLocaleTimeString()}] Skipping keyword: ${state.currentKeyword}`);
        chrome.storage.local.set({ scrapeState: state }, () => {
          signalActiveTab('skipCurrentKeyword').catch(() => {});
        });
      }
    }
  });
});

// Initial load
chrome.storage.local.get(['scrapeState'], (res) => {
  updateUI(res.scrapeState);
});

// Listen for updates from content script
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.scrapeState) {
    updateUI(changes.scrapeState.newValue);
  }
});

