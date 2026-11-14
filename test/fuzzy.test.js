const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/palette/fuzzy.js');
const { matchToken, scoreFields, rank } = globalThis.Zelium.fuzzy;

test('matches subsequences and reports positions', () => {
  const m = matchToken('gh', 'GitHub');
  assert.ok(m);
  assert.deepEqual(m.positions, [0, 3]);
});

test('returns null when not a subsequence', () => {
  assert.equal(matchToken('xyz', 'GitHub'), null);
});

test('prefers contiguous word-start matches', () => {
  const m = matchToken('git', 'Settings - GitHub');
  assert.deepEqual(m.positions, [11, 12, 13]);
});

test('all tokens must match', () => {
  assert.equal(scoreFields(['git', 'zzz'], ['GitHub', 'github.com']), null);
  assert.ok(scoreFields(['git', 'com'], ['GitHub', 'github.com']));
});

test('rank orders better matches first', () => {
  const items = ['Close Tab', 'Close Other Tabs', 'Reload Tab'].map((title) => ({ title }));
  const out = rank('clo', items, (i) => [i.title]);
  assert.equal(out.length, 2);
  assert.equal(out[0].item.title, 'Close Tab');
});

test('rank respects limit and minScore', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ t: `item ${i}` }));
  assert.equal(rank('item', items, (i) => [i.t], { limit: 5 }).length, 5);
  assert.equal(rank('itm', items, (i) => [i.t], { minScore: 1e9 }).length, 0);
});

test('empty query matches everything with zero score', () => {
  const r = scoreFields([], ['anything']);
  assert.equal(r.score, 0);
});

test('minScore filters scattered matches but keeps word-start ones', () => {
  const items = [
    { title: 'Zed - Wikipedia', url: 'en.wikipedia.org/wiki/Zed' },
    { title: 'Popover API - Web APIs | MDN', url: 'developer.mozilla.org/en-US/docs/Web/API/Popover_API' },
  ];
  const out = rank('zed', items, (i) => [i.title, i.url], { weights: [1, 0.85], minScore: 4.5 * 3, boost: () => 100 });
  assert.deepEqual(out.map((r) => r.item.title), ['Zed - Wikipedia']);
});
