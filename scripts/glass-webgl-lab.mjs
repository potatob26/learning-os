/**
 * 渲染 WebGL 液态玻璃实验台并逐个面板截图
 * 需要软件 GL（无头环境）：--use-gl=angle --use-angle=swiftshader
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const refPath = process.argv[2];

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--force-color-profile=srgb',
  ],
});

const ctx = await browser.newContext({
  viewport: { width: 900, height: 1080 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errs.push('console: ' + m.text());
});

let url = 'http://127.0.0.1:5188/webgl-lab.html';
if (refPath) {
  const { readFileSync } = await import('node:fs');
  const b64 = readFileSync(refPath).toString('base64');
  url += `?ref=${encodeURIComponent(`data:image/jpeg;base64,${b64}`)}`;
}

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

console.log('错误:', errs.length ? errs.slice(0, 3) : '无');
console.log('探测:', JSON.stringify(await page.evaluate(() => window.__LAB__ ?? null)));

const boxes = await page.locator('.glassbox').all();
const names = ['A-weak', 'B-strong', 'C-chroma'];
for (let i = 0; i < boxes.length; i++) {
  await boxes[i].screenshot({ path: `${out}/gl-${names[i] ?? i}.png` });
  console.log(`  ✓ gl-${names[i] ?? i}.png`);
}
console.log('面板数:', boxes.length);

await page.screenshot({ path: `${out}/webgl-lab.png`, fullPage: true });
await browser.close();
