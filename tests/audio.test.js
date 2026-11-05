'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectMP3, createCloudAudio, boundedDownload } = require('../cloudfunctions/game/lib/audio');
const path = 'audio/0123456789abcdef01234567/session-id/upload-id.mp3';
const fileID = 'cloud://test-env.bucket/' + path;
function mp3(count = 40, stereo = false) {
  const frame = Buffer.alloc(417); frame.writeUInt32BE(stereo ? 0xfffb9000 : 0xfffb90c0);
  return Buffer.concat(Array(count).fill(frame));
}
test('MP3 duration is calculated from real frames rather than claimed duration', () => {
  assert.ok(Math.abs(inspectMP3(mp3()).durationSeconds - 40 * 1152 / 44100) < .0001);
  assert.throws(() => inspectMP3(mp3(800)), { code: 'AUDIO_TOO_LONG' });
});
test('invalid, truncated, stereo, and oversized recordings are rejected', () => {
  for (const buffer of [Buffer.from('RIFF-WAVE'), mp3(40, true), mp3().subarray(0, -1), Buffer.alloc(1024 * 1024 + 1), mp3(2)]) {
    assert.throws(() => inspectMP3(buffer), { code: 'INVALID_AUDIO' });
  }
});
test('owned exact path and environment must match before download', async () => {
  let downloads = 0;
  const audio = createCloudAudio({ getTempFileURL: async () => { downloads++; return { fileList: [{ status: 0, tempFileURL: 'https://storage.test/private' }] }; } }, {
    envId: 'test-env', fetchFn: async () => new Response(mp3())
  });
  await audio.inspect({ fileID, cloudPath: path });
  await assert.rejects(audio.inspect({ fileID: fileID.replace('test-env.', 'other.'), cloudPath: path }), { code: 'INVALID_AUDIO' });
  await assert.rejects(audio.inspect({ fileID, cloudPath: path.replace('upload-id', 'other') }), { code: 'INVALID_AUDIO' });
  assert.equal(downloads, 1);
});
test('unconfirmed orphan upload resolves exact platform fileID and failed deletion is not success', async () => {
  let removed;
  const audio = createCloudAudio({ deleteFile: async ({ fileList }) => { removed = fileList[0]; return { fileList: [{ status: 0 }] }; } }, {
    envId: 'test-env', resolveFileID: async cloudPath => { assert.equal(cloudPath, path); return fileID; }
  });
  await audio.removeByPath(path); assert.equal(removed, fileID);
  const broken = createCloudAudio({ deleteFile: async () => ({}) });
  await assert.rejects(broken.remove(fileID), { code: 'FILE_DELETE_FAILED' });
});
test('private audio download is stopped at 1MB even if Content-Length is omitted', async () => {
  const cloud = { getTempFileURL: async () => ({ fileList: [{ status: 0, tempFileURL: 'https://storage.test/private' }] }) };
  await assert.rejects(boundedDownload(cloud, fileID, async () => new Response(Buffer.alloc(1024 * 1024 + 1))), { code: 'INVALID_AUDIO' });
  await assert.rejects(boundedDownload(cloud, fileID, async () => new Response('', { headers: { 'Content-Length': String(2 * 1024 * 1024) } })), { code: 'INVALID_AUDIO' });
});
