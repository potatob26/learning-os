/**
 * 截「软件主页」图（电脑上用真实 Chrome 内核，手机视口）
 * ──────────────────────────────────────────────────────────────
 * 用法：先起服务（npm run dev -- --port 5188 --host 127.0.0.1），然后
 *   node scripts/shot-home.mjs [url] [outFile]
 *
 * 为什么在电脑上截、而不是手机截图：
 *   1. 手机上用户自己上传的壁纸是**第三方版权作品**，放进说明书/商店截图属于对外分发；
 *      浏览器里用演示数据 → 背景是应用**自带的程序化场景**，没有版权问题。
 *   2. 手机截图带系统状态栏（别的 App 图标）与个人使用数据；
 *      这里用演示数据、干净视口。
 *
 * 数据来源：scripts/lib-seed.mjs 的 SEED（与项目其它截图脚本同一份种子，
 * 所以截出来的首页内容与既有 .preview/shots 一致）。
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SEED } from './lib-seed.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const out = process.argv[3] ?? 'docs/软著材料/截图/首页.png';

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find((p) => existsSync(p));

if (!CHROME) {
  console.error('找不到本机 Chrome/Edge，可设 CHROME_PATH 指定');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME });
// 常见安卓尺寸 + DPR 3：出图 1236×2745，够清楚又不至于几十 MB
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  colorScheme: 'light',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(url, { waitUntil: 'load' });

// 昵称：SHOT_NICKNAME=potato node scripts/shot-home.mjs  （默认不设昵称）
const NICKNAME = process.env.SHOT_NICKNAME ?? '';
const seeded = NICKNAME
  ? { ...SEED, settings: { ...SEED.settings, nickname: NICKNAME } }
  : SEED;

// 注入演示数据（localStorage 是主后端之一；浏览器上下文里 IndexedDB 为空，两者取会话多的那侧）
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seeded);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

// 关掉「本次更新」公告（覆盖整页的 role=dialog，会挡住首页）
const closed = await page.evaluate(() => {
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    if (!/本次更新|更新说明/.test(d.textContent || '')) continue;
    const b = Array.from(d.querySelectorAll('button')).find((x) =>
      /知道了|开始使用|关闭|稍后/.test(x.textContent || ''),
    );
    if (b) {
      b.click();
      return true;
    }
  }
  return false;
});

await page.goto(`${url}#/`, { waitUntil: 'load' });
await page.waitForTimeout(1600);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);

mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });

const info = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
}));
console.log(`公告是否点到关闭：${closed}`);
console.log(`主题：${info.theme}`);
console.log(`首页文字：${info.text}`);
console.log(`控制台错误：${errors.length ? errors.slice(0, 3).join(' | ') : '无'}`);
console.log(`输出：${out}`);

await ctx.close();
await browser.close();
