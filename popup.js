(function initializePopup(app) {
  'use strict';

  const azTexts = {
    socialNetwork: 'Sosial şəbəkə',
    source: 'Mənbə',
    selectSource: 'Mənbə seçin',
    keywords: 'Açar sözlər, hər yeni sətir yeni açar sözdür',
    maxPosts: 'Hər söz üçün post sayını məhdudlaşdır',
    infiniteLoop: 'Limitsiz toplama',
    dateLimit: 'Göstərilən tarixdən köhnə postları toplama',
    sendToServer: 'Postları serverə göndər',
    saveToPC: 'Nəticələri JSONL faylında saxla',
    auth: 'Giriş məlumatları yalnız cari brauzer sessiyasında istifadə olunur',
    username: 'Login və ya email',
    password: 'Şifrə',
    ready: 'Başlamağa hazırdır',
    start: 'Başlat',
    stop: 'Dayandır',
    skip: 'Cari sözü keç',
    logs: 'Loqlar',
    stopped: 'Dayandırılıb',
    completed: 'Tamamlandı',
    running: 'İcra olunur',
    languageWarning: '⚠️ Bu sayt Azərbaycan dilini dəstəkləmir. Açar sözləri rus dilində daxil edin.'
  };

  const translations = {
    ru: azTexts,
    az: azTexts
  };

  const elements = Object.fromEntries([
    'langSelect', 'platform', 'languageWarning', 'keywords', 'limitCountToggle', 'count', 'infiniteLoopToggle', 'dateLimitToggle', 'dateLimit',
    'datePicker', 'sendToServerToggle', 'saveToPCToggle', 'authFields', 'authUsername', 'authPassword', 'error', 'status', 'start', 'stop', 'skip', 'logs'
  ].map((id) => [id, document.getElementById(id)]));
  const SOCIAL_SOURCES = new Set(['twitter', 'instagram', 'facebook', 'tiktok']);
  const NEWS_SOURCES = new Set(['oxu.az', 'media.az', '1news.az', 'haqqin.az', 'caliber.az', 'qafqazinfo.az', 'lent.az', 'baku.ws']);
  const RUSSIAN_ONLY_NEWS_SOURCES = ['media.az', 'haqqin.az', 'caliber.az'];
  const SOURCE_TYPE_LABELS = { none: 'seçilməyib', social: 'sosial', news: 'xəbər', unknown: 'naməlum' };
  let language = localStorage.getItem('scraperLanguage') || 'az';
  let currentState = null;
  let selectedSource = null;
  const popupLogs = [];

  function applyTranslations() {
    elements.langSelect.value = language;
    const dictionary = translations[language];
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const value = dictionary[element.dataset.i18n];
      if (value) element.textContent = value;
    });
  }

  function showError(message = '') {
    elements.error.textContent = message;
    elements.error.style.display = message ? 'block' : 'none';
  }

  function popupLogEntry(message, level = 'info') {
    return {
      timestamp: new Date().toISOString(),
      platform: 'popup',
      level,
      message: String(message || '').replace(/^\[popup\]\s*/, ''),
      details: ''
    };
  }

  function debugPopup(message, level = 'info') {
    console[level === 'warn' ? 'warn' : 'log'](message);
    popupLogs.push(popupLogEntry(message, level));
    if (!currentState?.active) renderLogs(popupLogs);
  }

  function sourceType(source) {
    if (!source) return 'none';
    if (SOCIAL_SOURCES.has(source)) return 'social';
    if (NEWS_SOURCES.has(source)) return 'news';
    return 'unknown';
  }

  function updateSourceUi(reason = 'init') {
    selectedSource = elements.platform.value || null;
    const type = sourceType(selectedSource);
    const showLogin = type === 'social';
    const shouldShowWarning = RUSSIAN_ONLY_NEWS_SOURCES.includes(selectedSource);
    elements.authFields.hidden = !showLogin;
    elements.languageWarning.style.display = shouldShowWarning ? 'block' : 'none';
    if (!showLogin) showError();
    if (reason === 'change') {
      debugPopup(`[popup] Mənbə dəyişdi: ${selectedSource || 'seçilməyib'}`);
      debugPopup(`[popup] Mənbə tipi: ${SOURCE_TYPE_LABELS[type] || type}`);
      debugPopup(showLogin ? '[popup] Giriş bölməsi göstərildi' : '[popup] Giriş bölməsi gizlədildi');
      debugPopup(shouldShowWarning ? '[popup] Dil xəbərdarlığı göstərildi' : '[popup] Dil xəbərdarlığı gizlədildi');
    }
    return { source: selectedSource, type };
  }

  function renderLogs(logs = []) {
    const fragment = document.createDocumentFragment();
    for (const entry of logs) {
      const row = document.createElement('div');
      const timestamp = new Date(entry.timestamp || Date.now()).toLocaleTimeString();
      const level = entry.level || 'info';
      row.className = `log-${level}`;
      row.textContent = `[${timestamp}] [${entry.platform || 'scraper'}] ${entry.message || String(entry)}${entry.details ? `: ${entry.details}` : ''}`;
      fragment.appendChild(row);
    }
    elements.logs.replaceChildren(fragment);
    elements.logs.scrollTop = elements.logs.scrollHeight;
  }

  function render(state) {
    currentState = state || null;
    const active = !!state?.active;
    elements.start.hidden = active;
    elements.stop.hidden = !active;
    elements.skip.hidden = !active;
    elements.start.disabled = false;
    elements.stop.disabled = false;
    elements.skip.disabled = false;
    if (!state) elements.status.textContent = translations[language].ready;
    else if (active) elements.status.textContent = `${translations[language].running}: ${state.currentKeyword} (${state.stats?.currentKeyword || 0}${state.targetCount === -1 ? '' : `/${state.targetCount}`})`;
    else if (state.phase === 'completed' || state.phase === 'completed_with_errors') elements.status.textContent = `${translations[language].completed}: ${state.stats?.total || 0}`;
    else elements.status.textContent = `${translations[language].stopped}: ${state.phase || ''}`;
    renderLogs(state?.logs || popupLogs);
  }

  function validateForm() {
    const source = elements.platform.value || '';
    const type = sourceType(source);
    if (!source) throw new Error('Toplama mənbəyini seçin');
    if (type === 'unknown') throw new Error(`Dəstəklənməyən mənbə: ${source}`);
    const keywords = elements.keywords.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!keywords.length) throw new Error('Ən azı bir açar söz daxil edin.');
    let targetCount = -1;
    if (elements.limitCountToggle.checked) {
      targetCount = Number(elements.count.value);
      if (!Number.isInteger(targetCount) || targetCount < 1) throw new Error('Post sayı sıfırdan böyük tam ədəd olmalıdır.');
    }
    if (elements.dateLimitToggle.checked && !elements.dateLimit.value.trim()) {
      throw new Error('Tarixi seçin və ya DD/MM/YYYY formatında daxil edin.');
    }
    const parsedDate = elements.dateLimitToggle.checked ? app.utils.parseUserDate(elements.dateLimit.value) : { value: null, error: null };
    if (parsedDate.error) throw new Error(parsedDate.error);
    debugPopup(`[popup] Başlatma yoxlaması keçdi: ${SOURCE_TYPE_LABELS[type] || type}`);
    return { source, sourceType: type, keywords, targetCount, dateLimit: parsedDate.value };
  }

  function platformTarget(platform) {
    if (platform === 'facebook') return { domain: 'facebook.com', url: 'https://www.facebook.com/' };
    if (platform === 'instagram') return { domain: 'instagram.com', url: 'https://www.instagram.com/' };
    if (platform === 'tiktok') return { domain: 'tiktok.com', url: 'https://www.tiktok.com/' };
    if (platform === 'oxu.az') return { domain: 'oxu.az', url: 'https://oxu.az/' };
    if (platform === 'media.az') return { domain: 'media.az', url: 'https://media.az/' };
    if (platform === '1news.az') return { domain: '1news.az', url: 'https://1news.az/az' };
    if (platform === 'haqqin.az') return { domain: 'haqqin.az', url: 'https://haqqin.az/' };
    if (platform === 'caliber.az') return { domain: 'caliber.az', url: 'https://caliber.az/' };
    if (platform === 'qafqazinfo.az') return { domain: 'qafqazinfo.az', url: 'https://qafqazinfo.az/' };
    if (platform === 'lent.az') return { domain: 'lent.az', url: 'https://lent.az/' };
    if (platform === 'baku.ws') return { domain: 'baku.ws', url: 'https://baku.ws/' };
    return { domain: 'x.com', url: 'https://x.com/explore' };
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs[0]?.id) throw new Error('Aktiv tab tapılmadı.');
    return tabs[0];
  }

  elements.start.addEventListener('click', async () => {
    showError();
    elements.start.disabled = true;
    try {
      const form = validateForm();
      const tab = await activeTab();
      const platform = form.source;
      const runId = crypto.randomUUID();
      const state = {
        version: app.VERSION,
        runId,
        ownerTabId: tab.id,
        active: true,
        phase: 'starting',
        requestedAction: null,
        platform,
        keywords: form.keywords,
        keywordIndex: 0,
        currentKeyword: form.keywords[0],
        targetCount: form.targetCount,
        dateLimit: form.dateLimit,
        infiniteLoop: elements.infiniteLoopToggle.checked,
        sendToServer: elements.sendToServerToggle.checked,
        saveToPC: elements.saveToPCToggle.checked,
        stats: { currentKeyword: 0, total: 0, duplicates: 0, errors: 0 },
        logs: [
          popupLogEntry(`[popup] Başlatma yoxlaması keçdi: ${SOURCE_TYPE_LABELS[form.sourceType] || form.sourceType}`),
          { timestamp: new Date().toISOString(), platform, level: 'info', message: `Toplama yaradıldı. İlk açar söz: ${form.keywords[0]}`, details: '' }
        ],
        createdAt: new Date().toISOString()
      };
      const secrets = form.sourceType === 'social' ? {
        [platform]: { username: elements.authUsername.value.trim(), password: elements.authPassword.value }
      } : {};
      await app.storage.initialize(state, secrets);
      render(state);

      const target = platformTarget(platform);
      let currentHost = '';
      try { currentHost = new URL(tab.url).hostname; } catch (error) {}
      if (!currentHost.endsWith(target.domain)) {
        await chrome.tabs.update(tab.id, { url: target.url });
      } else {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'scraper:start', runId, credentials: secrets });
          if (!response?.success) throw new Error('Content script Start əmrini təsdiqləmədi');
        } catch (error) {
          await chrome.tabs.reload(tab.id);
        }
      }
    } catch (error) {
      showError(error.message);
      elements.start.disabled = false;
    }
  });

  elements.stop.addEventListener('click', async () => {
    if (!currentState?.runId) return;
    elements.stop.disabled = true;
    elements.skip.disabled = true;
    showError();
    try {
      await app.storage.requestControl(currentState.runId, 'stop');
    } catch (error) {
      showError(error.message);
      elements.stop.disabled = false;
    }
  });

  elements.skip.addEventListener('click', async () => {
    if (!currentState?.runId) return;
    elements.skip.disabled = true;
    showError();
    try {
      await app.storage.requestControl(currentState.runId, 'skip');
      setTimeout(() => { elements.skip.disabled = false; }, 800);
    } catch (error) {
      showError(error.message);
      elements.skip.disabled = false;
    }
  });

  elements.platform.addEventListener('change', () => updateSourceUi('change'));
  elements.limitCountToggle.addEventListener('change', () => { elements.count.disabled = !elements.limitCountToggle.checked; });
  elements.dateLimitToggle.addEventListener('change', () => {
    const disabled = !elements.dateLimitToggle.checked;
    elements.dateLimit.disabled = disabled;
    elements.datePicker.disabled = disabled;
    if (!disabled) elements.dateLimit.focus();
  });
  elements.dateLimit.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!/^\d$/.test(event.key) && !allowed.includes(event.key)) event.preventDefault();
  });
  elements.dateLimit.addEventListener('input', () => {
    const masked = app.utils.formatDateMask(elements.dateLimit.value);
    elements.dateLimit.value = masked;
    const parsed = app.utils.parseUserDate(masked);
    if (parsed.value) elements.datePicker.value = parsed.value;
  });
  elements.datePicker.addEventListener('change', () => {
    elements.dateLimit.value = app.utils.displayDateFromIso(elements.datePicker.value);
    showError();
  });
  elements.langSelect.addEventListener('change', () => {
    language = elements.langSelect.value;
    localStorage.setItem('scraperLanguage', language);
    applyTranslations();
    render(currentState);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[app.constants.STATE_KEY]) render(changes[app.constants.STATE_KEY].newValue);
  });

  elements.platform.value = '';
  selectedSource = null;
  elements.sendToServerToggle.checked = false;
  applyTranslations();
  debugPopup('[popup] Serverə göndərmə varsayılan olaraq bağlıdır');
  updateSourceUi();
  app.storage.getState().then(render).catch((error) => showError(error.message));
})(globalThis.ScraperApp);
