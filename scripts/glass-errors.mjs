/**
 * 抓取玻璃实验台的着色器编译/链接错误
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

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
  ],
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto('http://127.0.0.1:5188/webgl-lab.html', { waitUntil: 'load' });
await page.waitForTimeout(2000);

console.log('=== 控制台输出 ===');
for (const l of logs) console.log(l);
console.log('=== 探测 ===');
console.log(JSON.stringify(await page.evaluate(() => window.__LAB__ ?? null)));

await browser.close();
