'use strict';
const { failure } = require('../cloudfunctions/game/lib/provider');
function inspectWAV(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.length > 640044 ||
      buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.readUInt32LE(4) + 8 !== buffer.length ||
      buffer.toString('ascii', 8, 16) !== 'WAVEfmt ' || buffer.readUInt32LE(16) !== 16 ||
      buffer.readUInt16LE(20) !== 1 || buffer.readUInt16LE(22) !== 1 || buffer.readUInt32LE(24) !== 16000 ||
      buffer.readUInt32LE(28) !== 32000 || buffer.readUInt16LE(32) !== 2 || buffer.readUInt16LE(34) !== 16 ||
      buffer.toString('ascii', 36, 40) !== 'data' || buffer.readUInt32LE(40) !== buffer.length - 44 || (buffer.length - 44) % 2) throw failure('INVALID_AUDIO');
  const durationSeconds = (buffer.length - 44) / 32000;
  if (durationSeconds < 0.3 || durationSeconds > 20) throw failure('INVALID_AUDIO');
  let peak = 0;
  for (let i = 44; i < buffer.length; i += 2) peak = Math.max(peak, Math.abs(buffer.readInt16LE(i)));
  if (peak < 40) throw failure('EMPTY_AUDIO');
  return { durationSeconds, mimeType: 'audio/wav' };
}
function createPreviewAudio(store, owner) {
  const files = new Map();
  function purge() { for (const [key, file] of files) if (file.expiresAt <= Date.now()) files.delete(key); }
  const cleanup = setInterval(purge, 60000); cleanup.unref();
  return {
    extension: 'wav',
    async upload(cloudPath, buffer, currentOwner = owner) {
      purge(); inspectWAV(buffer);
      const id = /^audio\/[a-f0-9]{24}\/[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)\.wav$/.exec(cloudPath)?.[1];
      if (!id) throw failure('INVALID_UPLOAD');
      return store.transaction(async tx => {
        const upload = await tx.get('uploads', id);
        const session = upload && await tx.get('sessions', upload.sessionId);
        if (!upload || upload.userId !== currentOwner || upload.cloudPath !== cloudPath || upload.consumed || upload.expiresAt <= Date.now() ||
            !session || session.userId !== currentOwner || session.state !== 'playing' || session.expiresAt <= Date.now()) throw failure('INVALID_UPLOAD');
        const fileID = 'cloud://local-preview/' + cloudPath;
        const old = files.get(fileID);
        if (old && !old.buffer.equals(buffer)) throw failure('INVALID_UPLOAD');
        if (!old && files.size >= 20) throw failure('DAILY_LIMIT');
        files.set(fileID, { buffer, expiresAt: Date.now() + 600000 });
        upload.fileID = fileID; await tx.set('uploads', id, upload);
        return { fileID };
      });
    },
    async inspect({ fileID, cloudPath }) {
      purge();
      if (fileID !== 'cloud://local-preview/' + cloudPath || !files.has(fileID)) throw failure('INVALID_AUDIO');
      const buffer = files.get(fileID).buffer;
      return { buffer, ...inspectWAV(buffer) };
    },
    async remove(fileID) { files.delete(fileID); },
    async removeByPath(cloudPath) { files.delete('cloud://local-preview/' + cloudPath); },
    clear() { clearInterval(cleanup); files.clear(); }
  };
}
module.exports = { createPreviewAudio, inspectWAV };
