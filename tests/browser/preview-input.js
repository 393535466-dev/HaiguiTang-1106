'use strict';

// Optional browser regression. Requires Playwright + Chromium; no model calls.
// PREVIEW_BROWSER_EXECUTABLE may point to an existing Chrome installation.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createPreviewServer } = require('../../scripts/preview-server');

async function main() {
  const { server } = createPreviewServer({ env: { PREVIEW_MODE: 'fixture' }, configPath: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PREVIEW_BROWSER_EXECUTABLE ? { executablePath: process.env.PREVIEW_BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage();
    const errors = [], submissions = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().endsWith('/api') && ['askQuestion', 'guessAnswer'].includes(request.postDataJSON().action)) submissions.push(request.postDataJSON().text);
    });
    const cdp = await page.context().newCDPSession(page);
    const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const input = () => page.locator('textarea');
    const draft = field => page.evaluate(name => window.__preview.page.data[name], field);
    async function compose(pinyin, result, field, expected) {
      await input().focus();
      const previousDraft = await draft(field);
      const original = await input().elementHandle();
      const sentBefore = submissions.length;
      await page.evaluate(() => window.__preview.page.setData({ inputRegressionTick: Date.now() }));
      await paint();
      assert.equal(await original.evaluate(element => element.isConnected && element === document.activeElement), true, 'focused textarea changed before composition began');
      for (let i = 1; i <= pinyin.length; i++) {
        const text = pinyin.slice(0, i);
        await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
        // A reply/status update or resize must not interrupt the ongoing IME.
        await page.evaluate(() => { window.__preview.page.setData({ inputRegressionTick: Date.now() }); window.dispatchEvent(new Event('resize')); });
        await paint();
        assert.equal(await original.evaluate(element => element.isConnected && element === document.activeElement), true, 'composing textarea was replaced');
        assert.equal(await draft(field), previousDraft, 'unconfirmed Pinyin entered the draft');
      }
      await cdp.send('Input.insertText', { text: result });
      await paint();
      assert.equal(await input().inputValue(), expected);
      assert.equal(await draft(field), expected);
      assert.equal(submissions.length, sentBefore, 'input unexpectedly submitted to the judge');
      await original.dispose();
    }
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base);
    await page.getByRole('button', { name: '第一次玩？跟着做一遍' }).click();
    await page.getByRole('button', { name: '读懂了，试着提问' }).click();
    await compose('xiaozhou', '小周', 'question', '小周');
    assert.match(await page.locator('.draft-heading').innerText(), /2\s*\/\s*200/);
    await compose('meiyou', '没有', 'question', '小周没有');
    await page.keyboard.type('ABC12'); await paint();
    assert.equal(await draft('question'), '小周没有ABC12');
    await page.keyboard.press('Backspace'); await paint();
    assert.equal(await draft('question'), '小周没有ABC1');
    // Replace a selection in the middle with a composed Chinese phrase.
    await input().evaluate(element => element.setSelectionRange(2, 4));
    await compose('daile', '带了', 'question', '小周带了ABC1');
    // Cancel a composition without retaining its Pinyin or changing the draft.
    await input().evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
    await cdp.send('Input.imeSetComposition', { text: 'cuowu', selectionStart: 5, selectionEnd: 5 });
    await paint();
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await paint();
    assert.equal(await input().inputValue(), '小周带了ABC1');
    assert.equal(await draft('question'), '小周带了ABC1');
    await input().fill('小周出门时还在下雨吗？');
    await page.getByRole('button', { name: '确认提问' }).click();
    await page.getByRole('button', { name: '下一步，试试提示' }).click();
    assert.deepEqual(submissions, ['小周出门时还在下雨吗？']);
    await page.getByRole('button', { name: '试着看一条提示' }).click();
    await page.getByRole('button', { name: '有想法了，试着猜底' }).click();
    await compose('yuting', '雨停', 'guess', '雨停');
    await compose('xiaozhou', '小周', 'guess', '雨停小周');
    await input().evaluate(element => element.setSelectionRange(2, 2));
    await cdp.send('Input.insertText', { text: '之后，' }); await paint();
    assert.equal(await draft('guess'), '雨停之后，小周');
    await page.getByRole('button', { name: '跳过练习' }).click();
    await page.getByRole('button', { name: '进入游戏' }).click();
    await page.getByRole('button', { name: '独自推理' }).click();
    await page.locator('.story-card').first().click();
    await page.waitForFunction(() => window.__preview.page.data.session && !window.__preview.page.data.loading);
    await compose('xiaozhou', '小周', 'draft', '小周');
    await page.getByRole('button', { name: '我猜到了', exact: true }).click();
    await input().fill('');
    await compose('xiaozhou', '小周', 'draft', '小周');
    assert.deepEqual(errors, []);
    console.log('Chinese input regression passed: tutorial question/guess, game question/guess, consecutive composition, selection replacement, cancellation, mixed text, deletion, text insertion, character count and async rendering. No real AI calls.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
