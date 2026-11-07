'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { inspectWAV, createPreviewAudio } = require('../scripts/preview-audio');
const { createMemoryStore } = require('../cloudfunctions/game/lib/store-memory');
const { createService } = require('../cloudfunctions/game/lib/service');
function wav(seconds = 1, amplitude = 200) {
  const b = Buffer.alloc(44 + 32000 * seconds);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(amplitude, i);
  return b;
}
test('browser WAV validation checks actual PCM format, length and silence before ASR', () => {
  assert.equal(inspectWAV(wav()).durationSeconds, 1);
  for (const buffer of [wav(21), wav().subarray(0, 500), Buffer.from('not audio')]) assert.throws(() => inspectWAV(buffer), { code: 'INVALID_AUDIO' });
  assert.throws(() => inspectWAV(wav(1, 0)), { code: 'EMPTY_AUDIO' });
  const stereo = wav(); stereo.writeUInt16LE(2, 22); assert.throws(() => inspectWAV(stereo), { code: 'INVALID_AUDIO' });
});
test('browser recordings require an owned registration, use the normal ASR quota and are deleted after recognition', async t => {
  const store = createMemoryStore(), audio = createPreviewAudio(store, 'alice'); t.after(() => audio.clear());
  let calls = 0;
  const provider = { ready: () => ({ textReady: true, voiceReady: true }), transcribe: async input => {
    calls++; assert.equal(input.mimeType, 'audio/wav'); return { text: '小周没有带伞吗？' };
  } };
  const service = createService({ store, audio, provider, puzzles: [] });
  const api = (action, args = {}, uid = 'alice') => service.handle(action, args, uid);
  const s = (await api('startVoicePractice')).data.session;
  const u = (await api('registerUpload', { sessionId: s.id })).data;
  await assert.rejects(audio.upload('audio/not-registered.wav', wav()), { code: 'INVALID_UPLOAD' });
  const file = await audio.upload(u.cloudPath, wav());
  await assert.rejects(audio.upload(u.cloudPath, wav(1, 400)), { code: 'INVALID_UPLOAD' });
  const input = { sessionId: s.id, uploadId: u.uploadId, fileID: file.fileID, requestId: 'asr-test' };
  assert.equal((await api('transcribeAudio', input, 'bob')).error.code, 'NOT_FOUND');
  assert.equal((await api('transcribeAudio', input)).data.transcript, '小周没有带伞吗？');
  await api('transcribeAudio', input); assert.equal(calls, 1);
  await assert.rejects(audio.inspect({ fileID: file.fileID, cloudPath: u.cloudPath }), { code: 'INVALID_AUDIO' });
  assert.equal((await store.scan('usage')).find(row => row.id.startsWith('global-')).asr, 1);
});
