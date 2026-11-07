'use strict';
const fs = require('node:fs');
const path = require('node:path');
const CONFIG_PATH = path.resolve(__dirname, '../.env.preview.local');
const KEYS = new Set(['DASHSCOPE_API_KEY', 'GAME_ENABLED', 'LLM_MODEL', 'DASHSCOPE_BASE_URL', 'ASR_MODEL', 'TTS_MODEL', 'TTS_VOICE']);
function readConfig(env = process.env, file = CONFIG_PATH) {
  const result = {};
  for (const key of KEYS) if (env[key]) result[key] = env[key];
  if (file && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || !KEYS.has(match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (value) result[match[1]] = value;
    }
  }
  return result;
}
module.exports = { readConfig, CONFIG_PATH };
