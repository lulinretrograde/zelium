const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/palette/commands.js');
const { parseAsk, AI, COMMANDS } = globalThis.Zelium.commands;

test('parseAsk: alias + message', () => {
  assert.deepEqual(
    (({ ai, text }) => ({ id: ai.id, text }))(parseAsk('claude how do bangs work?')),
    { id: 'ai.claude', text: 'how do bangs work?' },
  );
  assert.equal(parseAsk('GPT: hi there').ai.id, 'ai.chatgpt');
  assert.equal(parseAsk('  gemini   explain MV3 ').text, 'explain MV3');
  assert.equal(parseAsk('deepseek x').ai.id, 'ai.deepseek');
  assert.equal(parseAsk('kimi 你好').text, '你好');
});

test('parseAsk: needs a whole-word alias and a message', () => {
  assert.equal(parseAsk('claude'), null);
  assert.equal(parseAsk('claude '), null);
  assert.equal(parseAsk('claudette hi'), null);
  assert.equal(parseAsk('ask claude hi'), null);
  assert.equal(parseAsk('github zelium'), null);
});

test('every AI service has a command with an https url', () => {
  for (const a of AI) {
    const cmd = COMMANDS.find((c) => c.id === a.id);
    assert.ok(cmd, a.id);
    assert.match(cmd.url, /^https:\/\//);
    assert.equal(cmd.group, 'AI');
  }
});
