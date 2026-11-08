/**
 * 从设备截图里裁出图标区域并放大，用来肉眼检查遮罩边缘有没有露出填充色。
 * 用法: node scripts/crop-shot.mjs <src.png> <cx> <cy> <half> <scale> <out.png>
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [src, cx, cy, half, scale, out] = process.argv.slice(2);
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const b64 = readFileSync(src).toString('base64');

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<body style="margin:0"><img id="i" src="data:image/png;base64,${b64}"></body>`);
await page.waitForFunction(() => document.getElementById('i').complete);

const url = await page.evaluate(async ({ x, y, h, s }) => {
  const img = document.getElementById('i');
  const c = document.createElement('canvas');
  c.width = h * 2 * s; c.height = h * 2 * s;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, x - h, y - h, h * 2, h * 2, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}, { x: +cx, y: +cy, h: +half, s: +scale });

writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log(`裁剪 (${cx},${cy}) ±${half} 放大 ${scale}× → ${out}`);
await browser.close();
