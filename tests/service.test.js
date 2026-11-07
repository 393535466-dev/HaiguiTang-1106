'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../cloudfunctions/game/lib/service');
const { createMemoryStore } = require('../cloudfunctions/game/lib/store-memory');
const DAY = 86400000;
const puzzle = { id: 'lift', version: 1, title: '电梯', difficulty: '入门', teaser: '一段小故事',
  surface: '他到家前会换一条路。为什么？', solution: 'SECRET_SOLUTION',
  facts: ['SECRET_FACT'], requiredPoints: ['SECRET_REQUIRED'], hints: ['提示一', '提示二', '提示三'] };
function fixture(options = {}) {
  const store = createMemoryStore();
  let time = Date.UTC(2026, 10, 6), next = 0, calls = 0, voiceCalls = 0;
  const removed = [];
  const provider = { ready: () => ({ textReady: true, voiceReady: true }),
    judge: async () => { calls++; return { answer: 'yes', usage: { inputTokens: 30, outputTokens: 4 } }; },
    transcribe: async () => { voiceCalls++; return { text: '他在电梯里吗？' }; }, ...options.provider };
  const audio = { inspect: async () => ({ buffer: Buffer.from('mp3'), durationSeconds: 6 }),
    remove: async id => removed.push(id), removeByPath: async path => removed.push(path), ...options.audio };
  const service = createService({ store, provider, audio, puzzles: [puzzle], clock: () => time,
    idFactory: () => `id-${++next}`, limits: options.limits });
  const handle = (action, data = {}, uid = 'alice') => service.handle(action, data, uid);
  const start = async (uid = 'alice') => (await handle('startSolo', { puzzleId: 'lift' }, uid)).data.session;
  return { service, store, handle, start, removed, get calls() { return calls; }, get voiceCalls() { return voiceCalls; },
    advance(ms) { time += ms; } };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(setImmediate); }
  throw new Error('did not reach pending call');
}
test('list and playing session never expose solution, canonical facts or caller identity', async () => {
  const f = fixture();
  const list = await f.handle('listPuzzles');
  const s = await f.start();
  const serialized = JSON.stringify([list, s]);
  for (const hidden of ['SECRET_SOLUTION', 'SECRET_FACT', 'SECRET_REQUIRED', 'alice', 'puzzle":'])
    assert.equal(serialized.includes(hidden), false, hidden);
  assert.equal((await f.handle('status')).data.ownerKey.length, 24);
  assert.equal((await f.handle('getSession', { sessionId: s.id }, 'bob')).error.code, 'NOT_FOUND');
  assert.equal((await f.handle('revealSoup', { sessionId: s.id }, 'bob')).error.code, 'NOT_FOUND');
});
test('missing provider config blocks paid call without consuming attempts', async () => {
  const f = fixture({ provider: { ready: () => ({ textReady: false, voiceReady: false }) } });
  const s = await f.start();
  const r = await f.handle('askQuestion', { sessionId: s.id, requestId: 'r1', text: '是吗？' });
  assert.equal(r.error.code, 'CONFIG_REQUIRED');
  assert.equal((await f.store.scan('requests')).length, 0);
  assert.equal((await f.handle('getSession', { sessionId: s.id })).data.session.attempts, 0);
});
test('free starts enforce a per-user daily cap without leaving rejected sessions', async () => {
  const f = fixture({ limits: { userDaily: 2 } });
  await f.start(); await f.start();
  const third = await f.handle('startSolo', { puzzleId: 'lift' });
  assert.equal(third.error.code, 'DAILY_LIMIT');
  assert.equal((await f.store.scan('sessions')).length, 2);
  const totals = (await f.store.scan('usage')).find(v => v.id.startsWith('global-'));
  assert.equal(totals.starts, 2);
});
test('concurrent free starts reserve the final global slot atomically', async () => {
  const f = fixture();
  await f.store.transaction(tx => tx.set('usage', 'global-2026-11-06', { starts: 499, expiresAt: Date.UTC(2027, 0, 1) }));
  const results = await Promise.all([
    f.handle('startSolo', { puzzleId: 'lift' }, 'alice'),
    f.handle('startSolo', { puzzleId: 'lift' }, 'bob')
  ]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => !r.ok).error.code, 'DAILY_LIMIT');
  assert.equal((await f.store.scan('sessions')).length, 1);
  assert.equal((await f.store.scan('usage')).find(v => v.id === 'global-2026-11-06').starts, 500);
});
test('same request ID is idempotent; different contents conflict', async () => {
  const f = fixture(), s = await f.start();
  const input = { sessionId: s.id, requestId: 'question1', text: '是吗？' };
  const first = await f.handle('askQuestion', input), again = await f.handle('askQuestion', input);
  assert.equal(first.data.answer, 'yes'); assert.equal(again.data.answer, 'yes'); assert.equal(f.calls, 1);
  assert.equal(first.data.session.attempts, 1); assert.equal(first.data.session.questionCount, 1);
  assert.equal((await f.handle('askQuestion', { ...input, text: '不是吗？' })).error.code, 'REQUEST_CONFLICT');
});
test('same session only allows one active operation', async () => {
  const d = deferred(); let invoked = 0;
  const f = fixture({ provider: { judge: async () => { invoked++; return d.promise; } } }), s = await f.start();
  const pending = f.handle('askQuestion', { sessionId: s.id, requestId: 'first', text: '先问？' });
  await waitFor(() => invoked === 1);
  const blocked = await f.handle('askQuestion', { sessionId: s.id, requestId: 'second', text: '再问？' });
  assert.equal(blocked.error.code, 'BUSY');
  d.resolve({ answer: 'no' }); await pending;
  assert.equal((await f.handle('getSession', { sessionId: s.id })).data.session.attempts, 1);
});
test('global 499 boundary atomically reserves only one of two concurrent calls', async () => {
  const f = fixture(), a = await f.start('alice'), b = await f.start('bob');
  await f.store.transaction(tx => tx.set('usage', 'global-2026-11-06', { judge: 499, createdAt: 0, expiresAt: Date.UTC(2027, 0, 1) }));
  const answers = await Promise.all([
    f.handle('askQuestion', { sessionId: a.id, requestId: 'a1', text: '是吗？' }, 'alice'),
    f.handle('askQuestion', { sessionId: b.id, requestId: 'b1', text: '是吗？' }, 'bob')
  ]);
  assert.equal(answers.filter(r => r.ok).length, 1);
  assert.equal(answers.find(r => !r.ok).error.code, 'DAILY_LIMIT'); assert.equal(f.calls, 1);
  const usage = (await f.store.scan('usage')).find(v => v.id === 'global-2026-11-06');
  assert.equal(usage.judge, 500); assert.equal(usage.inputTokens, 30);
});
test('session call cap counts failed paid attempts, independently of effective questions', async () => {
  const f = fixture({ limits: { sessionJudge: 1 }, provider: { judge: async () => { throw Object.assign(new Error('private provider error'), { code: 'BAD_RESPONSE' }); } } });
  const s = await f.start();
  const r = await f.handle('askQuestion', { sessionId: s.id, requestId: 'r1', text: '问题？' });
  assert.equal(r.data.status, 'failed'); assert.equal(r.data.session.questionCount, 0); assert.equal(r.data.session.attempts, 1);
  assert.equal(JSON.stringify(r).includes('private provider error'), false);
  assert.equal((await f.handle('askQuestion', { sessionId: s.id, requestId: 'r2', text: '重问？' })).error.code, 'SESSION_LIMIT');
});
test('unknown old result cannot overwrite explicitly replaced request', async () => {
  const d = deferred(); let calls = 0;
  const f = fixture({ provider: { judge: async () => ++calls === 1 ? d.promise : { answer: 'no' } } }), s = await f.start();
  const old = f.handle('askQuestion', { sessionId: s.id, requestId: 'old', text: '旧问题？' });
  await waitFor(() => calls === 1); f.advance(31000);
  const queried = await f.handle('getRequest', { sessionId: s.id, requestId: 'old' });
  assert.equal(queried.data.status, 'unknown');
  const rejected = await f.handle('askQuestion', { sessionId: s.id, requestId: 'new0', text: '新问题？' });
  assert.equal(rejected.error.code, 'RESULT_UNKNOWN');
  const fresh = await f.handle('askQuestion', { sessionId: s.id, requestId: 'new', replaceRequestId: 'old', text: '新问题？' });
  assert.equal(fresh.data.answer, 'no');
  d.resolve({ answer: 'yes' }); const late = await old;
  assert.equal(late.data.status, 'superseded');
  const restored = (await f.handle('getSession', { sessionId: s.id })).data.session;
  assert.deepEqual(restored.messages.map(m => m.id), ['new']); assert.equal(restored.attempts, 2);
});
test('network errors are unknown; same request never repeats the provider call', async () => {
  let calls = 0;
  const f = fixture({ provider: { judge: async () => { calls++; throw Object.assign(new Error('socket'), { code: 'NETWORK_ERROR' }); } } });
  const s = await f.start(), args = { sessionId: s.id, requestId: 'network', text: '问题？' };
  assert.equal((await f.handle('askQuestion', args)).data.status, 'unknown');
  assert.equal((await f.handle('askQuestion', args)).data.status, 'unknown'); assert.equal(calls, 1);
});
test('known provider failures expose only approved static recovery messages', async () => {
  const codes = ['CONTENT_CHECK_UNAVAILABLE', 'CONTENT_BLOCKED', 'CONTEXT_LIMIT', 'PROVIDER_AUTH', 'RATE_LIMITED'];
  for (const code of codes) {
    const f = fixture({ provider: { judge: async () => { throw Object.assign(new Error('PRIVATE_UPSTREAM_RESPONSE'), { code }); } } });
    const s = await f.start();
    const result = await f.handle('askQuestion', { sessionId: s.id, requestId: 'failed', text: '问题？' });
    assert.equal(result.data.status, 'failed'); assert.equal(result.data.error.code, code);
    assert.equal(JSON.stringify(result).includes('PRIVATE_UPSTREAM_RESPONSE'), false);
    assert.ok(result.data.error.message.length > 5);
  }
});
test('actual request deadline returns unknown and does not grant a second provider dispatch', async () => {
  const d = deferred(); let calls = 0;
  const f = fixture({ limits: { requestTimeoutMs: 5 }, provider: { judge: async () => { calls++; return d.promise; } } });
  const s = await f.start(), args = { sessionId: s.id, requestId: 'deadline', text: '超时问题？' };
  const timed = await f.handle('askQuestion', args);
  assert.equal(timed.data.status, 'unknown'); assert.equal(timed.data.session.attempts, 1);
  assert.equal((await f.handle('askQuestion', args)).data.status, 'unknown'); assert.equal(calls, 1);
  d.resolve({ answer: 'yes' }); await new Promise(setImmediate);
  assert.equal((await f.handle('getSession', { sessionId: s.id })).data.session.messages.length, 0);
});
test('clear invalidates in-flight write and deletes all request body snapshots', async () => {
  const d = deferred(); let called = false;
  const f = fixture({ provider: { judge: async () => { called = true; return d.promise; } } }), s = await f.start();
  const pending = f.handle('askQuestion', { sessionId: s.id, requestId: 'pending', text: 'PRIVATE_QUESTION' });
  await waitFor(() => called);
  assert.equal((await f.handle('clearSession', { sessionId: s.id })).data.cleared, true);
  d.resolve({ answer: 'yes' }); assert.equal((await pending).data.status, 'superseded');
  assert.equal((await f.store.scan('requests')).length, 0);
  assert.equal(JSON.stringify(await f.store.scan('sessions')).includes('PRIVATE_QUESTION'), false);
  assert.equal((await f.store.scan('sessions')).length, 0);
  assert.equal((await f.handle('getSession', { sessionId: s.id })).error.code, 'NOT_FOUND');
});
test('hints cap at three and reveal is only possible for the owner', async () => {
  const f = fixture(), s = await f.start();
  await Promise.all(Array.from({ length: 5 }, () => f.handle('getHint', { sessionId: s.id })));
  assert.equal((await f.handle('getSession', { sessionId: s.id })).data.session.hintCount, 3);
  const reveal = await f.handle('revealSoup', { sessionId: s.id });
  assert.equal(reveal.data.session.solution, 'SECRET_SOLUTION');
  assert.equal((await f.handle('askQuestion', { sessionId: s.id, requestId: 'post-reveal', text: '问题？' })).error.code, 'SESSION_ENDED');
});
test('effective question cap reveals the solution once, after the last valid verdict', async () => {
  const answers = ['yes', 'clarify', 'unspecified', 'no'];
  let calls = 0;
  const f = fixture({ limits: { questionLimit: 2 }, provider: { judge: async () => {
    calls++;
    return { answer: answers.shift() };
  } } });
  const session = await f.start();
  assert.equal(session.maxQuestions, 2);
  const ask = requestId => f.handle('askQuestion', { sessionId: session.id, requestId, text: '是这样吗？' });

  for (const id of ['first', 'clarify', 'unspecified']) {
    const { data } = await ask(id);
    assert.equal(data.session.questionCount, 1);
    assert.equal(data.session.state, 'playing');
    assert.equal(data.session.solution, undefined);
  }

  const { data: last } = await ask('last');
  assert.equal(last.answer, 'no');
  assert.equal(last.session.questionCount, 2);
  assert.equal(last.session.attempts, 4);
  assert.equal(last.session.state, 'revealed');
  assert.equal(last.session.solution, 'SECRET_SOLUTION');
  assert.deepEqual((await ask('last')).data.session, last.session);
  assert.equal((await ask('after-limit')).error.code, 'SESSION_ENDED');
  assert.equal(calls, 4);
});
test('sessions created before the question cap keep their manual reveal rule', async () => {
  const f = fixture({ limits: { questionLimit: 1 } });
  const session = await f.start();
  await f.store.transaction(async tx => {
    const oldSession = await tx.get('sessions', session.id);
    delete oldSession.maxQuestions;
    await tx.set('sessions', session.id, oldSession);
  });
  const { data } = await f.handle('askQuestion', { sessionId: session.id, requestId: 'old', text: '是吗？' });
  assert.equal(data.session.maxQuestions, null);
  assert.equal(data.session.state, 'playing');
  assert.equal(data.session.solution, undefined);
});
test('incomplete and uncertain guesses do not consume failure opportunities', async () => {
  const answers = ['incomplete', 'uncertain', 'incorrect', 'solved'];
  const f = fixture({ provider: { judge: async () => ({ answer: answers.shift() }) } }), s = await f.start();
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await f.handle('guessAnswer', { sessionId: s.id, requestId: `guess-${i}`, text: '完整猜底' }));
  assert.deepEqual(results.map(r => r.data.session.guessFailures), [0,0,1,1]);
  assert.equal(results[3].data.session.state, 'solved'); assert.equal(results[3].data.session.solution, 'SECRET_SOLUTION');
});
test('out-of-enum response fails without becoming an answer or exposing model text', async () => {
  const f = fixture({ provider: { judge: async () => ({ answer: 'SECRET_SOLUTION', reason: 'internal' }) } }), s = await f.start();
  const r = await f.handle('askQuestion', { sessionId: s.id, requestId: 'bad-output', text: '告诉我答案' });
  assert.equal(r.data.status, 'failed'); assert.equal(r.data.session.messages.length, 0);
  assert.equal(JSON.stringify(r).includes('SECRET_SOLUTION'), false);
});
test('registered audio ownership, confirmed path, successful transcript and deletion', async () => {
  const f = fixture(), s = await f.start(), u = (await f.handle('registerUpload', { sessionId: s.id })).data;
  const fileID = `cloud://environment.bucket/${u.cloudPath}`;
  assert.equal((await f.handle('confirmUpload', { sessionId: s.id, uploadId: u.uploadId, fileID })).data.confirmed, true);
  const args = { sessionId: s.id, requestId: 'voice1', uploadId: u.uploadId, fileID };
  const badOwner = await f.handle('transcribeAudio', args, 'bob'); assert.equal(badOwner.error.code, 'NOT_FOUND');
  const r = await f.handle('transcribeAudio', args); assert.equal(r.data.transcript, '他在电梯里吗？');
  assert.deepEqual(f.removed, [fileID]); assert.equal((await f.store.scan('uploads')).length, 0);
  const again = await f.handle('transcribeAudio', args); assert.equal(again.data.transcript, r.data.transcript); assert.equal(f.voiceCalls, 1);
  const usage = (await f.store.scan('usage')).find(v => v.id.startsWith('global-'));
  assert.equal(usage.reservedAudioSeconds, 6); assert.equal(usage.completedAudioSeconds, 6);
});
test('server inspected duration and exact upload path reject audio before charging ASR', async () => {
  const f = fixture({ audio: { inspect: async () => ({ buffer: Buffer.from('mp3'), durationSeconds: 21 }) } }), s = await f.start();
  const u = (await f.handle('registerUpload', { sessionId: s.id })).data;
  const badPath = await f.handle('transcribeAudio', { sessionId: s.id, requestId: 'voice0', uploadId: u.uploadId, fileID: 'https://evil/audio.mp3' });
  assert.equal(badPath.error.code, 'INVALID_UPLOAD');
  const long = await f.handle('transcribeAudio', { sessionId: s.id, requestId: 'voice1', uploadId: u.uploadId, fileID: `cloud://env.bucket/${u.cloudPath}` });
  assert.equal(long.error.code, 'INVALID_AUDIO'); assert.equal(f.voiceCalls, 0);
  assert.equal((await f.store.scan('requests')).length, 0);
});
test('an empty recognition reports a re-record prompt and removes the unusable upload', async () => {
  const f = fixture({ provider: { transcribe: async () => {
    throw Object.assign(new Error('private provider response'), { code: 'EMPTY_TRANSCRIPT' });
  } } });
  const session = await f.start();
  const { data: upload } = await f.handle('registerUpload', { sessionId: session.id });
  const fileID = 'cloud://environment.bucket/' + upload.cloudPath;
  const { data } = await f.handle('transcribeAudio', {
    sessionId: session.id, requestId: 'silent-audio', uploadId: upload.uploadId, fileID
  });
  assert.equal(data.status, 'failed');
  assert.equal(data.error.code, 'EMPTY_TRANSCRIPT');
  assert.match(data.error.message, /重录/);
  assert.equal(data.session.activeRequestId, null);
  assert.equal(data.session.questionCount, 0);
  assert.deepEqual(f.removed, [fileID]);
});
test('audio usage records exact inspected duration without trusting the client', async () => {
  const f = fixture({ audio: { inspect: async () => ({ buffer: Buffer.from('mp3'), durationSeconds: 19.984 }) } });
  const s = await f.start(), u = (await f.handle('registerUpload', { sessionId: s.id })).data;
  const result = await f.handle('transcribeAudio', { sessionId: s.id, requestId: 'padded', uploadId: u.uploadId,
    fileID: `cloud://env.bucket/${u.cloudPath}` });
  assert.equal(result.data.status, 'succeeded');
  assert.equal(result.data.usage.audioSeconds, 19.984);
  const totals = (await f.store.scan('usage')).find(v => v.id.startsWith('global-'));
  assert.equal(totals.reservedAudioSeconds, 19.984);
});
test('invalid audio cannot bypass the independent pre-download inspection quota', async () => {
  let downloads = 0;
  const f = fixture({ limits: { userDaily: 2 }, audio: { inspect: async () => {
    downloads++; return { buffer: Buffer.from('mp3'), durationSeconds: 21 };
  } } });
  const s = await f.start(), u = (await f.handle('registerUpload', { sessionId: s.id })).data;
  const args = { sessionId: s.id, uploadId: u.uploadId, fileID: `cloud://env.bucket/${u.cloudPath}` };
  for (let i = 0; i < 2; i++) assert.equal((await f.handle('transcribeAudio', { ...args, requestId: `bad-${i}` })).error.code, 'INVALID_AUDIO');
  assert.equal((await f.handle('transcribeAudio', { ...args, requestId: 'over' })).error.code, 'DAILY_LIMIT');
  assert.equal(downloads, 2); assert.equal(f.voiceCalls, 0);
  const totals = (await f.store.scan('usage')).find(v => v.id.startsWith('global-'));
  assert.equal(totals.audioInspections, 2); assert.equal(totals.asr, undefined);
});
test('only one concurrent audio inspection can reserve the final global download slot', async () => {
  let downloads = 0;
  const f = fixture({ audio: { inspect: async () => { downloads++; return { buffer: Buffer.from('mp3'), durationSeconds: 6 }; } } });
  const sessions = await Promise.all(['alice', 'bob'].map(uid => f.start(uid)));
  const uploads = await Promise.all(sessions.map((s, i) => f.handle('registerUpload', { sessionId: s.id }, ['alice', 'bob'][i])));
  await f.store.transaction(tx => tx.set('usage', 'global-2026-11-06', { audioInspections: 499, expiresAt: Date.UTC(2027, 0, 1) }));
  const results = await Promise.all(sessions.map((s, i) => f.handle('transcribeAudio', { sessionId: s.id,
    requestId: `voice-${i}`, uploadId: uploads[i].data.uploadId,
    fileID: `cloud://env.bucket/${uploads[i].data.cloudPath}` }, ['alice', 'bob'][i])));
  assert.equal(downloads, 1); assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => !r.ok).error.code, 'DAILY_LIMIT');
});
test('expiry invalidates history; cleanup removes body requests, pending uploads and aged metrics', async () => {
  const f = fixture(), s = await f.start();
  await f.handle('askQuestion', { sessionId: s.id, requestId: 'history', text: 'PRIVATE_HISTORY' });
  const u = (await f.handle('registerUpload', { sessionId: s.id })).data;
  f.advance(8 * DAY);
  const stats = await f.service.cleanup(); assert.equal(stats.sessions, 1);
  assert.equal((await f.store.scan('requests')).length, 0); assert.equal((await f.store.scan('uploads')).length, 0);
  assert.ok(f.removed.includes(u.cloudPath)); assert.equal(JSON.stringify(await f.store.scan('sessions')).includes('PRIVATE_HISTORY'), false);
  assert.equal((await f.store.scan('sessions')).length, 0);
  assert.equal((await f.handle('getSession', { sessionId: s.id })).error.code, 'NOT_FOUND');
  f.advance(23 * DAY); await f.service.cleanup(); assert.equal((await f.store.scan('usage')).length, 0);
});
test('upload expiry reserves an hour for cleanup within the normal 24-hour retention target', async () => {
  const f = fixture(), s = await f.start();
  const u = (await f.handle('registerUpload', { sessionId: s.id })).data;
  const record = (await f.store.scan('uploads'))[0];
  assert.equal(record.expiresAt - record.createdAt, 23 * 3600000);
  f.advance(23 * 3600000 - 1);
  assert.equal((await f.service.cleanup()).uploads, 0);
  f.advance(1);
  assert.equal((await f.service.cleanup()).uploads, 1);
  assert.equal((await f.store.scan('uploads')).length, 0);
  assert.ok(f.removed.includes(u.cloudPath));
});
test('transaction failure rolls back quota pre-reservations', async () => {
  const f = fixture(), s = await f.start();
  const user = (await f.store.scan('usage')).find(v => v.id.startsWith('user-'));
  await f.store.transaction(async tx => {
    await tx.set('usage', user.id, { ...user, judge: 100 });
  });
  const r = await f.handle('askQuestion', { sessionId: s.id, requestId: 'over', text: '问题？' });
  assert.equal(r.error.code, 'DAILY_LIMIT'); assert.equal((await f.store.scan('requests')).length, 0);
  const totals = (await f.store.scan('usage')).find(v => v.id.startsWith('global-'));
  assert.equal(totals.starts, 1); assert.equal(totals.judge, undefined);
});
