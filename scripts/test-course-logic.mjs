/**
 * 课程逻辑验证
 *  1. 今日课程显示状态，点击可循环切换
 *  2. 状态会持久化
 *  3. 学习窗口内的课标为「请假」后，课后可支配时间增加相应课时
 *  4. 课程状态**不会**产生任何学习记录（StudyRecord）
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 1000 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  colorScheme: 'dark',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const wd = (new Date().getDay() + 6) % 7;
/** 今天的 yyyy-MM-dd（本地时区）。与 lib/time.ts 的 dayKey 同口径，这里内联免得引模块 */
const todayKey = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
const at = (d, h, m = 0) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(h, m, 0, 0);
  return x.getTime();
};

const seed = {
  schema: 1,
  settings: {
    theme: 'liquid-glass',
    colorMode: 'dark',
    perf: 'balanced',
    glassBlur: true,
    dynamicBackground: false,
    onboarded: true,
    quoteSeed: 'x',
    dailyGoalMinutes: 180,
    // 学习窗口 17:40 - 22:30
    studyFrom: '17:40',
    studyTo: '22:30',
    blocks: [
      { id: 'b1', label: '晚饭', kind: 'meal', start: '17:40', end: '18:30', weekdays: null },
    ],
  },
  periods: [
    { id: 'p1', name: '第 1 节', start: '08:00', end: '08:45', counts: true },
    // 这节晚辅导落在学习窗口内：19:00-20:00
    { id: 'p9', name: '晚辅导', start: '19:00', end: '20:00', counts: true },
  ],
  courses: [
    { id: 'c1', subject: '数学', title: '数学', weekday: wd, periodId: 'p1' },
    { id: 'c2', subject: '英语', title: '英语晚辅导', weekday: wd, periodId: 'p9' },
  ],
  goals: [],
  tasks: [],
  sessions: [
    { id: 's1', subject: '数学', goalId: null, startedAt: at(0, 18, 45), endedAt: at(0, 18, 45) + 84 * 60000, durationSec: 84 * 60, source: 'timer' },
  ],
  dates: [],
  background: {
    current: 'scene:grid',
    mode: 'fixed',
    rotateMinutes: 60,
    enabledIds: ['scene:grid'],
    custom: [],
    dim: 0.2,
    dynamic: false,
    showVeil: false,
  },
  timer: null,
  courseStatus: {},
  /*
   * 把「今天」钉成按星期 wd 上课。
   *
   * 不钉的话这个用例会随运行日期时好时坏：节假日/调休日里课表本来就不生效
   * （比如 2026-09-25~27 是中秋假期），于是「可支配时间已扣除窗口内的课程」
   * 必然失败 —— 那是应用**正确**地按节假日算，不是缺陷。
   * 这与 test-holidays 的「上课占用」用例踩的是同一个坑，修法也一样：
   * 用 dayOverride 把当天课表固定下来，让断言只测它想测的逻辑。
   */
  dayOverrides: [{ date: todayKey, schedule: wd }],
};

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2000);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** 从首页读出「课后可支配」的数值（分钟） */
const readAvailable = async () => {
  const text = await page.evaluate(() => {
    const card = document.querySelector('main');
    const m = /课后可支配[\s\S]{0,40}?(\d+h\s*\d+m|\d+h|\d+m)/.exec(card?.textContent ?? '');
    return m ? m[1] : null;
  });
  if (!text) return null;
  const h = /(\d+)h/.exec(text);
  const mm = /(\d+)m/.exec(text);
  return (h ? Number(h[1]) * 60 : 0) + (mm ? Number(mm[1]) : 0);
};

const before = await readAvailable();
check('首页能读出「课后可支配」', before !== null, `${before} 分钟`);
// 窗口 290 - 晚饭 50 - 晚辅导 60 = 180
check('可支配时间已扣除窗口内的课程', before === 180, `期望 180，实际 ${before}`);

// 课程行状态
const rowText = await page.evaluate(() => {
  const t = document.querySelector('main')?.textContent ?? '';
  return { hasAttended: t.includes('已上完'), hasUnconfirmed: t.includes('未确认') };
});
check('今日课程显示状态标签', rowText.hasAttended || rowText.hasUnconfirmed, JSON.stringify(rowText));

// 把「英语晚辅导」标为请假：点击它的状态按钮
const clicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button[aria-label*="的状态"]'));
  const target = btns.find((b) => (b.getAttribute('aria-label') ?? '').includes('英语'));
  if (!target) {
    // 若英语已是「已上完」，需点三次到请假；先点一次看看当前状态
    return btns.length > 0;
  }
  return true;
});
check('找到课程状态按钮', clicked);

// 循环点击英语那行直到出现「请假」
let cycles = 0;
for (let i = 0; i < 4; i++) {
  const state = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label*="的状态"]'));
    const target = btns.find((b) => (b.getAttribute('aria-label') ?? '').includes('英语'));
    return target ? (target.textContent ?? '') : null;
  });
  if (!state) break;
  if (state.includes('请假')) break;
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label*="的状态"]'));
    const target = btns.find((b) => (b.getAttribute('aria-label') ?? '').includes('英语'));
    if (target) target.click();
  });
  cycles++;
  await page.waitForTimeout(500);
}
void cycles;

const afterText = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button[aria-label*="的状态"]'));
  const target = btns.find((b) => (b.getAttribute('aria-label') ?? '').includes('英语'));
  return target ? (target.textContent ?? '') : null;
});
check('英语晚辅导已切到「请假」', Boolean(afterText && afterText.includes('请假')), String(afterText));

const after = await readAvailable();
check(
  '请假后课后可支配增加了 60 分钟',
  after === before + 60,
  `${before} → ${after} 分钟`,
);

// 持久化
const persisted = await page.evaluate(() => {
  const raw = localStorage.getItem('learning-os:v1:state');
  const st = raw ? JSON.parse(raw) : null;
  const days = st?.courseStatus ? Object.keys(st.courseStatus) : [];
  const first = days.length ? st.courseStatus[days[0]] : null;
  return { days, entry: first };
});
check('状态已持久化到本地', persisted.days.length > 0, JSON.stringify(persisted.entry));

// 关键：课程状态不得产生学习记录
const sessionCount = await page.evaluate(() => {
  const raw = localStorage.getItem('learning-os:v1:state');
  const st = raw ? JSON.parse(raw) : null;
  return Array.isArray(st?.sessions) ? st.sessions.length : -1;
});
check('课程状态没有产生任何学习记录', sessionCount === 1, `学习记录数 ${sessionCount}（应仍为 1）`);

// 刷新后请假状态仍生效（可支配应保持 240，而不是回到 180）
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
const afterReload = await readAvailable();
check('刷新后请假状态仍生效', afterReload === after, `${after} → ${afterReload} 分钟`);

check('无运行期错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await page.screenshot({ path: `${out}/home-courses.png`, fullPage: true });
console.log(`\n已截图: ${out}/home-courses.png`);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) process.exit(1);
