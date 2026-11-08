/**
 * 图标验证：把生成的图标放在浅色 / 深色 / 棋盘背景上渲染，
 * 检查白边是否真的扣干净、圆角是否透明、maskable 是否满幅。
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/icons';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 2 });

const files = [
  ['icons/icon-192.webp', '192 普通'],
  ['icons/icon-512.webp', '512 普通'],
  ['icons/icon-maskable-512.webp', '512 maskable'],
  ['apple-touch-icon.png', '180 apple'],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font:13px system-ui;background:#1a1d24;color:#fff}
  .row{display:flex;gap:14px;padding:14px}
  .cell{text-align:center}
  .cap{font-size:11px;opacity:.75;margin-bottom:6px}
  .box{width:150px;height:150px;display:grid;place-items:center;border-radius:10px;overflow:hidden}
  .light{background:#ffffff}
  .dark{background:#0b0d12}
  .checker{background-image:linear-gradient(45deg,#bbb 25%,transparent 25%),linear-gradient(-45deg,#bbb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#bbb 75%),linear-gradient(-45deg,transparent 75%,#bbb 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
  .color{background:#ff5a5a}
  img{width:118px;height:118px;image-rendering:auto}
</style></head><body>
${['light', 'dark', 'checker', 'color']
  .map(
    (bg) => `<div class="row">${files
      .map(
        ([f, label]) =>
          `<div class="cell"><div class="cap">${label} · ${bg}</div><div class="box ${bg}"><img src="/${f}?t=${Date.now()}"></div></div>`,
      )
      .join('')}</div>`,
  )
  .join('')}
</body></html>`;

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'domcontentloaded' });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/icon-preview.png`, fullPage: true });
console.log(`已截图: ${out}/icon-preview.png`);

// 直接读像素判断：普通图标四角应为透明，maskable 四角应不透明
const probe = await page.evaluate(async () => {
  const load = (src) =>
    new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.src = src;
    });
  const corner = async (src) => {
    const img = await load(src);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = (x, y) => {
      const d = g.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    };
    const w = c.width;
    const h = c.height;
    return {
      size: `${w}x${h}`,
      topLeft: px(1, 1),
      topRight: px(w - 2, 1),
      center: px(Math.floor(w / 2), Math.floor(h / 2)),
    };
  };
  return {
    normal: await corner('/icons/icon-512.webp'),
    normal192: await corner('/icons/icon-192.webp'),
    maskable: await corner('/icons/icon-maskable-512.webp'),
    apple: await corner('/apple-touch-icon.png'),
  };
});

console.log(JSON.stringify(probe, null, 2));
await browser.close();
