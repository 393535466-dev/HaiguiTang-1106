'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const { createPreviewServer } = require('../../scripts/preview-server');
const puzzles = require('../../cloudfunctions/game/data/puzzles');
async function main() {
  const { server } = createPreviewServer({ env: { PREVIEW_MODE: 'fixture' }, configPath: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const dir = process.env.PREVIEW_SCREENSHOT_DIR;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PREVIEW_BROWSER_EXECUTABLE ? { executablePath: process.env.PREVIEW_BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    const shot = async name => { if (dir) await page.screenshot({ path: path.join(dir, 'design-' + name + '.png') }); };
    const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    async function layout(selector) {
      await frame();
      const result = await page.evaluate(selector => {
        const screen = document.querySelector('#mini-screen').getBoundingClientRect(), target = document.querySelector(selector).getBoundingClientRect();
        return { horizontal: document.documentElement.scrollWidth <= innerWidth + 1, inside: target.left >= screen.left - 1 && target.right <= screen.right + 1 && target.top >= screen.top - 1 && target.bottom <= screen.bottom + 1 };
      }, selector);
      assert.ok(result.horizontal, 'no horizontal page overflow'); assert.ok(result.inside, selector + ' remains in the usable screen');
    }
    await page.goto(base); await page.waitForFunction(() => !window.__preview.page.data.loading);
    for (const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:1320,height:1000}]) {
      await page.setViewportSize(viewport); await layout('.hero-button'); await shot('home-' + viewport.width);
    }
    await page.setViewportSize({width:390,height:844}); await frame();
    await page.locator('.hero-button').click(); await frame();
    assert.ok(await page.locator('.home-scroll').evaluate(e=>e.scrollTop>100),'pick a story scrolls directly to the story list');
    await page.locator('.story-card').first().click(); await page.waitForFunction(() => window.__preview.page.data.session?.state === 'playing');
    await layout('.send-button'); await shot('solo-mobile');
    await page.locator('.draft-input').fill(puzzles[0].testCases.find(c=>c.answer==='yes').text); await page.getByRole('button',{name:'确认提问'}).click();
    await page.waitForFunction(()=>window.__preview.page.data.session?.messages.length===1);
    await page.setViewportSize({width:320,height:568}); await layout('.send-button'); await shot('solo-small');
    await page.locator('[data-page="/pages/room/index"]').click(); await page.waitForFunction(()=>!window.__preview.page.data.loading);
    await page.getByRole('button',{name:'加入好友房',exact:true}).click(); await page.getByPlaceholder('输入六位房间号').fill('123');
    assert.equal(await page.getByRole('button',{name:'加入房间',exact:true}).isDisabled(),true);
    await page.setViewportSize({width:390,height:844}); await shot('join-mobile');
    await page.getByRole('button',{name:'我来组一桌',exact:true}).click(); await page.getByPlaceholder('输入昵称，最多12字').fill('小林');
    await page.getByRole('button',{name:'创建好友房',exact:true}).click(); await page.waitForFunction(()=>window.__preview.page.data.room?.state==='waiting');
    const roomId = await page.evaluate(()=>window.__preview.page.data.room.id), tokens=[];
    async function api(token, action, args={}) {
      const response = await page.request.post(base+'/api',{headers:token?{'X-Preview-Player':token}:{},data:{action,...args}}), result=await response.json();
      assert.equal(result.ok,true,action); return result.data;
    }
    for(let i=0;i<5;i++) {
      const response=await page.request.post(base+'/preview-player',{data:{}}), {token}=await response.json();tokens.push(token);
      await api(token,'saveProfile',{nickname:i===0?'认真找线索的朋友小陈':'汤友'+(i+1)});await api(token,'joinRoom',{roomId});
    }
    await page.waitForFunction(()=>window.__preview.page.data.room?.members.length===6);
    await page.getByRole('button',{name:'开始推理'}).click();await page.waitForFunction(()=>window.__preview.page.data.room?.state==='playing');
    await api(tokens[0],'roomChat',{roomId,requestId:'design-chat',text:'我觉得电影票可能还有其他用途，我们可以先问问这一点。'});
    await page.waitForFunction(()=>window.__preview.page.data.room?.messages.some(m=>m.type==='discussion'));
    const cdp=await page.context().newCDPSession(page);await page.locator('.room-draft').focus();
    const element=await page.locator('.room-draft').elementHandle();
    await cdp.send('Input.imeSetComposition',{text:'xiaozhou',selectionStart:8,selectionEnd:8});
    await page.waitForTimeout(1150);
    assert.equal(await element.evaluate(e=>e.isConnected&&e===document.activeElement),true,'clock tick must not replace an IME input');
    assert.equal(await page.evaluate(()=>window.__preview.page.data.draft),'');
    await cdp.send('Input.insertText',{text:'小周'});await frame();
    assert.equal(await page.locator('.room-draft').inputValue(),'小周');
    await page.locator('.room-draft').fill('我们先确认一下她为什么买票。');await page.getByRole('button',{name:'发送讨论'}).click();
    await page.waitForFunction(()=>!window.__preview.page.data.busy);
    for(const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:932}]) {
      await page.setViewportSize(viewport);await layout('.room-input-actions');assert.ok(await page.locator('.room-record').evaluate(e=>e.getBoundingClientRect().height>=44));await shot('room-'+viewport.width);
      if(viewport.width===320) assert.equal(await page.locator('.surface-text').evaluate(e=>getComputedStyle(e).webkitLineClamp),'1','class names ending in text keep their own CSS');
    }
    await page.setViewportSize({width:390,height:844});await frame();
    await page.getByRole('button',{name:'向 AI 提问',exact:true}).click();await page.locator('.room-draft').fill(puzzles[0].testCases.find(c=>c.answer==='yes').text);
    await page.getByRole('button',{name:'确认提问'}).click();await page.waitForFunction(()=>window.__preview.page.data.room?.questionCount===1);
    await page.waitForFunction(()=>{const e=document.querySelector('.room-messages');return e.scrollHeight-e.clientHeight-e.scrollTop<3;});await shot('room-answer-mobile');
    const current=await api(tokens[0],'getRoom',{roomId});
    await api(tokens[0],'roomGuess',{roomId,requestId:'design-win',turnSerial:current.room.turnSerial,text:puzzles[0].guessCases.find(c=>c.answer==='solved').text});
    await page.waitForFunction(()=>window.__preview.page.data.room?.state==='solved');
    await page.waitForFunction(()=>{const e=document.querySelector('.room-messages');return e.scrollHeight-e.clientHeight-e.scrollTop<3;});await shot('result-mobile');
    assert.equal(await page.locator('.team-score>div>span').evaluate(e=>getComputedStyle(e).display),'block');
    await page.getByRole('button',{name:'看看好友协作榜'}).click();await page.waitForFunction(()=>!window.__preview.page.data.loading);await shot('ranking-mobile');
    await page.setViewportSize({width:320,height:568});await layout('.my-score');
    await page.getByRole('button',{name:'单人榜',exact:true}).click();await page.waitForFunction(()=>!window.__preview.page.data.loading);assert.equal(await page.locator('.rank-empty').count(),1);
    await page.locator('[data-page="/pages/home/index"]').click();await page.waitForFunction(()=>!window.__preview.page.data.loading);
    await page.getByRole('button',{name:'第一次玩？跟着做一遍'}).click();await page.waitForFunction(()=>window.__preview.page.data.judgeReady);await layout('.tutorial-footer');await shot('tutorial-small');
    await page.goto(base+'/?mode=unconfigured');await page.waitForFunction(()=>!window.__preview.page.data.loading);assert.equal(await page.locator('.story-card').first().isDisabled(),true);await shot('not-ready-small');
    assert.deepEqual(errors,[]);
    console.log('Design browser checks passed: 320/390/430/1320 layouts, six-member room, readable discussion/verdict/result, join flow, live countdown with IME, rankings/empty state, tutorial and unavailable state. No real model calls.');
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
