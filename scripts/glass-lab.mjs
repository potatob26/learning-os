/**
 * 在真实 Chrome 中检测 Liquid Glass 能力，并截图对比
 * 关键问题：Chrome 是否支持 backdrop-filter: url(#filter)（真·实时折射）
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/glass-lab.html';
const out = '.preview/glass';
const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--force-color-profile=srgb'],
});

const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const probe = await page.evaluate(() => window.__GLASS_PROBE__ ?? null);
console.log('=== 浏览器能力检测 ===');
console.log(JSON.stringify(probe, null, 2));
console.log('控制台错误:', errors.length ? errors.slice(0, 5) : '无');

await page.screenshot({ path: `${out}/lab-full.png`, fullPage: true });

// 单独截取玻璃卡片区域，放大看折射细节
const card = page.locator('.cell').first();
await card.screenshot({ path: `${out}/card-oldglass.png` }).catch(() => undefined);

const dp = page.locator('.liquid-glass--vivid').first();
await dp.screenshot({ path: `${out}/card-dpawlikowski.png` }).catch(() => undefined);

console.log(`截图输出: ${out}`);

/* 性能：测量持续动画下的合成成本（粗略） */
const perf = await page.evaluate(async () => {
  const t0 = performance.now();
  let frames = 0;
  await new Promise((resolve) => {
    const tick = () => {
      frames++;
      if (performance.now() - t0 > 1500) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { fps: Math.round((frames / (performance.now() - t0)) * 1000) };
});
console.log('动画期间帧率（无头模式仅供参考）:', perf.fps, 'fps');

await browser.close();
