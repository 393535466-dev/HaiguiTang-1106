'use strict';

// Local UI preview only. Production never imports this explicit fixture provider.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createService } = require('../cloudfunctions/game/lib/service');
const { createMemoryStore } = require('../cloudfunctions/game/lib/store-memory');
const puzzles = require('../cloudfunctions/game/data/puzzles');
const root = path.resolve(__dirname, '..');
const normalize = text => String(text).trim().replace(/[\s，。！？、,.!?；;：:「」“”"']/g, '');
const provider = {
  ready: () => ({ textReady: true, voiceReady: false }),
  async judge({ puzzle, text, kind }) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const cases = kind === 'guess' ? puzzle.guessCases : puzzle.testCases;
    const match = (cases || []).find(item => normalize(item.text) === normalize(text));
    return { answer: match ? match.answer : (kind === 'guess' ? 'uncertain' : 'clarify'), usage: { inputTokens: 0, outputTokens: 0 } };
  },
  async transcribe() { throw Object.assign(new Error('浏览器预览不提供录音或真实语音识别'), { code: 'PREVIEW_UNSUPPORTED' }); }
};
const service = createService({ store: createMemoryStore(), provider,
  audio: { inspect: async () => { throw new Error('Preview audio is disabled'); }, remove: async () => {}, removeByPath: async () => {} },
  puzzles, limits: { userDaily: 10000, globalDaily: 10000 } });

function bundle() {
  const files = {};
  const add = (file, kind) => { files['/' + file.replace(/^miniprogram\//, '')] = { kind, source: fs.readFileSync(path.join(root, file), 'utf8') }; };
  for (const file of ['app.js', 'app.wxss', 'config.js', 'data/catalog.js', 'utils/api.js', 'utils/storage.js', 'utils/presentation.js', 'utils/practice-input.js', 'utils/practice-voice.js']) add('miniprogram/' + file, path.extname(file).slice(1));
  for (const page of ['home', 'game', 'tutorial', 'privacy']) for (const ext of ['js', 'wxml', 'wxss']) add(`miniprogram/pages/${page}/index.${ext}`, ext);
  // Never bundle config.local.js or server puzzle/answer files.
  return 'window.__miniFiles=' + JSON.stringify(files).replace(/</g, '\\u003c') + ';';
}
function respond(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
async function readJSON(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 16000) throw new Error('Body too large'); }
  return JSON.parse(body || '{}');
}
const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return respond(res, 403, '{}');
    if (req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost):18875$/.test(req.headers.origin)) return respond(res, 403, '{}');
    const url = new URL(req.url, 'http://127.0.0.1:18875');
    if (req.method === 'POST' && url.pathname === '/api') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return respond(res, 415, '{}');
      const input = await readJSON(req);
      if (['registerUpload', 'confirmUpload', 'transcribeAudio', 'discardUpload'].includes(input.action)) return respond(res, 200, JSON.stringify({ ok: false, error: { code: 'PREVIEW_UNSUPPORTED', message: '本地浏览器预览不支持录音，请在微信真机验证。', retryable: false } }));
      const output = await service.handle(input.action, input, 'local-preview-user');
      if (input.action === 'status' && output.ok) output.data.environment = 'local-preview';
      return respond(res, 200, JSON.stringify(output));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, '{}');
    if (url.pathname === '/bundle.js') return respond(res, 200, bundle(), 'text/javascript; charset=utf-8');
    const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/runtime.js': ['runtime.js', 'text/javascript; charset=utf-8'], '/preview.css': ['preview.css', 'text/css; charset=utf-8'] };
    if (staticFiles[url.pathname]) {
      const [file, mime] = staticFiles[url.pathname];
      return respond(res, 200, fs.readFileSync(path.join(__dirname, 'preview', file)), mime);
    }
    respond(res, 404, '{}');
  } catch (error) { respond(res, 500, JSON.stringify({ error: 'Local preview failed', message: error.message })); }
});
server.listen(18875, '127.0.0.1', () => {
  process.stdout.write('本地界面预览 · 非真实 AI/语音\nhttp://127.0.0.1:18875/\n未配置界面：http://127.0.0.1:18875/?mode=unconfigured\n按 Ctrl+C 结束。\n');
});
server.on('error', error => { process.stderr.write('预览启动失败：' + error.message + '\n'); process.exitCode = 1; });
