/**
 * 背景网格开关：用画布像素哈希判定，并回读实际生效的设置值
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const base = (grid) => ({
  schema: 1,
  settings: { theme: 'liquid-glass', colorMode: 'dark', perf: 'balanced', glassBlur: true, onboarded: true, blocks: [], quoteSeed: 'x' },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: {
    current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['scene:aurora'], custom: [], dim: 0.35,
    dynamic: false, showVeil: false, grid,
  },
  timer: null, courseStatus: {},
});

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const sample = async (page) => {
  // 回读设置 + 画布像素哈希
  const info = await page.evaluate(() => {
    const c = document.querySelector('.bg-canvas');
    const g = c?.getContext('2d');
    let hashSource = '';
    if (c && g) {
      // 取中间一条带，转成字符串参与哈希（避免 base64 体积）
      const d = g.getImageData(0, Math.floor(c.height / 2), c.width, 2).data;
      const arr = [];
      for (let i = 0; i < d.length; i += 4) arr.push(d[i], d[i + 1], d[i + 2]);
      hashSource = arr.join(',');
    }
    return {
      canvasSize: c ? `${c.width}x${c.height}` : null,
      hashSource,
      gridFromLs: (() => {
        try {
          const raw = localStorage.getItem('learning-os:v1:state');
          return raw ? JSON.parse(raw)?.background?.grid : 'no-ls';
        } catch { return 'parse-fail'; }
      })(),
    };
  });
  return { ...info, hash: createHash('sha1').update(info.hashSource).digest('hex').slice(0, 12) };
};

const off = {};
const on = {};
for (const grid of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), base(grid));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const s = await sample(page);
  console.log(`  设置 grid=${grid}: 存档值=${s.gridFromLs} 画布=${s.canvasSize} 像素哈希=${s.hash}`);
  if (grid) Object.assign(on, s); else Object.assign(off, s);
  await page.screenshot({ path: `${out}/grid-${grid ? 'on' : 'off'}.png` });
  await ctx.close();
}

check('关闭时存档值为 false', off.gridFromLs === false, String(off.gridFromLs));
check('打开时存档值为 true', on.gridFromLs === true, String(on.gridFromLs));
check('两种设置产生了不同的画面', off.hash !== on.hash, `关 ${off.hash} vs 开 ${on.hash}`);

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
