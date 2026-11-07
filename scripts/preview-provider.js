'use strict';
const { createProvider } = require('../cloudfunctions/game/lib/provider');
const { readConfig } = require('./preview-config');
const normalize = text => String(text).trim().replace(/[\s，。！？、,.!?；;：:「」“”"']/g, '');
function createPreviewProvider({ env = process.env, configPath, fetchFn = globalThis.fetch } = {}) {
  const fixture = env.PREVIEW_MODE === 'fixture';
  const real = () => createProvider({ env: readConfig(env, configPath), fetchFn });
  return {
    mode: fixture ? 'fixture' : 'real',
    ready() { return { textReady: fixture || real().ready().textReady, voiceReady: false }; },
    async judge(input) {
      if (!fixture) return real().judge(input);
      const cases = input.kind === 'guess' ? input.puzzle.guessCases : input.puzzle.testCases;
      const match = (cases || []).find(item => normalize(item.text) === normalize(input.text));
      return { answer: match ? match.answer : (input.kind === 'guess' ? 'uncertain' : 'clarify'), usage: { inputTokens: 0, outputTokens: 0 } };
    },
    async transcribe() { throw Object.assign(new Error('本地浏览器不支持录音转写，请使用微信真机。'), { code: 'PREVIEW_UNSUPPORTED' }); }
  };
}
module.exports = { createPreviewProvider };
