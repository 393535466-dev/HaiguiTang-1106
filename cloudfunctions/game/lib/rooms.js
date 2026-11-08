'use strict';
const crypto = require('node:crypto');
const ranking = require('./ranking');
const { speechText } = require('./speech');
const fail = (code, message) => Object.assign(new Error(message), { code, public: true });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const effective = new Set(['yes', 'no', 'irrelevant']);
const unknown = new Set(['UPSTREAM_TIMEOUT', 'TIMEOUT', 'NETWORK_ERROR', 'RESULT_UNKNOWN', 'AbortError']);
const actions = new Set(['getProfile', 'saveProfile', 'getLeaderboard', 'createRoom', 'joinRoom', 'getRoom', 'startRoom', 'leaveRoom', 'roomChat', 'roomQuestion', 'roomGuess', 'getRoomRequest', 'skipRoomTurn', 'roomHint', 'revealRoom', 'getRoomSpeech']);
function createRooms({ store, provider, puzzles, usage, recordUsage, clock, idFactory, limits }) {
  const now = clock;
  const requestKey = (uid, room, request) => hash(JSON.stringify([uid, room, request]));
  const validId = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw fail('INVALID_INPUT', '操作编号无效'); return value; };
  const members = r => r.members.filter(m => !m.left);
  const mine = (r, uid) => r.members.find(m => m.uid === uid && !m.left);
  const add = (r, message) => { r.messages.push({ id: idFactory(), createdAt: now(), ...message }); r.messages = r.messages.slice(-200); };
  const publicRoom = (r, uid) => ({ id: r.id, title: r.puzzle.title, surface: r.puzzle.surface, state: r.state, revision: r.revision,
    members: members(r).map(m => ({ id: m.id, nickname: m.nickname, online: now() - m.lastSeen < 45000, isHost: m.uid === r.hostId, isMe: m.uid === uid, eligible: Boolean(m.eligible) })),
    meId: ranking.playerId(uid), isHost: r.hostId === uid, myTurn: r.turnOwner === uid && r.state === 'playing',
    turnName: r.members.find(m => m.uid === r.turnOwner)?.nickname || '', turnSerial: r.turnSerial, turnDeadlineAt: r.turnDeadlineAt,
    messages: r.messages.map(m => ({ ...m })), hints: r.puzzle.hints.slice(0, r.hintCount), questionCount: r.questionCount,
    maxQuestions: limits.questionLimit, hintCount: r.hintCount, guessFailures: r.guessFailures,
    active: r.active ? { requestId: r.active.requestId, kind: r.active.kind, mine: r.active.uid === uid, status: now() >= r.active.deadlineAt ? 'unknown' : 'processing' } : null,
    points: r.points || 0, ranked: Boolean(mine(r, uid)?.eligible), expiresAt: r.expiresAt,
    ...(['solved', 'revealed'].includes(r.state) ? { solution: r.puzzle.solution } : {}) });
  async function room(tx, id, uid) {
    if (typeof id !== 'string' || !/^\d{6}$/.test(id)) throw fail('INVALID_ROOM', '请输入六位房间号');
    const r = await tx.get('rooms', id);
    if (!r || r.expiresAt <= now() || r.state === 'closed') throw fail('ROOM_ENDED', '房间已结束或过期，请重新创建');
    if (!mine(r, uid)) throw fail('ROOM_FORBIDDEN', '请先通过房间号加入');
    return r;
  }
  async function invalidate(tx, r) {
    if (r.active) { const req = await tx.get('roomRequests', r.active.key); if (req) { req.status = 'superseded'; await tx.set('roomRequests', r.active.key, req); } r.active = null; }
  }
  async function next(tx, r, reason) {
    await invalidate(tx, r);
    const old = r.members.findIndex(m => m.uid === r.turnOwner);
    for (let n = 1; n <= r.members.length; n++) { const m = r.members[(old + n + r.members.length) % r.members.length]; if (!m.left) { r.turnOwner = m.uid; break; } }
    r.turnSerial++; r.turnDeadlineAt = now() + 90000; r.revision++;
    if (reason) add(r, { type: 'system', text: reason });
  }
  async function refresh(tx, r) {
    if (r.state === 'playing' && now() >= r.turnDeadlineAt && (!r.active || now() >= r.active.deadlineAt)) await next(tx, r, '本轮等待结束，已交给下一位。');
  }
  function turn(r, uid, serial) {
    if (r.state !== 'playing') throw fail('ROOM_NOT_PLAYING', '这局还未开始或已经结束');
    if (r.turnOwner !== uid || serial !== r.turnSerial) throw fail('NOT_YOUR_TURN', '轮次已变化，请查看当前轮到谁；你的草稿会保留');
  }
  async function checked(text, max) {
    if (typeof text !== 'string' || !text.trim() || [...text.trim()].length > max) throw fail('INVALID_INPUT', '请填写 1 至 ' + max + ' 字');
    if (!provider.checkText) throw fail('CONTENT_CHECK_UNAVAILABLE', '内容检查尚未配置');
    await provider.checkText(text.trim()); return text.trim();
  }
  async function ready() { if (!(await provider.ready()).textReady) throw fail('CONFIG_REQUIRED', '请先连接 AI 主持'); }
  async function run(action, args, uid) {
    if (action === 'getProfile') return store.transaction(async tx => ({ profile: await ranking.profile(tx, uid) }));
    if (action === 'saveProfile') {
      const nickname = await checked(args.nickname, 12);
      return store.transaction(async tx => {
        await usage(tx, uid, now(), 'profiles'); const p = { playerId: ranking.playerId(uid), nickname };
        await tx.set('profiles', ranking.profileKey(uid), p);
        for (const mode of ['solo', 'friends']) { const key = mode + '-' + p.playerId, score = await tx.get('rankings', key); if (score) { score.nickname = nickname; await tx.set('rankings', key, score); } }
        return { profile: p };
      });
    }
    if (action === 'getLeaderboard') return ranking.board(store, uid, args.mode === 'friends' ? 'friends' : 'solo');
    if (action === 'createRoom') {
      await ready(); const puzzle = puzzles.find(p => p.id === args.puzzleId); if (!puzzle) throw fail('INVALID_PUZZLE', '请选择题目');
      for (let n = 0; n < 10; n++) {
        const code = String(crypto.randomInt(100000, 1000000));
        const result = await store.transaction(async tx => {
          if (await tx.get('rooms', code)) return null;
          await usage(tx, uid, now(), 'roomStarts'); const p = await ranking.profile(tx, uid);
          const r = { id: code, gameId: idFactory(), hostId: uid, puzzle: structuredClone(puzzle), state: 'waiting',
            members: [{ uid, id: p.playerId, nickname: p.nickname, joinedAt: now(), lastSeen: now(), left: false }],
            messages: [], judgeHistory: [], hintCount: 0, questionCount: 0, guessFailures: 0, attempts: 0, active: null,
            turnOwner: uid, turnSerial: 1, turnDeadlineAt: 0, revision: 1, createdAt: now(), expiresAt: now() + 86400000 };
          await tx.set('rooms', code, r); return { room: publicRoom(r, uid) };
        }); if (result) return result;
      } throw fail('BUSY', '暂时无法创建房间，请稍后再试');
    }
    if (action === 'joinRoom') {
      await ready();
      // Count failed code guesses too, before looking up any room.
      await store.transaction(tx => usage(tx, uid, now(), 'roomJoins'));
      return store.transaction(async tx => {
        const code = String(args.roomId || '').trim();
        if (!/^\d{6}$/.test(code)) throw fail('INVALID_ROOM', '请输入六位房间号');
        const r = await tx.get('rooms', code);
        if (!r || r.expiresAt <= now() || r.state === 'closed') throw fail('ROOM_ENDED', '房间不存在或已结束');
        if (!mine(r, uid)) {
          if (r.state !== 'waiting') throw fail('ROOM_STARTED', '房间已经开局，请等下一局');
          if (members(r).length >= 6) throw fail('ROOM_FULL', '房间已满，最多六人');
          const p = await ranking.profile(tx, uid), old = r.members.find(m => m.uid === uid);
          const m = { uid, id: p.playerId, nickname: p.nickname, joinedAt: now(), lastSeen: now(), left: false };
          if (old) Object.assign(old, m); else r.members.push(m);
          add(r, { type: 'system', text: p.nickname + ' 加入了房间。' });
        }
        mine(r, uid).lastSeen = now(); r.revision++; await tx.set('rooms', code, r);
        return { room: publicRoom(r, uid) };
      });
    }
    if (action === 'getRoom') return store.transaction(async tx => {
      const r = await room(tx, args.roomId, uid), revision = r.revision; await refresh(tx, r);
      const m = mine(r, uid); if (now() - m.lastSeen > 15000) { m.lastSeen = now(); r.revision++; }
      if (r.revision !== revision) await tx.set('rooms', r.id, r); return { room: publicRoom(r, uid) };
    });
    if (action === 'getRoomRequest') return store.transaction(async tx => {
      const r = await room(tx, args.roomId, uid), key = requestKey(uid, r.id, validId(args.requestId));
      const q = await tx.get('roomRequests', key); if (!q) throw fail('NOT_FOUND', '找不到这次操作');
      return { status: q.status === 'processing' && q.deadlineAt <= now() ? 'unknown' : q.status, error: q.error, room: publicRoom(r, uid) };
    });
    if (action === 'getRoomSpeech') {
      await ready(); const text = await store.transaction(async tx => {
        const r = await room(tx, args.roomId, uid);
        const value = speechText({ ...r, title: r.puzzle.title, surface: r.puzzle.surface }, args.target, args.messageId);
        await usage(tx, uid, now(), 'speech'); return value;
      }); return provider.speak({ text });
    }
    if (['roomQuestion', 'roomGuess'].includes(action)) {
      const kind = action === 'roomGuess' ? 'guess' : 'question';
      validId(args.requestId); await ready();
      if (typeof args.text !== 'string' || !args.text.trim() || [...args.text].length > (kind === 'guess' ? 500 : 200)) throw fail('INVALID_INPUT', '请缩短内容后再提交');
      const text = args.text.trim(), fingerprint = hash(JSON.stringify([kind, text, args.turnSerial]));
      const reserve = await store.transaction(async tx => {
        const r = await room(tx, args.roomId, uid), key = requestKey(uid, r.id, args.requestId), previous = await tx.get('roomRequests', key);
        if (previous) { if (previous.fingerprint !== fingerprint) throw fail('REQUEST_CONFLICT', '相同操作编号不能更换内容'); return { prior: { status: previous.status === 'processing' && previous.deadlineAt <= now() ? 'unknown' : previous.status, error: previous.error, room: publicRoom(r, uid) } }; }
        await refresh(tx, r); turn(r, uid, args.turnSerial);
        if (r.active) throw fail('BUSY', '主持人仍在处理，请先查询原结果，或主动跳过这一轮');
        if (r.attempts >= limits.sessionJudge) throw fail('SESSION_LIMIT', '本局主持调用已到上限，可查看提示或由房主揭底');
        await usage(tx, uid, now(), 'judge'); r.attempts++;
        const q = { uid, roomId: r.id, fingerprint, status: 'processing', createdAt: now(), deadlineAt: now() + limits.requestTimeoutMs, expiresAt: r.expiresAt };
        r.active = { key, uid, requestId: args.requestId, kind, turnSerial: r.turnSerial, deadlineAt: q.deadlineAt };
        r.revision++; await tx.set('roomRequests', key, q); await tx.set('rooms', r.id, r);
        return { key, room: r, q };
      });
      if (reserve.prior) return reserve.prior;
      let result, error, timer;
      try {
        result = await Promise.race([provider.judge({ puzzle: reserve.room.puzzle, history: reserve.room.judgeHistory || [], text, kind }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(fail('UPSTREAM_TIMEOUT', 'timeout')), limits.requestTimeoutMs); })]);
        if (!(kind === 'question' ? ['yes','no','irrelevant','unspecified','clarify'] : ['solved','incomplete','incorrect','uncertain']).includes(result?.answer)) throw fail('INVALID_MODEL_OUTPUT', '无效判定');
      } catch (e) { error = e; } finally { clearTimeout(timer); }
      return store.transaction(async tx => {
        const r = await tx.get('rooms', args.roomId), q = await tx.get('roomRequests', reserve.key);
        if (!r || !q) return { status: 'superseded' };
        if (result && !q.usageRecorded) { await recordUsage(tx, q.createdAt, result.usage); q.usageRecorded = true; }
        if (r.state !== 'playing' || r.expiresAt <= now() || r.active?.key !== reserve.key || r.turnSerial !== args.turnSerial || !mine(r, uid)) q.status = 'superseded';
        else if (error) {
          q.status = unknown.has(error.code) ? 'unknown' : 'failed';
          q.error = { code: q.status === 'unknown' ? 'RESULT_UNKNOWN' : error.code === 'CONTENT_BLOCKED' ? 'CONTENT_BLOCKED' : 'HOST_ERROR', message: q.status === 'unknown' ? '本次结果未知，请先查询原结果；跳过不会自动重新收费调用。' : error.code === 'CONTENT_BLOCKED' ? '请调整文字后再提交' : '主持人这次未能完成判定，草稿已保留，可以重新提交。' };
          if (q.status === 'failed') r.active = null;
        } else {
          q.status = 'succeeded'; r.active = null;
          const m = mine(r, uid);
          add(r, { id: reserve.key, type: kind, playerId: m.id, nickname: m.nickname, text, answer: result.answer, ...(result.clarifyReason ? { clarifyReason: result.clarifyReason } : {}) });
          if (kind === 'question') r.judgeHistory = [...(r.judgeHistory || []), { type: kind, text, answer: result.answer }].slice(-12);
          if (kind === 'question' && effective.has(result.answer)) r.questionCount++;
          if (kind === 'guess' && result.answer === 'incorrect') r.guessFailures++;
          if (result.answer === 'solved') r.state = 'solved';
          else if (r.questionCount >= limits.questionLimit || r.guessFailures >= limits.guessFailures) r.state = 'revealed';
          if (r.state !== 'playing') await ranking.settle(tx, r, r.members, 'friends', now());
          else if (kind === 'guess' || effective.has(result.answer)) await next(tx, r);
        }
        r.revision++; await tx.set('roomRequests', reserve.key, q); await tx.set('rooms', r.id, r);
        if (!mine(r, uid) || r.expiresAt <= now() || r.state === 'closed') return { status: 'superseded' };
        return { status: q.status, error: q.error, room: publicRoom(r, uid) };
      });
    }
    // Social text is checked before any public write. No LLM judge on discussion.
    if (action === 'startRoom') await ready();
    let chatText;
    if (action === 'roomChat') {
      await store.transaction(async tx => { await room(tx, args.roomId, uid); await usage(tx, uid, now(), 'discussions'); });
      chatText = await checked(args.text, 200); validId(args.requestId);
    }
    return store.transaction(async tx => {
      const r = await room(tx, args.roomId, uid); await refresh(tx, r);
      if (action === 'startRoom') {
        if (r.hostId !== uid) throw fail('HOST_ONLY', '只有房主可以开始');
        if (r.state !== 'waiting') return { room: publicRoom(r, uid) };
        if (members(r).length < 2) throw fail('NEED_PLAYERS', '至少两名玩家才能开局');
        for (const m of members(r)) m.eligible = await ranking.claim(tx, m.uid, r.puzzle, r.gameId);
        r.state = 'playing'; r.turnOwner = uid; r.turnDeadlineAt = now() + 90000;
        add(r, { type: 'system', text: '开始推理。每轮 90 秒，澄清后可继续问；讨论不会消耗提问次数。' });
      } else if (action === 'leaveRoom') {
        mine(r, uid).left = true;
        add(r, { type: 'system', text: r.members.find(m => m.uid === uid).nickname + ' 离开了房间。' });
        if (!members(r).length) { await invalidate(tx, r); r.state = 'closed'; }
        else { if (r.hostId === uid) r.hostId = members(r)[0].uid; if (r.turnOwner === uid && r.state === 'playing') await next(tx, r, '已交给下一位玩家。'); }
      } else if (action === 'roomChat') {
        if (!['waiting','playing'].includes(r.state)) throw fail('ROOM_ENDED', '本局已结束');
        const m = mine(r, uid), key = requestKey(uid, r.id, 'chat_' + args.requestId);
        const old = await tx.get('roomRequests', key);
        if (old) { if (old.fingerprint !== hash(chatText)) throw fail('REQUEST_CONFLICT', '相同编号不能更换讨论内容'); return { room: publicRoom(r, uid) }; }
        if (m.lastChatAt && now() - m.lastChatAt < 1000) throw fail('RATE_LIMITED', '发言太快，请稍等一秒');
        m.lastChatAt = now(); add(r, { type: 'discussion', playerId: m.id, nickname: m.nickname, text: chatText });
        await tx.set('roomRequests', key, { status: 'succeeded', fingerprint: hash(chatText), roomId: r.id, expiresAt: r.expiresAt });
      } else if (action === 'skipRoomTurn') {
        turn(r, uid, args.turnSerial); await next(tx, r, '当前玩家主动跳过，已交给下一位。');
      } else if (action === 'roomHint') {
        turn(r, uid, args.turnSerial); if (r.active) throw fail('BUSY', '请先等待主持人的本次回应');
        if (r.hintCount < 3) { r.hintCount++; add(r, { type: 'system', text: '解锁提示 ' + r.hintCount + '：' + r.puzzle.hints[r.hintCount - 1] }); }
      } else if (action === 'revealRoom') {
        if (r.hostId !== uid) throw fail('HOST_ONLY', '只有房主可以结束整局');
        if (r.state !== 'playing') throw fail('ROOM_NOT_PLAYING', '本局未在推理中');
        await invalidate(tx, r); r.state = 'revealed'; await ranking.settle(tx, r, r.members, 'friends', now());
      } else throw fail('INVALID_ACTION', '不支持的房间操作');
      r.revision++; await tx.set('rooms', r.id, r); return { room: action === 'leaveRoom' ? null : publicRoom(r, uid) };
    });
  }
  return { actions, run, async cleanup() {
    for (const r of await store.scan('rooms')) if (r.expiresAt <= now() || r.state === 'closed') await store.transaction(tx => tx.delete('rooms', r.id));
    for (const q of await store.scan('roomRequests')) if (q.expiresAt <= now()) await store.transaction(tx => tx.delete('roomRequests', q.id));
  } };
}
module.exports = { createRooms };
