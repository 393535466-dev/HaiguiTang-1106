'use strict';
const assert = require('node:assert/strict');
const http = require('node:http'), https = require('node:https');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { createMobileGateway } = require('../../scripts/mobile-preview');
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hgt-invite-tls-'));
  let upstream, tls, browser;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    upstream = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>Invitation accepted</h1>'); });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    let gateway, origin;
    const token = 'a'.repeat(64);
    tls = https.createServer({ key: fs.readFileSync(path.join(directory, 'key.pem')), cert: fs.readFileSync(path.join(directory, 'cert.pem')) }, (req, res) => {
      if (req.headers.host.startsWith('localhost:')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<a href="' + origin + '/invite/' + token + '">Open invitation</a>');
      } else gateway.emit('request', req, res);
    });
    await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve));
    origin = 'https://127.0.0.1:' + tls.address().port;
    gateway = createMobileGateway({ publicOrigin: origin, accessToken: token, expiresAt: Date.now() + 60000, upstreamPort: upstream.address().port });
    browser = await chromium.launch({ headless: true, ...(process.env.PREVIEW_BROWSER_EXECUTABLE ? { executablePath: process.env.PREVIEW_BROWSER_EXECUTABLE } : {}) });
    // localhost and 127.0.0.1 are separate browser sites. Real TLS and a real
    // redirect exercise SameSite behavior that a manually copied Cookie cannot.
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const denied = await page.goto(origin + '/'); assert.equal(denied.status(), 403);
    await page.goto('https://localhost:' + tls.address().port + '/message');
    await page.getByRole('link', { name: 'Open invitation' }).click();
    await page.getByRole('heading', { name: 'Invitation accepted' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    const cookie = (await page.context().cookies()).find(c => c.name === '__Secure-hgt-mobile-test');
    assert.ok(cookie && cookie.secure && cookie.httpOnly); assert.equal(cookie.sameSite, 'Lax');
    await page.reload(); await page.getByRole('heading', { name: 'Invitation accepted' }).waitFor();
    const stranger = await browser.newPage({ ignoreHTTPSErrors: true });
    assert.equal((await stranger.goto(origin + '/')).status(), 403);
    assert.equal((await stranger.goto(origin + '/invite/wrong')).status(), 403);
    console.log('Invitation browser regression passed: first cross-site link click, redirect, reload, secure HttpOnly cookie, and unauthenticated/wrong-invite denial. No real AI calls.');
  } finally {
    if (browser) await browser.close();
    if (tls) await new Promise(resolve => tls.close(resolve));
    if (upstream) await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
