'use strict';
const crypto = require('node:crypto');
const fail = code => Object.assign(new Error(code), { code });
const lines = {
  yes: '是的，这个方向成立。', no: '不是，可以换个方向想想。', irrelevant: '这件事和故事的关键原因无关。',
  unspecified: '故事没有设定这个细节，可以换一个问题。', clarify: '这句话还不够明确，请一次问一件事。',
  solved: '猜对了！你找到了故事的真相。', incomplete: '已经有线索了，再把关键原因补充完整。',
  incorrect: '这个解释和故事里的事实有冲突，再想一想。', uncertain: '这次还不能确定，请换一种说法。'
};
const clarification = {
  person: '你说的是哪一位人物？把名字补上再问。', reference: '你说的他、她或这件事，具体指什么？补充清楚再问。',
  time: '你指的是哪个时间点？请补充先后顺序。', multiple: '这句话里有几个问题，先挑其中一件事问吧。',
  open_ended: '先说出一个猜测，再问它是不是成立。', guess: '如果你已经想通了，可以切到我猜到了，提交完整解释。',
  instruction: '请围绕故事提问，想知道真相也可以主动揭底。'
};
function speechText(session, target, messageId) {
  if (target === 'surface') return '这一碗汤，叫做' + session.title + '。' + session.surface;
  if (target === 'solution' && ['solved', 'revealed'].includes(session.state) && session.puzzle?.solution)
    return (session.state === 'solved' ? '猜对了！现在揭晓完整的故事。' : '现在揭晓故事的真相。') + session.puzzle.solution;
  if (target === 'message') {
    const message = session.messages.find(m => m.id === messageId);
    if (message && lines[message.answer]) return message.answer === 'clarify' ? clarification[message.clarifyReason] || lines.clarify : lines[message.answer];
  }
  throw fail('INVALID_SPEECH');
}
function createSpeechProvider({ env, fetchFn, cache = new Map() }) {
  const model = env.TTS_MODEL || 'qwen3-tts-flash', voice = env.TTS_VOICE || 'Serena';
  async function synthesize(text) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    try {
      const origin = new URL(env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').origin;
      const response = await fetchFn(origin + '/api/v1/services/aigc/multimodal-generation/generation', {
        method: 'POST', headers: { Authorization: 'Bearer ' + env.DASHSCOPE_API_KEY, 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ model, input: { text, voice, language_type: 'Chinese' } })
      });
      if (!response.ok) throw fail(response.status === 429 ? 'RATE_LIMITED' : response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : 'SPEECH_UNAVAILABLE');
      const result = await response.json(), audio = result.output?.audio;
      const url = new URL(audio?.url || '');
      if (!['http:', 'https:'].includes(url.protocol) || !/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname) || url.username || url.password) throw fail('SPEECH_UNAVAILABLE');
      url.protocol = 'https:';
      const expiresAt = Math.min(Number(audio.expires_at) * 1000 || Date.now() + 3600000, Date.now() + 23 * 3600000);
      if (expiresAt <= Date.now() + 60000) throw fail('SPEECH_UNAVAILABLE');
      return { url: url.href, expiresAt, voice, characters: text.length };
    } catch (error) { throw fail(error.code || 'SPEECH_UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
  return { async speak({ text }) {
    if (typeof text !== 'string' || !text || text.length > 600) throw fail('INVALID_SPEECH');
    const key = crypto.createHash('sha256').update(JSON.stringify([env.DASHSCOPE_API_KEY, model, voice, text])).digest('hex');
    for (const [id, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(id);
    if (cache.has(key)) return cache.get(key).promise;
    if (cache.size >= 128) throw fail('SPEECH_UNAVAILABLE');
    // Share in-flight synthesis and keep failures briefly; never retry automatically.
    const entry = { expiresAt: Date.now() + 60000 };
    entry.promise = synthesize(text).then(result => { entry.expiresAt = result.expiresAt - 60000; return result; });
    cache.set(key, entry); return entry.promise;
  } };
}
module.exports = { speechText, createSpeechProvider };
