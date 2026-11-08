'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { inspectProject, validAppId, validEnvId, collections, leaderboardIndex } = require('./wechat-project');
const docs = ['DEPLOY.md', 'ACCEPTANCE.md', 'MULTIPLAYER.md', 'THIRD_PARTY.md', 'DEVICE-TEST.md'];
const allowed = file => (file.startsWith('miniprogram/') || file.startsWith('cloudfunctions/game/') || file === 'project.config.json' || file.startsWith('docs/') && docs.includes(file.slice(5))) &&
  !file.split('/').some(part => ['node_modules', '.git', '.preview-data', 'config.local.js', 'project.private.config.json'].includes(part) || part.startsWith('.') && part !== '.env.example');
function prepareWechat({ root = path.resolve(__dirname, '..'), appId, cloudEnv } = {}) {
  if (appId !== undefined && !validAppId(appId)) throw new Error('AppID 格式不正确；不要在此填写密钥。');
  if (cloudEnv !== undefined && !validEnvId(cloudEnv)) throw new Error('云环境 ID 格式不正确；不要在此填写密钥。');
  const files = execFileSync('git', ['ls-files', '-z', '--', 'miniprogram', 'cloudfunctions/game', 'project.config.json', ...docs.map(f => 'docs/' + f)], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).filter(allowed).sort();
  for (const file of ['project.config.json', 'miniprogram/app.json', 'cloudfunctions/game/index.js', ...docs.map(f => 'docs/' + f)]) if (!files.includes(file)) throw new Error('缺少已登记的交付文件：' + file);
  const parent = path.join(root, '.release');
  if (fs.existsSync(parent) && (!fs.lstatSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink())) throw new Error('.release 必须是普通目录');
  fs.mkdirSync(parent, { recursive: true });
  const output = fs.mkdtempSync(path.join(parent, 'wechat-'));
  const write = (file, data) => { const dest = path.join(output, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); };
  try {
    for (const file of files) {
      if (file.split('/').some((_, i, parts) => fs.lstatSync(path.join(root, ...parts.slice(0, i + 1))).isSymbolicLink())) throw new Error('交付文件不能经过符号链接：' + file);
      const data = fs.readFileSync(path.join(root, file));
      if (/\bsk-[A-Za-z0-9_.-]{20,}/.test(data.toString('utf8'))) throw new Error('发现疑似密钥，已停止打包：' + file);
      write(file, data);
    }
    const project = JSON.parse(fs.readFileSync(path.join(output, 'project.config.json'), 'utf8'));
    project.appid = appId || 'touristappid';
    write('project.config.json', JSON.stringify(project, null, 2) + '\n');
    write('miniprogram/config.local.js', '// 仅保存云环境 ID；密钥请填云端配置。\nmodule.exports = ' + JSON.stringify({ cloudEnv: cloudEnv || '', functionName: 'game' }, null, 2) + '\n');
    const inspection = inspectProject(output);
    if (!inspection.filesReady) throw new Error('交付目录预检失败：' + inspection.checks.filter(c => c.scope === 'files' && !c.pass).map(c => c.name).join('、'));
    const manifest = {
      purpose: '部署参考清单，不是厂商可直接导入的配置；生成此包不代表已部署或通过真机验收。',
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceHasLocalChanges: Boolean(execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: root, encoding: 'utf8' }).trim()),
      localInspection: inspection,
      cloud: { verified: false, functionName: 'game', runtime: 'Node.js 20 or newer', timeoutSeconds: 60, installDependencies: '云端安装依赖',
        collections: collections.map(name => ({ name, clientRead: false, clientWrite: false })),
        rankingIndex: { collection: 'rankings', unique: false, fields: leaderboardIndex.map(([field, direction]) => ({ field, direction })) },
        cleanup: { name: 'cleanup-hourly', cron: '0 0 * * * * *' } }
    };
    write('deployment-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    write('开始使用.md', '# 微信体验版交付包\n\n' +
      (inspection.accountConfigured ? '已填写账号配置，仍需实际验证归属及云端连接。' : '当前账号配置尚未齐备，可以查看源码和配置；尚不能手机联机。') +
      '\n\n1. 在微信开发者工具导入本目录，按实际账号填写 AppID。\n2. 将云环境 ID 写入 `miniprogram/config.local.js`。\n3. 按 `docs/DEPLOY.md` 创建私有集合和索引、配置云函数与存储。云端密钥单独填写，包内不含本机密钥。\n4. 按 `docs/DEVICE-TEST.md` 用两部手机逐项记录，未测项保留未测。\n\n好友房每轮 45 秒。自动化测试与本机浏览器通过不等于微信真机通过。\n');
    const delivered = [...files, 'miniprogram/config.local.js', 'deployment-manifest.json', '开始使用.md'];
    write('SHA256SUMS', delivered.sort().map(file => crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex') + '  ' + file).join('\n') + '\n');
    return { output, fileCount: delivered.length + 1, ...inspection };
  } catch (error) { fs.rmSync(output, { recursive: true, force: true }); throw error; }
}
if (require.main === module) {
  try {
    const argv = process.argv.slice(2), options = {};
    for (let i = 0; i < argv.length; i += 2) {
      const key = { '--appid': 'appId', '--env': 'cloudEnv' }[argv[i]];
      if (!key || !argv[i + 1] || options[key] !== undefined) throw new Error('用法：npm run prepare:wechat -- [--appid 微信AppID] [--env 云环境ID]');
      options[key] = argv[i + 1];
    }
    const result = prepareWechat(options);
    console.log('已生成微信导入目录：' + result.output);
    console.log('交付文件：' + result.fileCount + '；本地文件检查通过；' + (result.accountConfigured ? '已填写账号，云端未验证。' : 'AppID / 云环境 ID 待填写。'));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareWechat };
