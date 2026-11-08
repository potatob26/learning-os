/**
 * 复现：首页「重要日期」模块设了模块背景图、且日期多于 1 个时，
 * 横向小卡（.snap-item.glass）是否落在玻璃覆盖之外（直接压在背景图上）。
 *
 * 用法：先起 dev（npm run dev -- --port 5188 --host 127.0.0.1）
 *   node scripts/repro-date-module-bg.mjs [theme]
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { SEED } from './lib-seed.mjs';

const theme = process.argv[2] ?? 'liquid-glass';
const DATE_COUNT = Number(process.env.DATES ?? 4);
const NO_BG = process.env.NOBG === '1';
const VW = Number(process.env.VW ?? 344);
const VH = Number(process.env.VH ?? 882);
const SUFFIX = process.env.SUFFIX ?? '';
const url = 'http://127.0.0.1:5188/';
const outDir = '.preview/bug-glass';
mkdirSync(outDir, { recursive: true });

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((p) => existsSync(p));

const bgDataUrl =
  'data:image/png;base64,' +
  readFileSync(`${outDir}/${process.env.BGIMG ?? 'test-bg.png'}`).toString('base64');

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  colorScheme: 'light',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'load' });

const seeded = {
  ...SEED,
  settings: {
    ...SEED.settings,
    theme,
    colorMode: 'light',
    homeOrder: ['progress', 'courses', 'dates', 'todos'],
    ...(NO_BG ? {} : { dateModuleBackground: { imageId: 'imgtest', dim: 0.25 } }),
  },
  background: {
    ...SEED.background,
    current: 'scene:aurora',
    custom: NO_BG
      ? []
      : [
          { id: 'imgtest', name: '测试图', dataUrl: bgDataUrl, width: 800, height: 600, bytes: 5000, createdAt: Date.now() },
        ],
  },
  dates: [
    { id: 'd1', title: '中考', date: '2027-06-15', allDay: true, primary: true, visible: true, kind: 'exam', createdAt: Date.now() },
    { id: 'd2', title: '期末考', date: '2027-01-12', allDay: true, primary: false, visible: true, kind: 'exam', createdAt: Date.now() },
    { id: 'd3', title: '生日', date: '2026-11-03', allDay: true, primary: false, visible: true, kind: 'birthday', createdAt: Date.now() },
    { id: 'd4', title: '运动会', date: '2026-12-01', allDay: true, primary: false, visible: true, kind: 'custom', createdAt: Date.now() },
  ].slice(0, Math.max(1, DATE_COUNT)),
};
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seeded);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);

// 关更新公告
await page.evaluate(() => {
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    const b = Array.from(d.querySelectorAll('button')).find((x) => /知道了|开始使用|关闭|稍后/.test(x.textContent || ''));
    if (b) b.click();
  }
});
await page.waitForTimeout(900);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(700);

const info = await page.evaluate(() => {
  const section = document.querySelector('[data-home-section="dates"]');
  if (!section) return { error: '找不到 dates section' };
  const wrapper = section.firstElementChild; // DateModuleBackground 的外层（有背景图时）
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10, left: Math.round(r.left * 10) / 10 };
  };
  const primaryCard = section.querySelector('.glass-liquid, .lg2, [data-key-glass], .mica');
  const chips = Array.from(section.querySelectorAll('.snap-item'));
  const chipStyles = chips.map((c) => {
    const cs = getComputedStyle(c);
    return {
      text: (c.textContent || '').replace(/\s+/g, ' ').slice(0, 20),
      cls: String(c.className),
      rect: rectOf(c),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage.slice(0, 40),
      backdrop: cs.backdropFilter,
      border: cs.borderTopColor,
      radius: cs.borderRadius,
    };
  });
  const wrapperStyles = wrapper ? getComputedStyle(wrapper) : null;
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    section: rectOf(section),
    wrapperClass: wrapper ? String(wrapper.className).slice(0, 120) : null,
    wrapper: wrapper ? rectOf(wrapper) : null,
    wrapperBg: wrapperStyles ? wrapperStyles.backgroundImage.slice(0, 40) : null,
    primaryCard: primaryCard ? { cls: String(primaryCard.className).slice(0, 100), rect: rectOf(primaryCard) } : null,
    chips: chipStyles,
    chipRow: chips[0] ? rectOf(chips[0].parentElement) : null,
    text: (section.textContent || '').replace(/\s+/g, ' ').slice(0, 160),
  };
});

const file = `${outDir}/date-module-${theme}-${DATE_COUNT}${NO_BG ? '-nobg' : ''}${SUFFIX}.png`;
await page.screenshot({ path: file });

// 把「重要日期」模块单独截出来，方便看小卡与玻璃/背景图的关系
const sectionEl = page.locator('[data-home-section="dates"]');
await sectionEl.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const sectionFile = `${outDir}/date-module-${theme}-${DATE_COUNT}${NO_BG ? '-nobg' : ''}${SUFFIX}-section.png`;
await sectionEl.screenshot({ path: sectionFile });
console.log(JSON.stringify(info, null, 2));
console.log(`\n截图：${file}`);
console.log(`模块截图：${sectionFile}`);
console.log(`JS 错误：${errors.length ? errors.slice(0, 3).join(' | ') : '无'}`);

await ctx.close();
await browser.close();
