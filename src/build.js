/* build.js — inline css + three + game js into one self-contained HTML. */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('css/base.css') + '\n' + read('css/game.css');
const three = read('js/three.min.js');
const js = ['js/util.js', 'js/post.js', 'js/textures.js', 'js/audio.js', 'js/level.js', 'js/weapon.js', 'js/npc.js', 'js/hud.js', 'js/game.js']
  .map(read)
  .join('\n\n');

if (three.includes('</script') || js.includes('</script')) {
  console.error('ERROR: a source file contains a closing script tag');
  process.exit(1);
}

let html = read('index.html');

// Use function replacers: the bundled three.js source contains "$&"-like
// sequences that a string replacement would expand.
html = html.replace(
  /[ \t]*<link rel="stylesheet" href="css\/base\.css">\r?\n[ \t]*<link rel="stylesheet" href="css\/game\.css">/,
  () => '<style>\n' + css + '\n</style>'
);
html = html.replace(
  /<script src="js\/three\.min\.js"><\/script>/,
  () => '<script>\n' + three + '\n</script>'
);
html = html.replace(
  /<script src="js\/util\.js"><\/script>[\s\S]*?<script src="js\/game\.js"><\/script>/,
  () => '<script>\n' + js + '\n</script>'
);

if (/src="js\/|href="css\//.test(html)) {
  console.error('ERROR: build left external references');
  process.exit(1);
}

const out = path.join(root, '..', '抢救老板_V1.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB');
