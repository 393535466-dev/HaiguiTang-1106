'use strict';
const crypto = require('node:crypto');
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const playerId = uid => hash(uid).slice(0, 16);
const nameFor = uid => '玩家' + playerId(uid).slice(0, 4).toUpperCase();
const profileKey = uid => hash('profile:' + uid);
async function profile(tx, uid) {
  return await tx.get('profiles', profileKey(uid)) || { nickname: nameFor(uid), playerId: playerId(uid) };
}
// One first attempt per story version across both modes, reserved atomically at start.
async function claim(tx, uid, puzzle, gameId) {
  const key = hash(JSON.stringify([uid, puzzle.id, puzzle.version]));
  const old = await tx.get('rankClaims', key);
  if (old) return old.gameId === gameId;
  await tx.set('rankClaims', key, { gameId, playerId: playerId(uid), puzzleId: puzzle.id, version: puzzle.version });
  return true;
}
async function settle(tx, game, participants, mode, time) {
  if (game.rankSettled || !['solved', 'revealed'].includes(game.state)) return;
  const points = game.state === 'solved' ? Math.max(10, 100 - 2 * (game.questionCount || 0) - 10 * (game.hintCount || 0) - 10 * (game.guessFailures || 0)) : 0;
  game.points = points; game.rankSettled = true;
  for (const member of participants.filter(m => m.eligible && !m.left)) {
    const key = mode + '-' + playerId(member.uid), p = await profile(tx, member.uid);
    const record = await tx.get('rankings', key) || { mode, playerId: p.playerId, points: 0, wins: 0, played: 0, updatedAt: time };
    record.nickname = p.nickname; record.points += points; record.wins += game.state === 'solved' ? 1 : 0; record.played++; record.updatedAt = time;
    await tx.set('rankings', key, record);
  }
}
const compare = (a, b) => b.points - a.points || b.wins - a.wins || a.updatedAt - b.updatedAt || a.playerId.localeCompare(b.playerId);
async function board(store, uid, mode) {
  const rows = store.leaderboard ? await store.leaderboard(mode) : (await store.scan('rankings')).filter(r => r.mode === mode).sort(compare).slice(0, 20);
  const me = await store.transaction(tx => tx.get('rankings', mode + '-' + playerId(uid)));
  const clean = r => ({ id: r.playerId, nickname: r.nickname, points: r.points, wins: r.wins, played: r.played, isMe: r.playerId === playerId(uid) });
  let rank = 0;
  return { mode, rows: rows.map((r, i) => { if (!i || r.points !== rows[i - 1].points || r.wins !== rows[i - 1].wins) rank = i + 1; return { rank, ...clean(r) }; }), me: me ? clean(me) : null };
}
module.exports = { playerId, profileKey, profile, claim, settle, board, compare };
