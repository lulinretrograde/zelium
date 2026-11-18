const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/palette/learn.js');
require('../src/palette/settings.js');
const { keyFor, record, boosts, TOP_HIT, MAX_ENTRIES } = globalThis.Zelium.learn;
const { normalize, DEFAULTS } = globalThis.Zelium.settings;

const DAY = 86400e3;

test('keyFor: stable keys for URLs and commands only', () => {
  assert.equal(keyFor({ kind: 'tab', url: 'https://a.org', data: { id: 7 } }), 'url:https://a.org');
  assert.equal(keyFor({ kind: 'history', url: 'https://a.org' }), 'url:https://a.org');
  assert.equal(keyFor({ kind: 'command', data: { id: 'tab.reload' } }), 'command:tab.reload');
  assert.equal(keyFor({ kind: 'search' }), null);
  assert.equal(keyFor({ kind: 'calc', data: {} }), null);
});

test('record counts picks per normalised query', () => {
  let s = record({}, ' GitHub ', 'url:https://github.com', 1000);
  s = record(s, 'github', 'url:https://github.com', 2000);
  assert.deepEqual(s, { 'github\u0001url:https://github.com': [2, 2000] });
  assert.equal(record(s, '   ', 'url:x'), s);
});

test('boosts: exact query beats a prefix, both make a top hit after one pick', () => {
  const now = 10 * DAY;
  const s = record({}, 'github', 'url:https://github.com', now);
  const exact = boosts(s, 'github', now).get('url:https://github.com');
  const prefix = boosts(s, 'gi', now).get('url:https://github.com');
  assert.ok(exact >= TOP_HIT, `exact ${exact}`);
  assert.ok(prefix > 0 && prefix < exact, `prefix ${prefix}`);
  assert.equal(boosts(s, 'githubx', now).size, 0);
  assert.equal(boosts(s, 'hub', now).size, 0);
});

test('boosts grow with picks and fade with time', () => {
  const now = 100 * DAY;
  const once = record({}, 'q', 'k', now);
  const thrice = record(record(once, 'q', 'k', now), 'q', 'k', now);
  assert.ok(boosts(thrice, 'q', now).get('k') > boosts(once, 'q', now).get('k'));
  const old = record({}, 'q', 'k', now - 28 * DAY);
  assert.ok(Math.abs(boosts(old, 'q', now).get('k') - boosts(once, 'q', now).get('k') / 4) < 1e-9);
});

test('record keeps at most MAX_ENTRIES, dropping the least recently used', () => {
  let s = {};
  for (let i = 0; i <= MAX_ENTRIES; i++) s = record(s, `q${i}`, 'k', i);
  assert.equal(Object.keys(s).length, MAX_ENTRIES);
  assert.ok(!('q0\u0001k' in s));
  assert.ok(`q${MAX_ENTRIES}\u0001k` in s);
});

test('settings.normalize: defaults, ignores unknown keys and wrong types', () => {
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.equal(normalize({ learn: false }).learn, false);
  assert.equal(normalize({ learn: 'no' }).learn, true);
  assert.ok(!('evil' in normalize({ evil: 1 })));
});
