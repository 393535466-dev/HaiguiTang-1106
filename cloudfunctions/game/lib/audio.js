'use strict';

const { failure } = require('./provider');
const BITRATE_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATE_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

// Inspect MPEG Layer III frames rather than trusting a client duration or extension.
function inspectMP3(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 1024 * 1024) throw failure('INVALID_AUDIO');
  let offset = 0;
  if (buffer.subarray(0, 3).toString() === 'ID3') {
    if (buffer.length < 10 || [6, 7, 8, 9].some(i => buffer[i] > 127)) throw failure('INVALID_AUDIO');
    const size = (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
    offset = 10 + size + ((buffer[5] & 0x10) ? 10 : 0);
  }
  let seconds = 0, frames = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset === 128 && buffer.subarray(offset, offset + 3).toString() === 'TAG') break;
    if (offset + 4 > buffer.length) throw failure('INVALID_AUDIO');
    const h = buffer.readUInt32BE(offset);
    if ((h >>> 21) !== 0x7ff || ((h >>> 17) & 3) !== 1) throw failure('INVALID_AUDIO');
    const version = (h >>> 19) & 3, rateIndex = (h >>> 10) & 3, bitrateIndex = (h >>> 12) & 15;
    if (version === 1 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15 || ((h >>> 6) & 3) !== 3) {
      throw failure('INVALID_AUDIO');
    }
    const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? BITRATE_V1 : BITRATE_V2)[bitrateIndex] * 1000;
    const length = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + ((h >>> 9) & 1);
    if (length < 4 || offset + length > buffer.length) throw failure('INVALID_AUDIO');
    seconds += (version === 3 ? 1152 : 576) / rate;
    if (seconds > 20.2) throw failure('AUDIO_TOO_LONG');
    frames++; offset += length;
  }
  if (!frames || seconds < 0.3 || seconds > 20.2) throw failure('INVALID_AUDIO');
  return { durationSeconds: seconds };
}

function filePathOf(fileID) {
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw failure('INVALID_AUDIO');
  const slash = fileID.indexOf('/', 8);
  if (slash < 0) throw failure('INVALID_AUDIO');
  return { authority: fileID.slice(8, slash), path: fileID.slice(slash + 1) };
}

async function boundedDownload(cloud, fileID, fetchFn) {
  const links = await cloud.getTempFileURL({ fileList: [fileID] });
  const entry = links.fileList?.[0];
  if (entry?.status !== 0 || !entry.tempFileURL || new URL(entry.tempFileURL).protocol !== 'https:') throw failure('INVALID_AUDIO');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const result = await fetchFn(entry.tempFileURL, { signal: controller.signal, redirect: 'error' });
    if (!result.ok || !result.body?.getReader) throw failure('INVALID_AUDIO');
    if (Number(result.headers.get('content-length')) > 1024 * 1024) {
      controller.abort(); throw failure('INVALID_AUDIO');
    }
    const reader = result.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) { controller.abort(); throw failure('INVALID_AUDIO'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timer); }
}

function createCloudAudio(cloud, { envId, storagePrefix, resolveFileID, fetchFn = globalThis.fetch } = {}) {
  function assertFile(fileID, cloudPath) {
    const value = filePathOf(fileID);
    if (!cloudPath || value.path !== cloudPath || !/^audio\/[a-f0-9]{24}\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.mp3$/.test(cloudPath)) {
      throw failure('INVALID_AUDIO');
    }
    if (envId && !value.authority.startsWith(`${envId}.`)) throw failure('INVALID_AUDIO');
    return value;
  }
  async function remove(fileID) {
    if (!fileID) return;
    const result = await cloud.deleteFile({ fileList: [fileID] });
    const status = result.fileList?.[0]?.status;
    if (status !== 0 && status !== -503003) throw failure('FILE_DELETE_FAILED');
  }
  return {
    async inspect({ fileID, cloudPath }) {
      assertFile(fileID, cloudPath);
      const buffer = await boundedDownload(cloud, fileID, fetchFn);
      return { buffer, ...inspectMP3(buffer) };
    },
    remove,
    async removeByPath(cloudPath) {
      // The platform resolves the exact storage authority; never guess a bucket name.
      const fileID = resolveFileID ? await resolveFileID(cloudPath) : storagePrefix ?
        `${storagePrefix.replace(/\/$/, '')}/${cloudPath}` : null;
      if (!fileID) throw failure('STORAGE_PREFIX_REQUIRED');
      assertFile(fileID, cloudPath);
      await remove(fileID);
    }
  };
}

module.exports = { inspectMP3, createCloudAudio, filePathOf, boundedDownload };
