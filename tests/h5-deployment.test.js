'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBridge } = require('../api/bridge');
const token = 'a'.repeat(48), upstream = 'https://upstream.example/play/' + 'b'.repeat(64) + '/';
async function call(handler, { operation = 'game', method = 'POST', headers = {}, body = '{}', query = {} } = {}) {
  const req = Readable.from([Buffer.from(body)]); req.url = '/api/bridge?operation=' + operation;
  req.method = method; req.query = { operation, ...query }; req.headers = { host: 'game.example', 'content-type': 'application/json', 'x-preview-player': token, ...headers };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = JSON.parse(value); } };
  await handler(req, res); return res;
}
test('bridge forwards only fixed endpoints and never publishes upstream credentials', async () => {
  let target, init;
  const handler = createBridge({ env: { HGT_UPSTREAM_URL: upstream }, fetchFn: async (url, options) => { target = url; init = options; return new Response('{"ok":true,"data":{}}', { headers: { 'content-type': 'application/json' } }); } });
  const res = await call(handler, { body: '{"action":"status"}', headers: { origin: 'https://game.example', cookie: 'unrelated=secret', authorization: 'secret' } });
  assert.equal(res.statusCode, 200); assert.equal(target.href, upstream + 'api');
  assert.equal(init.headers.Cookie, undefined); assert.equal(init.headers.authorization, undefined);
  assert.equal(init.headers['X-Preview-Player'], token); assert.equal(init.body.toString(), '{"action":"status"}');
  assert.equal(JSON.stringify(res).includes('upstream.example'), false);
});
test('bridge rejects cross-site, missing identity, oversize and unlisted endpoints before fetch', async () => {
  let calls = 0; const handler = createBridge({ env: { HGT_UPSTREAM_URL: upstream }, fetchFn: async () => { calls++; throw Error('must not reach'); } });
  assert.equal((await call(handler, { headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await call(handler, { headers: { 'x-preview-player': '' } })).statusCode, 401);
  assert.equal((await call(handler, { body: 'x'.repeat(24001) })).statusCode, 413);
  assert.equal((await call(handler, { operation: 'https://evil.example' })).statusCode, 404);
  assert.equal((await call(handler, { method: 'GET' })).statusCode, 405); assert.equal(calls, 0);
});
test('bridge handles raw WAV and upstream downtime without returning credentials', async () => {
  let target, init; const wav = Buffer.from([0, 10, 128, 255]);
  const handler = createBridge({ env: { HGT_UPSTREAM_URL: upstream }, fetchFn: async (url, options) => { target = url; init = options; return new Response('{"fileID":"x"}', { headers: { 'content-type': 'application/json' } }); } });
  const req = Readable.from([wav]); req.url = '/api/bridge'; req.method = 'POST'; req.query = { operation: 'audio', path: 'audio/test.wav' }; req.headers = { host: 'game.example', 'content-type': 'audio/wav', 'x-preview-player': token };
  const res = { setHeader() {}, end(v) { this.body = JSON.parse(v); } }; await handler(req, res);
  assert.deepEqual(init.body, wav); assert.equal(target.searchParams.get('path'), 'audio/test.wav');
  const offline = createBridge({ env: { HGT_UPSTREAM_URL: upstream }, fetchFn: async () => new Response('secret invitation', { status: 410 }) });
  const failed = await call(offline); assert.equal(failed.statusCode, 503); assert.equal(JSON.stringify(failed).includes('secret invitation'), false);
});
test('unconfigured bridge fails closed and never defaults to a shared local user', async () => {
  const handler = createBridge({ env: {}, fetchFn: async () => { throw Error('must not call'); } });
  assert.equal((await call(handler)).statusCode, 503);
});
