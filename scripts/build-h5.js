'use strict';
// Export only audited public files. Never publish the repository root or private puzzles.
const fs = require('node:fs');
const path = require('node:path');
const { bundle } = require('./preview-server');
const assets = require('./preview-assets');
const root = path.resolve(__dirname, '..');
function buildH5(output = path.join(root, 'dist')) {
  fs.mkdirSync(output, { recursive: true });
  const write = (name, bytes) => { const dest = path.join(output, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); };
  for (const name of ['index.html', 'runtime.js', 'voice.js', 'preview.css']) write(name, fs.readFileSync(path.join(__dirname, 'preview', name)));
  write('recorder.wav.min.js', fs.readFileSync(path.join(__dirname, 'preview/vendor/recorder.wav.min.js')));
  write('bundle.js', bundle());
  for (const name of Object.keys(assets)) {
    // Keep the requested extension and correct file type for CDN serving.
    write(name.slice(1), fs.readFileSync(path.join(root, 'miniprogram', name)));
  }
  for (const [name, source] of Object.entries({
    'Recorder-LICENSE.txt': 'scripts/preview/vendor/Recorder-LICENSE.txt',
    'OFL-MaShanZheng.txt': 'miniprogram/assets/fonts/OFL-MaShanZheng.txt',
    'OFL-GenWanMin.txt': 'docs/fonts/genwan/OFL-GenWanMin.txt',
    'GenWan-NOTICE.txt': 'docs/fonts/genwan/NOTICE.txt',
    'aoyagi-usage.txt': 'docs/fonts/aoyagi/usage-original.txt',
    'aoyagi-explanation.pdf': 'docs/fonts/aoyagi/explanation.pdf',
    'font-provenance.txt': 'docs/fonts/PROVENANCE.txt'
  })) write('licenses/' + name, fs.readFileSync(path.join(root, source)));
  for (const name of ['PRD.html', 'one-page.html']) write('product/' + name, fs.readFileSync(path.join(root, 'docs/product', name)));
  write('robots.txt', 'User-agent: *\nDisallow: /\n');
  console.log('H5 public build ready: ' + Object.keys(assets).length + ' approved assets.');
}
if (require.main === module) buildH5();
module.exports = { buildH5 };
