/**
 * 裁切并放大参考帧的关键区域，用于判读边缘几何与色散
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const out = '.preview/ref';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

/** [源文件, x, y, w, h, 放大倍数, 输出名] */
const crops = [
  ['ref2-03_t31.79s.png', 30, 615, 540, 185, 3, 'crop-searchbar-rainbow'],
  ['ref2-03_t31.79s.png', 30, 715, 540, 115, 3, 'crop-slider'],
  ['ref2-01_t13.63s.png', 30, 600, 540, 185, 3, 'crop-searchbar-photo'],
  ['ref2-01_t13.63s.png', 470, 660, 130, 150, 5, 'crop-roundbtn'],
  ['ref1-01_t4.56s.png', 20, 110, 555, 200, 3, 'crop-appstore-glass'],
];

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });

for (const [file, x, y, w, h, zoom, name] of crops) {
  const b64 = readFileSync(`${out}/${file}`).toString('base64');
  const cropped = await page.evaluate(
    async ([b, cx, cy, cw, ch, z]) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('decode fail'));
        img.src = `data:image/png;base64,${b}`;
      });
      const c = document.createElement('canvas');
      c.width = cw * z;
      c.height = ch * z;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
      return c.toDataURL('image/png');
    },
    [b64, x, y, w, h, zoom],
  );
  writeFileSync(`${out}/${name}.png`, Buffer.from(cropped.split(',')[1], 'base64'));
  console.log(`  ✓ ${name}.png  (${w}x${h} ×${zoom})`);
}

await browser.close();
