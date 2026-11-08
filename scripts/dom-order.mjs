/**
 * 打印首页各卡片的 DOM 顺序与位置（核实渲染顺序）
 * 用法：node scripts/dom-order.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { SEED } from './lib-seed.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), SEED);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
const items = await page.evaluate(() => {
  const main = document.querySelector('main');
  const els = main ? Array.from(main.children[0]?.children ?? []) : [];
  return els.map((el, i) => {
    const r = el.getBoundingClientRect();
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return `${i}. top=${Math.round(r.top + window.scrollY)} h=${Math.round(r.height)} | ${text}`;
  });
});
console.log(items.join('\n'));
await browser.close();
