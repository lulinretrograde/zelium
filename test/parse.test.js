const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/palette/parse.js');
const { detectUrl, calculate, parseBang, displayUrl, relativeTime } = globalThis.Zelium.parse;

test('detectUrl: domains, schemes, localhost, IPs', () => {
  assert.equal(detectUrl('github.com'), 'https://github.com');
  assert.equal(detectUrl('docs.rs/serde'), 'https://docs.rs/serde');
  assert.equal(detectUrl('https://example.org/a?b=c'), 'https://example.org/a?b=c');
  assert.equal(detectUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(detectUrl('192.168.1.1/admin'), 'http://192.168.1.1/admin');
  assert.equal(detectUrl('chrome://settings'), 'chrome://settings');
});

test('detectUrl: rejects plain words, sentences, unknown TLDs, javascript:', () => {
  assert.equal(detectUrl('hello world'), null);
  assert.equal(detectUrl('rust'), null);
  assert.equal(detectUrl('script.js'), null);
  assert.equal(detectUrl('javascript:alert(1)'), null);
});

test('calculate: arithmetic, precedence, functions, constants', () => {
  assert.equal(calculate('2*(3+4)').value, 14);
  assert.equal(calculate('2+3*4').value, 14);
  assert.equal(calculate('2^3^2').value, 512);
  assert.equal(calculate('-2^2').value, -4);
  assert.equal(calculate('sqrt(16)+1').value, 5);
  assert.equal(calculate('10 % 3').value, 1);
  assert.equal(calculate('6 × 7').value, 42);
  assert.equal(calculate('0.1+0.2').display, '0.3');
  assert.ok(Math.abs(calculate('2*pi').value - Math.PI * 2) < 1e-12);
});

test('calculate: ignores non-math input', () => {
  assert.equal(calculate('42'), null);
  assert.equal(calculate('-5'), null);
  assert.equal(calculate('hello'), null);
  assert.equal(calculate('1/0'), null);
  assert.equal(calculate('2 +'), null);
  assert.equal(calculate('foo(2)'), null);
});

test('parseBang: prefix, suffix and partial forms', () => {
  const a = parseBang('!yt lofi beats');
  assert.equal(a.kind, 'search');
  assert.equal(a.bang.key, 'yt');
  assert.equal(a.query, 'lofi beats');
  assert.equal(a.url, 'https://www.youtube.com/results?search_query=lofi%20beats');

  const b = parseBang('serde !crates');
  assert.equal(b.kind, 'search');
  assert.equal(b.query, 'serde');

  const c = parseBang('!g');
  assert.equal(c.kind, 'partial');
  assert.equal(c.matches[0].key, 'g');

  assert.equal(parseBang('no bang here'), null);
  assert.equal(parseBang('hey !unknown thing'), null);
});

test('displayUrl strips scheme, www and trailing slash', () => {
  assert.equal(displayUrl('https://www.example.com/'), 'example.com');
  assert.equal(displayUrl('http://a.b/c/'), 'a.b/c');
});

test('relativeTime buckets', () => {
  const now = 1_000_000_000_000;
  assert.equal(relativeTime(now - 10e3, now), 'now');
  assert.equal(relativeTime(now - 5 * 60e3, now), '5m');
  assert.equal(relativeTime(now - 3 * 3600e3, now), '3h');
  assert.equal(relativeTime(now - 2 * 86400e3, now), '2d');
  assert.equal(relativeTime(0, now), '');
});
