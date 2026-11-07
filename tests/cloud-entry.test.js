'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, positiveLimit } = require('../cloudfunctions/game');
const { createCloudStore, missing } = require('../cloudfunctions/game/lib/store-cloud');

// Models the documented wx-server-sdk database shape, without cloud credentials.
function database() {
  const data = new Map();
  const db = {
    data, command: { gt: value => ({ greaterThan: value }) },
    runTransaction: async fn => fn(db),
    collection(name) {
      const bucket = data.get(name) || new Map(); data.set(name, bucket);
      return {
        cursor: '', count: 100,
        doc(id) { return {
          get: async () => ({ data: bucket.has(id) ? { _id: id, ...structuredClone(bucket.get(id)) } : null }),
          set: async ({ data: value }) => bucket.set(id, structuredClone(value)),
          remove: async () => bucket.delete(id)
        }; },
        orderBy() { return this; }, limit(count) { this.count = count; return this; },
        where(where) { this.cursor = where._id.greaterThan; return this; },
        async get() { return { data: [...bucket.entries()].sort(([a], [b]) => a.localeCompare(b))
          .filter(([id]) => id > this.cursor).slice(0, this.count).map(([id, value]) => ({ _id: id, ...structuredClone(value) })) }; }
      };
    }
  }; return db;
}
function setup({ uid = 'trusted-openid', suggest = 'pass' } = {}) {
  const db = database(); let fetches = 0; const checks = [];
  const context = { OPENID: uid, ENV: 'test-env' };
  const cloud = { database: () => db, getWXContext: () => context,
    openapi: { security: { msgSecCheck: async data => { checks.push(data); return { result: { suggest } }; } } } };
  const handler = createHandler({ cloud, env: { DASHSCOPE_API_KEY: 'server-only-secret', GAME_ENABLED: 'true' },
    fetchFn: async () => { fetches++; return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"intent":"yes_no","answer":"yes"}' } }] }) }; }
  });
  return { handler, db, context, checks, fetches: () => fetches };
}
test('entry ignores caller-supplied identity and only returns public session', async () => {
  const { handler, db, checks, fetches } = setup();
  const start = await handler({ action: 'startSolo', puzzleId: 'parking-ticket', userId: 'attacker' });
  assert.equal(start.ok, true); assert.equal(start.data.session.solution, undefined);
  const saved = db.data.get('sessions').get(start.data.session.id);
  assert.equal(saved.userId, 'trusted-openid');
  const answer = await handler({ action: 'askQuestion', sessionId: saved.id, requestId: 'test-request', text: '他买了电影票吗？', openid: 'attacker' });
  assert.equal(answer.data.answer, 'yes'); assert.equal(fetches(), 1);
  assert.equal(checks[0].openid, 'trusted-openid'); assert.equal(checks[0].version, 2);
  assert.ok(!JSON.stringify(answer).includes('server-only-secret'));
});
test('content-check review/block stops the paid model call', async () => {
  const { handler, fetches } = setup({ suggest: 'review' });
  const start = await handler({ action: 'startSolo', puzzleId: 'parking-ticket' });
  const answer = await handler({ action: 'askQuestion', sessionId: start.data.session.id, requestId: 'test-request', text: 'test' });
  assert.equal(answer.data.status, 'failed'); assert.equal(answer.data.error.code, 'CONTENT_BLOCKED'); assert.equal(fetches(), 0);
});
test('client Timer fields do not grant cleanup authority; unauthenticated calls are rejected', async () => {
  const { handler, context, db } = setup();
  const spoof = await handler({ Type: 'Timer', TriggerName: 'cleanup-hourly', action: 'cleanup' });
  assert.equal(spoof.ok, false); assert.equal(spoof.error.code, 'INVALID_ACTION');
  context.OPENID = undefined;
  const unauthorized = await handler({ action: 'status', OPENID: 'injected' });
  assert.equal(unauthorized.error.code, 'AUTH_REQUIRED');
  const wrong = await handler({ Type: 'Timer', TriggerName: 'arbitrary' });
  assert.equal(wrong.error.code, 'AUTH_REQUIRED');
  const timer = await handler({ Type: 'Timer', TriggerName: 'cleanup-hourly' });
  assert.equal(timer.ok, true); assert.equal(timer.data.pendingUploads, 0);
  assert.ok(db.data.has('sessions'));
});
test('cloud store strips document metadata and scans all pages', async () => {
  const db = database(), store = createCloudStore(db);
  const value = await store.transaction(async tx => { await tx.set('samples', '001', { _id: 'ignored', value: 1 }); return tx.get('samples', '001'); });
  assert.deepEqual(value, { value: 1 });
  for (let i = 2; i <= 102; i++) await store.set('samples', String(i).padStart(3, '0'), { value: i });
  const rows = await store.scan('samples'); assert.equal(rows.length, 102); assert.equal(rows[101].id, '102');
  await store.delete('samples', '001'); assert.equal(await store.get('samples', '001'), null);
});
test('missing collection errors are not swallowed and configured quotas can only be lowered', () => {
  assert.equal(missing(new Error('document does not exist')), true);
  assert.equal(missing(new Error('document.get:fail document with _id collection does not exist')), true);
  assert.equal(missing(new Error('collection does not exist')), false);
  assert.equal(positiveLimit('20', 100), 20); assert.equal(positiveLimit('100000', 100), 100);
  assert.equal(positiveLimit('-1', 100), 100); assert.equal(positiveLimit('NaN', 100), 100);
});
