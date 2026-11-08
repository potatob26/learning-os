/**
 * 复现用户报告的具体场景：背景页的「删除这张背景？」确认弹窗
 * 需要先有一张自定义背景才会出现删除按钮，这里用 dataURL 造一张。
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/sheets';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const SIZES = [
  ['360x800', 360, 800],
  ['412x915', 412, 915],
];

const seed = (img) => ({
  schema: 3,
  settings: {
    theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true,
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
  },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: {
    current: 'img:b1', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['img:b1'],
    custom: [{ id: 'b1', name: '夏日海边', dataUrl: img, addedAt: Date.now() }],
    dim: 0.35, dynamic: false, showVeil: true, grid: false,
  },
  timer: null, courseStatus: {},
});

// 造一张简单的渐变图当自定义背景
const tmpCtx = await browser.newContext({ viewport: { width: 400, height: 400 } });
const tmpPage = await tmpCtx.newPage();
const img = await tmpPage.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 120; c.height = 120;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 120, 120);
  grad.addColorStop(0, '#2563eb');
  grad.addColorStop(1, '#0d9488');
  g.fillStyle = grad;
  g.fillRect(0, 0, 120, 120);
  return c.toDataURL('image/png');
});
await tmpCtx.close();

for (const [label, w, h] of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed(img));
  await page.goto('http://127.0.0.1:5188/#/settings/background', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);

  // 找到自定义背景的删除按钮
  const clicked = await page.evaluate(() => {
    const del = Array.from(document.querySelectorAll('button')).find((b) => {
      const al = b.getAttribute('aria-label') || '';
      const t = (b.textContent || '').trim();
      return al.includes('删除') || t === '删除';
    });
    if (!del) return false;
    del.click();
    return true;
  });
  await page.waitForTimeout(900);

  const state = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return { open: false };
    const title = d.querySelector('h2')?.textContent ?? '';
    const panel = d.querySelector('.lg2') ?? d.lastElementChild;
    const pr = panel.getBoundingClientRect();
    const btns = Array.from(d.querySelectorAll('button'))
      .map((b) => (b.textContent || '').trim())
      .filter(Boolean);
    return {
      open: true,
      title,
      top: Math.round(pr.top),
      bottom: Math.round(pr.bottom),
      viewportH: window.innerHeight,
      btns,
      inBody: d.parentElement === document.body,
    };
  });

  console.log(`\n=== ${label} ===`);
  if (!clicked) console.log('  ⚠️ 没找到删除按钮');
  if (!state.open) {
    console.log('  ⚠️ 弹窗未打开');
  } else {
    console.log(`  标题: ${state.title}`);
    console.log(`  位置: ${state.top}~${state.bottom} / 视口 ${state.viewportH}，挂在 body 下=${state.inBody}`);
    console.log(`  按钮: ${state.btns.join(' / ')}`);
  }

  await page.screenshot({ path: `${out}/bg-delete-${label}.png` });
  console.log(`  截图: ${out}/bg-delete-${label}.png`);
  await ctx.close();
}

await browser.close();
