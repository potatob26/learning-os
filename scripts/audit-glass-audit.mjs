/**
 * 玻璃审计（协作任务第二轮 §2）：固定条件下跑遍玻璃主题的界面与弹层，
 * 连跑两轮验证稳定性，截图存 .preview/glass-audit/run{1,2}/。
 *
 * 固定条件：412×915 @2x · dark · perf high · glassBlur on · scene:grid（静态，避免 aurora 动画干扰哈希）
 * motion off + reducedMotion（消除动画帧差）· 固定种子数据。
 *
 * 输出：每张截图的 SHA-256 与两轮对比 → 判断哪些状态稳定复现、哪些本身非确定性。
 * 首页有时钟与相对时间的今日数据：两轮若不同属预期，判据见任务书 §5.2。
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const OUT = '.preview/glass-audit';
mkdirSync(`${OUT}/run1`, { recursive: true });
mkdirSync(`${OUT}/run2`, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const seed = (theme) => ({
  schema: 3,
  settings: {
    theme, colorMode: 'dark', perf: 'high', glassBlur: true, motion: 'off',
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'audit',
    dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '22:30',
    ...(theme === 'liquid-glass-wc' ? { refract: { strength: 55, blur: 1, chromatic: true, elasticity: 1 } } : {}),
  },
  periods: [{ id: 'p1', name: '第 1 节', start: '08:00', end: '08:45', counts: true }],
  courses: [{ id: 'c1', subject: '数学', title: '数学', weekday: (new Date().getDay() + 6) % 7, periodId: 'p1' }],
  goals: [{
    id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60,
    actualMinutes: 24, status: 'doing', date: new Date().toISOString().slice(0, 10), createdAt: Date.now(),
  }],
  tasks: [],
  sessions: [{
    id: 's1', subject: '数学', goalId: 'g1',
    startedAt: Date.now() - 3600000, endedAt: Date.now() - 3600000 + 24 * 60000,
    durationSec: 24 * 60, source: 'timer',
  }],
  dates: [{ id: 'd1', title: '中考', date: '2027-06-30', primary: true, hidden: false }],
  background: {
    current: 'scene:grid', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['scene:grid'], custom: [], dim: 0.35,
    dynamic: false, showVeil: true, grid: true,
  },
  timer: null,
  courseStatus: {},
});

/** 页面与弹层清单。sheet 用例：route + 打开它的按钮文案 */
const STATES = [
  { id: 'home', theme: 'liquid-glass-wc', route: '#/' },
  { id: 'goals', theme: 'liquid-glass-wc', route: '#/goals' },
  { id: 'timer', theme: 'liquid-glass-wc', route: '#/timer' },
  { id: 'stats', theme: 'liquid-glass-wc', route: '#/stats' },
  { id: 'settings-appearance', theme: 'liquid-glass-wc', route: '#/settings/appearance' },
  { id: 'home', theme: 'liquid-glass', route: '#/' },
  { id: 'goals', theme: 'liquid-glass', route: '#/goals' },
  { id: 'timer', theme: 'liquid-glass', route: '#/timer' },
  { id: 'stats', theme: 'liquid-glass', route: '#/stats' },
  { id: 'settings-appearance', theme: 'liquid-glass', route: '#/settings/appearance' },
  { id: 'sheet-goal-new', theme: 'liquid-glass-wc', route: '#/goals', open: '新建' },
  { id: 'sheet-goal-new', theme: 'liquid-glass', route: '#/goals', open: '新建' },
  { id: 'sheet-quickadd', theme: 'liquid-glass-wc', route: '#/', open: '快速添加' },
  { id: 'sheet-quickadd', theme: 'liquid-glass', route: '#/', open: '快速添加' },
];

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ],
});

const summary = [];
const runs = [1, 2];
for (const run of runs) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2,
    locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

  for (const st of STATES) {
    await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
    await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed(st.theme));
    await page.goto(`http://127.0.0.1:5188/${st.route}`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click();
    });
    await page.waitForTimeout(500);
    if (st.open) {
      const clicked = await page.evaluate((t) => {
        const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((x) =>
          (x.textContent || '').trim() === t || (x.getAttribute('aria-label') || '').includes(t));
        if (!b) return false;
        b.click();
        return true;
      }, st.open);
      if (!clicked) errors.push(`[audit] 触发按钮没找到：${st.open}`);
      await page.waitForTimeout(1400);
    }

    const probe = await page.evaluate(() => {
      // .surface 在 shadow DOM 里，轻量查询进不去 —— 逐实例穿 shadowRoot 数
      const vendorRendered = Array.from(document.querySelectorAll('liquid-glass'))
        .filter((el) => el.shadowRoot?.querySelector('.surface.rendered')).length;
      return {
        glassAttr: document.documentElement.dataset.glass ?? '(unset)',
        vendorGlass: document.querySelectorAll('liquid-glass').length,
        vendorRendered,
        lg2: document.querySelectorAll('.lg2').length,
        lg2Warp: document.querySelectorAll('.lg2 .glass__warp').length,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        refractLayer: Boolean(document.querySelector('.refract-layer')),
      };
    });

    const path = `${OUT}/run${run}/${st.id}--${st.theme}${st.open ? '--open' : ''}.png`;
    const shot = await page.screenshot({ path });
    const sha = createHash('sha256').update(shot).digest('hex').slice(0, 12);
    summary.push({
      id: `${st.id}--${st.theme}${st.open ? '--open' : ''}`,
      run, sha, errors: [...errors], probe,
    });
    errors.length = 0;
  }
  await ctx.close();
}
await browser.close();

/* ---- 两轮对比 ---- */
const byId = new Map();
for (const s of summary) {
  if (!byId.has(s.id)) byId.set(s.id, {});
  byId.get(s.id)[`run${s.run}`] = s;
}
const lines = [];
for (const [id, { run1, run2 }] of byId) {
  const stable = run1.sha === run2.sha;
  const errs = [...run1.errors, ...run2.errors];
  lines.push(`${stable ? '稳定' : '差异'}  ${id}  run1=${run1.sha} run2=${run2?.sha}  glass=${run1.probe.glassAttr} vendor=${run1.probe.vendorGlass}/${run1.probe.vendorRendered} lg2=${run1.probe.lg2} dlg=${run1.probe.dialogs}${errs.length ? `  错误: ${[...new Set(errs)].slice(0, 2).join(' | ')}` : ''}`);
}
writeFileSync(`${OUT}/summary.txt`, lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log(`\n截图: ${OUT}/run1|run2 · 汇总: ${OUT}/summary.txt`);
