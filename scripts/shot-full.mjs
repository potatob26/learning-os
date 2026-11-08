/**
 * 首页全页截图（带示例数据），用于看完整信息结构。
 * 用法：node scripts/shot-full.mjs [route] [out.png] [width] [height]
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/#/';
const out = process.argv[3] ?? '.preview/full-home.png';
const width = Number(process.argv[4] ?? 412);
const height = Number(process.argv[5] ?? 915);

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('找不到 Chrome');
  process.exit(1);
}

function dayOffsetTs(daysAgo, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function todayWeekday() {
  return (new Date().getDay() + 6) % 7;
}

const SEED = {
  schema: 1,
  settings: {
    theme: 'mica', colorMode: 'system', perf: 'balanced', motion: true, glassBlur: true,
    dynamicBackground: true, autoRotate: false, schoolStart: '08:00', schoolEnd: '17:40',
    wakeTime: '06:40', sleepTime: '22:30', dailyGoalMinutes: 180,
    blocks: [
      { id: 'b_dinner', label: '晚饭', kind: 'meal', start: '17:40', end: '18:30', weekdays: null },
      { id: 'b_tidy', label: '洗漱、收拾', kind: 'chore', start: '22:00', end: '22:25', weekdays: null },
    ],
    studyFrom: '17:40', studyTo: '22:30', quoteSeed: '2026-09-12', align: 'left',
    nickname: '', onboarded: true,
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
  courses: (() => {
    const wd = todayWeekday();
    return [
      { id: 'c1', subject: '数学', title: '数学', weekday: wd, periodId: 'p1', location: '高二(3)班' },
      { id: 'c2', subject: '英语', title: '英语', weekday: wd, periodId: 'p2', location: '高二(3)班' },
      { id: 'c3', subject: '物理', title: '物理', weekday: wd, periodId: 'p5', location: '实验楼 2' },
      { id: 'c4', subject: '化学', title: '化学', weekday: (wd + 1) % 7, periodId: 'p1' },
      { id: 'c5', subject: '语文', title: '语文', weekday: (wd + 2) % 7, periodId: 'p1' },
    ];
  })(),
  goals: [
    { id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60, actualMinutes: 47, dueAt: null, priority: 'high', status: 'done', createdAt: dayOffsetTs(0, 8), completedAt: dayOffsetTs(0, 20) },
    { id: 'g2', title: '背诵英语 Unit 5 单词', subject: '英语', plannedMinutes: 30, actualMinutes: 22, dueAt: null, priority: 'normal', status: 'doing', createdAt: dayOffsetTs(0, 8) },
    { id: 'g3', title: '物理错题重做', subject: '物理', plannedMinutes: 45, actualMinutes: 0, dueAt: null, priority: 'high', status: 'todo', createdAt: dayOffsetTs(0, 9) },
    { id: 'g4', title: '语文古诗默写', subject: '语文', plannedMinutes: 20, actualMinutes: 0, dueAt: null, priority: 'low', status: 'todo', createdAt: dayOffsetTs(0, 10) },
    { id: 'g5', title: '化学方程式整理', subject: '化学', plannedMinutes: 30, actualMinutes: 0, dueAt: null, priority: 'normal', status: 'todo', createdAt: dayOffsetTs(0, 11) },
  ],
  tasks: [],
  sessions: [
    { id: 's1', subject: '数学', goalId: 'g1', startedAt: dayOffsetTs(0, 18, 20), endedAt: dayOffsetTs(0, 19, 7), durationSec: 47 * 60, source: 'timer' },
    { id: 's2', subject: '英语', goalId: 'g2', startedAt: dayOffsetTs(0, 19, 20), endedAt: dayOffsetTs(0, 19, 42), durationSec: 22 * 60, source: 'timer' },
    { id: 's3', subject: '数学', goalId: null, startedAt: dayOffsetTs(0, 20, 0), endedAt: dayOffsetTs(0, 20, 45), durationSec: 45 * 60, source: 'timer' },
    { id: 's4', subject: '物理', goalId: null, startedAt: dayOffsetTs(0, 21, 4), endedAt: dayOffsetTs(0, 21, 28), durationSec: 24 * 60, source: 'timer' },
    ...[[1, 175], [2, 92], [3, 210], [4, 60], [5, 143], [6, 188], [7, 35]].map(([d, mins], i) => ({
      id: `s${10 + i}`, subject: ['数学', '英语', '物理', '化学', '语文'][i % 5], goalId: null,
      startedAt: dayOffsetTs(d, 19, 0), endedAt: dayOffsetTs(d, 19, 0) + mins * 60000,
      durationSec: mins * 60, source: 'timer',
    })),
  ],
  dates: [
    { id: 'd1', title: '中考', date: '2027-06-15', allDay: true, primary: true, visible: true, kind: 'exam', createdAt: Date.now() },
    { id: 'd2', title: '期末考', date: '2027-01-12', allDay: true, primary: false, visible: true, kind: 'exam', createdAt: Date.now() },
    { id: 'd3', title: '生日', date: '2026-11-03', allDay: true, primary: false, visible: true, kind: 'birthday', createdAt: Date.now() },
  ],
  background: {
    current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['scene:aurora', 'scene:stars', 'scene:grid'], custom: [], dim: 0.35,
    dynamic: true, showVeil: true,
  },
  timer: null,
};

const browser = await chromium.launch({
  executablePath, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({
  viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), SEED);
await page.goto(url, { waitUntil: 'load' });
// 必须整页 reload，应用只在启动时读一次 localStorage（hash 跳转不会重读）
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`✓ ${out}`);
