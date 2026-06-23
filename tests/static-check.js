'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scripts = manifest.content_scripts[0].js;
for (const platform of ['facebook', 'instagram', 'twitter', 'tiktok']) {
  assert.ok(scripts.includes(`scrapers/${platform}.js`), `${platform} scraper must be a separate content module`);
}
assert.equal(scripts.at(-1), 'content.js');

const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'tests') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.(js|html|json)$/.test(entry.name)) sourceFiles.push(fullPath);
  }
}
walk(root);
const sources = sourceFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]);
const downloadCalls = sources.flatMap(([file, source]) => Array.from(source.matchAll(/chrome\.downloads\.download/g), () => file));
assert.deepEqual(downloadCalls.map((file) => path.relative(root, file)), ['core\\downloads.js']);

const directStateWrites = sources.flatMap(([file, source]) => source.includes('chrome.storage.local.set') ? [path.relative(root, file)] : []);
assert.deepEqual(directStateWrites, ['core\\storage.js']);

const joined = sources.map(([, source]) => source).join('\n');
for (const leakedToken of ['raulalishov', 'AlexeyMoro', 'Ds7B', '2v7$s4', 'pLYpMK']) assert.equal(joined.includes(leakedToken), false);
assert.equal(/DOMContentLoaded[^\n]+run|setTimeout\([^\n]+runStateMachine/.test(fs.readFileSync(path.join(root, 'content.js'), 'utf8')), false);
const instagramSource = fs.readFileSync(path.join(root, 'scrapers', 'instagram.js'), 'utf8');
assert.match(instagramSource, /svg\[aria-label\]/);
assert.ok(instagramSource.includes('a[href="/explore/"]'));
assert.match(instagramSource, /Instagram waiting for search input/);
assert.match(instagramSource, /collectCarouselMedia/);
assert.match(instagramSource, /source\[src\]/);
assert.match(instagramSource, /Instagram carousel slide changed/);
const facebookSource = fs.readFileSync(path.join(root, 'scrapers', 'facebook.js'), 'utf8');
const navigationSource = fs.readFileSync(path.join(root, 'core', 'navigation.js'), 'utf8');
assert.match(facebookSource, /parseFacebookDateFromHeaderHover/);
assert.match(facebookSource, /findAndHoverFacebookDateElement/);
assert.match(facebookSource, /findFacebookPostContainer/);
assert.match(facebookSource, /isCompleteFacebookPostContainer/);
assert.match(facebookSource, /Post rejected: missing author\/date after container retry/);
assert.match(facebookSource, /profile \? this\.allVisible\('a\[role="link"\]\[href\]'/);
assert.match(facebookSource, /Container candidate level=/);
assert.match(facebookSource, /resolveDateFromPermalink/);
assert.match(facebookSource, /postDate: app\.utils\.formatTimestamp\(postDate\)/);
assert.match(facebookSource, /Date candidates outside header ignored/);
assert.match(facebookSource, /Expand candidates found/);
assert.match(facebookSource, /attempt <= 5/);
assert.match(facebookSource, /expandFacebookFullText/);
assert.match(facebookSource, /extractFacebookAuthor/);
assert.match(facebookSource, /extractFacebookMedia/);
assert.match(facebookSource, /\[data-ad-rendering-role="profile_name"\]/);
assert.match(facebookSource, /Timestamp link found from header/);
assert.match(facebookSource, /\[data-ad-rendering-role="story_message"\]/);
assert.match(facebookSource, /focusFacebookSearchInput/);
assert.match(facebookSource, /typeFacebookSearchKeyword/);
assert.match(facebookSource, /pressFacebookSearchEnter/);
assert.match(facebookSource, /document\.activeElement === input/);
assert.match(facebookSource, /facebookUnsafeInteractionReason/);
assert.match(facebookSource, /\[data-ad-rendering-role="image"\]/);
assert.match(facebookSource, /a\[href\*="\/reel\/"\]/);
assert.match(facebookSource, /ambiguous-more-outside-message/);
assert.match(facebookSource, /settleFacebookInteraction/);
assert.match(facebookSource, /accidental content-info popup detected/);
assert.match(facebookSource, /'Escape', 'Escape', 27/);
assert.match(navigationSource, /options\.typeInput/);
assert.match(navigationSource, /options\.pressEnter/);
const tiktokSource = fs.readFileSync(path.join(root, 'scrapers', 'tiktok.js'), 'utf8');
const stateMachineSource = fs.readFileSync(path.join(root, 'core', 'state-machine.js'), 'utf8');
assert.match(tiktokSource, /switchToVideosTab/);
assert.match(tiktokSource, /Looking for Videos tab/);
assert.match(tiktokSource, /Videos tab confirmed/);
assert.match(tiktokSource, /for \(let attempt = 1; attempt <= 3; attempt\+\+\)/);
assert.doesNotMatch(tiktokSource, /location\.pathname\.includes\('\/search\/video'\) \|\| document\.querySelector\('a\[href\*="\/video\/"\]'\)/);
assert.match(tiktokSource, /openTikTokVideoAndScrape/);
assert.match(tiktokSource, /scraperProgress/);
assert.match(tiktokSource, /Caption selector matched/);
assert.match(tiktokSource, /text: caption\?\.text \|\| null/);
assert.doesNotMatch(tiktokSource, /parseCard\(/);
assert.match(tiktokSource, /openFirstVideoCard/);
assert.match(tiktokSource, /moveToNextViewerPost/);
assert.match(tiktokSource, /collectViewerMedia/);
assert.match(tiktokSource, /ArrowDown/);
assert.doesNotMatch(tiktokSource, /videoUrls/);
assert.doesNotMatch(tiktokSource, /assign\(target\.postUrl\)/);
assert.match(stateMachineSource, /if \(result\?\.navigating\)/);
assert.match(stateMachineSource, /scraperProgress: null/);
assert.match(stateMachineSource, /reason !== 'end-of-feed'/);
assert.equal(globalThis.ScraperApp, undefined);

console.log('Static architecture checks passed');
