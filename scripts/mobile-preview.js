'use strict';
// Invite-only HTTPS tunnel entry. The original preview keeps listening on loopback.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const COOKIE = '__Secure-hgt-mobile-test';
const publicAssets = require('./preview-assets');
const assets = new Set(['/', '/bundle.js', '/runtime.js', '/voice.js', '/recorder.wav.min.js', '/preview.css', '/preview-status', ...Object.keys(publicAssets)]);
const posts = new Set(['/api', '/audio', '/preview-player']);
function equal(a, b) {
  const aa = Buffer.from(String(a || '')), bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function createMobileGateway({ publicOrigin, accessToken, expiresAt, upstreamPort = 18875, now = Date.now }) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Expected a plain HTTPS origin');
  if (!/^[a-f0-9]{48,128}$/.test(accessToken) || !Number.isFinite(expiresAt)) throw new Error('Invalid mobile access configuration');
  return http.createServer((req, res) => {
    const finish = (status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
    if (req.headers.host !== origin.host) return finish(403, '访问地址不正确。');
    if (now() >= expiresAt) return finish(410, '本轮手机测试链接已到期，请联系发起人更新链接。');
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return finish(400, '无效请求。');
    const url = new URL(req.url, origin);
    if (req.headers.origin && req.headers.origin !== origin.origin) return finish(403, '不允许跨站请求。');
    if (req.method === 'GET' && url.pathname.startsWith('/invite/')) {
      if (!equal(url.pathname.slice('/invite/'.length), accessToken)) return finish(403, '测试邀请无效，请使用完整的邀请链接。');
      res.setHeader('Set-Cookie', COOKIE + '=' + accessToken + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + Math.max(0, Math.floor((expiresAt - now()) / 1000)));
      res.writeHead(303, { Location: '/' }); return res.end();
    }
    const cookies = String(req.headers.cookie || '').split(';').map(v => v.trim());
    const cookie = cookies.find(v => v.startsWith(COOKIE + '='));
    if (!cookie || !equal(cookie.slice(COOKIE.length + 1), accessToken)) return finish(403, '请先打开朋友发来的完整测试邀请链接。');
    const isPost = req.method === 'POST' && posts.has(url.pathname);
    if (!isPost && !(['GET', 'HEAD'].includes(req.method) && assets.has(url.pathname))) return finish(404, '未找到页面。');
    // Cache only versioned artwork/fonts after authentication. Game data and code stay no-store.
    if (Object.hasOwn(publicAssets, url.pathname)) res.setHeader('Cache-Control', 'private, max-age=' + Math.min(86400, Math.max(0, Math.floor((expiresAt - now()) / 1000))));
    // Public callers may never inherit the local owner's identity by omitting a header.
    if (['/api', '/audio'].includes(url.pathname) && !/^[a-f0-9]{48}$/.test(String(req.headers['x-preview-player'] || ''))) return finish(401, '玩家身份已过期，请刷新页面。');
    const headers = { host: '127.0.0.1:' + upstreamPort };
    for (const key of ['content-type', 'content-length', 'x-preview-player']) if (req.headers[key]) headers[key] = req.headers[key];
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: req.method, path: url.pathname + url.search, headers }, response => {
      res.writeHead(response.statusCode, { 'Content-Type': response.headers['content-type'] || 'application/octet-stream' });
      response.pipe(res);
    });
    upstream.setTimeout(70000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => { if (!res.headersSent) finish(502, '试玩服务暂时未连接，请稍后重试。'); else res.destroy(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  });
}
if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.preview-data/mobile-access.json'), 'utf8'));
  const server = createMobileGateway(config);
  server.listen(config.port || 18876, '127.0.0.1', () => process.stdout.write('手机测试入口已启动，仅监听本机。\n'));
  server.on('error', error => { process.stderr.write('手机入口启动失败：' + error.code + '\n'); process.exitCode = 1; });
}
module.exports = { createMobileGateway };
