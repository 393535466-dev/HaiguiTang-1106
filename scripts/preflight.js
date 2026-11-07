'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const project = require('../project.config.json');
let local = {};
try { local = require('../miniprogram/config.local'); } catch (_) {}
const privatePath = path.join(root, 'project.private.config.json');
if (fs.existsSync(privatePath)) Object.assign(project, JSON.parse(fs.readFileSync(privatePath, 'utf8')));
const checks = [
  ['Node.js >=20', Number(process.versions.node.split('.')[0]) >= 20],
  ['真实微信 AppID', /^wx[0-9a-f]{16}$/.test(project.appid || '')],
  ['本机云环境 ID', Boolean(local.cloudEnv && !/你的|example|placeholder/i.test(local.cloudEnv))],
  ['game 云函数入口', fs.existsSync(path.join(root, 'cloudfunctions/game/index.js'))]
];
for (const [name, pass] of checks) console.log(`${pass ? '已就绪' : '待准备'}  ${name}`);
console.log('云端 Key、启用开关、数据库/存储权限、定时器、微信类目和真机录音需按 docs/DEPLOY.md 核验。此检查不连接付费服务，也不验证云端密钥。');
if (checks.some(([, pass]) => !pass)) process.exitCode = 2;
