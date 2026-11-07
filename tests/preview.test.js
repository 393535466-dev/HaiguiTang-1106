'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPreviewProvider } = require('../scripts/preview-provider');
const { createPreviewServer } = require('../scripts/preview-server');
const puzzle = require('../cloudfunctions/game/data/tutorial');
test('preview defaults to real AI; missing credentials never silently fall back to fixtures', async () => {
  const provider = createPreviewProvider({ env: {}, configPath: null });
  assert.equal(provider.mode, 'real'); assert.equal(provider.ready().textReady, false);
  await assert.rejects(provider.judge({ puzzle, text: puzzle.testCases[0].text, kind: 'question' }), { code: 'CONFIG_REQUIRED' });
  const fixture = createPreviewProvider({ env: { PREVIEW_MODE: 'fixture' }, configPath: null });
  assert.equal(fixture.mode, 'fixture');
  assert.equal((await fixture.judge({ puzzle, text: puzzle.testCases[0].text, kind: 'question' })).answer, puzzle.testCases[0].answer);
});
test('preview uses the real provider protocol and keeps keys and solutions off public responses', async t => {
  const key = 'test-preview-private-key'; let dispatched = 0;
  const { server } = createPreviewServer({ env: { DASHSCOPE_API_KEY: key, GAME_ENABLED: 'true' }, configPath: null,
    fetchFn: async (_, opts) => {
      dispatched++;
      assert.equal(opts.headers.Authorization, 'Bearer ' + key);
      const data = JSON.parse(opts.body);
      assert.equal(JSON.parse(data.messages[1].content).untrustedSubmission, '自由表达的问题');
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"intent":"yes_no","answer":"yes"}' } }] }) };
    } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async body => (await fetch(base + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const status = await post({ action: 'status' });
  assert.equal(status.data.judgeMode, 'real'); assert.equal(status.data.voiceReady, false);
  const start = await post({ action: 'startTutorial' });
  const answer = await post({ action: 'askQuestion', sessionId: start.data.session.id, requestId: 'free-wording', text: '自由表达的问题' });
  assert.equal(answer.data.answer, 'yes'); assert.equal(dispatched, 1);
  const publicText = JSON.stringify([status, start, answer]) + await (await fetch(base + '/bundle.js')).text();
  assert.ok(!publicText.includes(key)); assert.ok(!publicText.includes(puzzle.solution));
  for (const hidden of ['/.env.preview.local', '/cloudfunctions/game/data/tutorial.js', '/scripts/preview-config.js']) {
    assert.equal((await fetch(base + hidden)).status, 404);
  }
  assert.equal((await fetch(base + '/api', { method: 'POST', headers: { Origin: 'https://outside.test', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  const audio = await post({ action: 'startVoicePractice' });
  assert.equal(audio.error.code, 'PREVIEW_UNSUPPORTED');
});
