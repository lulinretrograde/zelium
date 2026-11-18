const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/palette/parse.js');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { detectUrl, calculate, parseBang, setBangs, hasFullBangs, displayUrl, relativeTime } = globalThis.Zelium.parse;

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

test('detectUrl: mailto/tel, unlisted TLDs with a port or path', () => {
  assert.equal(detectUrl('mailto:someone@example.com'), 'mailto:someone@example.com');
  assert.equal(detectUrl('tel:+1-555-0100'), 'tel:+1-555-0100');
  assert.equal(detectUrl('my.example.berlin/path'), 'https://my.example.berlin/path');
  assert.equal(detectUrl('intranet.corp:8080'), 'https://intranet.corp:8080');
  assert.equal(detectUrl('readme.md'), null);
  assert.equal(detectUrl('readme.md/'), null);
  assert.equal(detectUrl('mailto:'), null);
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

test('calculate: dates and phone numbers are not maths', () => {
  assert.equal(calculate('2026-11-18'), null);
  assert.equal(calculate('10/12/2024'), null);
  assert.equal(calculate('1-800-555-1234'), null);
  assert.equal(calculate('0171-123456'), null);
  assert.equal(calculate('09/2025'), null);
  // Still arithmetic:
  assert.equal(calculate('100-25').value, 75);
  assert.equal(calculate('10/4').value, 2.5);
  assert.equal(calculate('10 - 3 - 2').value, 5);
});

test('built-in bangs work before the full list loads', () => {
  const a = parseBang('!yt lofi beats');
  assert.equal(a.kind, 'search');
  assert.equal(a.bang.key, 'yt');
  assert.equal(a.query, 'lofi beats');
  assert.equal(a.url, 'https://www.youtube.com/results?search_query=lofi+beats');
  assert.equal(parseBang('!w cats').url, 'https://wikipedia.org/w/index.php?search=cats');
});

test('full Helium bang list: same triggers as Helium', () => {
  setBangs(JSON.parse(readFileSync(join(__dirname, '../src/third_party/bangs/bangs.json'), 'utf8')));
  assert.ok(hasFullBangs());
  const cases = {
    '!w cats': 'https://wikipedia.org/w/index.php?search=cats',
    '!gh zed': 'https://github.com/search?q=zed',
    '!g a b': 'https://www.google.com/search?q=a+b',
    '!wikipedia x': 'https://wikipedia.org/w/index.php?search=x',
    '!YT lofi': 'https://www.youtube.com/results?search_query=lofi',
    'serde !crates': 'https://crates.io/search?q=serde',
    '!wd Q42': 'https://www.wikidata.org/w/index.php?search=Q42',
  };
  for (const [input, url] of Object.entries(cases)) assert.equal(parseBang(input)?.url, url, input);
});

test('bang format flags: raw (unencoded) templates', () => {
  // Wayback Machine (f=1) takes the URL as-is.
  assert.equal(parseBang('!ia https://example.com/a?b=1').url, 'https://web.archive.org/web/*/https://example.com/a?b=1');
});

test('bang with no query opens the site', () => {
  const r = parseBang('!w ');
  assert.equal(r.kind, 'home');
  assert.equal(r.url, 'https://wikipedia.org');
  assert.equal(parseBang('cats'), null);
});

test('partial bangs suggest by trigger prefix, exact match first', () => {
  const r = parseBang('!gh');
  assert.equal(r.kind, 'partial');
  assert.equal(r.matches[0].key, 'gh');
  assert.equal(r.matches[0].name, 'GitHub');
  assert.ok(r.matches.length > 1 && r.matches.every((m) => m.key.startsWith('gh')));
  const popular = parseBang('!');
  assert.equal(popular.matches[0].key, 'w');
});

test('unknown bangs are left alone', () => {
  assert.equal(parseBang('hey !zzzzunknown thing'), null);
  assert.equal(parseBang('no bang here'), null);
  assert.equal(parseBang('!zzzzunknown').matches.length, 0);
});

test('AI bangs are flagged', () => {
  const r = parseBang('!chatgpt hello');
  assert.equal(r.url, 'https://chatgpt.com/?prompt=hello');
  assert.equal(r.bang.ai, true);
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

test('markdownLink escapes the title and encodes the URL', () => {
  const { markdownLink } = globalThis.Zelium.parse;
  assert.equal(markdownLink('A [b] c', 'https://x.org/a'), '[A \\[b\\] c](https://x.org/a)');
  assert.equal(markdownLink('W', 'https://en.wikipedia.org/wiki/Foo_(bar) x'), '[W](https://en.wikipedia.org/wiki/Foo_%28bar%29%20x)');
  assert.equal(markdownLink('', 'https://x.org'), '[https://x.org](https://x.org)');
});

test('formatTabList: URLs or a Markdown list', () => {
  const { formatTabList } = globalThis.Zelium.parse;
  const tabs = [
    { title: 'One', url: 'https://one.org' },
    { title: 'Two', url: 'https://two.org' },
  ];
  assert.equal(formatTabList(tabs, 'urls'), 'https://one.org\nhttps://two.org');
  assert.equal(formatTabList(tabs, 'markdown'), '- [One](https://one.org)\n- [Two](https://two.org)');
});
