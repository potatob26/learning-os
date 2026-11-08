/**
 * 复现「确认弹窗被底部导航覆盖」
 * ──────────────────────────────────────────────────────────────
 * 不只量 z-index，而是实测：
 *   1. 弹层与底部导航的矩形是否重叠
 *   2. 在重叠区域 elementFromPoint 命中的到底是谁（这才是「谁盖住谁」的真相）
 *   3. 弹层底部按钮是否可见、可点
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/dialog';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

/** 几个必须覆盖的安卓尺寸 */
const SIZES = [
  ['360x800', 360, 800],
  ['390x844', 390, 844],
  ['412x915', 412, 915],
];

const seed = {
  schema: 3,
  settings: {
    theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true,
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
  },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: {
    current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['scene:aurora'], custom: [], dim: 0.35,
    dynamic: false, showVeil: true, grid: false,
  },
  timer: null, courseStatus: {},
};

for (const [label, w, h] of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
  await page.goto('http://127.0.0.1:5188/#/settings/data', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);

  // 触发「清空所有数据」确认弹窗
  const opened = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      (x.textContent || '').includes('清空所有数据'),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { error: '弹层未打开' };
    const nav = document.querySelector('nav');
    const panel = dialog.querySelector('.lg2') ?? dialog.lastElementChild;

    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) };
    };
    const panelR = r(panel);
    const navR = r(nav);

    // 重叠区域
    const overlap = panelR && navR
      ? Math.max(0, Math.min(panelR.bottom, navR.bottom) - Math.max(panelR.top, navR.top))
      : 0;

    // 弹层底部区域，谁在最上层？
    let hitAtPanelBottom = null;
    if (panelR) {
      const y = Math.min(panelR.bottom - 6, window.innerHeight - 6);
      const el = document.elementFromPoint(Math.round(panelR.left + 20), y);
      hitAtPanelBottom = el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : null;
    }

    // 底部按钮（取消/删除）是否完整可见
    const btns = Array.from(dialog.querySelectorAll('button')).map((b) => {
      const br = b.getBoundingClientRect();
      const mid = document.elementFromPoint(
        Math.round(br.left + br.width / 2),
        Math.round(br.top + br.height / 2),
      );
      return {
        text: (b.textContent || '').trim().slice(0, 8),
        rect: r(b),
        covered: !(mid === b || b.contains(mid)),
        coveredBy: mid ? `${mid.tagName}.${String(mid.className).slice(0, 30)}` : null,
      };
    });

    return {
      panel: panelR,
      nav: navR,
      overlap,
      hitAtPanelBottom,
      buttons: btns,
      bodyOverflow: getComputedStyle(document.body).overflow,
      viewportH: window.innerHeight,
    };
  });

  console.log(`\n=== ${label} ===`);
  if (info.error) {
    console.log('  ' + info.error);
  } else {
    console.log(`  弹层: top=${info.panel.top} bottom=${info.panel.bottom} 高=${info.panel.h}`);
    console.log(`  导航: top=${info.nav?.top} bottom=${info.nav?.bottom}`);
    console.log(`  重叠高度: ${info.overlap}px  ${info.overlap > 0 ? '← 有遮挡' : '（无重叠）'}`);
    console.log(`  弹层底部位置命中元素: ${info.hitAtPanelBottom}`);
    console.log(`  body overflow = ${info.bodyOverflow}`);
    for (const b of info.buttons) {
      const flag = b.covered ? `⚠️ 被 ${b.coveredBy} 覆盖` : '可点';
      console.log(`    按钮「${b.text}」 ${b.rect.top}~${b.rect.bottom}  ${flag}`);
    }
  }
  if (!opened) console.log('  ⚠️ 没找到触发按钮');

  await page.screenshot({ path: `${out}/dialog-${label}.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n截图: ${out}/`);
