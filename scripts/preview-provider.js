'use strict';
const { createProvider } = require('../cloudfunctions/game/lib/provider');
const { readConfig } = require('./preview-config');
const normalize = text => String(text).trim().replace(/[\s，。！？、,.!?；;：:「」“”"']/g, '');
function createPreviewProvider({ env = process.env, configPath, fetchFn = globalThis.fetch } = {}) {
  const fixture = env.PREVIEW_MODE === 'fixture';
  const speechCache = new Map();
  const real = () => createProvider({ env: readConfig(env, configPath), fetchFn, speechCache });
  return {
    mode: fixture ? 'fixture' : 'real',
    ready() { return { textReady: fixture || real().ready().textReady, voiceReady: !fixture && real().ready().voiceReady }; },
    async judge(input) {
      if (!fixture) return real().judge(input);
      const cases = input.kind === 'guess' ? input.puzzle.guessCases : input.puzzle.testCases;
      const match = (cases || []).find(item => normalize(item.text) === normalize(input.text));
      return { answer: match ? match.answer : (input.kind === 'guess' ? 'uncertain' : 'clarify'), usage: { inputTokens: 0, outputTokens: 0 } };
    },
    async speak(input) {
      if (fixture) throw Object.assign(new Error('固定测试模式不调用语音合成。'), { code: 'PREVIEW_UNSUPPORTED' });
      return real().speak(input);
    },
    async transcribe(input) {
      if (fixture) throw Object.assign(new Error('固定测试模式不提供语音识别。'), { code: 'PREVIEW_UNSUPPORTED' });
      return real().transcribe(input);
    }
  };
}
module.exports = { createPreviewProvider };
