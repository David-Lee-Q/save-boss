/* sync.js — copy the built index.html to the Desktop/3A named copy. */
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
const src = path.join(repo, 'index.html');
const dst = path.join(repo, '..', '抢救老板_V1.html');

if (!fs.existsSync(src)) {
  console.error('missing', src);
  process.exit(1);
}
fs.copyFileSync(src, dst);
const size = (fs.statSync(dst).size / 1024 / 1024).toFixed(2) + ' MB';
console.log('synced', dst, size);
