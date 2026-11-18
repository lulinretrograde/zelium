const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/palette/settings.js');
require('../src/palette/parse.js');
require('../src/palette/commands.js');
const { normalize, extraAis, DEFAULTS } = globalThis.Zelium.settings;
const P = globalThis.Zelium.parse;
const C = globalThis.Zelium.commands;

test('normalize: sections, limits, theme, prompt', () => {
  const s = normalize({ sections: { history: false, bogus: true }, limits: { tabs: 10, history: 99, bookmarks: 0 }, theme: 'light', pagePrompt: '  TL;DR  ' });
  assert.equal(s.sections.history, false);
  assert.equal(s.sections.tabs, true);
  assert.ok(!('bogus' in s.sections));
  assert.equal(s.limits.tabs, 10);
  assert.equal(s.limits.history, DEFAULTS.limits.history);
  assert.equal(s.limits.bookmarks, DEFAULTS.limits.bookmarks);
  assert.equal(s.theme, 'light');
  assert.equal(s.pagePrompt, 'TL;DR');
  assert.equal(normalize({ theme: 'neon' }).theme, 'dark');
  assert.equal(normalize({ pagePrompt: '   ' }).pagePrompt, DEFAULTS.pagePrompt);
});

test('normalize: default bang, custom bangs and AIs are validated', () => {
  assert.equal(normalize({ defaultBang: '!DDG' }).defaultBang, 'ddg');
  assert.equal(normalize({ defaultBang: 'not a trigger' }).defaultBang, '');
  const s = normalize({
    customBangs: [
      { trigger: '!Mine', name: 'Mine', url: 'https://mine.example/?q=%s' },
      { trigger: 'mine', name: 'Dup', url: 'https://dup.example/?q=%s' },
      { trigger: 'noq', url: 'https://x.example/' },
      { trigger: 'js', url: 'javascript:alert(%s)' },
    ],
    customAis: [
      { alias: 'myai', name: 'My AI', url: 'https://ai.example/?q=%s' },
      { alias: 'two words', url: 'https://ai.example/?q=%s' },
    ],
    aiPresets: ['grok', 'nope'],
  });
  assert.deepEqual(s.customBangs, [{ trigger: 'mine', name: 'Mine', url: 'https://mine.example/?q=%s' }]);
  assert.deepEqual(s.customAis, [{ alias: 'myai', name: 'My AI', url: 'https://ai.example/?q=%s' }]);
  assert.deepEqual(s.aiPresets, ['grok']);
  assert.deepEqual(extraAis(s).map((a) => a.alias), ['grok', 'myai']);
  assert.deepEqual(normalize(null).aiPresets, [], 'no extra AI services by default');
});

test('user bangs win over built-in ones and are marked', () => {
  P.setUserBangs([{ trigger: 'w', name: 'My Wiki', url: 'https://wiki.example/?s=%s' }]);
  const r = P.parseBang('!w zed');
  assert.equal(r.url, 'https://wiki.example/?s=zed');
  assert.equal(r.bang.user, true);
  P.setUserBangs([]);
  assert.equal(P.parseBang('!w zed').bang.name, 'Wikipedia');
});

test('opt-in AI services: aliases, commands and URL templates', () => {
  C.setExtraAis([{ alias: 'grok', name: 'Grok', url: 'https://grok.com/?q=%s' }]);
  const ask = C.parseAsk('grok: hi there', { requireColon: true });
  assert.equal(ask.ai.name, 'Grok');
  assert.equal(ask.ai.url, 'https://grok.com/');
  assert.equal(C.fillTemplate(ask.ai.template, 'a&b c'), 'https://grok.com/?q=a%26b%20c');
  const ids = C.list(null).map((c) => c.id);
  assert.ok(ids.includes('ai.x.grok') && ids.includes('ai.x.grok.page'));
  // Built-in aliases can't be taken over.
  C.setExtraAis([{ alias: 'claude', name: 'Fake', url: 'https://fake.example/?q=%s' }]);
  assert.equal(C.parseAsk('claude: hi').ai.id, 'ai.claude');
  C.setExtraAis([]);
  assert.equal(C.parseAsk('grok: hi'), null);
});
