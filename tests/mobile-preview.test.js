'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http');
const { createMobileGateway } = require('../scripts/mobile-preview');
const { createPreviewServer } = require('../scripts/preview-server');
async function setup(t) {
  const { server } = createPreviewServer({ env: { PREVIEW_MODE: 'fixture' }, configPath: null });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let time = 1000;
  const secret = 'a'.repeat(64), origin = 'https://soup.example:8443';
  const gateway = createMobileGateway({ publicOrigin: origin, accessToken: secret, expiresAt: 10000, now: () => time, upstreamPort: server.address().port });
  await new Promise(r => gateway.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => gateway.close(r)); await new Promise(r => server.close(r)); });
  const base = 'http://127.0.0.1:' + gateway.address().port;
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(base + route, { method: options.method || 'GET', headers: { Host: 'soup.example:8443', ...options.headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(options.body);
  });
  const enter = async () => { const r = await request('/invite/' + secret); assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/'); return r.headers.get('set-cookie'); };
  return { request, enter, origin, expire: () => { time = 10000; } };
}
test('mobile entry requires an unexpired invite, sets a secure cookie and hides private paths', async t => {
  const { request, enter, expire } = await setup(t);
  assert.equal((await request('/')).status, 403);
  assert.equal((await request('/invite/wrong')).status, 403);
  assert.equal((await request('/', { headers: { Host: 'attacker.example' } })).status, 403);
  const cookie = await enter();
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(cookie.includes(flag));
  const headers = { Cookie: cookie.split(';')[0] };
  const page = await request('/', { headers }); assert.equal(page.status, 200); assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  const image = await request('/assets/brand/logo-red-cyan-v6.png', { headers }); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await request('/assets/brand/logo-red-cyan-v6.png')).status, 403);
  for (const [route,mime] of Object.entries(require('../scripts/preview-assets'))) {
    const asset = await request(route, { headers }); assert.equal(asset.status, 200); assert.equal(asset.headers.get('content-type'), mime);
    assert.equal(asset.headers.get('cache-control'), 'private, max-age=9');
    assert.equal((await request(route)).status, 403);
  }
  const optimized = await request('/assets/brand/torn-entry-button-v2.png', { headers: { ...headers, Accept: 'image/webp,image/png' } });
  assert.equal(optimized.headers.get('content-type'), 'image/webp');
  assert.equal(optimized.headers.get('vary'), 'Accept');
  const bytes = Buffer.from(await optimized.arrayBuffer());
  assert.equal(bytes.subarray(8,12).toString(), 'WEBP');
  assert.ok(bytes.length < 50000);
  const fallback = await request('/assets/brand/torn-entry-button-v2.png', { headers: { ...headers, Accept: 'image/webp;q=0,image/png' } });
  assert.equal(fallback.headers.get('content-type'), 'image/png');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  for (const route of ['/.env.preview.local', '/.preview-data/preview-state.json', '/cloudfunctions/game/data/puzzles.js']) assert.equal((await request(route, { headers })).status, 404);
  expire(); assert.equal((await request('/', { headers })).status, 410);
});
test('mobile gateway rejects cross-site requests and never gives callers the local owner identity', async t => {
  const { request, enter, origin } = await setup(t);
  const headers = { Cookie: (await enter()).split(';')[0], 'Content-Type': 'application/json', Origin: origin };
  const post = (route, data, extra = {}) => request(route, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(data) });
  assert.equal((await post('/preview-player', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('/api', { action: 'status' })).status, 401);
  assert.equal((await post('/api', { action: 'status' }, { 'X-Preview-Player': '0'.repeat(48) })).status, 401);
  const a = (await (await post('/preview-player', {})).json()).token;
  const b = (await (await post('/preview-player', {})).json()).token;
  const api = async (token, action, args = {}) => (await (await post('/api', { action, ...args }, { 'X-Preview-Player': token })).json());
  const statusA = await api(a, 'status'), statusB = await api(b, 'status', { userId: 'local-preview-user' });
  assert.notEqual(statusA.data.ownerKey, statusB.data.ownerKey);
  const room = (await api(a, 'createRoom', { puzzleId: 'parking-ticket' })).data.room;
  assert.equal((await api(b, 'getRoom', { roomId: room.id })).error.code, 'ROOM_FORBIDDEN');
  const joined = (await api(b, 'joinRoom', { roomId: room.id })).data.room;
  assert.equal(joined.members.length, 2); assert.equal(joined.isHost, false);
});
test('mobile entry compresses startup files and preserves encoding through the gateway', async t => {
  const { request, enter } = await setup(t);
  const headers = { Cookie: (await enter()).split(';')[0] };
  const plain = await request('/bundle.js', { headers: { ...headers, 'Accept-Encoding': 'gzip;q=0' } });
  const compressed = await request('/bundle.js', { headers: { ...headers, 'Accept-Encoding': 'gzip' } });
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
  assert.equal(compressed.headers.get('cache-control'), 'no-store');
  const bytes = Buffer.from(await compressed.arrayBuffer()), text = await plain.text();
  assert.equal(require('node:zlib').gunzipSync(bytes).toString(), text);
  assert.ok(bytes.length < Buffer.byteLength(text) / 2);
  const page = await request('/', { headers });
  assert.match(await page.text(), /id="preview-boot"/);
});
