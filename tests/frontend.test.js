'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const miniRoot = path.resolve(__dirname, '../miniprogram');
const source = file => fs.readFileSync(path.join(miniRoot, file), 'utf8');
const presentation = require('../miniprogram/utils/presentation');
const sessionID = 'frontend-session';
const playing = extra => ({ id: sessionID, title: '测试故事', state: 'playing', messages: [], hints: [], expiresAt: Date.now() + 86400000, ...extra });
const failure = code => Object.assign(new Error(code), { code });

function gameFixture(call = async () => { throw new Error('Unexpected API call'); }) {
  const local = new Map();
  const app = { globalData: { ownerKey: 'frontend-owner' } };
  const wx = {
    getStorageSync: key => local.has(key) ? structuredClone(local.get(key)) : null,
    setStorageSync: (key, value) => local.set(key, structuredClone(value)),
    removeStorageSync: key => local.delete(key),
    showToast() {}
  };
  const storageModule = { exports: {} };
  vm.runInNewContext(source('utils/storage.js'), { module: storageModule, wx, getApp: () => app, Date });
  const storage = storageModule.exports;
  const api = { call, message: error => error.message, requestId: () => 'new-request' };
  let definition;
  vm.runInNewContext(source('pages/game/index.js'), {
    Page: value => { definition = value; },
    require: name => name.endsWith('/api') ? api : name.endsWith('/storage') ? storage : presentation,
    wx, getApp: () => app, getCurrentPages: () => [], Date, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  const page = { ...definition, data: structuredClone(definition.data),
    _alive: true, _visible: false, _sessionId: sessionID, _draftVersion: 0,
    setData(patch) { Object.assign(this.data, patch); } };
  page.data.session = playing();
  return { page, storage, local, wx };
}

test('game releases recorder listeners while a tutorial or another page is visible', () => {
  const { page, wx } = gameFixture();
  const starts = new Set(), stops = new Set(), errors = new Set();
  wx.getRecorderManager = () => ({ onStart: f => starts.add(f), offStart: f => starts.delete(f),
    onStop: f => stops.add(f), offStop: f => stops.delete(f), onError: f => errors.add(f), offError: f => errors.delete(f) });
  page._bindRecorder();
  assert.equal(starts.size, 1);
  page.onHide(); assert.equal(starts.size, 0); assert.equal(stops.size, 0);
  page.onShow(); page.onShow(); assert.equal(starts.size, 1);
  page.onUnload(); assert.equal(starts.size, 0); assert.equal(errors.size, 0);
});

test('client timeout dispatches once and accepts the original late response without retrying', async () => {
  let resolveCloud, dispatches = 0, fireTimeout, late;
  const module = { exports: {} };
  vm.runInNewContext(source('utils/api.js'), {
    module,
    require: () => ({ cloudEnv: 'configured-test-env', functionName: 'game' }),
    wx: { cloud: { callFunction() { dispatches++; return new Promise(resolve => { resolveCloud = resolve; }); } } },
    setTimeout: callback => { fireTimeout = callback; return 1; }, clearTimeout() {}, Date, Math, Error, Promise
  });
  const request = module.exports.call('askQuestion', { requestId: 'original' }, { onLate: (error, result) => { late = { error, result }; } });
  const timedOut = assert.rejects(request, error => error.code === 'CLIENT_TIMEOUT');
  fireTimeout();
  await timedOut;
  assert.equal(dispatches, 1);
  resolveCloud({ result: { ok: true, data: { status: 'succeeded', answer: 'yes' } } });
  await new Promise(setImmediate);
  assert.equal(late.error, null);
  assert.equal(late.result.answer, 'yes');
  assert.equal(dispatches, 1);
});

test('slow bootstrap can finish after 20 seconds without extending or retrying a paid question', async () => {
  const module = { exports: {} }, timers = new Map(), pending = new Map(); let id = 0, calls = 0;
  vm.runInNewContext(source('utils/api.js'), {
    module, require: () => ({ cloudEnv: 'configured-test-env', functionName: 'game' }),
    wx: { cloud: { callFunction({ data }) { calls++; return new Promise(resolve => pending.set(data.action, resolve)); } } },
    setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    clearTimeout: key => timers.delete(key), Date, Math, Error, Promise
  });
  const status = module.exports.call('status');
  const question = module.exports.call('askQuestion', { requestId: 'one-paid-call' });
  const timeout = assert.rejects(question, error => error.code === 'CLIENT_TIMEOUT');
  for (const timer of [...timers.values()]) if (timer.delay <= 20000) timer.callback();
  await timeout;
  pending.get('status')({ result: { ok: true, data: { textReady: true } } });
  assert.equal((await status).textReady, true);
  assert.equal(calls, 2, 'no automatic duplicate question or bootstrap request');
});

test('late transcription preserves a draft edited while speech recognition was running', async () => {
  const { page, storage } = gameFixture();
  page._setPending({ requestId: 'voice-request', kind: 'transcribeAudio', draftVersion: 0 });
  page.onInput({ detail: { value: '识别等待时新写的问题' } });
  await page._applyRequest('voice-request', { status: 'succeeded', transcript: '较早的录音文字' });
  assert.equal(page.data.draft, '识别等待时新写的问题');
  assert.equal(page.data.recoveredTranscript, '较早的录音文字');
  assert.equal(storage.draft(sessionID).text, '识别等待时新写的问题');
  assert.equal(storage.pending(sessionID), null);
  assert.equal(page.data.busy, false);
});
test('an empty recognition can be replaced without overwriting the current draft', async () => {
  const { page, storage } = gameFixture();
  page._setPending({ requestId: 'no-speech', kind: 'transcribeAudio', draftVersion: 0 });
  page.onInput({ detail: { value: '已经写好的问题' } });
  await page._applyRequest('no-speech', { status: 'failed', error: { code: 'EMPTY_TRANSCRIPT', message: '请重录或打字' } });
  assert.equal(page.data.error, '请重录或打字');
  assert.equal(page.data.draft, '已经写好的问题');
  assert.equal(page.data.busy, false);
  assert.equal(storage.pending(sessionID), null);
});

test('transcription with no newer edit is restored as an editable draft', async () => {
  const { page, storage } = gameFixture();
  page._setPending({ requestId: 'voice-request', kind: 'transcribeAudio', draftVersion: 0 });
  await page._applyRequest('voice-request', { status: 'succeeded', transcript: '请我确认的识别文字' });
  assert.equal(page.data.draft, '请我确认的识别文字');
  assert.equal(page.data.draftSource, 'voice');
  assert.equal(storage.draft(sessionID).text, '请我确认的识别文字');
});

test('a response for an old ID cannot replace a newer pending request', async () => {
  const { page } = gameFixture();
  page._setPending({ requestId: 'newer', kind: 'askQuestion', draftVersion: 0 });
  await page._applyRequest('older', { status: 'succeeded', answer: 'yes', session: playing({ messages: [{ id: 'older' }] }) });
  assert.equal(page._pending.requestId, 'newer');
  assert.equal(page.data.session.messages.length, 0);
});

test('BUSY restores the original active request and keeps the newer draft without another paid dispatch', async () => {
  const calls = [];
  const { page, storage } = gameFixture(async (action, payload) => {
    calls.push({ action, payload });
    if (action === 'askQuestion') throw failure('BUSY');
    if (action === 'getSession') return { session: playing({ activeRequestId: 'original-request' }) };
    if (action === 'getRequest') return { requestId: payload.requestId, status: 'unknown' };
    throw new Error('Unexpected API action: ' + action);
  });
  page._setPending({ requestId: 'original-request', kind: 'askQuestion', text: '原来的问题', draftVersion: 0, status: 'unknown', createdAt: Date.now() });
  page.onInput({ detail: { value: '保留这份新的草稿' } });
  await page._judge({ kind: 'askQuestion', text: page.data.draft, replaceRequestId: 'original-request' });
  await new Promise(setImmediate);
  assert.equal(page._pending.requestId, 'original-request');
  assert.equal(page._pending.kind, 'askQuestion');
  assert.equal(page._pending.text, '原来的问题');
  assert.equal(storage.pending(sessionID).requestId, 'original-request');
  assert.equal(page.data.draft, '保留这份新的草稿');
  assert.equal(calls.filter(item => item.action === 'askQuestion').length, 1);
  assert.equal(calls.find(item => item.action === 'getRequest').payload.requestId, 'original-request');
});

for (const code of ['NOT_FOUND', 'SESSION_ENDED']) {
  test(code + ' removes the stale session, local continuation, draft and pending request', async () => {
    const { page, storage } = gameFixture(async () => { throw failure(code); });
    storage.saveLast(sessionID);
    page.onInput({ detail: { value: '已失效会话的草稿' } });
    page._setPending({ requestId: 'old-request', kind: 'askQuestion' });
    await page.reload();
    assert.equal(page.data.session, null);
    assert.equal(page.data.draft, '');
    assert.equal(storage.lastSession(), '');
    assert.equal(storage.draft(sessionID), null);
    assert.equal(storage.pending(sessionID), null);
    page.onHide();
    assert.equal(storage.draft(sessionID), null, 'leaving the missing session must not recreate a deleted draft');
  });
}

test('ordinary network failure preserves the current session and local draft for recovery', async () => {
  const { page, storage } = gameFixture(async () => { throw failure('NETWORK_ERROR'); });
  storage.saveLast(sessionID);
  page.onInput({ detail: { value: '网络恢复后还要继续的问题' } });
  page._setPending({ requestId: 'pending-request', kind: 'askQuestion' });
  await page.reload();
  assert.equal(page.data.session.id, sessionID);
  assert.equal(storage.lastSession(), sessionID);
  assert.equal(storage.draft(sessionID).text, '网络恢复后还要继续的问题');
  assert.equal(storage.pending(sessionID).requestId, 'pending-request');
});

test('local retention removes seven-day drafts and pending text for all owners without touching unrelated keys', () => {
  const now = Date.UTC(2026, 10, 6), old = now - 7 * 86400000;
  const entries = new Map([
    ['hgt:alice:draft:old', { text: 'expired private draft', savedAt: old }],
    ['hgt:bob:pending:old', { text: 'expired private request', createdAt: old }],
    ['hgt:alice:pending:read-expired', { text: 'expired on access', createdAt: old }],
    ['hgt:alice:pending:legacy', { text: 'missing retention timestamp' }],
    ['hgt:alice:draft:current', { text: 'current draft', savedAt: now - 1000 }],
    ['hgt:bob:pending:current', { text: 'current request', createdAt: now - 1000 }],
    ['hgt:alice:last', 'old-session'],
    ['hgt:muted', true],
    ['other-app:alice:draft:old', { savedAt: old }]
  ]);
  const module = { exports: {} };
  vm.runInNewContext(source('utils/storage.js'), {
    module, Date: { now: () => now }, getApp: () => ({ globalData: { ownerKey: 'alice' } }),
    wx: { getStorageInfoSync: () => ({ keys: Array.from(entries.keys()) }),
      getStorageSync: key => entries.get(key), removeStorageSync: key => entries.delete(key) }
  });
  assert.equal(module.exports.pending('read-expired'), null);
  assert.equal(entries.has('hgt:alice:pending:read-expired'), false);
  module.exports.purgeExpired();
  assert.deepEqual(Array.from(entries.keys()).sort(), [
    'hgt:alice:draft:current', 'hgt:alice:last', 'hgt:bob:pending:current', 'hgt:muted', 'other-app:alice:draft:old'
  ].sort());
});
