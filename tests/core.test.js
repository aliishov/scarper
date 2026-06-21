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
  'core/server.js',
  'scrapers/base.js',
  'scrapers/facebook.js',
  'scrapers/tiktok.js'
]) {
  require(path.join(root, file));
}

const app = globalThis.ScraperApp;

test('DD_MM_YYYY validation is strict and date-only', () => {
  assert.deepEqual(app.utils.parseUserDate('15_05_2026'), { value: '2026-05-15', error: null });
  assert.equal(app.utils.parseUserDate('31_02_2026').value, null);
  assert.equal(app.utils.parseUserDate('2026-05-15').value, null);
  assert.equal(app.utils.isBeforeDateLimit('2026-05-14T23:59:59+04:00', '2026-05-15'), true);
  assert.equal(app.utils.isBeforeDateLimit('2026-05-15T00:00:01+04:00', '2026-05-15'), false);
});

test('result filename follows source_result_DD_MM_YYYY.jsonl', () => {
  assert.equal(app.utils.buildFilename('facebook', new Date(2026, 5, 20)), 'facebook_result_20_06_2026.jsonl');
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

test('Facebook parses localized relative dates', () => {
  const now = new Date(2026, 5, 20, 12, 0, 0);
  assert.equal(app.parsers.facebookDate('2 min ago', now).getTime(), now.getTime() - 120000);
  assert.equal(app.parsers.facebookDate('7 ч', now).getTime(), now.getTime() - 7 * 3600000);
  assert.equal(app.parsers.facebookDate('3 weeks ago', now).getTime(), now.getTime() - 21 * 86400000);
  const twoMonths = app.parsers.facebookDate('2 месяца', now);
  assert.equal(twoMonths.getMonth(), 3);
  assert.equal(app.parsers.facebookDate('not a publication date', now), null);
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
