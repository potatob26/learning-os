/**
 * 单主题快速截图：只截一个主题的首页，用于快速观察液态玻璃调整效果
 * 用法：node scripts/shot-one.mjs <theme> [scheme]
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const theme = process.argv[2] ?? 'liquid-glass';
const scheme = process.argv[3] ?? 'dark';
const base = process.argv[4] ?? 'http://127.0.0.1:5188/';
const out = '.preview/glass';
mkdirSync(out, { recursive: true });

const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const wd = (new Date().getDay() + 6) % 7;
const at = (d, h, m = 0) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(h, m, 0, 0);
  return x.getTime();
};

const seed = {
  schema: 1,
  settings: {
    theme,
    colorMode: scheme,
    perf: 'balanced',
    motion: true,
    glassBlur: true,
    dynamicBackground: true,
    schoolStart: '08:00',
    schoolEnd: '17:40',
    wakeTime: '06:40',
    sleepTime: '22:30',
    dailyGoalMinutes: 180,
    blocks: [
      { id: 'b1', label: '晚饭', kind: 'meal', start: '17:40', end: '18:30', weekdays: null },
      { id: 'b2', label: '洗漱、收拾', kind: 'chore', start: '22:00', end: '22:25', weekdays: null },
    ],
    studyFrom: '17:40',
    studyTo: '22:30',
    quoteSeed: '2026-09-12',
    align: 'left',
    nickname: '',
    onboarded: true,
  },
  periods: [
    { id: 'p1', name: '第 1 节', start: '08:00', end: '08:45', counts: true },
    { id: 'p2', name: '第 2 节', start: '08:55', end: '09:40', counts: true },
    { id: 'p3', name: '第 3 节', start: '10:00', end: '10:45', counts: true },
    { id: 'p4', name: '第 4 节', start: '10:55', end: '11:40', counts: true },
    { id: 'p5', name: '第 5 节', start: '14:00', end: '14:45', counts: true },
    { id: 'p6', name: '第 6 节', start: '14:55', end: '15:40', counts: true },
    { id: 'p7', name: '第 7 节', start: '16:00', end: '16:45', counts: true },
    { id: 'p8', name: '第 8 节', start: '16:55', end: '17:40', counts: true },
  ],
  courses: [
    { id: 'c1', subject: '数学', title: '数学', weekday: wd, periodId: 'p1', location: '高二(3)班' },
    { id: 'c2', subject: '英语', title: '英语', weekday: wd, periodId: 'p2', location: '高二(3)班' },
    { id: 'c3', subject: '物理', title: '物理', weekday: wd, periodId: 'p5', location: '实验楼 2' },
  ],
  goals: [
    { id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60, actualMinutes: 47, dueAt: null, priority: 'high', status: 'done', createdAt: at(0, 8), completedAt: at(0, 20) },
    { id: 'g2', title: '背诵英语 Unit 5 单词', subject: '英语', plannedMinutes: 30, actualMinutes: 22, dueAt: null, priority: 'normal', status: 'doing', createdAt: at(0, 8) },
    { id: 'g3', title: '物理错题重做', subject: '物理', plannedMinutes: 45, actualMinutes: 0, dueAt: null, priority: 'high', status: 'todo', createdAt: at(0, 9) },
  ],
  tasks: [],
  sessions: [
    { id: 's1', subject: '数学', goalId: 'g1', startedAt: at(0, 18, 20), endedAt: at(0, 19, 7), durationSec: 47 * 60, source: 'timer' },
    { id: 's2', subject: '英语', goalId: 'g2', startedAt: at(0, 19, 20), endedAt: at(0, 19, 42), durationSec: 22 * 60, source: 'timer' },
    { id: 's3', subject: '数学', goalId: null, startedAt: at(0, 20, 0), endedAt: at(0, 20, 45), durationSec: 45 * 60, source: 'timer' },
    { id: 's4', subject: '物理', goalId: null, startedAt: at(0, 21, 4), endedAt: at(0, 21, 28), durationSec: 24 * 60, source: 'timer' },
    { id: 's5', subject: '数学', goalId: null, startedAt: at(1, 19), endedAt: at(1, 19) + 175 * 60000, durationSec: 175 * 60, source: 'timer' },
    { id: 's6', subject: '英语', goalId: null, startedAt: at(2, 19), endedAt: at(2, 19) + 92 * 60000, durationSec: 92 * 60, source: 'timer' },
  ],
  dates: [
    { id: 'd1', title: '中考', date: '2027-06-15', allDay: true, primary: true, visible: true, kind: 'exam', createdAt: Date.now() },
    { id: 'd2', title: '期末考', date: '2027-01-12', allDay: true, primary: false, visible: true, kind: 'exam', createdAt: Date.now() },
  ],
  background: {
    current: 'scene:aurora',
    mode: 'fixed',
    rotateMinutes: 60,
    enabledIds: ['scene:aurora'],
    custom: [],
    dim: 0.35,
    dynamic: true,
    showVeil: true,
  },
  timer: null,
};

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.5,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  colorScheme: scheme === 'dark' ? 'dark' : 'light',
  timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();
await page.goto(base, { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1400);

// 顺手把可支配时间的计算过程读出来，便于发现数值回归
const plan = await page.evaluate(async () => {
  const t = await import('/src/lib/time.ts');
  const st = window.__LOS__.useStore.getState();
  const d = new Date();
  const wd = t.toWeekday(d.getDay());
  const classes = st.courses
    .filter((c) => c.weekday === wd)
    .map((c) => {
      const p = st.periods.find((x) => x.id === c.periodId);
      const s = t.parseHM(c.start ?? p?.start);
      const e = t.parseHM(c.end ?? p?.end);
      return s === null || e === null ? null : { startMin: s, endMin: e };
    })
    .filter(Boolean);
  const p = t.computeDayPlan(Date.now(), st.settings, wd, classes);
  return {
    weekday: wd,
    now: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
    window: `${st.settings.studyFrom}-${st.settings.studyTo}`,
    available: p.availableMinutes,
    remaining: p.remainingAvailableMinutes,
    classMin: p.classMinutes,
    blockMin: p.blockMinutes,
    closed: p.windowClosed,
    classCount: classes.length,
    blockCount: st.settings.blocks.length,
  };
});
console.log('可支配时间:', JSON.stringify(plan));

await page.screenshot({ path: `${out}/one--${theme}--${scheme}.png` });
console.log(`已截图: ${out}/one--${theme}--${scheme}.png`);
await browser.close();
