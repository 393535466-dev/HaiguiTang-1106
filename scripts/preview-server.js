'use strict';

// Local development only: real AI by default; fixtures require PREVIEW_MODE=fixture.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { createService } = require('../cloudfunctions/game/lib/service');
const { createMemoryStore } = require('../cloudfunctions/game/lib/store-memory');
const { createPreviewProvider } = require('./preview-provider');
const { createPreviewAudio } = require('./preview-audio');
const puzzles = require('../cloudfunctions/game/data/puzzles');
const root = path.resolve(__dirname, '..');
const webpAssets = Object.freeze({
  '/assets/brand/logo-red-cyan-v7.png': '/assets/brand/logo-red-cyan-v7.webp',
  '/assets/brand/torn-entry-button-v2.png': '/assets/brand/torn-entry-button-v2.webp',
  '/assets/brand/torn-eye-open-v3.jpg': '/assets/brand/torn-eye-open-v3.webp',
  '/assets/brand/torn-eye-closed-v3.jpg': '/assets/brand/torn-eye-closed-v3.webp'
});
function accepts(req, header, type) {
  return String(req.headers[header] || '').split(',').some(entry => {
    const [coding, ...params] = entry.trim().split(';');
    return coding === type && !params.some(p => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p));
  });
}

function bundle() {
  const files = {};
  const add = (file, kind) => { files['/' + file.replace(/^miniprogram\//, '')] = { kind, source: fs.readFileSync(path.join(root, file), 'utf8') }; };
  for (const file of ['app.js', 'app.wxss', 'config.js', 'data/catalog.js', 'utils/api.js', 'utils/storage.js', 'utils/presentation.js', 'utils/tutorial-judge.js', 'utils/host-voice.js', 'utils/practice-voice.js']) add('miniprogram/' + file, path.extname(file).slice(1));
  for (const page of ['home', 'game', 'tutorial', 'privacy', 'room', 'leaderboard']) for (const ext of ['js', 'wxml', 'wxss']) add(`miniprogram/pages/${page}/index.${ext}`, ext);
  return 'window.__miniFiles=' + JSON.stringify(files).replace(/</g, '\\u003c') + ';';
}
function respond(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function respondStatic(req, res, body, type) {
  let bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const gzip = bytes.length > 1024 && accepts(req, 'accept-encoding', 'gzip');
  if (gzip) bytes = gzipSync(bytes);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
async function readJSON(req) {
  let body = '', bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 24000) throw new Error('Body too large'); body += chunk; }
  return JSON.parse(body || '{}');
}
function createPreviewServer(options = {}) {
  const provider = createPreviewProvider(options);
  const store = options.store || createMemoryStore(), owner = 'local-preview-user';
  const audio = createPreviewAudio(store, owner);
  const service = createService({ store, provider, audio,
    puzzles, limits: { userDaily: 100, globalDaily: 100 } });
  const server = http.createServer(async (req, res) => {
    try {
      const port = server.address().port;
      const host = String(req.headers.host || '');
      const allowed = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
      if (!allowed.has(host)) return respond(res, 403, '{}');
      if (req.headers.origin && !Array.from(allowed).some(h => req.headers.origin === 'http://' + h)) return respond(res, 403, '{}');
      const url = new URL(req.url, 'http://' + host);
      if (req.method === 'POST' && url.pathname === '/preview-player') {
        if (req.headers['content-type'] !== 'application/json') return respond(res, 415, '{}');
        await readJSON(req);
        const players = await store.scan('previewPlayers');
        if (players.length >= 50) return respond(res, 429, '{}');
        const token = crypto.randomBytes(24).toString('hex');
        await store.transaction(tx => tx.set('previewPlayers', token, { uid: 'preview-' + crypto.randomUUID(), expiresAt: Date.now() + 7 * 86400000 }));
        return respond(res, 200, JSON.stringify({ token }));
      }
      let uid = owner;
      if (req.headers['x-preview-player']) {
        const token = String(req.headers['x-preview-player']);
        const player = /^[a-f0-9]{48}$/.test(token) ? await store.transaction(tx => tx.get('previewPlayers', token)) : null;
        if (!player || player.expiresAt <= Date.now()) return respond(res, 401, '{}');
        uid = player.uid;
      }
      if (req.method === 'POST' && url.pathname === '/audio') {
        if (req.headers['content-type'] !== 'audio/wav') return respond(res, 415, '{}');
        if (!provider.ready().voiceReady) return respond(res, 403, JSON.stringify({ error: '语音识别尚未配置。' }));
        try {
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 640044) return respond(res, 413, '{}'); chunks.push(chunk); }
          return respond(res, 200, JSON.stringify(await audio.upload(url.searchParams.get('path') || '', Buffer.concat(chunks), uid)));
        } catch (error) { return respond(res, 400, JSON.stringify({ error: error.code === 'EMPTY_AUDIO' ? '没有听到声音，请靠近麦克风重录。' : '录音无效或已过期，请重新录制。' })); }
      }
      if (req.method === 'POST' && url.pathname === '/api') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return respond(res, 415, '{}');
        const input = await readJSON(req);
        const output = await service.handle(input.action, input, uid);
        if (input.action === 'status' && output.ok) { output.data.environment = 'local-' + provider.mode; output.data.judgeMode = provider.mode; }
        return respond(res, 200, JSON.stringify(output));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, '{}');
      if (url.pathname === '/bundle.js') return respondStatic(req, res, bundle(), 'text/javascript; charset=utf-8');
      if (url.pathname === '/preview-status') return respond(res, 200, JSON.stringify({ mode: provider.mode, ...provider.ready() }));
      const publicAssets = require('./preview-assets');
      if (Object.hasOwn(publicAssets, url.pathname)) {
        const webp = webpAssets[url.pathname] && accepts(req, 'accept', 'image/webp');
        const bytes = fs.readFileSync(path.join(root, 'miniprogram', webp ? webpAssets[url.pathname] : url.pathname));
        res.writeHead(200, { 'Content-Type': webp ? 'image/webp' : publicAssets[url.pathname], 'Content-Length': bytes.length, Vary: 'Accept', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/runtime.js': ['runtime.js', 'text/javascript; charset=utf-8'], '/voice.js': ['voice.js', 'text/javascript; charset=utf-8'], '/recorder.wav.min.js': ['vendor/recorder.wav.min.js', 'text/javascript; charset=utf-8'], '/preview.css': ['preview.css', 'text/css; charset=utf-8'] };
      if (staticFiles[url.pathname]) {
        const [file, mime] = staticFiles[url.pathname];
        return respondStatic(req, res, fs.readFileSync(path.join(__dirname, 'preview', file)), mime);
      }
      respond(res, 404, '{}');
    } catch (_) { respond(res, 500, JSON.stringify({ error: '本地服务未能完成请求，请检查配置后重试。' })); }
  });
  server.on('close', () => audio.clear());
  return { server, service, provider };
}
if (require.main === module) {
  const { createFileStore } = require('./preview-store');
  const store = createFileStore(path.join(root, '.preview-data', process.env.PREVIEW_MODE === 'fixture' ? 'fixture-state.json' : 'preview-state.json'));
  const { server, provider, service } = createPreviewServer({ store });
  const cleanup = async () => {
    await service.cleanup();
    for (const p of await store.scan('previewPlayers')) if (p.expiresAt <= Date.now()) await store.transaction(tx => tx.delete('previewPlayers', p.id));
  };
  const clean = () => cleanup().catch(() => process.stderr.write('本机过期记录清理暂未完成。\n'));
  clean(); const cleaner = setInterval(clean, 3600000); cleaner.unref(); server.on('close', () => clearInterval(cleaner));
  server.listen(18875, '127.0.0.1', () => {
    process.stdout.write((provider.mode === 'fixture' ? '固定裁判测试模式 · 非真实 AI' : '本机真实 AI · 语音输入与自然人声') + '\nhttp://127.0.0.1:18875/\n');
    if (!provider.ready().textReady) process.stdout.write('请在 .env.preview.local 填写服务端密钥并启用 GAME_ENABLED；保存后重新检查连接即可。\n');
    process.stdout.write('按 Ctrl+C 结束。\n');
  });
  server.on('error', error => { process.stderr.write('预览启动失败：' + error.code + '\n'); process.exitCode = 1; });
}
module.exports = { createPreviewServer };
