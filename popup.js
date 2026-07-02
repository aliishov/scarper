(function initializePopup(app) {
  'use strict';

  const translations = {
    ru: {
      socialNetwork: 'Социальная сеть', source: 'Источник', selectSource: 'Выберите источник', scrapingMode: 'Режим scraping',
      modeSingle: 'Режим одиночного скрапинга', modeMixedSocial: 'Режим множественного скрапинга соцсетей', modeMixedNews: 'Режим множественного скрапинга новостных каналов', modeFull: 'Режим полного скрапинга',
      keywords: 'Ключевые слова, каждое с новой строки', maxPosts: 'Ограничить количество постов на слово',
      infiniteLoop: 'Бесконечный сбор', dateLimit: 'Не собирать посты старше даты', sendToServer: 'Отправлять посты на сервер',
      saveToPC: 'Сохранять результаты в JSONL на ПК', auth: 'Данные входа используются только в текущей сессии браузера',
      multiAuth: 'Данные входа для соцсетей используются только в текущей сессии браузера',
      username: 'Логин или email', password: 'Пароль', ready: 'Готов к запуску', start: 'Начать сбор', stop: 'Остановить',
      skip: 'Следующее слово', logs: 'Логи', stopped: 'Остановлено', completed: 'Завершено', running: 'Выполняется'
    },
    az: {
      socialNetwork: 'Sosial şəbəkə', source: 'Mənbə', selectSource: 'Mənbə seçin', scrapingMode: 'Scraping rejimi',
      modeSingle: 'Tək scraping rejimi', modeMixedSocial: 'Sosial şəbəkələrin çoxlu scraping rejimi', modeMixedNews: 'Xəbər kanallarının çoxlu scraping rejimi', modeFull: 'Tam scraping rejimi',
      keywords: 'Açar sözlər, hər biri yeni sətirdə', maxPosts: 'Hər söz üçün post sayını məhdudlaşdır',
      infiniteLoop: 'Sonsuz toplama', dateLimit: 'Bu tarixdən köhnə postları toplama', sendToServer: 'Postları serverə göndər',
      saveToPC: 'Nəticələri JSONL kimi kompüterə yaz', auth: 'Giriş məlumatları yalnız cari brauzer sessiyasında istifadə olunur',
      multiAuth: 'Sosial şəbəkə giriş məlumatları yalnız cari brauzer sessiyasında istifadə olunur',
      username: 'Login və ya email', password: 'Şifrə', ready: 'Başlamağa hazırdır', start: 'Toplamağa başla', stop: 'Dayandır',
      skip: 'Növbəti söz', logs: 'Loqlar', stopped: 'Dayandırılıb', completed: 'Tamamlandı', running: 'İcra olunur'
    }
  };

  const elements = Object.fromEntries([
    'langSelect', 'scrapingMode', 'singleSourceFields', 'platform', 'keywords', 'limitCountToggle', 'count', 'infiniteLoopToggle', 'dateLimitToggle', 'dateLimit',
    'datePicker', 'sendToServerToggle', 'saveToPCToggle', 'authFields', 'multiAuthFields', 'authUsername', 'authPassword', 'error', 'status', 'start', 'stop', 'skip', 'logs'
  ].map((id) => [id, document.getElementById(id)]));
  const SOCIAL_SOURCES = new Set(app.utils.SOCIAL_SOURCES);
  const NEWS_SOURCES = new Set(app.utils.NEWS_SOURCES);
  let language = localStorage.getItem('scraperLanguage') || 'ru';
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

  function updateSourceUi(reason = 'init') {
    const mode = elements.scrapingMode.value || app.utils.SCRAPING_MODES.single;
    selectedSource = elements.platform.value || null;
    const type = app.utils.sourceType(selectedSource);
    const multi = app.utils.isMultiMode(mode);
    const showSingleSource = mode === app.utils.SCRAPING_MODES.single;
    const showSingleLogin = showSingleSource && type === 'social';
    const showMultiLogin = mode === app.utils.SCRAPING_MODES.mixedSocial || mode === app.utils.SCRAPING_MODES.full;
    elements.singleSourceFields.hidden = !showSingleSource;
    elements.authFields.hidden = !showSingleLogin;
    elements.multiAuthFields.hidden = !showMultiLogin;
    if (!showSingleLogin && !showMultiLogin) showError();
    if (reason === 'change') {
      debugPopup(`[popup] Scraping mode changed: ${mode}`);
      debugPopup(`[popup] Source changed: ${selectedSource || 'none'}`);
      debugPopup(`[popup] Source type: ${multi ? 'multi' : type}`);
      debugPopup(showSingleLogin || showMultiLogin ? '[popup] Login section shown' : '[popup] Login section hidden');
    }
    return { mode, source: selectedSource, type };
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
    const mode = elements.scrapingMode.value || app.utils.SCRAPING_MODES.single;
    const singleMode = mode === app.utils.SCRAPING_MODES.single;
    const source = singleMode ? elements.platform.value || '' : '';
    const type = singleMode ? app.utils.sourceType(source) : 'multi';
    if (singleMode && !source) throw new Error(language === 'ru' ? 'Выберите источник для сбора' : 'Toplamaq üçün mənbə seçin');
    if (singleMode && type === 'unknown') throw new Error(`Unsupported source: ${source}`);
    if (!app.utils.SCRAPING_MODES || (!singleMode && !app.utils.isMultiMode(mode))) throw new Error(`Unsupported scraping mode: ${mode}`);
    const keywords = elements.keywords.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!keywords.length) throw new Error(language === 'ru' ? 'Введите хотя бы одно ключевое слово.' : 'Ən azı bir açar söz daxil edin.');
    let targetCount = -1;
    if (elements.limitCountToggle.checked) {
      targetCount = Number(elements.count.value);
      if (!Number.isInteger(targetCount) || targetCount < 1) throw new Error(language === 'ru' ? 'Количество постов должно быть целым числом больше нуля.' : 'Post sayı sıfırdan böyük tam ədəd olmalıdır.');
    }
    if (elements.dateLimitToggle.checked && !elements.dateLimit.value.trim()) {
      throw new Error(language === 'ru' ? 'Выберите или введите дату в формате DD/MM/YYYY.' : 'Tarixi seçin və ya DD/MM/YYYY formatında daxil edin.');
    }
    const parsedDate = elements.dateLimitToggle.checked ? app.utils.parseUserDate(elements.dateLimit.value) : { value: null, error: null };
    if (parsedDate.error) throw new Error(parsedDate.error);
    const sources = app.utils.sourcesForMode(mode, source);
    const downloadSource = app.utils.filenameSourceForMode(mode, source);
    debugPopup(`[popup] Start validation passed for ${singleMode ? type : mode} source`);
    return { mode, source, sourceType: type, sources, downloadSource, keywords, targetCount, dateLimit: parsedDate.value };
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

  function collectCredentials(form) {
    if (form.mode === app.utils.SCRAPING_MODES.single) {
      return form.sourceType === 'social'
        ? { [form.source]: { username: elements.authUsername.value.trim(), password: elements.authPassword.value } }
        : {};
    }
    if (form.mode === app.utils.SCRAPING_MODES.mixedNews) return {};
    const credentials = {};
    document.querySelectorAll('[data-credential-source][data-credential-field]').forEach((input) => {
      const source = input.dataset.credentialSource;
      const field = input.dataset.credentialField;
      credentials[source] = credentials[source] || {};
      credentials[source][field] = field === 'username' ? input.value.trim() : input.value;
    });
    return credentials;
  }

  function sourceStatesFor(sources, firstKeyword) {
    return Object.fromEntries(sources.map((source) => [source, {
      active: true,
      phase: 'initialize',
      status: 'queued',
      keywordIndex: 0,
      currentKeyword: firstKeyword,
      stats: { currentKeyword: 0, total: 0, duplicates: 0, errors: 0 },
      lastSkipNonce: 0,
      parentRunId: null,
      sourceRunId: null,
      tabId: null,
      windowId: null,
      lastProgressAt: null
    }]));
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs[0]?.id) throw new Error(language === 'ru' ? 'Не найдена активная вкладка.' : 'Aktiv tab tapılmadı.');
    return tabs[0];
  }

  elements.start.addEventListener('click', async () => {
    showError();
    elements.start.disabled = true;
    try {
      const form = validateForm();
      const tab = await activeTab();
      const singleMode = form.mode === app.utils.SCRAPING_MODES.single;
      const platform = singleMode ? form.source : form.downloadSource;
      const runId = crypto.randomUUID();
      const state = {
        version: app.VERSION,
        runId,
        ownerTabId: tab.id,
        active: true,
        phase: 'starting',
        requestedAction: null,
        scrapingMode: form.mode,
        sources: form.sources,
        downloadSource: form.downloadSource,
        sourceStates: singleMode ? null : sourceStatesFor(form.sources, form.keywords[0]),
        sourceTabs: singleMode ? null : {},
        skipNonce: 0,
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
          popupLogEntry(`[popup] Start validation passed for ${singleMode ? form.sourceType : form.mode} source`),
          { timestamp: new Date().toISOString(), platform, level: 'info', message: `Run created. First keyword: ${form.keywords[0]}`, details: '' }
        ],
        createdAt: new Date().toISOString()
      };
      const secrets = collectCredentials(form);
      await app.storage.initialize(state, secrets);
      render(state);

      if (!singleMode) {
        const response = await chrome.runtime.sendMessage({ action: 'multi:start', runId, credentials: secrets });
        if (!response?.success) throw new Error(response?.error || 'Multi scrape controller did not acknowledge Start');
      } else {
        const target = platformTarget(platform);
        let currentHost = '';
        try { currentHost = new URL(tab.url).hostname; } catch (error) {}
        if (!currentHost.endsWith(target.domain)) {
          await chrome.tabs.update(tab.id, { url: target.url });
        } else {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'scraper:start', runId, credentials: secrets });
            if (!response?.success) throw new Error('Content script did not acknowledge Start');
          } catch (error) {
            await chrome.tabs.reload(tab.id);
          }
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

  elements.scrapingMode.addEventListener('change', () => updateSourceUi('change'));
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
  elements.scrapingMode.value = app.utils.SCRAPING_MODES.single;
  selectedSource = null;
  elements.sendToServerToggle.checked = false;
  applyTranslations();
  debugPopup('[popup] sendToServer default: false');
  updateSourceUi();
  app.storage.getState().then(render).catch((error) => showError(error.message));
})(globalThis.ScraperApp);
