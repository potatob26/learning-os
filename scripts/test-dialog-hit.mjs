/**
 * 决定性测试：在弹窗「取消」按钮中心做一次**真实鼠标点击**（走浏览器命中测试），
 * 判断该点到底被弹窗接住，还是被底部导航抢走。
 * 这才是用户实际会遇到的行为，比读 z-index 可靠。
 *
 * ── 两个必须注意的点（都曾让这个测试误报失败）────────────────────
 *  1. 新增的「更新说明」弹层也是 [role="dialog"]，
 *     用 querySelector('[role="dialog"]') 盲取第一个会抓到它（里面没有「取消」）。
 *     所以要先关掉更新说明，并**在所有 dialog 里找含「取消」的那个**。
 *  2. 页面按钮文案是「清空所有数据」（「全部清空」是弹层里的确认按钮）。
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const SIZES = [
  ['360x800', 360, 800],
  ['390x844', 390, 844],
  ['412x915', 412, 915],
];

const seed = {
  schema: 3,
  settings: { theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true, dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x' },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false },
  timer: null, courseStatus: {},
};

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

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
  await page.waitForTimeout(1700);

  // 关掉「本次更新」弹层（新版本首次访问会出现）
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button'))
      .find((x) => (x.textContent || '').includes('知道了'))
      ?.click();
  });
  await page.waitForTimeout(700);

  // 打开危险操作确认弹层
  const opened = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      (x.textContent || '').includes('清空所有数据'),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(800);

  // 在所有 dialog 里找含「取消」的那个，而不是盲取第一个
  const rect = await page.evaluate(() => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
      Array.from(d.querySelectorAll('button')).some((b) => (b.textContent || '').includes('取消')),
    );
    if (!dialog) return null;
    const b = Array.from(dialog.querySelectorAll('button')).find((x) => (x.textContent || '').includes('取消'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const nav = document.querySelector('nav')?.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      cancelBottom: Math.round(r.bottom),
      navTop: nav ? Math.round(nav.top) : null,
    };
  });

  console.log(`\n=== ${label} ===`);
  check('危险操作确认弹层能打开且含「取消」', opened && rect !== null, rect ? `取消按钮中心 (${rect.x}, ${rect.y})` : '未找到');

  if (rect) {
    if (rect.navTop !== null) {
      console.log(`    取消按钮 bottom=${rect.cancelBottom} · 底栏 top=${rect.navTop}` +
        (rect.cancelBottom > rect.navTop ? '（落在底栏覆盖区内，正是当初被抢点击的位置）' : ''));
    }

    const before = await page.evaluate(() => ({ path: location.hash }));
    await page.mouse.click(rect.x, rect.y);
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      hasDialog: Boolean(
        Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
          Array.from(d.querySelectorAll('button')).some((b) => (b.textContent || '').includes('取消')),
        ),
      ),
      path: location.hash,
    }));

    check('真实点击「取消」后弹层关闭（没被底栏抢走）', after.hasDialog === false, `弹层仍在=${after.hasDialog}`);
    check('且没有误触底栏导致跳页', after.path === before.path, `${before.path} → ${after.path}`);
  }

  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
