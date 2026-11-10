'use strict';
// Temporary deployment bridge: game state stays on the owner's existing service.
// Credentials and the invitation mount never enter the public H5 bundle.
const routes = Object.freeze({ game: ['/api', 'POST', 24000], player: ['/preview-player', 'POST', 100], audio: ['/audio', 'POST', 640044], status: ['/preview-status', 'GET', 0] });
function reply(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status; res.end(JSON.stringify(data));
}
async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw Error('BODY_LIMIT');
  if (req.body !== undefined) {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (body.length > limit) throw Error('BODY_LIMIT');
    return body;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw Error('BODY_LIMIT'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
function createBridge({ env = process.env, fetchFn = globalThis.fetch } = {}) {
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'https://bridge.invalid');
    const operation = req.query?.operation || url.searchParams.get('operation');
    const route = routes[operation];
    if (!route) return reply(res, 404, { error: '未找到接口。' });
    if (req.method !== route[1]) return reply(res, 405, { error: '请求方式不支持。' });
    const origin = req.headers.origin;
    if (origin && origin !== 'https://' + req.headers.host) return reply(res, 403, { error: '不允许跨站请求。' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return reply(res, 403, { error: '不允许跨站请求。' });
    if (['game', 'audio'].includes(operation) && !/^[a-f0-9]{48}$/.test(String(req.headers['x-preview-player'] || ''))) return reply(res, 401, { error: '玩家身份已过期，请刷新。' });
    const contentType = String(req.headers['content-type'] || '');
    if (req.method === 'POST' && !(operation === 'audio' ? contentType === 'audio/wav' : contentType.startsWith('application/json'))) return reply(res, 415, { error: '请求内容格式不支持。' });
    let base;
    try {
      base = new URL(env.HGT_UPSTREAM_URL);
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !/^\/play\/[a-f0-9]{48,128}\/$/.test(base.pathname)) throw Error('CONFIG');
    } catch (_) { return reply(res, 503, { error: '游戏服务尚未连接，请联系发起人。', textReady: false, voiceReady: false }); }
    try {
      const target = new URL(route[0].slice(1), base);
      if (operation === 'audio') target.searchParams.set('path', String(req.query?.path || url.searchParams.get('path') || ''));
      const headers = {};
      if (req.method === 'POST') headers['Content-Type'] = operation === 'audio' ? 'audio/wav' : 'application/json';
      if (req.headers['x-preview-player']) headers['X-Preview-Player'] = req.headers['x-preview-player'];
      const body = req.method === 'POST' ? await readBody(req, route[2]) : undefined;
      const response = await fetchFn(target, { method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(55000) });
      // Do not forward upstream invitation text, redirects, cookies, or raw diagnostics.
      if (!response.headers.get('content-type')?.includes('application/json')) return reply(res, 503, { error: '试玩服务暂时离线，请联系发起人。' });
      const data = await response.json();
      return reply(res, response.status, data);
    } catch (error) {
      if (error.message === 'BODY_LIMIT') return reply(res, 413, { error: '内容过长，请缩短后再试。' });
      return reply(res, 503, { error: '试玩服务暂时离线，你的文字已保留，请稍后重试。' });
    }
  };
}
module.exports = createBridge();
module.exports.createBridge = createBridge;
