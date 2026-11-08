/**
 * 真实浏览器预览：用本机 Chrome 内核，在多个真实视口下截图。
 * 用法：node scripts/shots.mjs [url] [outDir]
 * 环境变量：
 *   SHOT_ONLY=2-common-android   只截某个视口
 *   SHOT_ROUTE=home              只截某个页面
 *   SHOT_ONBOARD=1               截首次引导
 *   SHOT_SEED=1                  注入一份示例数据（用于观察真实排版）
 *   SHOT_SCHEME=dark             深色系统
 */
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const outDir = process.argv[3] ?? '.preview/shots';

const VIEWPORTS = [
  { name: '1-small-android', label: '小屏安卓 360×640', width: 360, height: 640, dpr: 3, mobile: true },
  { name: '2-common-android', label: '常见安卓 412×915', width: 412, height: 915, dpr: 2.625, mobile: true },
  { name: '3-large-android', label: '大屏安卓 480×1040', width: 480, height: 1040, dpr: 3, mobile: true },
  { name: '4-landscape', label: '安卓横屏 915×412', width: 915, height: 412, dpr: 2.625, mobile: true },
  { name: '5-tablet', label: '平板 768×1024', width: 768, height: 1024, dpr: 2, mobile: true },
  { name: '6-desktop', label: '桌面 1440×900', width: 1440, height: 900, dpr: 1, mobile: false },
];

const ROUTES = [
  { name: 'home', hash: '#/' },
  { name: 'goals', hash: '#/goals' },
  { name: 'timer', hash: '#/timer' },
  { name: 'stats', hash: '#/stats' },
  { name: 'settings', hash: '#/settings' },
  { name: 'set-appearance', hash: '#/settings/appearance' },
  { name: 'set-schedule', hash: '#/settings/schedule' },
  { name: 'set-courses', hash: '#/settings/courses' },
  { name: 'set-background', hash: '#/settings/background' },
  { name: 'set-dates', hash: '#/settings/dates' },
  { name: 'set-data', hash: '#/settings/data' },
];

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));

const SEED = (overrides = {}) => ({
  schema: 1,
  settings: {
    theme: 'mica',
    colorMode: 'system',
    perf: 'balanced',
    motion: true,
    glassBlur: true,
    dynamicBackground: true,
    autoRotate: false,
    schoolStart: '08:00',
    schoolEnd: '17:40',
    wakeTime: '06:40',
    sleepTime: '22:30',
    dailyGoalMinutes: 180,
    blocks: [
      { id: 'b_dinner', label: '晚饭', kind: 'meal', start: '17:40', end: '18:30', weekdays: null },
      { id: 'b_tidy', label: '洗漱、收拾', kind: 'chore', start: '22:00', end: '22:25', weekdays: null },
    ],
    studyFrom: '17:40',
    studyTo: '22:30',
    quoteSeed: '2026-09-12',
    align: 'left',
    nickname: '',
    onboarded: true,
    ...(overrides.settings ?? {}),
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
  courses: (overrides.courses ?? [
    { id: 'c1', subject: '数学', title: '数学', weekday: 0, periodId: 'p1', location: '高二(3)班' },
    { id: 'c2', subject: '英语', title: '英语', weekday: 0, periodId: 'p2', location: '高二(3)班' },
    { id: 'c3', subject: '物理', title: '物理', weekday: 0, periodId: 'p5', location: '实验楼 2' },
    { id: 'c4', subject: '化学', title: '化学', weekday: 1, periodId: 'p1' },
    { id: 'c5', subject: '语文', title: '语文', weekday: 2, periodId: 'p1' },
  ]),
  goals: (overrides.goals ?? []),
  tasks: [],
  sessions: (overrides.sessions ?? []),
  dates: [
    { id: 'd1', title: '中考', date: '2027-06-15', allDay: true, primary: true, visible: true, kind: 'exam', createdAt: Date.now() },
    { id: 'd2', title: '期末考', date: '2027-01-12', allDay: true, primary: false, visible: true, kind: 'exam', createdAt: Date.now() },
    { id: 'd3', title: '生日', date: '2026-11-03', allDay: true, primary: false, visible: true, kind: 'birthday', createdAt: Date.now() },
  ],
  background: {
    current: 'scene:aurora',
    mode: 'fixed',
    rotateMinutes: 60,
    enabledIds: ['scene:aurora', 'scene:stars', 'scene:grid'],
    custom: [],
    dim: 0.35,
    dynamic: true,
    showVeil: true,
  },
  timer: null,
});

/** 今天的 weekday（0=周一…6=周日），让示例课程出现在今天 */
function todayWeekday() {
  return (new Date().getDay() + 6) % 7;
}

function dayOffsetTs(daysAgo, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** 一份用于观察真实排版的数据：今天已有 2 小时学习、目标若干 */
function demoSeed() {
  const wd = todayWeekday();
  // 让示例课程落在今天，同时保留一两门其它日期的课
  const courses = [
    { id: 'c1', subject: '数学', title: '数学', weekday: wd, periodId: 'p1', location: '高二(3)班' },
    { id: 'c2', subject: '英语', title: '英语', weekday: wd, periodId: 'p2', location: '高二(3)班' },
    { id: 'c3', subject: '物理', title: '物理', weekday: wd, periodId: 'p5', location: '实验楼 2' },
    { id: 'c4', subject: '化学', title: '化学', weekday: (wd + 1) % 7, periodId: 'p1' },
    { id: 'c5', subject: '语文', title: '语文', weekday: (wd + 2) % 7, periodId: 'p1' },
  ];
  const goals = [
    { id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60, actualMinutes: 47, dueAt: null, priority: 'high', status: 'done', createdAt: dayOffsetTs(0, 8), completedAt: dayOffsetTs(0, 20) },
    { id: 'g2', title: '背诵英语 Unit 5 单词', subject: '英语', plannedMinutes: 30, actualMinutes: 22, dueAt: null, priority: 'normal', status: 'doing', createdAt: dayOffsetTs(0, 8) },
    { id: 'g3', title: '物理错题重做', subject: '物理', plannedMinutes: 45, actualMinutes: 0, dueAt: null, priority: 'high', status: 'todo', createdAt: dayOffsetTs(0, 9) },
    { id: 'g4', title: '语文古诗默写', subject: '语文', plannedMinutes: 20, actualMinutes: 0, dueAt: null, priority: 'low', status: 'todo', createdAt: dayOffsetTs(0, 10) },
    { id: 'g5', title: '化学方程式整理', subject: '化学', plannedMinutes: 30, actualMinutes: 0, dueAt: null, priority: 'normal', status: 'todo', createdAt: dayOffsetTs(0, 11) },
  ];
  const sessions = [];
  // 今天：累计 138 分钟
  sessions.push({ id: 's1', subject: '数学', goalId: 'g1', startedAt: dayOffsetTs(0, 18, 20), endedAt: dayOffsetTs(0, 19, 7), durationSec: 47 * 60, source: 'timer' });
  sessions.push({ id: 's2', subject: '英语', goalId: 'g2', startedAt: dayOffsetTs(0, 19, 20), endedAt: dayOffsetTs(0, 19, 42), durationSec: 22 * 60, source: 'timer' });
  sessions.push({ id: 's3', subject: '数学', goalId: null, startedAt: dayOffsetTs(0, 20, 0), endedAt: dayOffsetTs(0, 20, 45), durationSec: 45 * 60, source: 'timer' });
  sessions.push({ id: 's4', subject: '物理', goalId: null, startedAt: dayOffsetTs(0, 21, 4), endedAt: dayOffsetTs(0, 21, 28), durationSec: 24 * 60, source: 'timer' });
  // 过去 6 天，用于连续天数与统计
  const past = [
    [1, 175], [2, 92], [3, 210], [4, 60], [5, 143], [6, 188], [7, 35],
  ];
  let i = 10;
  for (const [d, mins] of past) {
    sessions.push({
      id: `s${i++}`,
      subject: ['数学', '英语', '物理', '化学', '语文'][i % 5],
      goalId: null,
      startedAt: dayOffsetTs(d, 19, 0),
      endedAt: dayOffsetTs(d, 19, 0) + mins * 60000,
      durationSec: mins * 60,
      source: 'timer',
    });
  }
  return SEED({ goals, sessions, courses });
}

async function main() {
  if (!executablePath) {
    console.error('找不到 Chrome / Edge 可执行文件');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--force-color-profile=srgb'],
  });

  const only = process.env.SHOT_ONLY;
  const routeOnly = process.env.SHOT_ROUTE;
  const onboard = process.env.SHOT_ONBOARD === '1';
  const useSeed = process.env.SHOT_SEED === '1';

  const collectedErrors = [];

  for (const vp of VIEWPORTS) {
    if (only && !vp.name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      colorScheme: process.env.SHOT_SCHEME === 'dark' ? 'dark' : 'light',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') collectedErrors.push(`[${vp.name}] ${m.text()}`);
    });
    page.on('pageerror', (e) => collectedErrors.push(`[${vp.name}] pageerror: ${e.message}`));

    if (useSeed) {
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), demoSeed());
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(300);
    }

    const routes = onboard ? [{ name: 'onboard', hash: '#/' }] : ROUTES;
    for (const r of routes) {
      if (routeOnly && r.name !== routeOnly) continue;
      await page.goto(`${url}${r.hash}`, { waitUntil: 'load' });
      await page.waitForTimeout(r.name === 'home' ? 1100 : 750);
      await page.screenshot({ path: join(outDir, `${vp.name}--${r.name}.png`) });
      console.log(`  ✓ ${vp.label}  ${r.name}`);
    }
    await ctx.close();
  }

  // 主题 / 深色总览（常见安卓尺寸）
  if (!only && !routeOnly && !onboard) {
    for (const theme of ['mica', 'liquid-glass', 'pure-light', 'pure-dark', 'soft', 'immersive']) {
      for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({
          viewport: { width: 412, height: 915 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: 'zh-CN',
          colorScheme: scheme,
          timezoneId: 'Asia/Shanghai',
        });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'load' });
        await page.evaluate(
          ([s, t, m]) => {
            const seed = JSON.parse(s);
            seed.settings.theme = t;
            seed.settings.colorMode = m;
            localStorage.setItem('learning-os:v1:state', JSON.stringify(seed));
          },
          [JSON.stringify(demoSeed()), theme, scheme === 'dark' ? 'dark' : 'light'],
        );
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: join(outDir, `theme--${theme}--${scheme}.png`) });
        console.log(`  ✓ 主题 ${theme} / ${scheme}`);
        await ctx.close();
      }
    }
  }

  await browser.close();

  if (collectedErrors.length) {
    console.log('\n控制台错误：');
    for (const e of [...new Set(collectedErrors)].slice(0, 12)) console.log(`  ! ${e}`);
  } else {
    console.log('\n无控制台错误');
  }
  console.log(`截图输出目录: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
