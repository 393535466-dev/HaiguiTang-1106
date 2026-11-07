'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture(custom) {
  const calls = [], sessions = [], state = {}, module = { exports: {} };
  let next = 0;
  const api = { requestId: () => ++next === 1 ? 'original-request' : 'replacement-request', message: e => e.code || 'ERROR', async call(action, args, options) {
    calls.push({ action, args, options });
    if (custom) { const value = await custom(action, args, options); if (value !== undefined) return value; }
    if (action === 'status') return { textReady: true };
    if (action === 'startTutorial') return { session: { id: 'tutorial-only', messages: [] } };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/utils/tutorial-judge'), 'utf8'), {
    module, require: () => api, setTimeout, clearTimeout, Date
  });
  const judge = new module.exports({ update: p => Object.assign(state, p), session: s => sessions.push(s) });
  return { judge, calls, sessions, state };
}
test('tutorial sends arbitrary wording to the server, with no local answer matching', async () => {
  const f = fixture(action => action === 'askQuestion' ? { status: 'succeeded', session: { messages: [{ answer: 'no' }] } } : undefined);
  await f.judge.connect();
  await f.judge.submit('askQuestion', '我换一种从没写进示例的问法？');
  const call = f.calls.find(c => c.action === 'askQuestion');
  assert.equal(call.args.text, '我换一种从没写进示例的问法？');
  assert.equal(call.args.sessionId, 'tutorial-only');
  assert.equal(f.sessions.at(-1).messages[0].answer, 'no');
  assert.equal(f.state.judgePending, false);
  f.judge.dispose();
});
test('missing AI configuration gates the tutorial before any session or paid request', async () => {
  const f = fixture(action => action === 'status' ? { textReady: false } : undefined);
  await f.judge.connect(); await f.judge.submit('askQuestion', 'x');
  assert.deepEqual(f.calls.map(c => c.action), ['status']);
  assert.equal(f.state.judgeReady, false);
  f.judge.dispose();
});
test('unknown results query the original ID and never render a previous verdict as the new answer', async () => {
  const stale = { messages: [{ text: 'old question', answer: 'yes' }] };
  const f = fixture(action => action === 'askQuestion' ? { status: 'unknown', session: stale }
    : action === 'getRequest' ? { status: 'succeeded', session: { messages: [{ text: 'new question', answer: 'no' }] } } : undefined);
  await f.judge.connect(); await f.judge.submit('askQuestion', 'new question');
  assert.equal(f.sessions.length, 1);
  await f.judge.submit('askQuestion', 'duplicate');
  await f.judge.check();
  assert.equal(f.calls.filter(c => c.action === 'askQuestion').length, 1);
  assert.equal(f.calls.find(c => c.action === 'getRequest').args.requestId, 'original-request');
  assert.equal(f.sessions.at(-1).messages[0].text, 'new question');
  assert.equal(f.state.judgePending, false);
  f.judge.dispose();
});
test('leaving the tutorial ignores a late verdict and clears its isolated session', async () => {
  let finish;
  const f = fixture(action => action === 'guessAnswer' ? new Promise(resolve => { finish = resolve; }) : undefined);
  await f.judge.connect(); const request = f.judge.submit('guessAnswer', '我的解释');
  f.judge.dispose(); finish({ status: 'succeeded', session: { solution: 'late solution' } });
  await request;
  assert.equal(f.sessions.length, 1);
  assert.equal(f.calls.filter(c => c.action === 'clearSession').length, 1);
});
test('an explicit retry checks the original result before issuing one replacement request', async () => {
  let attempts = 0;
  const f = fixture(action => action === 'askQuestion' ? (++attempts === 1 ? { status: 'unknown' } : { status: 'succeeded', session: { messages: [] } })
    : action === 'getRequest' ? { status: 'unknown' } : undefined);
  await f.judge.connect(); await f.judge.submit('askQuestion', '原来的问题');
  assert.equal(f.state.judgeCanRetry, true);
  await f.judge.retry();
  const calls = f.calls.filter(c => c.action === 'askQuestion');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.replaceRequestId, 'original-request');
  assert.equal(calls[1].args.requestId, 'replacement-request');
  assert.equal(calls[1].args.text, '原来的问题');
  assert.ok(f.calls.findIndex(c => c.action === 'getRequest') < f.calls.indexOf(calls[1]));
  f.judge.dispose();
});
test('expired tutorial sessions can reconnect instead of trapping the player behind a stale session', async () => {
  const f = fixture(action => action === 'askQuestion' ? Promise.reject({ code: 'SESSION_ENDED' }) : undefined);
  await f.judge.connect(); await f.judge.submit('askQuestion', '问题');
  assert.equal(f.state.judgeReady, false); assert.equal(f.state.judgePending, false);
  await f.judge.connect();
  assert.equal(f.calls.filter(c => c.action === 'startTutorial').length, 2);
  assert.equal(f.state.judgeReady, true);
  f.judge.dispose();
});
