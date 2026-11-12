// Builds the single-file game.
//   dist/index.html  plain single file (open it anywhere)
//   docs/index.html   same game plus home-screen/offline bits (manifest, icons, service worker)
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const fill = (head, tail) => src('template.html')
  .replace('/*CSS*/', () => src('style.css'))
  .replace('/*ENGINE*/', () => src('engine.js'))
  .replace('/*UI*/', () => src('ui.js'))
  .replace('<!--HEAD-->', () => head)
  .replace('<!--TAIL-->', () => tail);

const appHead = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Block Game">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="theme-color" content="#e6e9ef" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#131821" media="(prefers-color-scheme: dark)">',
  '<link rel="apple-touch-icon" href="icons/icon-180.png">',
  '<link rel="icon" type="image/png" href="icons/icon-192.png">',
].join('\n');
const appTail = `<script>if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});</script>`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), fill('', ''));
fs.writeFileSync(path.join(__dirname, 'docs', 'index.html'), fill(appHead, appTail));
console.log('built dist/index.html and docs/index.html');
