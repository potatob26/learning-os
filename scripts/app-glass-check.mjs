/**
 * 检查应用页面（非实验台）的运行时错误与玻璃渲染状态
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const outDir = '.preview/glass';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--force-color-profile=srgb',
  ],
});

const theme = process.argv[2] ?? 'liquid-glass';
const scheme = process.argv[3] ?? 'dark';

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
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[console] ${m.text()}`);
});

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
    { id: 'p5', name: '第 5 节', start: '14:00', end: '14:45', counts: true },
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

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2200);

console.log('运行时错误:', logs.length ? logs.slice(0, 5) : '无');

const info = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll('canvas'));
  return {
    glassAttr: document.documentElement.dataset.glass ?? '(未设置)',
    canvasCount: canvases.length,
    // 每块 canvas 是否有实际绘制内容（宽高 > 0 且非全透明）
    canvases: canvases.map((c) => ({
      cls: c.className,
      w: c.width,
      h: c.height,
      // 只在玻璃画布上取样
      nonEmpty: (() => {
        try {
          const g = c.getContext('2d');
          if (!g) return 'webgl';
          const d = g.getImageData(0, 0, 1, 1).data;
          return d[3] > 0;
        } catch {
          return 'n/a';
        }
      })(),
    })),
    lgSurfaces: document.querySelectorAll('.lg-surface').length,
    lgWebgl: document.querySelectorAll('.lg-surface--webgl').length,
    bodyText: (document.body.innerText ?? '').slice(0, 60).replace(/\n/g, ' '),
  };
});
console.log('渲染状态:', JSON.stringify(info, null, 2));

await page.screenshot({ path: `${outDir}/app--${theme}--${scheme}.png` });
console.log(`已截图: ${outDir}/app--${theme}--${scheme}.png`);

await browser.close();
