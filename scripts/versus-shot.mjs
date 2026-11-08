/**
 * 液态玻璃横向对比截图（开发专用页面 /glass-versus.html）
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

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
  viewport: { width: 412, height: 1000 },
  deviceScaleFactor: 2.5,
  locale: 'zh-CN',
  colorScheme: 'dark',
});
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) logs.push(`[console] ${m.text()}`);
});

await page.goto('http://127.0.0.1:5188/glass-versus.html', { waitUntil: 'load' });
await page.waitForTimeout(2600);

console.log('错误:', logs.length ? logs.slice(0, 4) : '无');
console.log('\n' + (await page.textContent('#probe')));

await page.screenshot({ path: `${out}/versus-full.png`, fullPage: true });
console.log(`\n已截图: ${out}/versus-full.png`);

await browser.close();
