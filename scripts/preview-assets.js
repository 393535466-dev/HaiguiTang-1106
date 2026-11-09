'use strict';
// Exact public asset allowlist shared by the local preview and invitation gateway.
module.exports = Object.freeze({
  ...require('./font-assets-manifest.json'),
  ...Object.fromEntries(require('../miniprogram/data/catalog').map(p => ['/assets/stories/' + p.id + '-v1.jpg', 'image/jpeg'])),
  '/assets/brand/ranking-coin-v1.png': 'image/png',
  '/assets/brand/story-paper-v1.png': 'image/png',
  '/assets/brand/logo-red-cyan-v6.png': 'image/png',
  '/assets/brand/torn-eye-home-v1.png': 'image/png',
  '/assets/brand/torn-eye-open-v2.jpg': 'image/jpeg',
  '/assets/brand/torn-eye-closed-v2.jpg': 'image/jpeg',
  '/assets/brand/torn-entry-button-v1.png': 'image/png',
  '/assets/brand/logo-red-cyan-v7.png': 'image/png',
  '/assets/brand/torn-eye-open-v3.jpg': 'image/jpeg',
  '/assets/brand/torn-eye-closed-v3.jpg': 'image/jpeg',
  '/assets/brand/torn-entry-button-v2.png': 'image/png',
  '/assets/brand/black-paper-v1.jpg': 'image/jpeg',
  '/assets/brand/torn-kraft-v1.png': 'image/png',
  '/assets/fonts/pinru-v1.ttf': 'font/ttf',
  '/assets/fonts/aoyagi-v1.ttf': 'font/ttf',
  '/assets/fonts/soup-brush-home-v1.woff2': 'font/woff2'
});
