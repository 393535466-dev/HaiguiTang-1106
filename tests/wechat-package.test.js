'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { prepareWechat } = require('../scripts/prepare-wechat');
const { inspectProject } = require('../scripts/wechat-project');
const source = path.resolve(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hgt-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = execFileSync('git', ['ls-files', '-z', '--', 'miniprogram', 'cloudfunctions/game', 'project.config.json'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
  files.push(...['DEPLOY.md','ACCEPTANCE.md','MULTIPLAYER.md','THIRD_PARTY.md','DEVICE-TEST.md'].map(f => 'docs/' + f));
  for (const file of files) { const dest = path.join(root, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(source, file), dest); }
  fs.writeFileSync(path.join(root, '.env.preview.local'), 'DASHSCOPE_API_KEY=fixture-private-only');
  fs.writeFileSync(path.join(root, 'miniprogram/config.local.js'), 'module.exports={cloudEnv:"private-existing-env", functionName:"game", secret:"fixture-private-only"}');
  fs.writeFileSync(path.join(root, 'project.private.config.json'), '{"appid":"wxffffffffffffffff"}');
  fs.mkdirSync(path.join(root, '.preview-data')); fs.writeFileSync(path.join(root, '.preview-data/private.json'), '{"transcript":"fixture-private-only"}');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  return { root, git };
}
test('delivery includes deployable sources and checksum manifest but excludes private configs, keys and player records', t => {
  const { root } = fixture(t), before = fs.readFileSync(path.join(root, 'miniprogram/config.local.js'), 'utf8');
  const pack = prepareWechat({ root }); assert.equal(pack.filesReady, true); assert.equal(pack.accountConfigured, false); assert.equal(pack.cloudVerified, false);
  assert.equal(fs.readFileSync(path.join(root, 'miniprogram/config.local.js'), 'utf8'), before);
  const manifest = JSON.parse(fs.readFileSync(path.join(pack.output, 'deployment-manifest.json')));
  assert.equal(manifest.cloud.collections.length, 10); assert.equal(manifest.cloud.rankingIndex.fields[0].field, 'mode');
  for (const line of fs.readFileSync(path.join(pack.output, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const [hash, file] = line.split('  '), data = fs.readFileSync(path.join(pack.output, file));
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), hash);
    assert.ok(!data.includes(Buffer.from('fixture-private-only')));
  }
  for (const file of ['.env.preview.local','.preview-data','project.private.config.json','scripts','node_modules']) assert.equal(fs.existsSync(path.join(pack.output, file)), false);
});
test('explicit account IDs configure only the delivery copy; existing deliveries are preserved', t => {
  const { root } = fixture(t), first = prepareWechat({ root });
  const pack = prepareWechat({ root, appId: 'wx1234567890abcdef', cloudEnv: 'production-env-123' });
  assert.notEqual(first.output, pack.output); assert.ok(fs.existsSync(first.output));
  assert.equal(pack.accountConfigured, true); assert.equal(pack.cloudVerified, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pack.output, 'project.config.json'))).appid, 'wx1234567890abcdef');
  const page = path.join(pack.output, 'miniprogram/pages/room/index.wxml'); fs.unlinkSync(page);
  assert.equal(inspectProject(pack.output).filesReady, false);
});
test('invalid IDs and a secret accidentally tracked in frontend code stop delivery without leaving a partial package', t => {
  const { root } = fixture(t);
  assert.throws(() => prepareWechat({ root, appId: 'not-an-app-id' }), /AppID/);
  assert.throws(() => prepareWechat({ root, cloudEnv: '../bad-path' }), /环境/);
  assert.throws(() => prepareWechat({ root, cloudEnv: 'sk-fixture000000000000000000000' }), /环境/);
  fs.appendFileSync(path.join(root, 'miniprogram/app.js'), '\nconst accidental = "sk-fixture000000000000000000000";\n');
  assert.throws(() => prepareWechat({ root }), /疑似密钥/);
  assert.deepEqual(fs.readdirSync(path.join(root, '.release')), []);
});
