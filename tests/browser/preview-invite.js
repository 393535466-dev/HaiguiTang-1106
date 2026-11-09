'use strict';
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { createMobileGateway } = require('../../scripts/mobile-preview');
const { createPreviewServer } = require('../../scripts/preview-server');
const puzzle = require('../../cloudfunctions/game/data/puzzles')[0];
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hgt-invite-tls-'));
  let upstream, tls, browser;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    const preview = createPreviewServer({ env: { PREVIEW_MODE: 'fixture' }, configPath: null });
    upstream = preview.server;
    const ready = preview.provider.ready; preview.provider.ready = () => ({ ...ready(), voiceReady:true });
    let asrCalls=0; preview.provider.transcribe = async () => { asrCalls++; return { text:'我们先看比赛的线索。' }; };
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    let gateway, origin;
    const token = 'a'.repeat(64), mount = '/play/' + token + '/', seen = [], failures = [];
    tls = https.createServer({ key: fs.readFileSync(path.join(directory, 'key.pem')), cert: fs.readFileSync(path.join(directory, 'cert.pem')) }, (req, res) => {
      if (req.headers.host.startsWith('localhost:')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<a href="' + origin + '/invite/' + token + '">Open invitation</a>');
      } else {
        // Model a mobile browser that never stores or sends cookies.
        assert.equal(req.headers.cookie, undefined);
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => name.toLowerCase() === 'set-cookie' ? res : setHeader(name, value);
        seen.push(req.url); gateway.emit('request', req, res);
      }
    });
    await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve));
    origin = 'https://127.0.0.1:' + tls.address().port;
    gateway = createMobileGateway({ publicOrigin: origin, accessToken: token, expiresAt: Date.now() + 180000, upstreamPort: upstream.address().port });
    browser = await chromium.launch({ headless: true, args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'], ...(process.env.PREVIEW_BROWSER_EXECUTABLE ? { executablePath: process.env.PREVIEW_BROWSER_EXECUTABLE } : {}) });
    const a = await browser.newPage({ ignoreHTTPSErrors:true, viewport:{width:390,height:844} });
    const b = await browser.newPage({ ignoreHTTPSErrors:true, viewport:{width:390,height:844} });
    for (const p of [a,b]) { p.on('pageerror', e => failures.push(e.message)); p.on('response', r => { if(r.status()>=400) failures.push(r.status()+' '+new URL(r.url()).pathname.replace(token,'[invite]')); }); }
    await a.goto('https://localhost:' + tls.address().port + '/message');
    await a.getByRole('link', { name:'Open invitation' }).click();
    await a.waitForFunction(() => window.__preview?.page.data.canStart);
    assert.equal(new URL(a.url()).pathname, mount); assert.equal((await a.context().cookies()).length,0);
    await a.waitForFunction(() => [...document.querySelectorAll('.cover-art')].every(i=>i.naturalWidth>0));
    await a.evaluate(() => document.fonts.ready);
    assert.ok(await a.evaluate(() => document.fonts.check('24px SoupMincho','好友房')));
    await a.getByRole('button',{name:'进入游戏',exact:true}).click();await a.getByRole('button',{name:'和朋友一起玩'}).click();await a.waitForFunction(()=>!window.__preview.page.data.loading);
    await a.getByRole('button',{name:'创建好友房',exact:true}).click();await a.waitForFunction(()=>window.__preview.page.data.room?.state==='waiting');
    const roomId=await a.evaluate(()=>window.__preview.page.data.room.id);
    // A copied address is still usable in a fresh browser, with no invitation cookie.
    await b.goto(origin+mount+'#/pages/room/index');await b.waitForFunction(()=>!window.__preview.page.data.loading);
    await b.getByRole('button',{name:'加入好友房',exact:true}).click();await b.getByPlaceholder('输入六位房间号').fill(roomId);await b.getByRole('button',{name:'加入房间',exact:true}).click();
    await a.waitForFunction(()=>window.__preview.page.data.room?.members.length===2);
    assert.notEqual(await a.evaluate(()=>window.__preview.page.data.room.meId),await b.evaluate(()=>window.__preview.page.data.room.meId));
    await a.getByRole('button',{name:'开始推理'}).click();for(const p of [a,b])await p.waitForFunction(()=>window.__preview.page.data.room?.state==='playing');
    await b.getByRole('button',{name:'按住说话',exact:true}).click();await b.getByRole('button',{name:'同意并继续',exact:true}).click();await b.waitForFunction(()=>!window.__preview.page.data.voiceBusy);
    const record=await b.getByRole('button',{name:'按住说话',exact:true}).boundingBox();await b.mouse.move(record.x+record.width/2,record.y+record.height/2);await b.mouse.down();await b.waitForFunction(()=>window.__preview.page.data.recording);await b.waitForTimeout(850);await b.mouse.up();await b.waitForFunction(()=>window.__preview.page.data.draft==='我们先看比赛的线索。');assert.equal(asrCalls,1);
    await a.getByRole('button',{name:'向 AI 提问',exact:true}).click();await a.locator('.room-draft').fill(puzzle.testCases.find(c=>c.answer==='yes').text);await a.getByRole('button',{name:'确认提问',exact:true}).click();await b.waitForFunction(()=>window.__preview.page.data.room?.messages.some(m=>m.answer==='yes'));
    const identity=await b.evaluate(()=>window.__preview.page.data.room.meId);await b.reload();await b.waitForFunction(()=>window.__preview.page.data.room?.state==='playing');assert.equal(await b.evaluate(()=>window.__preview.page.data.room.meId),identity);assert.equal(await b.locator('.room-draft').inputValue(),'我们先看比赛的线索。');
    assert.ok(seen.includes(mount+'api'));assert.ok(seen.some(p=>p.startsWith(mount+'audio?')));assert.ok(seen.some(p=>p.startsWith(mount+'assets/')));assert.ok(!seen.includes('/api'));
    const restricted=await browser.newPage({ignoreHTTPSErrors:true});await restricted.addInitScript(()=>{for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{get(){throw new DOMException('Disabled','SecurityError')}})});await restricted.goto(origin+mount);await restricted.waitForFunction(()=>window.__preview?.page.data.canStart);
    const stranger = await browser.newPage({ignoreHTTPSErrors:true});assert.equal((await stranger.goto(origin+'/')).status(),403);assert.equal((await stranger.goto(origin+'/play/wrong/')).status(),403);
    assert.deepEqual(failures,[]);
    console.log('Cookie-free invitation passed: external click, copied URL, images/fonts, two independent players, create/join, voice upload, question sync, reload with identity/draft, blocked storage fallback and unauthorized denial. Fixture AI only.');
  } finally {
    if (browser) await browser.close();
    if (tls) await new Promise(resolve => tls.close(resolve));
    if (upstream) await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
