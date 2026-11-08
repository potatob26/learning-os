/**
 * 验证 v1.0：
 *  1. 界面内的 Logo 是否换成了新图（读取 img 的 src 与是否真的加载成功）
 *  2. 设置 → 数据 里是否显示版本号
 *  3. 启动页、引导页的 Logo
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

/** 版本号从 package.json 读取，避免每次发版都要改测试 */
const PKG_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;

const out = '.preview/v1';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
};

/* ---- ① 引导页（全新用户） ---- */
{
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3,
    locale: 'zh-CN',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);

  const logo = await page.evaluate(() => {
    const img = document.querySelector('img[src*="app-icon"]');
    if (!img) return { found: false };
    return {
      found: true,
      src: img.getAttribute('src'),
      complete: img.complete,
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      rect: (() => {
        const r = img.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      })(),
    };
  });
  check('引导页使用新的应用图标', logo.found && logo.natural === '192x192', JSON.stringify(logo));
  await page.screenshot({ path: `${out}/firstrun.png` });
  await ctx.close();
}

/* ---- ② 顶栏 Logo + 版本号 ---- */
{
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3,
    locale: 'zh-CN',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  const seed = {
    schema: 3,
    settings: {
      theme: 'liquid-glass',
      colorMode: 'dark',
      perf: 'balanced',
      glassBlur: true,
      onboarded: true,
      blocks: [],
      quoteSeed: 'x',
    },
    periods: [],
    courses: [],
    goals: [],
    tasks: [],
    sessions: [],
    dates: [],
    background: {
      current: 'scene:aurora',
      mode: 'fixed',
      rotateMinutes: 60,
      enabledIds: ['scene:aurora'],
      custom: [],
      dim: 0.35,
      dynamic: false,
      showVeil: true,
      grid: false,
    },
    timer: null,
    courseStatus: {},
  };
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
  await page.goto('http://127.0.0.1:5188/#/settings/data', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);

  const header = await page.evaluate(() => {
    const img = document.querySelector('header img, img[src*="app-icon"]');
    if (!img) return { found: false };
    return { found: true, natural: `${img.naturalWidth}x${img.naturalHeight}`, complete: img.complete };
  });
  check('顶栏 Logo 使用新图标', header.found && header.natural === '192x192', JSON.stringify(header));

  const about = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent ?? '';
    const m = /版本\s*v?([\d.]+)/.exec(t);
    const b = /构建时间\s*([\d/]+\s*[\d:]+)/.exec(t);
    const s = /数据格式版本\s*v?(\d+)/.exec(t);
    return { version: m?.[1] ?? null, build: b?.[1] ?? null, schema: s?.[1] ?? null, hasAbout: t.includes('关于') };
  });
  check('设置里显示版本号', about.version === PKG_VERSION, `version=${about.version}（期望 ${PKG_VERSION}）`);
  check('显示构建时间', Boolean(about.build), String(about.build));
  check('显示数据格式版本', Boolean(about.schema), `schema=${about.schema}`);
  check('存在「关于」区块', about.hasAbout);

  await page.screenshot({ path: `${out}/settings-about.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
