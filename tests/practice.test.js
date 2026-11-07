'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const examples = require('../miniprogram/utils/practice-input');
const read = name => fs.readFileSync(path.join(__dirname, '../miniprogram', name), 'utf8');
const tick = () => new Promise(setImmediate);
function voiceFixture(customCall, uploadFile) {
  const listeners = { Start: new Set(), Stop: new Set(), Error: new Set() };
  const calls = [], deleted = [], transcripts = [], state = {};
  const recorder = { starts: 0, stops: 0,
    start() { this.starts++; for (const fn of listeners.Start) fn(); },
    stop() { this.stops++; for (const fn of [...listeners.Stop]) fn({ duration: 1000, tempFilePath: '/tmp/practice.mp3' }); }
  };
  for (const kind of Object.keys(listeners)) {
    recorder['on' + kind] = fn => listeners[kind].add(fn);
    recorder['off' + kind] = fn => listeners[kind].delete(fn);
  }
  const api = { requestId: () => 'voice-1', message: e => e.message, async call(action, payload, options) {
    calls.push(action);
    if (customCall) { const result = await customCall(action, payload, options); if (result !== undefined) return result; }
    if (action === 'startVoicePractice') return { session: { id: 'practice-only' } };
    if (action === 'registerUpload') return { uploadId: 'u1', cloudPath: 'audio/u1.mp3' };
    if (action === 'transcribeAudio') return { status: 'succeeded', transcript: '小周出门时还在下雨吗？' };
    return {};
  } };
  const wx = { getRecorderManager: () => recorder, authorize: o => o.success(),
    getFileSystemManager: () => ({ unlink: o => deleted.push(o.filePath) }),
    cloud: { uploadFile: uploadFile || (async () => ({ fileID: 'cloud://test/audio/u1.mp3' })) }
  };
  const module = { exports: {} };
  vm.runInNewContext(read('utils/practice-voice.js'), { module, require: () => api, wx,
    getApp: () => ({ ensurePrivacy: async () => {} }), setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise });
  const voice = new module.exports({ update: p => Object.assign(state, p), transcript: (text, context) => transcripts.push({ text, context }) });
  return { voice, recorder, listeners, calls, deleted, transcripts, state };
}
const touch = { touches: [{ clientY: 200 }] };

test('practice examples never invent answers for arbitrary input or reversed negation', () => {
  assert.equal(examples.question('小周出门时还在下雨吗？'), 'no');
  assert.equal(examples.question('他出门时没有下雨吗？'), 'yes');
  assert.equal(examples.question('他出门时并不是没有下雨吗？'), 'unsupported');
  assert.equal(examples.question('小周为什么没淋湿？'), 'clarify');
  assert.equal(examples.guess('小周等雨停了再出门，回家前也没再下雨，所以没有淋湿。'), 'solved');
  assert.equal(examples.guess('小周并没有等雨停了再出门，回家前也没再下雨，所以没有淋湿。'), 'unsupported');
});

test('practice transcripts fill an editable draft and never submit; newer typing is preserved', () => {
  let definition;
  class FakeVoice { constructor(options) { this.options = options; this.supported = true; } }
  vm.runInNewContext(read('pages/tutorial/index.js'), {
    require: name => name.endsWith('practice-voice') ? FakeVoice : examples,
    Page: value => { definition = value; }, getCurrentPages: () => [], wx: {}
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(p) { Object.assign(this.data, p); } };
  page.onLoad(); page.next();
  const context = { step: 1, revision: page._draftRevision };
  page.receiveTranscript('小周出门时还在下雨吗？', context);
  assert.equal(page.data.question, '小周出门时还在下雨吗？');
  assert.equal(page.data.submittedQuestion, '');
  assert.equal(page.data.questionResult, '');
  const secondContext = { step: 1, revision: page._draftRevision };
  page.onQuestionInput({ detail: { value: '保留我新写的问题' } });
  page.receiveTranscript('迟到的转写', secondContext);
  assert.equal(page.data.question, '保留我新写的问题');
  assert.equal(page.data.recoveredTranscript, '迟到的转写');
  page.confirmQuestion();
  assert.equal(page.data.submittedQuestion, '保留我新写的问题');
  assert.equal(page.data.questionResult, 'unsupported');
});

test('recording cancellation deletes local audio without an upload or transcription', async () => {
  const f = voiceFixture();
  await f.voice.start(touch, { step: 1, revision: 0 });
  assert.equal(f.recorder.starts, 1);
  f.voice.cancel();
  await tick();
  assert.deepEqual(f.calls, ['startVoicePractice']);
  assert.deepEqual(f.deleted, ['/tmp/practice.mp3']);
  f.voice.dispose();
  assert.equal(f.listeners.Start.size, 0);
  assert.equal(f.listeners.Stop.size, 0);
});

test('a released press during service preparation cannot start recording later', async () => {
  let ready;
  const f = voiceFixture(action => action === 'startVoicePractice' ? new Promise(resolve => { ready = resolve; }) : undefined);
  const start = f.voice.start(touch, { step: 1, revision: 0 });
  f.voice.end(); ready({ session: { id: 'practice-only' } });
  await start;
  assert.equal(f.recorder.starts, 0);
  assert.match(f.state.voiceStatus, /再次按住/);
  f.voice.dispose();
});

test('unknown transcription is queried by the same request and never dispatched twice', async () => {
  const f = voiceFixture(action => action === 'transcribeAudio' ? { status: 'unknown' }
    : action === 'getRequest' ? { status: 'succeeded', transcript: '真实转写的文字' } : undefined);
  await f.voice.start(touch, { step: 1, revision: 8 }); f.voice.end();
  await tick();
  assert.equal(f.state.voicePending, true);
  await f.voice.start(touch, { step: 1, revision: 8 });
  assert.equal(f.recorder.starts, 1);
  await f.voice.check();
  assert.equal(f.calls.filter(a => a === 'transcribeAudio').length, 1);
  assert.equal(f.calls.filter(a => a === 'getRequest').length, 1);
  assert.equal(f.transcripts[0].text, '真实转写的文字');
  assert.equal(f.state.voicePending, false);
  assert.equal(f.calls.includes('askQuestion'), false);
  f.voice.dispose();
});

test('leaving during an upload discards the file before clearing its registration', async () => {
  let finishUpload;
  const f = voiceFixture(null, () => new Promise(resolve => { finishUpload = resolve; }));
  await f.voice.start(touch, { step: 1, revision: 0 }); f.voice.end();
  await tick();
  f.voice.dispose();
  assert.equal(f.calls.includes('clearSession'), false);
  finishUpload({ fileID: 'cloud://test/audio/u1.mp3' });
  await tick();
  assert.equal(f.calls.includes('transcribeAudio'), false);
  assert.equal(f.calls.includes('discardUpload'), true);
  assert.equal(f.calls.includes('clearSession'), true);
  assert.ok(f.calls.indexOf('discardUpload') < f.calls.indexOf('clearSession'));
  assert.equal(f.transcripts.length, 0);
});

test('hidden practice pages release the shared recorder and reattach exactly once on return', () => {
  const f = voiceFixture();
  assert.equal(f.listeners.Start.size, 1);
  f.voice.hide(); assert.equal(f.listeners.Start.size, 0);
  f.voice.show(); f.voice.show(); assert.equal(f.listeners.Start.size, 1);
  f.voice.dispose(); assert.equal(f.listeners.Start.size, 0);
});
