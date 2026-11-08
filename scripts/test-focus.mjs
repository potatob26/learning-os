/**
 * 验证专注模式
 *  ① 计时中默认进入专注界面、底部导航被盖住
 *  ② 巨号时间在走
 *  ③ 暂停/继续真实生效
 *  ④ 退出专注后回到普通计时页
 *  ⑤ 横屏（landscape）布局不溢出
 *  ⑥ 全屏按钮在无此能力的环境下**如实提示失败**，而不是假装成功
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const seed = {
  schema: 3,
  settings: {
    theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true,
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
    dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '23:00',
  },
  periods: [], courses: [],
  goals: [{ id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60, actualMinutes: 12, status: 'doing', createdAt: Date.now(), completedAt: null, priority: 'normal', dueAt: null, description: '' }],
  tasks: [], sessions: [], dates: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false, dimAuto: false },
  timer: {
    id: 't1', subject: '数学', goalId: 'g1', phase: 'running',
    startedAt: Date.now() - 20 * 60000, pausedMs: 0, pausedAt: null, targetMinutes: 60,
    autoResumed: false,
  },
  courseStatus: {},
};

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2,
  locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
await page.goto('http://127.0.0.1:5188/#/timer', { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2000);

/* ---------- ① 默认进入专注界面 ---------- */
const state1 = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  if (!d) return { focus: false };
  const r = d.getBoundingClientRect();
  return {
    focus: true,
    covers: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1,
    text: (d.textContent || '').replace(/\s+/g, ' ').slice(0, 150),
  };
});
check('计时中默认显示专注界面', state1.focus, state1.text);
check('专注层铺满整个视口', state1.covers === true);

/* ---------- ② 巨号时间在走 ---------- */
const t1 = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  // 用 data-testid 精确定位巨号时间。
  // 不能拿整段 textContent 去正则匹配 hh:mm:ss —— 会先匹配到页脚的
  // 「开始于 10:57:19」，而巨号时间本身是 mm:ss 格式，永远轮不到（第一版就栽在这）。
  return (d?.querySelector('[data-testid="focus-clock"]')?.textContent ?? '').trim() || null;
});
await page.waitForTimeout(2600);
const t2 = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  // 用 data-testid 精确定位巨号时间。
  // 不能拿整段 textContent 去正则匹配 hh:mm:ss —— 会先匹配到页脚的
  // 「开始于 10:57:19」，而巨号时间本身是 mm:ss 格式，永远轮不到（第一版就栽在这）。
  return (d?.querySelector('[data-testid="focus-clock"]')?.textContent ?? '').trim() || null;
});
/** 把 mm:ss 或 h:mm:ss 都解析成秒。
 *  巨号时间用 fmtClock 输出的是 mm:ss（两段），
 *  第一版写死三段会让 p[2] 变成 undefined 而算出 NaN，误报失败。 */
const secs = (s) => {
  const p = (s ?? '0:00').split(':').map(Number);
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] * 3600 + p[1] * 60 + p[2];
};
check('巨号时间在递增', t1 !== null && t2 !== null && secs(t2) - secs(t1) >= 2, `${t1} → ${t2}`);

/* ---------- ③ 暂停真实生效 ---------- */
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  const b = Array.from(d?.querySelectorAll('button') ?? []).find((x) => (x.textContent || '').trim() === '暂停');
  b?.click();
});
await page.waitForTimeout(800);
const paused = await page.evaluate(() => {
  const raw = localStorage.getItem('learning-os:v1:state');
  return JSON.parse(raw).timer.phase;
});
check('点暂停后计时器进入暂停态', paused === 'paused', `phase=${paused}`);

const p1 = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  // 用 data-testid 精确定位巨号时间。
  // 不能拿整段 textContent 去正则匹配 hh:mm:ss —— 会先匹配到页脚的
  // 「开始于 10:57:19」，而巨号时间本身是 mm:ss 格式，永远轮不到（第一版就栽在这）。
  return (d?.querySelector('[data-testid="focus-clock"]')?.textContent ?? '').trim() || null;
});
await page.waitForTimeout(2200);
const p2 = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  // 用 data-testid 精确定位巨号时间。
  // 不能拿整段 textContent 去正则匹配 hh:mm:ss —— 会先匹配到页脚的
  // 「开始于 10:57:19」，而巨号时间本身是 mm:ss 格式，永远轮不到（第一版就栽在这）。
  return (d?.querySelector('[data-testid="focus-clock"]')?.textContent ?? '').trim() || null;
});
check('暂停后时间不再增长', p1 === p2, `${p1} → ${p2}`);

/* ---------- ④ 退出专注回到普通计时页 ---------- */
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  d?.querySelector('button[aria-label="退出专注模式"]')?.click();
});
await page.waitForTimeout(800);
const afterExit = await page.evaluate(() => ({
  focus: Boolean(document.querySelector('[role="dialog"][aria-label="专注计时"]')),
  hasHeader: (document.querySelector('main h1')?.textContent ?? '').includes('计时'),
}));
check('退出专注后回到普通计时页', !afterExit.focus && afterExit.hasHeader, JSON.stringify(afterExit));

/* ---------- ⑤ 横屏布局不溢出 ---------- */
await page.evaluate(() => {
  // 重新进入专注：重新加载会重置 focusMode
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1800);
await page.setViewportSize({ width: 915, height: 412 });
await page.waitForTimeout(900);
const land = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  const de = document.documentElement;
  return {
    focus: Boolean(d),
    overflowX: de.scrollWidth - de.clientWidth,
    // 横屏下应变成左右分栏
    row: d ? getComputedStyle(d.querySelector('.flex.min-h-0') ?? d).flexDirection : null,
  };
});
check('横屏下仍在专注界面', land.focus);
check('横屏无横向溢出', land.overflowX <= 1, `溢出 ${land.overflowX}px`);
check('横屏改成左右分栏', land.row === 'row', `flex-direction=${land.row}`);

// 横屏截图
await page.screenshot({ path: '.preview/focus/landscape.png' }).catch(() => {});
await page.setViewportSize({ width: 412, height: 915 });
await page.waitForTimeout(700);
await page.screenshot({ path: '.preview/focus/portrait.png' }).catch(() => {});

/* ---------- ⑥ 全屏失败要如实提示 ---------- */
const fs = await page.evaluate(async () => {
  const mod = await import('/src/lib/fullscreen.ts');
  const r = await mod.enterFullscreen();
  return { supported: mod.fullscreenSupported(), ok: r.ok, reason: r.reason ?? null, active: mod.isFullscreen() };
});
check(
  '全屏结果与实际状态一致（不假装成功）',
  fs.ok === fs.active,
  `supported=${fs.supported} ok=${fs.ok} active=${fs.active} reason=${fs.reason}`,
);

check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
