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
    await page.waitForFunction(()=>window.__preview.page.data.eyeReady && [...document.querySelectorAll('.cover-art,.brand-logo,.torn-button-art')].every(i=>i.complete&&i.naturalWidth>0));
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.evaluate(()=>document.fonts.check('24px SoupBrush','进入游戏')),true);
    for (const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:1320,height:1000}]) {
      await page.setViewportSize(viewport); await layout('.hero-button'); await layout('.cover-tutorial'); await layout('.cover-privacy');
      assert.equal(await page.evaluate(()=>{const b=document.querySelector('.hero-button').getBoundingClientRect(),t=document.querySelector('.cover-tutorial').getBoundingClientRect(),f=document.querySelector('.cover-footnote').getBoundingClientRect();return t.top>=b.bottom-1&&t.bottom<=f.top+1}),true,'tutorial is between entry and capability caption');
      await page.locator('.eye-blink').evaluate(e=>e.getAnimations().forEach(a=>{a.pause();a.currentTime=0}));await shot('home-' + viewport.width);
    }
    await page.setViewportSize({width:390,height:844}); await frame();
    for(const [time,expected] of [[0,0],[704,1],[992,0],[1280,1],[1800,0],[5000,0]]) {
      await page.locator('.eye-blink').evaluate((e,t)=>e.getAnimations().forEach(a=>{a.pause();a.currentTime=t}),time);await frame();
      assert.ok(Math.abs(Number(await page.locator('.eye-blink').evaluate(e=>getComputedStyle(e).opacity))-expected)<.01,'two blinks then a held-open pause');if(time===704)await shot('eye-closed');
    }
    await page.emulateMedia({reducedMotion:'reduce'});await frame();assert.equal(await page.locator('.eye-blink').evaluate(e=>getComputedStyle(e).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('.hero-button').click(); await frame();
    assert.equal(await page.evaluate(()=>window.__preview.page.data.screen),'mode');
    assert.equal(await page.getByRole('button',{name:'第一次玩？跟着做一遍'}).count(),0);
    await page.setViewportSize({width:320,height:568});await layout('.route-bottom');await shot('mode-small');
    await page.getByRole('button',{name:'独自推理'}).click();await page.waitForFunction(()=>window.__preview.page.data.screen==='stories'&&!window.__preview.page.data.loading);await layout('.story-card');await shot('stories-small');
    await page.getByRole('button',{name:'下一题',exact:false}).click();assert.equal(await page.evaluate(()=>window.__preview.page.data.storyIndex),1);
    await page.goBack();await page.waitForFunction(()=>window.__preview.page.data.screen==='mode');
    await page.goForward();await page.waitForFunction(()=>window.__preview.page.data.screen==='stories');
    await page.waitForFunction(()=>!window.__preview.page.data.loading);
    if(await page.evaluate(()=>window.__preview.page.data.storyIndex>0))await page.getByRole('button',{name:'上一题',exact:false}).click();
    await page.setViewportSize({width:390,height:844});
    await page.locator('.story-card').first().click(); await page.waitForFunction(() => window.__preview.page.data.session?.state === 'playing');
    await layout('.send-button'); await shot('solo-mobile');
    await page.locator('.draft-input').fill(puzzles[0].testCases.find(c=>c.answer==='yes').text); await page.getByRole('button',{name:'确认提问'}).click();
    await page.waitForFunction(()=>window.__preview.page.data.session?.messages.length===1);
    await page.setViewportSize({width:320,height:568}); await layout('.send-button'); await shot('solo-small');
    await page.getByRole('button',{name:'返回故事列表',exact:true}).click();await page.locator('.route-header button').click();await page.getByRole('button',{name:'和朋友一起玩'}).click(); await page.waitForFunction(()=>!window.__preview.page.data.loading);
    await page.getByRole('button',{name:'加入好友房',exact:true}).click(); await page.getByPlaceholder('输入六位房间号').fill('123');
    assert.equal(await page.getByRole('button',{name:'加入房间',exact:true}).isDisabled(),true);
    await layout('.join-panel .primary'); await page.setViewportSize({width:390,height:844}); await shot('join-mobile');
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
    await page.setViewportSize({width:320,height:568});await layout('.my-score');await layout('.rank-pagination');assert.equal(await page.locator('.rank-row').count(),3);await page.getByRole('button',{name:'下一页',exact:false}).click();assert.equal(await page.evaluate(()=>window.__preview.page.data.pageIndex),1);await shot('ranking-small');
    await page.getByRole('button',{name:'单人榜',exact:true}).click();await page.waitForFunction(()=>!window.__preview.page.data.loading);assert.equal(await page.locator('.rank-empty').count(),1);
    await page.getByRole('button',{name:'回到首页',exact:false}).click();await page.waitForFunction(()=>!window.__preview.page.data.loading);
    await page.getByRole('button',{name:'第一次玩？跟着做一遍'}).click();await page.waitForFunction(()=>window.__preview.page.data.judgeReady);await layout('.tutorial-footer');await shot('tutorial-small');
    const practice=require('../../cloudfunctions/game/data/tutorial');
    await page.getByRole('button',{name:'读懂了，试着提问'}).click();await page.locator('.practice-input').fill(practice.testCases[0].text);await page.getByRole('button',{name:'确认提问'}).click();await page.waitForFunction(()=>window.__preview.page.data.questionResult==='no');
    await page.getByRole('button',{name:'下一步，试试提示'}).click();await page.getByRole('button',{name:'试着看一条提示'}).click();await page.getByRole('button',{name:'有想法了，试着猜底'}).click();
    await page.locator('.guess-input').fill(practice.guessCases[0].text);await page.getByRole('button',{name:'提交猜底'}).click();await page.getByRole('button',{name:'去选一碗汤'}).click();await page.waitForFunction(()=>window.__preview.page.data.screen==='stories');
    await page.locator('.route-header button').click();await page.waitForFunction(()=>window.__preview.page.data.screen==='mode');await page.locator('.route-header button').click();await page.waitForFunction(()=>window.__preview.page.data.screen==='cover');
    await page.getByRole('button',{name:'录音与隐私说明',exact:true}).click();
    const count=await page.evaluate(()=>window.__preview.page.data.sections.length);
    for(let i=0;i<count;i++){await layout('.privacy-card');await layout('.privacy-page .primary');await layout('.privacy-paragraph:last-child');if(i<count-1)await page.getByRole('button',{name:'下一页',exact:false}).click();}
    await shot('privacy-small');
    await page.goto(base+'/?mode=unconfigured');await page.getByRole('button',{name:'进入游戏'}).click();await page.getByRole('button',{name:'独自推理'}).click();await page.waitForFunction(()=>!window.__preview.page.data.loading);assert.equal(await page.locator('.story-card').first().isDisabled(),true);await shot('not-ready-small');
    assert.deepEqual(errors,[]);
    console.log('Design browser checks passed: single-screen cover/mode/story routes, assets loaded, browser back/forward, 320/390/430/1320 layouts, six-member room, discussion/verdict/result, join flow, countdown with IME, paged rankings/privacy, tutorial and unavailable state. No real model calls.');
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
