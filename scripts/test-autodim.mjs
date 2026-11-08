/**
 * 验证「背景暗化自动重算」
 *  ① dimAuto=true 时，切换浅色/深色会重算 dim
 *  ② 用户拖动滑块后 dimAuto 变 false，再切深浅不再覆盖
 *
 * ⚠️ 每个阶段都用**全新的 context**。
 *    踩过的坑：在同一个页面里连续 setItem 换种子再 reload 时，
 *    旧页面会在刷新前把自己内存里的状态写回 localStorage，**覆盖掉刚种下的数据**，
 *    于是读到的仍是上一个阶段的值 —— 看起来像"功能没生效"，其实是测试竞态。
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const URL = 'http://127.0.0.1:5188/';

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

/** 纯白图：深浅两种模式的推荐值差异极大（≈0.85 vs ≈0.08），便于验证"确实重算了" */
const WHITE_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const mkSeed = (dim, dimAuto, colorMode) => ({
  schema: 3,
  settings: {
    theme: 'liquid-glass', colorMode, perf: 'high', glassBlur: true,
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
  },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: {
    current: 'img:b1', mode: 'fixed', rotateMinutes: 60, enabledIds: ['img:b1'],
    custom: [{ id: 'b1', name: '白图', dataUrl: WHITE_IMG, width: 1, height: 1, bytes: 80, createdAt: Date.now() }],
    dim, dynamic: false, showVeil: true, grid: false, dimAuto,
  },
  timer: null, courseStatus: {},
});

/** 全新 context + 全新页面，种数据后 reload，避免旧页面回写覆盖 */
async function freshPage(seed) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark', isMobile: true,
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  return { ctx, page };
}

const readState = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('learning-os:v1:state');
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { dim: s.background.dim, dimAuto: s.background.dimAuto, colorMode: s.settings.colorMode };
  });

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

/* ---------- ① 深色模式：种子值故意设错，看是否被重算 ---------- */
{
  const { ctx, page } = await freshPage(mkSeed(0.1, true, 'dark'));
  const s = await readState(page);
  check('dimAuto=true 深色模式自动重算（0.1 → 约 0.85）', s && s.dim > 0.5, JSON.stringify(s));
  await ctx.close();
}

/* ---------- ② 浅色模式：同一张白图应降到很低 ---------- */
{
  const { ctx, page } = await freshPage(mkSeed(0.85, true, 'light'));
  const s = await readState(page);
  check('dimAuto=true 浅色模式重算（0.85 → 约 0.08）', s && s.dim < 0.3, JSON.stringify(s));
  await ctx.close();
}

/* ---------- ③ 拖动滑块 → dimAuto 变 false 且值保留 ---------- */
{
  const { ctx, page } = await freshPage(mkSeed(0.5, true, 'light'));
  await page.goto(`${URL}#/settings/background`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const ok = await page.evaluate(() => {
    const el = document.querySelector('input[type="range"][max="90"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, '25');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(700);
  const s = await readState(page);
  check('拖动滑块后 dimAuto=false', ok && s?.dimAuto === false, JSON.stringify(s));
  check('拖动后的值被保留（约 0.25）', s && Math.abs(s.dim - 0.25) < 0.03, `dim=${s?.dim}`);
  await ctx.close();
}

/* ---------- ④ dimAuto=false：切深浅都不再覆盖 ---------- */
{
  const { ctx, page } = await freshPage(mkSeed(0.25, false, 'dark'));
  const s = await readState(page);
  check('dimAuto=false 深色模式不覆盖', s && Math.abs(s.dim - 0.25) < 0.02, JSON.stringify(s));
  await ctx.close();
}
{
  const { ctx, page } = await freshPage(mkSeed(0.25, false, 'light'));
  const s = await readState(page);
  check('dimAuto=false 浅色模式不覆盖', s && Math.abs(s.dim - 0.25) < 0.02, JSON.stringify(s));
  await ctx.close();
}

/* ---------- ⑤ 向后兼容：老用户存档里没有 dimAuto 字段 ----------
   必须当作"手动"，绝不能悄悄改掉他们已调好的值 */
{
  const legacy = mkSeed(0.25, false, 'light');
  delete legacy.background.dimAuto; // 模拟旧版本存下来的数据
  const { ctx, page } = await freshPage(legacy);
  const s = await readState(page);
  check(
    '老存档（无 dimAuto 字段）不被自动覆盖',
    s && Math.abs(s.dim - 0.25) < 0.02,
    JSON.stringify(s),
  );
  await ctx.close();
}

/* ---------- ⑥ 全新安装无自定义图时不应报错 ---------- */
{
  const fresh = mkSeed(0.5, false, 'dark');
  fresh.background.current = 'scene:aurora';
  fresh.background.custom = [];
  const { ctx, page } = await freshPage(fresh);
  const errs = await page.evaluate(() => document.querySelectorAll('[role="alert"]').length);
  check('场景背景（无自定义图）下正常运行', errs === 0, `alert 数=${errs}`);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
