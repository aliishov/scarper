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
assert.equal(globalThis.ScraperApp, undefined);

console.log('Static architecture checks passed');
