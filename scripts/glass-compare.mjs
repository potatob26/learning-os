/**
 * 把参考图与当前实现放在同一画面里截图对照
 * 用法: node scripts/glass-compare.mjs <参考图路径>
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const refPath = process.argv[2];
const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const b64 = readFileSync(refPath);
const dataUrl = `data:image/jpeg;base64,${b64.toString('base64')}`;

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({
  viewport: { width: 560, height: 620 },
  deviceScaleFactor: 3,
  locale: 'zh-CN',
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const url = `http://127.0.0.1:5188/glass-compare.html?ref=${encodeURIComponent(dataUrl)}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);
console.log('错误:', errs.length ? errs.slice(0, 3) : '无');
await page.screenshot({ path: `${out}/compare.png`, fullPage: true });
console.log(`已截图: ${out}/compare.png`);
await browser.close();
