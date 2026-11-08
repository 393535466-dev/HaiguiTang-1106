'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createMemoryStore } = require('../cloudfunctions/game/lib/store-memory');
function createFileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  if (!Array.isArray(entries) || entries.some(e => !Array.isArray(e) || typeof e[0] !== 'string' || !e[0].includes('\0'))) throw new Error('本机存档格式错误，未覆盖原文件');
  return createMemoryStore({ entries, persist(values) {
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(values), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } });
}
module.exports = { createFileStore };
