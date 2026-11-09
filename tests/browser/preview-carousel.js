'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {createPreviewServer}=require('../../scripts/preview-server');
const puzzles=require('../../miniprogram/data/catalog');
async function main(){
 const {server}=createPreviewServer({env:{PREVIEW_MODE:'fixture'},configPath:null});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.PREVIEW_BROWSER_EXECUTABLE?{executablePath:process.env.PREVIEW_BROWSER_EXECUTABLE}:{})});
  const p=await browser.newPage({viewport:{width:466,height:676}}), errors=[];p.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:'+server.address().port;
  await p.goto(base+'/#/pages/home/index?screen=stories');await p.waitForFunction(()=>!window.__preview.page.data.loading);await p.evaluate(()=>document.fonts.ready);
  async function selected(key,index){await p.waitForFunction(({key,index,title})=>window.__preview.page.data[key]===index&&document.querySelector('.story-leaf.active .book-title')?.textContent===title,{key,index,title:puzzles[index].title});}
  async function swipe(dx,dy=0){const b=await p.locator('.story-leaf.active').boundingBox(),x=b.x+b.width/2,y=b.y+b.height*.35;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y+dy,{steps:7});await p.mouse.up();}
  await swipe(-95);await selected('storyIndex',1);
  await swipe(8,85);await selected('storyIndex',1);
  await swipe(95);await selected('storyIndex',0);await swipe(95);await selected('storyIndex',0);
  for(let i=1;i<13;i++){await swipe(-95);await selected('storyIndex',i);}
  await swipe(-95);await selected('storyIndex',12);
  // A keyboard user can select a neighboring card without a swipe.
  await p.waitForTimeout(360);await p.locator('.story-leaf.left-1').focus();await p.keyboard.press('Enter');await selected('storyIndex',11);
  await p.locator('.story-card').click();await p.waitForFunction(()=>window.__preview.page.data.session?.state==='playing');
  assert.equal(await p.locator('.game-title').innerText(),puzzles[11].title);assert.equal(await p.locator('.game-kicker').count(),0);
  await p.goto(base+'/#/pages/room/index');await p.waitForFunction(()=>!window.__preview.page.data.loading);await p.evaluate(()=>document.fonts.ready);
  assert.equal(await p.getByText('FRIENDS AT THE TABLE',{exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'排行榜',exact:true}).locator('img').count(),1);
  await p.getByPlaceholder('输入昵称，最多12字').fill('小周');
  for(let i=1;i<=3;i++){await swipe(-95);await selected('puzzleIndex',i);}
  assert.equal(await p.getByPlaceholder('输入昵称，最多12字').inputValue(),'小周');
  assert.equal(await p.evaluate(()=>window.__preview.page.data.selectedPuzzle),puzzles[3].id);
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:466,height:676}]){
   await p.setViewportSize(viewport);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const layout=await p.evaluate(()=>{const card=document.querySelector('.story-leaf.active'),box=card.getBoundingClientRect(),copy=card.querySelector('.book-copy'),action=document.querySelector('.setup-panel>.primary').getBoundingClientRect();return{page:document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth,inside:box.top>=0&&box.bottom<=action.top,content:copy.scrollHeight<=copy.clientHeight+1,action:action.bottom<=innerHeight}});
   assert.ok(layout.page&&layout.inside&&layout.content&&layout.action,JSON.stringify({viewport,layout}));
   if(process.env.PREVIEW_SCREENSHOT_DIR){fs.mkdirSync(process.env.PREVIEW_SCREENSHOT_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.PREVIEW_SCREENSHOT_DIR,'carousel-room-'+viewport.width+'.png')});}
  }
  await p.getByRole('button',{name:'创建好友房',exact:true}).click();await p.waitForFunction(()=>window.__preview.page.data.room?.state==='waiting');assert.equal(await p.evaluate(()=>window.__preview.page.data.room.title),puzzles[3].title);
  assert.deepEqual(errors,[]);console.log('Carousel passed: all 13 swipe selections, boundaries, vertical gesture, keyboard neighbor, matching solo/room story, preserved nickname, small-screen layout. No real model calls.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
