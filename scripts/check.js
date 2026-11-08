'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'test-results', '.preview-data'].includes(item.name)) continue;
    const target = path.join(dir, item.name);
    if (item.isDirectory()) walk(target); else files.push(target);
  }
}
walk(root);
let checked = 0;
for (const file of files) {
  if (/\.js$/.test(file)) { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); checked++; }
  if (/\.json$/.test(file)) { JSON.parse(fs.readFileSync(file, 'utf8')); checked++; }
}
const frontend = path.join(root, 'miniprogram');
const app = JSON.parse(fs.readFileSync(path.join(frontend, 'app.json'), 'utf8'));
for (const page of app.pages) for (const ext of ['js', 'json', 'wxml', 'wxss']) {
  if (!fs.existsSync(path.join(frontend, page + '.' + ext))) throw new Error('Missing page file: ' + page + '.' + ext);
}
const puzzles = [...require('../cloudfunctions/game/data/puzzles'), require('../cloudfunctions/game/data/tutorial')];
for (const file of files.filter(f => f.startsWith(frontend) && /\.(js|json|wxml|wxss)$/.test(f))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const p of puzzles) if (text.includes(p.solution)) throw new Error('Private solution found in client: ' + file);
  if (/sk-[A-Za-z0-9]{20,}/.test(text)) throw new Error('Possible API secret in client: ' + file);
}
console.log(`检查通过：${checked} 个 JS/JSON 文件、全部页面入口、客户端无完整汤底或 API Key。`);
