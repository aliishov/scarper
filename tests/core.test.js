'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const localStorageData = {};
const sessionStorageData = {};
function storageArea(data) {
  return {
    async get(key) {
      if (typeof key === 'string') return { [key]: data[key] };
      return { ...data };
    },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; }
  };
}
globalThis.chrome = {
  runtime: { sendMessage: async () => ({ success: true }) },
  storage: { local: storageArea(localStorageData), session: storageArea(sessionStorageData) }
};

const root = path.resolve(__dirname, '..');
for (const file of [
  'core/namespace.js',
  'core/utils.js',
  'core/storage.js',
  'core/navigation.js',
  'core/server.js',
  'scrapers/base.js',
  'scrapers/twitter.js',
  'scrapers/facebook.js',
  'scrapers/instagram.js',
  'scrapers/tiktok.js',
  'scrapers/oxu.js',
  'scrapers/media.js',
  'scrapers/one-news.js'
]) {
  require(path.join(root, file));
}

const app = globalThis.ScraperApp;

test('DD/MM/YYYY validation is strict and date-only', () => {
  assert.deepEqual(app.utils.parseUserDate('15/05/2026'), { value: '2026-05-15', error: null });
  assert.equal(app.utils.parseUserDate('31/02/2026').value, null);
  assert.equal(app.utils.parseUserDate('2026-05-15').value, null);
  assert.equal(app.utils.isBeforeDateLimit('2026-05-14T23:59:59+04:00', '2026-05-15'), true);
  assert.equal(app.utils.isBeforeDateLimit('2026-05-15T00:00:01+04:00', '2026-05-15'), false);
});

test('date mask inserts slashes and calendar values use DD/MM/YYYY', () => {
  assert.equal(app.utils.formatDateMask('2'), '2');
  assert.equal(app.utils.formatDateMask('21'), '21/');
  assert.equal(app.utils.formatDateMask('2106'), '21/06/');
  assert.equal(app.utils.formatDateMask('21a06-2026'), '21/06/2026');
  assert.equal(app.utils.displayDateFromIso('2026-06-21'), '21/06/2026');
});

test('result filename follows source_result_DD_MM_YYYY.jsonl', () => {
  assert.equal(app.utils.buildFilename('facebook', new Date(2026, 5, 20)), 'facebook_result_20_06_2026.jsonl');
  assert.equal(app.utils.buildFilename('oxu.az', new Date(2026, 5, 25)), 'oxu.az_result_25_06_2026.jsonl');
  assert.equal(app.utils.buildFilename('media.az', new Date(2026, 5, 25)), 'media.az_result_25_06_2026.jsonl');
  assert.equal(app.utils.buildFilename('1news.az', new Date(2026, 5, 25)), '1news.az_result_25_06_2026.jsonl');
});

test('Facebook parses absolute tooltip date without replacing it with now', () => {
  const parsed = app.parsers.facebookDate('Wednesday, June 17, 2026 at 9:28 PM', new Date(2026, 5, 20, 12));
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 5);
  assert.equal(parsed.getDate(), 17);
  assert.equal(parsed.getHours(), 21);
  assert.equal(parsed.getMinutes(), 28);
});

test('Facebook accepts the author-time tooltip and rejects media accessibility tooltips', () => {
  const tooltip = 'Saturday, June 20, 2026 at 3:29 PM';
  assert.equal(app.parsers.facebookDateText(tooltip), true);
  const parsed = app.parsers.facebookDate(tooltip, new Date(2026, 5, 21, 12));
  assert.equal(parsed.getDate(), 20);
  assert.equal(parsed.getHours(), 15);
  assert.equal(parsed.getMinutes(), 29);
  for (const value of [
    'May be an image of car and text',
    'May be a video of a vehicle',
    'Image may contain: car, text and 2026',
    'На изображении может быть автомобиль и текст'
  ]) {
    assert.equal(app.parsers.facebookMediaTooltip(value), true);
    assert.equal(app.parsers.facebookDate(value, new Date(2026, 5, 21, 12)), null);
    assert.equal(app.parsers.facebookDateText(value), false);
  }
});

test('Facebook container scoring rejects media wrappers and whole feeds', () => {
  const mediaWrapper = app.parsers.facebookContainerScore({
    hasAuthor: false, hasText: false, hasExpand: false, hasDateMeta: false,
    hasPermalink: true, hasMedia: true, hasEngagement: false, tooLarge: false, isFeed: false
  });
  const fullPost = app.parsers.facebookContainerScore({
    hasAuthor: true, hasText: true, hasExpand: true, hasDateMeta: true,
    hasPermalink: true, hasMedia: true, hasEngagement: true, tooLarge: false, isFeed: false
  });
  const feed = app.parsers.facebookContainerScore({
    hasAuthor: true, hasText: true, hasExpand: true, hasDateMeta: true,
    hasPermalink: true, hasMedia: true, hasEngagement: true, tooLarge: true, isFeed: true
  });
  assert.ok(fullPost > mediaWrapper);
  assert.ok(feed < 0);
});

test('Facebook container selection requires author, timestamp, permalink, and content', () => {
  const incompleteScore18 = {
    hasAuthor: false, hasText: true, hasExpand: true, hasDateMeta: false,
    hasPermalink: true, hasMedia: true, hasEngagement: false, tooLarge: false, isFeed: false
  };
  assert.equal(app.parsers.facebookContainerScore(incompleteScore18), 18);
  assert.equal(app.parsers.facebookContainerComplete(incompleteScore18), false);
  assert.equal(app.parsers.facebookContainerComplete({
    ...incompleteScore18, hasAuthor: true, hasDateMeta: true
  }), true);
  assert.equal(app.parsers.facebookContainerComplete({
    ...incompleteScore18, hasAuthor: true, hasDateMeta: true, hasText: false, hasMedia: false
  }), false);
});

test('Facebook post URL normalization rejects search navigation links', () => {
  assert.equal(app.scrapers.facebook.normalizePostUrl('https://www.facebook.com/search/videos'), '');
  assert.equal(
    app.scrapers.facebook.normalizePostUrl('https://www.facebook.com/photo/?fbid=123456789&id=123'),
    'https://www.facebook.com/photo?fbid=123456789&id=123'
  );
  assert.equal(
    app.scrapers.facebook.normalizePostUrl('https://www.facebook.com/example/posts/123456789?ref=search'),
    'https://www.facebook.com/example/posts/123456789'
  );
});

test('Facebook expand labels cover supported locales without matching UI text', () => {
  for (const label of ['See more', 'More', 'Read more', 'Show more', 'Ещё', 'Еще', 'Показать больше', 'Daha çox', 'Devamını gör']) {
    assert.equal(app.parsers.facebookExpandLabel(label), true, label);
  }
  assert.equal(app.parsers.facebookExpandLabel('Share'), false);
});

test('Facebook parses localized relative dates', () => {
  const now = new Date(2026, 5, 20, 12, 0, 0);
  assert.equal(app.parsers.facebookDate('2 min ago', now).getTime(), now.getTime() - 120000);
  assert.equal(app.parsers.facebookDate('7 ч', now).getTime(), now.getTime() - 7 * 3600000);
  assert.equal(app.parsers.facebookDate('2 дн.', now).getTime(), now.getTime() - 2 * 86400000);
  assert.equal(app.parsers.facebookDate('3 weeks ago', now).getTime(), now.getTime() - 21 * 86400000);
  const twoMonths = app.parsers.facebookDate('2 месяца', now);
  assert.equal(twoMonths.getMonth(), 3);
  const yesterday = app.parsers.facebookDate('Yesterday at 9:10 PM', now);
  assert.equal(yesterday.getDate(), 19);
  assert.equal(yesterday.getHours(), 21);
  assert.equal(yesterday.getMinutes(), 10);
  const htmlTimestamp = app.parsers.facebookDate('14 июнь в 19:02', now);
  assert.equal(htmlTimestamp.getMonth(), 5);
  assert.equal(htmlTimestamp.getDate(), 14);
  assert.equal(htmlTimestamp.getHours(), 19);
  assert.equal(htmlTimestamp.getMinutes(), 2);
  assert.equal(app.parsers.facebookDate('not a publication date', now), null);
});

test('Facebook search focus state requires active input and caret at the end', () => {
  const originalDocument = globalThis.document;
  const input = {
    value: 'Messi',
    selectionStart: 5,
    selectionEnd: 5,
    isContentEditable: false,
    getAttribute: () => null
  };
  globalThis.document = { activeElement: input };
  try {
    assert.deepEqual(app.scrapers.facebook.facebookSearchFocusState(input), {
      active: true,
      contenteditable: false,
      caretConfirmed: true
    });
    input.selectionStart = 2;
    input.selectionEnd = 2;
    assert.equal(app.scrapers.facebook.facebookSearchFocusState(input).caretConfirmed, false);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('posts can retain a null publication date in the public payload', () => {
  const normalized = app.utils.normalizePost({
    postDate: null,
    postUrl: 'https://www.facebook.com/example/posts/123',
    author: 'Author',
    authorUrl: 'https://www.facebook.com/example',
    text: '',
    mediaUrls: []
  }, { keyword: 'test', source: 'facebook' });
  assert.equal(normalized.postDate, null);
  assert.equal(app.server.toPayload(normalized).postDate, null);
});

test('TikTok can retain a null caption without reusing another post text', () => {
  const normalized = app.utils.normalizePost({
    postDate: '2026-06-20T10:00:00+04:00',
    postUrl: 'https://www.tiktok.com/@author/video/1234567890123456789',
    author: 'author',
    authorUrl: 'https://www.tiktok.com/@author',
    text: null,
    mediaUrls: []
  }, { keyword: 'test', source: 'tiktok' });
  assert.equal(normalized.text, null);
  assert.equal(app.server.toPayload(normalized).text, null);
});

test('TikTok video snowflake yields a stable publication date', () => {
  const expectedSeconds = Math.floor(new Date('2026-06-17T12:00:00Z').getTime() / 1000);
  const videoId = (BigInt(expectedSeconds) << 32n).toString();
  const parsed = app.parsers.tiktokVideoIdDate(videoId);
  assert.equal(Math.floor(parsed.getTime() / 1000), expectedSeconds);
});

test('TikTok URL produces a clean author and profile URL', () => {
  const parsed = app.parsers.tiktokVideoUrl('https://www.tiktok.com/@barca4ever.36/video/7370000000000000000?lang=ru');
  assert.deepEqual(parsed, {
    postUrl: 'https://www.tiktok.com/@barca4ever.36/video/7370000000000000000',
    author: 'barca4ever.36',
    authorUrl: 'https://www.tiktok.com/@barca4ever.36',
    videoId: '7370000000000000000'
  });
});

test('Instagram builds its direct keyword search URL without UI search', () => {
  assert.equal(
    app.parsers.instagramSearchUrl('Lionel Messi #10'),
    'https://www.instagram.com/explore/search/keyword/?q=Lionel%20Messi%20%2310'
  );
});

test('Twitter date limit builds Advanced Search fallback query', () => {
  assert.deepEqual(app.parsers.twitterDateLimit('13/04/2026'), {
    iso: '2026-04-13',
    year: '2026',
    month: '4',
    monthName: 'April',
    day: '13'
  });
  assert.deepEqual(app.parsers.twitterDateLimit('2026-04-13'), {
    iso: '2026-04-13',
    year: '2026',
    month: '4',
    monthName: 'April',
    day: '13'
  });
  assert.equal(app.parsers.twitterDateLimit('31/02/2026'), null);
  assert.equal(
    app.parsers.twitterSinceSearchUrl('mehkeme', '13/04/2026'),
    'https://x.com/search?f=live&q=mehkeme%20since%3A2026-04-13&src=typed_query'
  );
});

test('Oxu.az parses relative Azerbaijani publication dates', () => {
  const now = new Date(2026, 5, 25, 13, 30, 0);
  const today = app.parsers.oxuDate('Bu g\u00fcn / 12:02', now);
  assert.equal(today.getFullYear(), 2026);
  assert.equal(today.getMonth(), 5);
  assert.equal(today.getDate(), 25);
  assert.equal(today.getHours(), 12);
  assert.equal(today.getMinutes(), 2);
  const yesterday = app.parsers.oxuDate('D\u00fcn\u0259n / 22:12', now);
  assert.equal(yesterday.getDate(), 24);
  assert.equal(yesterday.getHours(), 22);
  assert.equal(yesterday.getMinutes(), 12);
  assert.equal(app.parsers.oxuDate('31/02/2026 / 12:00', now), null);
});

test('Media.az parses absolute publication dates in local timezone', () => {
  assert.equal(
    app.parsers.mediaAzDate('25.06.2026 12:40'),
    app.utils.formatTimestamp(new Date(2026, 5, 25, 12, 40, 0))
  );
  assert.equal(
    app.parsers.mediaAzDate('2026-06-25 12:40:30'),
    app.utils.formatTimestamp(new Date(2026, 5, 25, 12, 40, 30))
  );
  assert.equal(app.parsers.mediaAzDate('31.02.2026 12:00'), null);
});

test('Media.az date limit search URL includes date_start filters', () => {
  assert.deepEqual(app.parsers.mediaAzDateLimit('02/07/2026'), {
    display: '02/07/2026',
    iso: '2026-07-02'
  });
  assert.deepEqual(app.parsers.mediaAzDateLimit('2026-07-02'), {
    display: '02/07/2026',
    iso: '2026-07-02'
  });
  assert.equal(app.parsers.mediaAzDateLimit('31/02/2026'), null);
  assert.equal(
    app.parsers.mediaAzSearchUrl('\u0421\u0443\u0434', '02/07/2026'),
    'https://media.az/search?query=%D0%A1%D1%83%D0%B4&date_start=2026-07-02&date_end=&category=&sort_type=0'
  );
});

test('1news.az parses article publication dates in local timezone', () => {
  assert.equal(
    app.parsers.parse1NewsDate('19:12 - 17 / 06 / 2026'),
    app.utils.formatTimestamp(new Date(2026, 5, 17, 19, 12, 0))
  );
  assert.equal(app.parsers.parse1NewsDate('bad date'), null);
});

test('News payload never exposes title or category', () => {
  const normalized = app.utils.normalizePost({
    postDate: '2026-06-25T12:02:00+04:00',
    postUrl: 'https://oxu.az/cemiyyet/example',
    author: 'oxu.az',
    authorUrl: 'https://oxu.az/',
    title: 'Example title',
    text: 'Article body',
    category: 'C\u0259miyy\u0259t',
    mediaUrls: []
  }, { keyword: 'test', source: 'oxu.az' });
  const payload = app.server.toPayload(normalized);
  assert.equal('title' in normalized, false);
  assert.equal('title' in payload, false);
  assert.equal('category' in normalized, false);
  assert.equal('category' in payload, false);
  assert.equal(app.utils.canonicalPostKey(normalized), 'oxu.az:https://oxu.az/cemiyyet/example');
});

test('TikTok detail caption cleanup removes page chrome without sharing state', () => {
  assert.equal(app.parsers.tiktokCaption('Full caption #tag | TikTok', 'author'), 'Full caption #tag');
  assert.equal(app.parsers.tiktokCaption('12 Likes. TikTok video from User (@author): “Quoted caption #tag”.', 'author'), 'Quoted caption #tag');
  assert.equal(app.parsers.tiktokCaption('author', 'author'), '');
  assert.equal(app.parsers.tiktokCaption('TikTok - Make Your Day', 'author'), '');
  assert.equal(app.parsers.tiktokCaption('A different caption', 'author'), 'A different caption');
});

test('normalized posts and server payload contain only the required public model', () => {
  const normalized = app.utils.normalizePost({
    id: 'must-not-leak',
    postDate: '2026-06-17T12:00:00+04:00',
    postUrl: 'https://www.instagram.com/p/ABC/',
    author: 'author',
    authorUrl: 'https://www.instagram.com/author/',
    text: 'caption',
    mediaUrls: ['https://cdn.example/image.jpg']
  }, { keyword: 'test', source: 'instagram' });
  const payload = app.server.toPayload(normalized);
  assert.deepEqual(Object.keys(payload), [
    'keyword', 'source', 'scrapedAt', 'postDate', 'postUrl', 'author', 'authorUrl', 'text', 'mediaUrls'
  ]);
  assert.equal('id' in payload, false);
  assert.equal('url' in payload, false);
});

test('cancellation interrupts pending waits immediately', async () => {
  const token = new app.utils.CancellationToken();
  const started = Date.now();
  const pending = app.utils.sleep(5000, token);
  token.cancel('stop');
  await assert.rejects(pending, (error) => error.name === 'CancellationError' && error.reason === 'stop');
  assert.ok(Date.now() - started < 500);
});

test('state repository serializes concurrent writes and rejects stale runs', async () => {
  const repository = app.createStateRepository();
  const runId = 'run-current';
  await repository.initialize({ runId, active: true, logs: [], stats: {} });
  await Promise.all([
    ...Array.from({ length: 50 }, (_, index) => repository.appendLog(runId, {
      timestamp: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      platform: 'test',
      level: 'info',
      message: `log-${index}`,
      details: ''
    })),
    repository.patch(runId, { active: false, phase: 'stopped' })
  ]);
  const state = await repository.get();
  assert.equal(state.active, false);
  assert.equal(state.phase, 'stopped');
  assert.equal(state.logs.length, 50);
  assert.equal(state.revision, 52);
  assert.equal(await repository.patch('stale-run', { active: true }), null);
});

test('all platform scrapers implement the shared public contract', () => {
  const methods = [
    'ensureReady', 'searchKeyword', 'scrapePosts', 'parsePost', 'expandPostText',
    'parsePostDate', 'shouldSkipPost', 'stop', 'cleanup'
  ];
  for (const platform of ['facebook', 'instagram', 'twitter', 'tiktok', 'oxu.az', 'media.az', '1news.az']) {
    for (const method of methods) {
      assert.equal(typeof app.scrapers[platform][method], 'function', `${platform}.${method} must exist`);
    }
  }
});

test('focus and caret confirmation requires the active input and caret at the end', () => {
  const input = { value: 'Messi', selectionStart: 5, selectionEnd: 5 };
  assert.deepEqual(app.navigationInternals.focusAndCaretState(input, { activeElement: input }), {
    active: true,
    supportsCaret: true,
    selectionStart: 5,
    selectionEnd: 5,
    caretAtEnd: true
  });
  input.selectionStart = 2;
  input.selectionEnd = 2;
  assert.equal(app.navigationInternals.focusAndCaretState(input, { activeElement: input }).caretAtEnd, false);
  assert.equal(app.navigationInternals.focusAndCaretState(input, { activeElement: null }).active, false);
});
