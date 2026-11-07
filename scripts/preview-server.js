'use strict';

// Local development only: real AI by default; fixtures require PREVIEW_MODE=fixture.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createService } = require('../cloudfunctions/game/lib/service');
const { createMemoryStore } = require('../cloudfunctions/game/lib/store-memory');
const { createPreviewProvider } = require('./preview-provider');
const puzzles = require('../cloudfunctions/game/data/puzzles');
const root = path.resolve(__dirname, '..');

function bundle() {
  const files = {};
  const add = (file, kind) => { files['/' + file.replace(/^miniprogram\//, '')] = { kind, source: fs.readFileSync(path.join(root, file), 'utf8') }; };
  for (const file of ['app.js', 'app.wxss', 'config.js', 'data/catalog.js', 'utils/api.js', 'utils/storage.js', 'utils/presentation.js', 'utils/tutorial-judge.js', 'utils/practice-voice.js']) add('miniprogram/' + file, path.extname(file).slice(1));
  for (const page of ['home', 'game', 'tutorial', 'privacy']) for (const ext of ['js', 'wxml', 'wxss']) add(`miniprogram/pages/${page}/index.${ext}`, ext);
  return 'window.__miniFiles=' + JSON.stringify(files).replace(/</g, '\\u003c') + ';';
}
function respond(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
async function readJSON(req) {
  let body = '', bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 24000) throw new Error('Body too large'); body += chunk; }
  return JSON.parse(body || '{}');
}
function createPreviewServer(options = {}) {
  const provider = createPreviewProvider(options);
  const service = createService({ store: createMemoryStore(), provider,
    audio: { inspect: async () => { throw new Error('Preview audio is disabled'); }, remove: async () => {}, removeByPath: async () => {} },
    puzzles, limits: { userDaily: 100, globalDaily: 100 } });
  const server = http.createServer(async (req, res) => {
    try {
      const port = server.address().port;
      const host = String(req.headers.host || '');
      const allowed = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
      if (!allowed.has(host)) return respond(res, 403, '{}');
      if (req.headers.origin && !Array.from(allowed).some(h => req.headers.origin === 'http://' + h)) return respond(res, 403, '{}');
      const url = new URL(req.url, 'http://' + host);
      if (req.method === 'POST' && url.pathname === '/api') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return respond(res, 415, '{}');
        const input = await readJSON(req);
        if (['registerUpload', 'confirmUpload', 'transcribeAudio', 'discardUpload', 'startVoicePractice'].includes(input.action)) return respond(res, 200, JSON.stringify({ ok: false, error: { code: 'PREVIEW_UNSUPPORTED', message: '本地浏览器不支持录音转写，请使用微信真机。', retryable: false } }));
        const output = await service.handle(input.action, input, 'local-preview-user');
        if (input.action === 'status' && output.ok) { output.data.environment = 'local-' + provider.mode; output.data.judgeMode = provider.mode; }
        return respond(res, 200, JSON.stringify(output));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, '{}');
      if (url.pathname === '/bundle.js') return respond(res, 200, bundle(), 'text/javascript; charset=utf-8');
      if (url.pathname === '/preview-status') return respond(res, 200, JSON.stringify({ mode: provider.mode, textReady: provider.ready().textReady }));
      const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/runtime.js': ['runtime.js', 'text/javascript; charset=utf-8'], '/preview.css': ['preview.css', 'text/css; charset=utf-8'] };
      if (staticFiles[url.pathname]) {
        const [file, mime] = staticFiles[url.pathname];
        return respond(res, 200, fs.readFileSync(path.join(__dirname, 'preview', file)), mime);
      }
      respond(res, 404, '{}');
    } catch (_) { respond(res, 500, JSON.stringify({ error: '本地服务未能完成请求，请检查配置后重试。' })); }
  });
  return { server, service, provider };
}
if (require.main === module) {
  const { server, provider } = createPreviewServer();
  server.listen(18875, '127.0.0.1', () => {
    process.stdout.write((provider.mode === 'fixture' ? '固定裁判测试模式 · 非真实 AI' : '本机真实文字 AI · 语音请用微信真机') + '\nhttp://127.0.0.1:18875/\n');
    if (!provider.ready().textReady) process.stdout.write('请在 .env.preview.local 填写服务端密钥并启用 GAME_ENABLED；保存后重新检查连接即可。\n');
    process.stdout.write('按 Ctrl+C 结束。\n');
  });
  server.on('error', error => { process.stderr.write('预览启动失败：' + error.code + '\n'); process.exitCode = 1; });
}
module.exports = { createPreviewServer };
