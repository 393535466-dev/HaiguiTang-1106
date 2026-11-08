'use strict';
const path = require('node:path');
const { inspectProject } = require('./wechat-project');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--project')) {
  console.error('用法：npm run preflight -- [--project 项目目录]'); process.exitCode = 1;
} else {
  const root = args.length ? path.resolve(args[1]) : path.resolve(__dirname, '..');
  const result = inspectProject(root), nodeReady = Number(process.versions.node.split('.')[0]) >= 20;
  console.log(`${nodeReady ? '已就绪' : '待准备'}  Node.js >=20`);
  for (const check of result.checks) console.log(`${check.pass ? '已就绪' : '待准备'}  ${check.name}`);
  console.log('本地预检不连接云端。集合/索引、存储权限、云端 Key、定时器、类目、录音及两部真机仍需按部署说明验证。');
  if (!nodeReady || !result.filesReady || !result.accountConfigured) process.exitCode = 2;
}
