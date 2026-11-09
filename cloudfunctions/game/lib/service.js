'use strict';

const crypto = require('node:crypto');
const tutorialPuzzle = require('../data/tutorial');
const { speechText } = require('./speech');
const ranking = require('./ranking');
const { createRooms } = require('./rooms');
const DAY = 86400000;
const QUESTION = new Set(['yes', 'no', 'irrelevant', 'unspecified', 'clarify']);
const EFFECTIVE_ANSWERS = new Set(['yes', 'no', 'irrelevant']);
const GUESS = new Set(['solved', 'incomplete', 'incorrect', 'uncertain']);
const CLARIFY_REASONS = new Set(['person', 'reference', 'time', 'multiple', 'open_ended', 'guess', 'instruction']);
const UNCERTAIN_ERRORS = new Set(['UPSTREAM_TIMEOUT', 'TIMEOUT', 'NETWORK_ERROR', 'RESULT_UNKNOWN', 'AbortError']);
const KNOWN_ERRORS = {
  CONTENT_CHECK_UNAVAILABLE: '内容检查暂不可用，请联系维护人员',
  CONTENT_BLOCKED: '请调整文字后再提交',
  EMPTY_TRANSCRIPT: '这段录音没有识别到文字，请重录或打字',
  TRANSCRIPT_TOO_LONG: '这段话转写后太长，请缩短后重录或打字',
  CONTEXT_LIMIT: '这段对话太长，请提交完整猜底或揭底',
  PROVIDER_AUTH: '模型密钥或权限有误，请联系维护人员检查配置',
  INVALID_MODEL_OUTPUT: 'AI 这次未返回有效判定，你的文字已保留，可以重新提交',
  UPSTREAM_ERROR: 'AI 服务未能接受这次请求，你的文字已保留，请稍后再试',
  RATE_LIMITED: '模型服务限流，请稍后手动重试'
};
const HASH = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code, public: true });
const finite = v => Number.isFinite(v) && v >= 0 ? v : 0;

function createService({ store, provider, audio, puzzles, clock = Date.now,
  idFactory = () => crypto.randomUUID(), limits = {} }) {
  const config = { userDaily: 100, globalDaily: 500, sessionJudge: 50,
    questionLimit: 30, guessFailures: 5, requestTimeoutMs: 30000, sessionDays: 7, ...limits };
  const now = () => +clock();
  const rooms = createRooms({ store, provider, puzzles, usage, recordUsage, clock: now, idFactory, limits: config });
  const requestKey = (uid, sid, rid) => HASH(`${uid}\0${sid}\0${rid}`);
  const dateKey = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
  const safeID = (value, name) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
      throw fail('INVALID_INPUT', `${name}格式不正确`);
    return value;
  };
  const ready = async type => {
    const state = await provider.ready();
    if (!state[type === 'asr' ? 'voiceReady' : 'textReady'])
      throw fail('CONFIG_REQUIRED', type === 'asr' ? '语音识别尚未配置，请先使用文字输入' : 'AI裁判尚未配置，请按部署说明设置云端密钥');
  };
  const publicSession = s => {
    const p = s.puzzle || {};
    const result = {
      id: s.id, puzzleId: s.puzzleId, puzzleVersion: s.puzzleVersion,
      title: s.title, difficulty: s.difficulty, surface: s.surface, state: s.state,
      messages: (s.messages || []).map(m => ({ id: m.id, type: m.type, text: m.text, answer: m.answer, createdAt: m.createdAt,
        ...(m.answer === 'clarify' && CLARIFY_REASONS.has(m.clarifyReason) ? { clarifyReason: m.clarifyReason } : {}) })),
      hints: (p.hints || []).slice(0, s.hintCount || 0), hintCount: s.hintCount || 0, maxHints: 3,
      questionCount: s.questionCount || 0, maxQuestions: s.maxQuestions ?? null, guessFailures: s.guessFailures || 0,
      maxGuessFailures: config.guessFailures, attempts: s.attempts || 0,
      maxAttempts: config.sessionJudge, expiresAt: s.expiresAt,
      activeRequestId: s.activeRequestId || null
    };
    result.ranked = Boolean(s.ranked); result.points = s.points || 0;
    if (s.state === 'solved' || s.state === 'revealed') result.solution = p.solution;
    return result;
  };
  async function owned(tx, uid, sid, playing = false) {
    safeID(sid, '会话ID');
    const s = await tx.get('sessions', sid);
    if (!s || s.userId !== uid) throw fail('NOT_FOUND', '找不到这局游戏');
    if (s.expiresAt <= now() && !['cleared', 'expired'].includes(s.state)) {
      s.state = 'expired'; s.version++; s.messages = []; s.puzzle = null; s.activeRequestId = null;
      await tx.set('sessions', sid, s);
    }
    if (playing && s.state !== 'playing') throw fail('SESSION_ENDED', '这局已经结束，请重新开局');
    return s;
  }
  function exposeRequest(r, s) {
    const data = { requestId: r.requestId, status: r.status };
    if (r.status === 'succeeded') {
      if (r.transcript) data.transcript = r.transcript;
      if (r.answer) data.answer = r.answer;
      if (r.usage) data.usage = r.usage;
    }
    if (r.error) data.error = r.error;
    if (s) data.session = publicSession(s);
    return data;
  }
  async function usage(tx, uid, time, type, amount = 1) {
    const day = dateKey(time), gid = `global-${day}`, userKey = `user-${HASH(uid).slice(0,24)}-${day}`;
    const global = await tx.get('usage', gid) || { createdAt: time, expiresAt: time + 30 * DAY };
    const user = await tx.get('usage', userKey) || { createdAt: time, expiresAt: time + 30 * DAY };
    if ((global[type] || 0) + amount > config.globalDaily || (user[type] || 0) + amount > config.userDaily)
      throw fail('DAILY_LIMIT', '今日调用额度已用完，可以查看已解锁提示或揭底');
    global[type] = (global[type] || 0) + amount; user[type] = (user[type] || 0) + amount;
    await tx.set('usage', gid, global); await tx.set('usage', userKey, user);
  }
  async function recordUsage(tx, time, tokens) {
    const key = `global-${dateKey(time)}`, totals = await tx.get('usage', key);
    if (totals) {
      totals.inputTokens = finite(totals.inputTokens) + finite(tokens?.inputTokens);
      totals.outputTokens = finite(totals.outputTokens) + finite(tokens?.outputTokens);
      await tx.set('usage', key, totals);
    }
  }
  async function prior(uid, sid, rid, fingerprint) {
    return store.transaction(async tx => {
      const s = await owned(tx, uid, sid);
      const r = await tx.get('requests', requestKey(uid, sid, rid));
      if (!r) return null;
      if (r.fingerprint !== fingerprint) throw fail('REQUEST_CONFLICT', '相同请求ID不能提交不同内容');
      if (s.state === 'expired' || s.state === 'cleared') throw fail('SESSION_ENDED', '这局已结束或记录已清空');
      if (r.status === 'processing' && r.deadlineAt <= now()) {
        r.status = 'unknown'; r.error = { code: 'RESULT_UNKNOWN', message: '请求结果未知，服务可能已计费，请先查询状态' };
        await tx.set('requests', r.id, r);
      }
      return exposeRequest(r, s);
    });
  }
  async function reserve(uid, args, kind, fingerprint) {
    return store.transaction(async tx => {
      const s = await owned(tx, uid, args.sessionId, true);
      const key = requestKey(uid, s.id, args.requestId);
      const exists = await tx.get('requests', key);
      if (exists) {
        if (exists.fingerprint !== fingerprint) throw fail('REQUEST_CONFLICT', '相同请求ID不能提交不同内容');
        return { prior: exposeRequest(exists, s) };
      }
      if (s.mode === 'voice-practice' && kind !== 'asr') throw fail('INVALID_ACTION', '输入练习不支持正式判题');
      if (s.activeRequestId) {
        const old = await tx.get('requests', requestKey(uid, s.id, s.activeRequestId));
        if (old && old.status === 'processing' && old.deadlineAt <= now()) old.status = 'unknown';
        if (old && old.status === 'processing') throw fail('BUSY', '上一条请求仍在处理');
        if (old && old.status === 'unknown') {
          if (args.replaceRequestId !== old.requestId) throw fail('RESULT_UNKNOWN', '上一条结果未知，请确认后再新建尝试');
          old.status = 'superseded'; delete old.transcript; delete old.text;
          await tx.set('requests', old.id, old);
        }
      }
      if (kind !== 'asr' && s.attempts >= config.sessionJudge) throw fail('SESSION_LIMIT', '本局调用已到上限，可以看提示或揭底');
      if (kind === 'guess' && s.guessFailures >= config.guessFailures) throw fail('GUESS_LIMIT', '本局猜底机会已用完，可以查看提示或揭底');
      await usage(tx, uid, now(), kind === 'asr' ? 'asr' : 'judge');
      if (kind !== 'asr') s.attempts++;
      const r = { id: key, userId: uid, sessionId: s.id, requestId: args.requestId,
        kind, fingerprint, text: args.text || '', status: 'processing',
        version: s.version, createdAt: now(), deadlineAt: now() + config.requestTimeoutMs,
        expiresAt: s.expiresAt, dispatchedAt: now(), audioSeconds: args.audioSeconds || 0 };
      if (kind === 'asr') {
        const gid = `global-${dateKey(r.createdAt)}`, totals = await tx.get('usage', gid);
        totals.reservedAudioSeconds = finite(totals.reservedAudioSeconds) + r.audioSeconds;
        await tx.set('usage', gid, totals);
      }
      s.activeRequestId = args.requestId;
      await tx.set('requests', key, r); await tx.set('sessions', s.id, s);
      return { request: r, session: s };
    });
  }
  async function finish(uid, request, output, error) {
    return store.transaction(async tx => {
      const r = await tx.get('requests', request.id);
      const s = await tx.get('sessions', request.sessionId);
      if (!r || !s || s.userId !== uid) return { requestId: request.requestId, status: 'superseded' };
      const current = s.state === 'playing' && s.expiresAt > now() && s.version === request.version && s.activeRequestId === request.requestId;
      if (!current || r.status === 'superseded') {
        r.status = 'superseded'; delete r.text; delete r.transcript;
      } else if (error) {
        const code = error.code || error.name;
        // Private diagnostic code only; never persist provider messages or raw output.
        r.failureCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'INTERNAL_ERROR';
        r.status = UNCERTAIN_ERRORS.has(code) ? 'unknown' : 'failed';
        r.error = { code: r.status === 'unknown' ? 'RESULT_UNKNOWN' : KNOWN_ERRORS[code] ? code : 'SERVICE_ERROR',
          message: r.status === 'unknown' ? '请求结果未知，服务可能已计费，请先查询状态' : KNOWN_ERRORS[code] || '服务未能完成，请稍后手动重试' };
        if (r.status === 'failed') s.activeRequestId = null;
      } else {
        r.status = 'succeeded'; r.usage = output.usage;
        if (request.kind === 'asr') r.transcript = output.text;
        else {
          r.answer = output.answer;
          s.messages.push({ id: request.requestId, type: request.kind, text: request.text, answer: output.answer, createdAt: now(),
            ...(output.clarifyReason ? { clarifyReason: output.clarifyReason } : {}) });
          if (request.kind === 'question' && EFFECTIVE_ANSWERS.has(output.answer)) {
            s.questionCount++;
            if (s.maxQuestions && s.questionCount >= s.maxQuestions) s.state = 'revealed';
          }
          if (request.kind === 'guess' && output.answer === 'incorrect') s.guessFailures++;
          if (output.answer === 'solved') s.state = 'solved';
          if (s.mode === 'solo') await ranking.settle(tx, s, [{ uid, eligible: s.ranked }], 'solo', now());
        }
        s.activeRequestId = null; s.updatedAt = now();
      }
      if (output && !r.usageRecorded) {
        const gid = `global-${dateKey(request.createdAt)}`, totals = await tx.get('usage', gid);
        if (totals) {
          totals.inputTokens = finite(totals.inputTokens) + finite(output.usage?.inputTokens);
          totals.outputTokens = finite(totals.outputTokens) + finite(output.usage?.outputTokens);
          totals.completedAudioSeconds = finite(totals.completedAudioSeconds) + finite(output.usage?.audioSeconds);
          await tx.set('usage', gid, totals);
        }
        r.usageRecorded = true;
      }
      r.completedAt = now();
      await tx.set('requests', r.id, r); await tx.set('sessions', s.id, s);
      return exposeRequest(r, s);
    });
  }
  async function external(task) {
    let timer;
    try {
      return await Promise.race([task(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail('UPSTREAM_TIMEOUT', 'timeout')), config.requestTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function removeFile(upload) {
    if (upload.fileID) await audio.remove(upload.fileID);
    else if (audio.removeByPath) await audio.removeByPath(upload.cloudPath);
    else throw fail('CLEANUP_PENDING', '尚未配置孤立文件清理');
  }
  async function eraseContent(uid, sid) {
    for (const r of await store.scan('requests')) if (r.userId === uid && r.sessionId === sid) {
      await store.transaction(tx => tx.delete('requests', r.id));
    }
    for (const u of await store.scan('uploads')) if (u.userId === uid && u.sessionId === sid) {
      try { await removeFile(u); await store.transaction(tx => tx.delete('uploads', u.id)); } catch (_) { /* retry at cleanup */ }
    }
  }
  async function run(action, args, uid) {
    if (typeof uid !== 'string' || !uid || uid.length > 200) throw fail('AUTH_REQUIRED', '请在微信中登录后重试');
    if (!args || typeof args !== 'object') args = {};
    if (rooms.actions.has(action)) return rooms.run(action, args, uid);
    if (action === 'status') {
      const state = await provider.ready();
      return { configured: !!(state.textReady && state.voiceReady), textReady: !!state.textReady, voiceReady: !!state.voiceReady, environment: 'cloud', ownerKey: HASH(uid).slice(0,24) };
    }
    if (action === 'listPuzzles') return { puzzles: puzzles.map(p => ({ id: p.id, title: p.title, difficulty: p.difficulty, teaser: p.teaser,
      ...(p.level ? { level: p.level, genre: p.genre, contentTags: p.contentTags } : {}) })) };
    if (action === 'startSolo' || action === 'startVoicePractice' || action === 'startTutorial') {
      const practice = action === 'startVoicePractice';
      const tutorial = action === 'startTutorial';
      if (practice) await ready('asr');
      if (tutorial) await ready('text');
      const p = practice ? { id: 'voice-practice', version: 1, title: '语音输入练习', difficulty: '练习', surface: '', hints: [] } : tutorial ? tutorialPuzzle : puzzles.find(p => p.id === args.puzzleId);
      if (!p) throw fail('INVALID_PUZZLE', '请选择有效题目');
      const s = { id: idFactory(), userId: uid, puzzleId: p.id, puzzleVersion: p.version,
        puzzle: structuredClone(p), title: p.title, difficulty: p.difficulty, surface: p.surface,
        mode: practice ? 'voice-practice' : tutorial ? 'tutorial' : 'solo',
        state: 'playing', version: 1, messages: [], hintCount: 0, questionCount: 0, maxQuestions: practice ? null : config.questionLimit,
        guessFailures: 0, attempts: 0, activeRequestId: null, createdAt: now(), expiresAt: now() + (practice || tutorial ? 3600000 : config.sessionDays * DAY) };
      await store.transaction(async tx => {
        await usage(tx, uid, now(), 'starts');
        if (s.mode === 'solo') s.ranked = await ranking.claim(tx, uid, p, s.id);
        await tx.set('sessions', s.id, s);
      });
      return { session: publicSession(s) };
    }
    if (action === 'getSession') return store.transaction(async tx => ({ session: publicSession(await owned(tx, uid, args.sessionId)) }));
    if (action === 'getSpeech') {
      await ready('text');
      if (!provider.speak) throw fail('CONFIG_REQUIRED', '人声播报尚未配置');
      const text = await store.transaction(async tx => {
        const s = await owned(tx, uid, args.sessionId);
        if (s.mode === 'voice-practice' || ['cleared', 'expired'].includes(s.state)) throw fail('SESSION_ENDED', '这局已结束或记录已清空');
        const value = speechText(s, args.target, args.messageId);
        await usage(tx, uid, now(), 'speech');
        return value;
      });
      return provider.speak({ text });
    }
    if (action === 'getRequest') {
      safeID(args.requestId, '请求ID');
      return store.transaction(async tx => {
        const s = await owned(tx, uid, args.sessionId);
        if (s.state === 'expired' || s.state === 'cleared') throw fail('SESSION_ENDED', '这局已结束或记录已清空');
        const r = await tx.get('requests', requestKey(uid, s.id, args.requestId));
        if (!r) throw fail('NOT_FOUND', '找不到这条请求');
        if (r.status === 'processing' && r.deadlineAt <= now()) {
          r.status = 'unknown'; r.error = { code: 'RESULT_UNKNOWN', message: '结果未知，服务可能已计费' };
          await tx.set('requests', r.id, r);
        }
        return exposeRequest(r, s);
      });
    }
    if (['getHint', 'revealSoup', 'clearSession'].includes(action)) {
      const result = await store.transaction(async tx => {
        const s = await owned(tx, uid, args.sessionId, action !== 'clearSession');
        if (s.mode === 'voice-practice' && action !== 'clearSession') throw fail('INVALID_ACTION', '输入练习不支持正式游戏操作');
        if (action === 'getHint') s.hintCount = Math.min(3, (s.puzzle.hints || []).length, s.hintCount + 1);
        else {
          s.version++; s.activeRequestId = null;
          if (action === 'revealSoup') s.state = 'revealed';
          else { s.state = 'cleared'; s.messages = []; s.puzzle = null; s.hintCount = 0; }
        }
        if (s.mode === 'solo') await ranking.settle(tx, s, [{ uid, eligible: s.ranked }], 'solo', now());
        await tx.set('sessions', s.id, s);
        return action === 'clearSession' ? { cleared: true } : { session: publicSession(s) };
      });
      if (action === 'clearSession') {
        await eraseContent(uid, args.sessionId);
        await store.transaction(tx => tx.delete('sessions', args.sessionId));
      }
      return result;
    }
    if (action === 'feedback') {
      if (!['wrong_answer', 'puzzle_issue'].includes(args.kind)) throw fail('INVALID_INPUT', '反馈类型无效');
      return store.transaction(async tx => {
        const s = await owned(tx, uid, args.sessionId);
        if (args.messageId && !(s.messages || []).some(m => m.id === args.messageId)) throw fail('INVALID_INPUT', '问答记录不存在');
        const id = HASH(`${uid}\0${s.id}\0${args.messageId || ''}\0${args.kind}`);
        await tx.set('feedback', id, { sessionId: s.id, puzzleId: s.puzzleId, messageId: args.messageId || null,
          kind: args.kind, createdAt: now(), expiresAt: now() + 7 * DAY });
        return { received: true };
      });
    }
    if (action === 'registerUpload') {
      return store.transaction(async tx => {
        const s = await owned(tx, uid, args.sessionId, true);
        await usage(tx, uid, now(), 'uploads');
        const id = idFactory(), path = `audio/${HASH(uid).slice(0,24)}/${s.id}/${id}.${audio.extension === 'wav' ? 'wav' : 'mp3'}`;
        await tx.set('uploads', id, { userId: uid, sessionId: s.id, cloudPath: path, fileID: null,
          // Reserve an hour for the normal hourly cleanup, targeting deletion within 24 hours.
          consumed: false, createdAt: now(), expiresAt: now() + 23 * 3600000 });
        return { uploadId: id, cloudPath: path };
      });
    }
    if (action === 'confirmUpload') {
      return store.transaction(async tx => {
        await owned(tx, uid, args.sessionId, true);
        const id = safeID(args.uploadId, '录音ID'), u = await tx.get('uploads', id);
        if (!u || u.userId !== uid || u.sessionId !== args.sessionId || u.expiresAt <= now() || u.consumed)
          throw fail('INVALID_UPLOAD', '录音登记不存在或已过期');
        if (!validFileID(args.fileID, u.cloudPath) || (u.fileID && u.fileID !== args.fileID))
          throw fail('INVALID_UPLOAD', '录音路径不匹配');
        u.fileID = args.fileID; await tx.set('uploads', id, u);
        return { confirmed: true };
      });
    }
    if (action === 'discardUpload') {
      const upload = await store.transaction(async tx => {
        await owned(tx, uid, args.sessionId);
        const u = await tx.get('uploads', safeID(args.uploadId, '录音ID'));
        if (!u || u.userId !== uid || u.sessionId !== args.sessionId) throw fail('NOT_FOUND', '找不到录音');
        if (args.fileID && validFileID(args.fileID, u.cloudPath)) u.fileID = args.fileID;
        return { ...u, id: args.uploadId };
      });
      await removeFile(upload); await store.transaction(tx => tx.delete('uploads', upload.id));
      return { discarded: true };
    }
    if (!['askQuestion', 'guessAnswer', 'transcribeAudio'].includes(action)) throw fail('INVALID_ACTION', '不支持的操作');
    const kind = action === 'transcribeAudio' ? 'asr' : action === 'guessAnswer' ? 'guess' : 'question';
    safeID(args.requestId, '请求ID'); safeID(args.sessionId, '会话ID');
    const input = { ...args };
    if (kind !== 'asr') {
      input.text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!input.text || [...input.text].length > (kind === 'guess' ? 500 : 200)) throw fail('INVALID_INPUT', '请输入有效文字，提问最多200字，猜底最多500字');
    }
    const fingerprint = HASH(JSON.stringify([kind, input.text || '', input.uploadId || '', input.fileID || '']));
    const previous = await prior(uid, input.sessionId, input.requestId, fingerprint);
    if (previous) return previous;
    await ready(kind);
    let recording, upload;
    if (kind === 'asr') {
      upload = await store.transaction(async tx => {
        await owned(tx, uid, input.sessionId, true);
        const u = await tx.get('uploads', safeID(input.uploadId, '录音ID'));
        if (!u || u.userId !== uid || u.sessionId !== input.sessionId || u.expiresAt <= now() || u.consumed)
          throw fail('INVALID_UPLOAD', '录音不可用，请重新录制');
        if (!validFileID(input.fileID, u.cloudPath) || (u.fileID && u.fileID !== input.fileID)) throw fail('INVALID_UPLOAD', '录音路径不匹配');
        await usage(tx, uid, now(), 'audioInspections');
        u.fileID = input.fileID; await tx.set('uploads', input.uploadId, u); return u;
      });
      recording = await audio.inspect({ fileID: input.fileID, cloudPath: upload.cloudPath });
      if (!recording || !Buffer.isBuffer(recording.buffer) || recording.buffer.length > 1024 * 1024 || !Number.isFinite(recording.durationSeconds) || recording.durationSeconds <= 0 || recording.durationSeconds > 20)
        throw fail('INVALID_AUDIO', '录音格式不正确或超过20秒限制');
      input.audioSeconds = recording.durationSeconds;
    }
    const reserved = await reserve(uid, input, kind, fingerprint);
    if (reserved.prior) return reserved.prior;
    let result, externalError;
    try {
      result = await external(async () => {
        const o = kind === 'asr' ? await provider.transcribe({ buffer: recording.buffer, mimeType: recording.mimeType || 'audio/mpeg' })
          : await provider.judge({ puzzle: reserved.session.puzzle, history: reserved.session.messages,
            text: input.text, kind });
        if (kind === 'asr') {
          if (!o || typeof o.text !== 'string' || !o.text.trim() || o.text.length > 2000) throw fail('INVALID_MODEL_OUTPUT', 'invalid output');
          return { text: o.text.trim(), usage: { audioSeconds: recording.durationSeconds } };
        }
        if (!o || !(kind === 'guess' ? GUESS : QUESTION).has(o.answer)) throw fail('INVALID_MODEL_OUTPUT', 'invalid output');
        return { answer: o.answer, ...(o.answer === 'clarify' && CLARIFY_REASONS.has(o.clarifyReason) ? { clarifyReason: o.clarifyReason } : {}),
          usage: { inputTokens: finite(o.usage?.inputTokens), outputTokens: finite(o.usage?.outputTokens) } };
      });
    } catch (error) { externalError = error; }
    const response = await finish(uid, reserved.request, result, externalError);
    if (kind === 'asr' && (response.status === 'succeeded' || ['EMPTY_TRANSCRIPT', 'TRANSCRIPT_TOO_LONG'].includes(response.error?.code))) {
      await store.transaction(async tx => {
        const u = await tx.get('uploads', input.uploadId);
        if (u) { u.consumed = true; await tx.set('uploads', input.uploadId, u); }
      });
      try { await removeFile({ ...upload, fileID: input.fileID }); await store.transaction(tx => tx.delete('uploads', input.uploadId)); } catch (_) { /* cleanup retries */ }
    }
    return response;
  }
  function validFileID(fileID, cloudPath) {
    return typeof fileID === 'string' && fileID.length < 1500 && fileID.startsWith('cloud://') && fileID.endsWith(`/${cloudPath}`) && !fileID.includes('..') && !/[?#\\]/.test(fileID);
  }
  return {
    async handle(action, args, userId) {
      try { return { ok: true, data: await run(action, args, userId) }; }
      catch (error) { return { ok: false, error: { code: error.code || 'SERVICE_ERROR', message: error.public ? error.message : KNOWN_ERRORS[error.code] || '服务暂时不可用，请稍后重试', retryable: false } }; }
    },
    async cleanup() {
      await rooms.cleanup();
      const stats = { sessions: 0, requests: 0, uploads: 0, usage: 0, feedback: 0, pendingUploads: 0 };
      for (const s of await store.scan('sessions')) if (s.expiresAt <= now() || s.state === 'cleared') {
        await store.transaction(async tx => {
          const current = await tx.get('sessions', s.id);
          if (current) { current.state = current.state === 'cleared' ? 'cleared' : 'expired'; current.version++; current.activeRequestId = null; current.messages = []; current.puzzle = null; current.hintCount = 0; await tx.set('sessions', s.id, current); }
        });
        await eraseContent(s.userId, s.id);
        await store.transaction(tx => tx.delete('sessions', s.id));
        stats.sessions++;
      }
      for (const r of await store.scan('requests')) if (r.expiresAt <= now()) { await store.transaction(tx => tx.delete('requests', r.id)); stats.requests++; }
      for (const u of await store.scan('uploads')) if (u.expiresAt <= now()) {
        try { await removeFile(u); await store.transaction(tx => tx.delete('uploads', u.id)); stats.uploads++; }
        catch (_) { stats.pendingUploads++; }
      }
      for (const c of ['usage', 'feedback']) for (const v of await store.scan(c)) if (v.expiresAt <= now()) { await store.transaction(tx => tx.delete(c, v.id)); stats[c]++; }
      return stats;
    }
  };
}

module.exports = { createService };
