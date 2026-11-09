'use strict';
// Uses a synthetic Chromium microphone and explicit fake model responses.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createPreviewServer } = require('../../scripts/preview-server');
async function main() {
  let asrCalls = 0, judgeCalls = 0;
  const { server } = createPreviewServer({ env: { DASHSCOPE_API_KEY: 'test-only', GAME_ENABLED: 'true' }, configPath: null,
    fetchFn: async (_, options) => {
      const body = JSON.parse(options.body);
      let content;
      if (body.model === 'qwen3-asr-flash') { asrCalls++; content = '小周没有带伞吗？'; }
      else { judgeCalls++; content = '{"intent":"yes_no","answer":"yes"}'; }
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
    } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PREVIEW_BROWSER_EXECUTABLE ? { executablePath: process.env.PREVIEW_BROWSER_EXECUTABLE } : {}), args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByRole('button', { name: '第一次玩？跟着做一遍' }).click();
    await page.getByRole('button', { name: '读懂了，试着提问' }).click();
    const button = () => page.getByRole('button', { name: '按住说话', exact: true });
    await button().click();
    await page.getByRole('button', { name: '同意并继续', exact: true }).click();
    await page.waitForFunction(() => !window.__preview.page.data.voiceBusy);
    async function hold() {
      const box = await button().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.waitForFunction(() => window.__preview.page.data.recording === true);
      await page.waitForTimeout(850); return box;
    }
    // Cancellation must survive the DOM updates that occur during recording.
    const box = await hold();
    await page.mouse.move(box.x + box.width / 2, box.y - 100); await page.mouse.up();
    await page.waitForFunction(() => !window.__preview.page.data.recording);
    await page.waitForTimeout(150); assert.equal(asrCalls, 0);
    await hold(); await page.mouse.up();
    await page.waitForFunction(() => window.__preview.page.data.question === '小周没有带伞吗？');
    assert.equal(asrCalls, 1); assert.equal(judgeCalls, 0);
    assert.equal(await page.evaluate(() => window.__preview.page.data.submittedQuestion), '');
    await page.locator('textarea').fill('小周带了伞吗？');
    await page.getByRole('button', { name: '确认提问' }).click();
    await page.waitForFunction(() => window.__preview.page.data.questionResult === 'yes');
    assert.equal(judgeCalls, 1);
    // A denied microphone request leaves the editable text route available.
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError')); });
    await button().click();
    await page.waitForFunction(() => Boolean(window.__preview.page.data.voiceError));
    await page.locator('textarea').fill('拒绝麦克风后仍可打字');
    assert.equal(await page.locator('textarea').inputValue(), '拒绝麦克风后仍可打字');
    assert.deepEqual(errors, []);
    console.log('Browser voice regression passed: cancel without ASR, release after re-render, editable transcription, explicit judge submission, microphone denial. No real AI calls.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
