'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createPreviewServer } = require('../../scripts/preview-server');
const puzzle = require('../../cloudfunctions/game/data/puzzles')[0];
async function main() {
  const { server, provider } = createPreviewServer({ env: { PREVIEW_MODE: 'fixture' }, configPath: null });
  let asrCalls = 0; const ready = provider.ready; provider.ready = () => ({ ...ready(), voiceReady: true }); provider.transcribe = async () => { asrCalls++; return { text: '电影票可能还有别的用途。' }; };
  let judgeCalls = 0; const judge = provider.judge; provider.judge = input => { judgeCalls++; return judge(input); };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], ...(process.env.PREVIEW_BROWSER_EXECUTABLE ? { executablePath: process.env.PREVIEW_BROWSER_EXECUTABLE } : {}) });
    const contextA = await browser.newContext({ viewport: { width: 1200, height: 900 } }), contextB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const a = await contextA.newPage(), b = await contextB.newPage(), errors = [];
    for (const p of [a, b]) p.on('pageerror', e => errors.push(e.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    const roomReady = p => p.waitForFunction(() => window.__preview.page.data.room?.state === 'playing');
    await a.goto(base); await a.getByRole('button', { name: '和朋友一起玩' }).click();
    await a.getByPlaceholder('输入昵称，最多12字').fill('小林'); await a.getByRole('button', { name: '创建好友房' }).click();
    await a.waitForFunction(() => window.__preview.page.data.room?.state === 'waiting');
    const roomId = await a.evaluate(() => window.__preview.page.data.room.id);
    await b.goto(base + '/?guest=1#/pages/room/index');
    await b.waitForFunction(() => !window.__preview.page.data.loading);
    await b.getByPlaceholder('输入昵称，最多12字').fill('小陈'); await b.getByPlaceholder('输入六位房间号').fill(roomId); await b.getByRole('button', { name: '加入房间' }).click();
    await a.waitForFunction(() => window.__preview.page.data.room?.members.length === 2);
    await a.getByRole('button', { name: '开始推理' }).click(); await roomReady(a); await roomReady(b);
    for (const p of [a,b]) {
      const seconds = await p.evaluate(() => window.__preview.page.data.seconds);
      assert.ok(seconds > 0 && seconds <= 45, 'both players see the shortened turn deadline');
    }
    assert.notEqual(await a.evaluate(() => window.__preview.page.data.room.meId), await b.evaluate(() => window.__preview.page.data.room.meId));
    assert.equal(await b.getByRole('button', { name: '向 AI 提问', exact: true }).isDisabled(), true);
    await b.getByRole('button', { name: '按住说话', exact: true }).click();
    await b.getByRole('button', { name: '同意并继续', exact: true }).click();
    await b.waitForFunction(() => !window.__preview.page.data.voiceBusy);
    const record = await b.getByRole('button', { name: '按住说话', exact: true }).boundingBox();
    await b.mouse.move(record.x + record.width / 2, record.y + record.height / 2); await b.mouse.down();
    await b.waitForFunction(() => window.__preview.page.data.recording); await b.waitForTimeout(850); await b.mouse.up();
    await b.waitForFunction(() => window.__preview.page.data.draft === '电影票可能还有别的用途。');
    assert.equal(asrCalls, 1); assert.equal(judgeCalls, 0);
    assert.equal(await b.evaluate(() => window.__preview.page.data.room.messages.some(m => m.type === 'discussion')), false);
    await b.locator('.room-draft').fill('我觉得电影票可能还有别的用途。'); await b.getByRole('button', { name: '发送讨论' }).click();
    await a.getByText('我觉得电影票可能还有别的用途。', { exact: true }).waitFor(); assert.equal(judgeCalls, 0);
    await a.getByRole('button', { name: '向 AI 提问', exact: true }).click();
    await a.locator('.room-draft').fill(puzzle.testCases.find(c => c.answer === 'yes').text); await a.getByRole('button', { name: '确认提问', exact: true }).click();
    await b.waitForFunction(() => window.__preview.page.data.room?.myTurn === true);
    await b.locator('.room-draft').fill('刷新后还在的草稿'); await b.reload(); await roomReady(b);
    assert.equal(await b.locator('.room-draft').inputValue(), '刷新后还在的草稿');
    await b.getByRole('button', { name: '我猜到了', exact: true }).click(); await b.locator('.room-draft').fill(puzzle.guessCases.find(c => c.answer === 'solved').text);
    await b.getByRole('button', { name: '提交猜底', exact: true }).click();
    for (const p of [a,b]) await p.waitForFunction(() => window.__preview.page.data.room?.state === 'solved');
    assert.equal(judgeCalls, 2);
    await b.getByRole('button', { name: '看看好友协作榜' }).click(); await b.waitForFunction(() => window.__preview.page.data.rows?.length === 2);
    const rows = await b.evaluate(() => window.__preview.page.data.rows); assert.deepEqual(rows.map(r => r.points), [98,98]); assert.equal(rows.filter(r => r.isMe).length,1);
    assert.equal(await a.locator('.room-messages').evaluate(e => getComputedStyle(e).overflowY), 'auto');
    await a.locator('.room-messages').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await a.waitForTimeout(250);
    if (process.env.PREVIEW_SCREENSHOT_DIR) {
      await a.screenshot({ path: process.env.PREVIEW_SCREENSHOT_DIR + '/friends-desktop.png' });
      await b.screenshot({ path: process.env.PREVIEW_SCREENSHOT_DIR + '/friends-rank-mobile.png' });
    }
    await a.getByRole('button', { name: '回到首页', exact: true }).click(); await a.getByRole('button', { name: '和朋友一起玩' }).click(); await a.waitForFunction(() => window.__preview.page.data.room?.state === 'solved');
    assert.deepEqual(errors, []);
    console.log('Multiplayer browser passed: independent identities, create/join, editable guest recording, discussion sync without AI, turn handoff, reload with draft, shared result, identical ranking points and room resume. No real AI calls.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
