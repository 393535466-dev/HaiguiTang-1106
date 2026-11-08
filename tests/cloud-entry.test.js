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
        cursor: '', count: 100, filters: {}, orders: [],
        doc(id) { return {
          get: async () => ({ data: bucket.has(id) ? { _id: id, ...structuredClone(bucket.get(id)) } : null }),
          set: async ({ data: value }) => bucket.set(id, structuredClone(value)),
          remove: async () => bucket.delete(id)
        }; },
        orderBy(field, direction) { this.orders.push([field, direction]); return this; }, limit(count) { this.count = count; return this; },
        where(where) { if (where._id) this.cursor = where._id.greaterThan; else this.filters = where; return this; },
        async get() { return { data: [...bucket.entries()].map(([id, value]) => ({ _id: id, ...structuredClone(value) }))
          .filter(row => row._id > this.cursor && Object.entries(this.filters).every(([key, value]) => row[key] === value))
          .sort((a,b) => { for (const [key,direction] of this.orders) { const difference = typeof a[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key])); if (difference) return direction === 'desc' ? -difference : difference; } return 0; }).slice(0, this.count) }; }
      };
    }
  }; return db;
}
function setup({ uid = 'trusted-openid', suggest = 'pass' } = {}) {
  const db = database(); let fetches = 0, judgment = { intent: 'yes_no', answer: 'yes' }; const checks = [];
  const context = { OPENID: uid, ENV: 'test-env' };
  const cloud = { database: () => db, getWXContext: () => context,
    openapi: { security: { msgSecCheck: async data => { checks.push(data); return { result: { suggest } }; } } } };
  const handler = createHandler({ cloud, env: { DASHSCOPE_API_KEY: 'server-only-secret', GAME_ENABLED: 'true' },
    fetchFn: async () => { fetches++; return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(judgment) } }] }) }; }
  });
  return { handler, db, context, checks, fetches: () => fetches, setJudgment: value => { judgment = value; } };
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
test('cloud leaderboard filters mode, applies ordered tie breaks and limits to twenty records', async () => {
  const store = createCloudStore(database());
  for (let i=0;i<25;i++) await store.set('rankings','friend-'+i,{mode:'friends',playerId:String(i).padStart(2,'0'),points:100,wins:i<2?2:1,updatedAt:i<2?10:20});
  await store.set('rankings','solo',{mode:'solo',playerId:'solo',points:999,wins:99,updatedAt:0});
  const rows=await store.leaderboard('friends');
  assert.equal(rows.length,20);assert.deepEqual(rows.slice(0,3).map(r=>r.playerId),['00','01','02']);assert.ok(rows.every(r=>r.mode==='friends'));
});
test('two trusted WeChat identities complete a shared room through the cloud entry and receive the same ranking', async () => {
  const f=setup({uid:'alice-openid'}),h=f.handler;
  await h({action:'saveProfile',nickname:'小林',userId:'spoofed'});
  const room=(await h({action:'createRoom',puzzleId:'parking-ticket'})).data.room;
  f.context.OPENID='bob-openid';await h({action:'saveProfile',nickname:'小陈'});await h({action:'joinRoom',roomId:room.id});
  assert.equal((await h({action:'startRoom',roomId:room.id,openid:'alice-openid'})).error.code,'HOST_ONLY');
  f.context.OPENID='alice-openid';const start=(await h({action:'startRoom',roomId:room.id})).data.room;
  const next=(await h({action:'roomQuestion',roomId:room.id,requestId:'cloud-q',turnSerial:start.turnSerial,text:'她买了电影票吗？'})).data.room;
  const puzzle=require('../cloudfunctions/game/data/puzzles').find(p=>p.id==='parking-ticket');
  f.context.OPENID='bob-openid';f.setJudgment({answer:'solved',covered:puzzle.requiredPoints.map((_,i)=>i+1),contradiction:false});
  const won=await h({action:'roomGuess',roomId:room.id,requestId:'cloud-win',turnSerial:next.turnSerial,text:'电影票可以抵停车费。'});
  assert.equal(won.data.room.state,'solved');assert.equal(f.fetches(),2);
  const board=(await h({action:'getLeaderboard',mode:'friends'})).data;
  assert.deepEqual(board.rows.map(r=>r.points),[98,98]);assert.deepEqual(board.rows.map(r=>r.rank),[1,1]);
  assert.equal(board.me.nickname,'小陈');assert.equal(board.me.wins,1);
  assert.ok(f.checks.some(c=>c.openid==='alice-openid'&&c.content==='小林'));
  assert.ok(f.checks.some(c=>c.openid==='bob-openid'&&c.content==='小陈'));
  assert.ok(!JSON.stringify(board).includes('openid'));
  f.context.OPENID='outside-openid';assert.equal((await h({action:'getRoom',roomId:room.id})).error.code,'ROOM_FORBIDDEN');
});
