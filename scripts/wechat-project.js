'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const validAppId = value => /^wx[0-9a-f]{16}$/.test(value || '');
const validEnvId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(value) && !/^sk-|example|placeholder|your[-_]?env/i.test(value);
const collections = ['sessions', 'requests', 'usage', 'uploads', 'feedback', 'rooms', 'roomRequests', 'profiles', 'rankClaims', 'rankings'];
const leaderboardIndex = [['mode', 'asc'], ['points', 'desc'], ['wins', 'desc'], ['updatedAt', 'asc'], ['playerId', 'asc']];
function inspectProject(root) {
  const checks = [];
  const add = (name, scope, check) => { let pass = false; try { pass = Boolean(check()); } catch (_) {} checks.push({ name, scope, pass }); };
  const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  let project = {}, local = {};
  add('项目配置可以读取', 'files', () => {
    project = json('project.config.json');
    if (fs.existsSync(path.join(root, 'project.private.config.json'))) Object.assign(project, json('project.private.config.json'));
    return true;
  });
  add('前端本机配置可以读取', 'files', () => {
    const context = { module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/config.local.js'), 'utf8'), context, { timeout: 100 });
    local = context.module.exports;
    return local && typeof local === 'object' && local.functionName === 'game';
  });
  add('微信小程序与云函数目录', 'files', () => project.compileType === 'miniprogram' && project.miniprogramRoot === 'miniprogram/' && project.cloudfunctionRoot === 'cloudfunctions/');
  add('全部页面文件齐全', 'files', () => {
    const pages = json('miniprogram/app.json').pages;
    return Array.isArray(pages) && pages.length > 0 && pages.every(page => typeof page === 'string' && /^[\w/-]+$/.test(page) && !page.split('/').includes('..') && ['js','json','wxml','wxss'].every(ext => fs.existsSync(path.join(root, 'miniprogram', page + '.' + ext))));
  });
  add('game 云函数入口和依赖锁定', 'files', () => {
    const pkg = json('cloudfunctions/game/package.json'), lock = json('cloudfunctions/game/package-lock.json');
    return fs.existsSync(path.join(root, 'cloudfunctions/game/index.js')) && pkg.main === 'index.js' && Object.entries(pkg.dependencies || {}).every(([name, version]) => lock.packages?.['node_modules/' + name]?.version === version);
  });
  add('内容检查权限与小时清理配置', 'files', () => {
    const config = json('cloudfunctions/game/config.json');
    return config.permissions?.openapi?.includes('security.msgSecCheck') && config.triggers?.some(t => t.name === 'cleanup-hourly' && t.type === 'timer' && t.config === '0 0 * * * * *');
  });
  add('真实微信 AppID 已填写（未验证归属）', 'account', () => validAppId(project.appid));
  add('云环境 ID 已填写（未连接验证）', 'account', () => validEnvId(local.cloudEnv));
  return { checks, filesReady: checks.filter(c => c.scope === 'files').every(c => c.pass), accountConfigured: checks.filter(c => c.scope === 'account').every(c => c.pass), cloudVerified: false };
}
module.exports = { inspectProject, validAppId, validEnvId, collections, leaderboardIndex };
