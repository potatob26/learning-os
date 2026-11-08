/**
 * 运行时实验：分别改动弹层/导航的 z-index 与 DOM 位置，找出真正的决定因素
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  colorScheme: 'dark',
  isMobile: true,
});
const page = await ctx.newPage();
const seed = {
  schema: 3,
  settings: { theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true, dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x' },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false },
  timer: null, courseStatus: {},
};

const reload = async () => {
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
  await page.goto('http://127.0.0.1:5188/#/settings/data', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('清空所有数据'));
    b?.click();
  });
  await page.waitForTimeout(700);
};

/** 判断某点最上层是谁 */
const whoIsOnTop = () =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const b = Array.from(d.querySelectorAll('button')).find((x) => (x.textContent || '').includes('取消'));
    const r = b.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const el = document.elementFromPoint(x, y);
    const inDialog = d.contains(el);
    const inNav = Boolean(el.closest('nav'));
    return { hit: `${el.tagName}.${String(el.className).slice(0, 34)}`, inDialog, inNav, x, y };
  });

const experiments = [
  ['① 现状（不改动）', async () => {}],
  [
    '② 把导航 z-index 设为 0',
    async () => { await page.evaluate(() => { document.querySelector('nav').style.zIndex = '0'; }); },
  ],
  [
    '③ 把弹层 z-index 设为 9999',
    async () => { await page.evaluate(() => { document.querySelector('[role="dialog"]').style.zIndex = '9999'; }); },
  ],
  [
    '④ 导航 z-index 9999 + 弹层 100（故意让导航更高）',
    async () => {
      await page.evaluate(() => {
        document.querySelector('nav').style.zIndex = '9999';
        document.querySelector('[role="dialog"]').style.zIndex = '100';
      });
    },
  ],
  [
    '⑤ 把弹层移到 body 末尾（Portal 效果），导航保持 z-40',
    async () => {
      await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        document.body.appendChild(d);
      });
    },
  ],
];

for (const [label, act] of experiments) {
  await reload();
  await act();
  await page.waitForTimeout(300);
  const r = await whoIsOnTop();
  console.log(`${label}`);
  console.log(`   命中: ${r.hit}`);
  console.log(`   在弹窗内=${r.inDialog}  在导航内=${r.inNav}`);
}

await browser.close();
