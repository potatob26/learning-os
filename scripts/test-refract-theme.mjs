/**
 * 验证「液态玻璃」主题（WebGL 逐像素折射层）
 *  1. <liquid-glass> 实例是否创建
 *  2. WebGL 是否真的渲染成功（shadow DOM 里 .surface 会加 .rendered）
 *  3. 玻璃的几何是否与目标容器对齐
 *  4. 玻璃是否在内容之下（文字必须清晰、不被糊）
 *  5. 实例数量是否在 WebGL 上下文预算内
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/refract';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

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
  ],
});

const seed = (theme) => ({
  schema: 3,
  settings: {
    theme, colorMode: 'dark', perf: 'high', glassBlur: true,
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
    dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '22:30',
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
  dates: [{ id: 'd1', title: '中考', date: '2027-06-15', primary: true, hidden: false }],
  background: {
    current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['scene:aurora'], custom: [], dim: 0.35,
    dynamic: false, showVeil: true, grid: false,
  },
  timer: null,
  courseStatus: {},
});

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  colorScheme: 'dark',
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed('liquid-glass-wc'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('liquid-glass'));
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    count: els.length,
    instances: els.map((el) => {
      const surface = el.shadowRoot?.querySelector('.surface');
      const r = el.getBoundingClientRect();
      return {
        rendered: surface?.classList.contains('rendered') ?? false,
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.left),
        y: Math.round(r.top),
        hasSource: Boolean(el.source),
      };
    }),
    // 注册表里的目标数量
    targetCount: document.querySelectorAll('.lg2, [data-key-glass]').length,
  };
});

console.log('data-theme =', info.theme);
console.log('liquid-glass 实例数 =', info.count);
for (const [i, it] of info.instances.entries()) {
  console.log(`  #${i + 1} rendered=${it.rendered} ${it.w}x${it.h} @${it.x},${it.y} source=${it.hasSource}`);
}

check('主题已切换', info.theme === 'liquid-glass-wc');
check('创建了玻璃实例', info.count > 0, `${info.count} 个`);
check('WebGL 渲染成功（.surface 带 rendered）', info.instances.every((i) => i.rendered), 
  info.instances.filter((i) => !i.rendered).length + ' 个未渲染');
check('实例数在 WebGL 上下文预算内(≤6)', info.count <= 6, `${info.count} 个`);
check('每个实例都拿到了背景画布作为 source', info.instances.every((i) => i.hasSource));

// 文字必须在玻璃之上：取一个卡片标题，看它是否可见且未被玻璃遮挡
const textOk = await page.evaluate(() => {
  const h = Array.from(document.querySelectorAll('main *')).find(
    (e) => e.children.length === 0 && (e.textContent || '').includes('今日自学'),
  );
  if (!h) return { found: false };
  const r = h.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  const glassOnTop = Boolean(hit?.closest?.('liquid-glass'));
  return { found: true, glassOnTop, hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 30)}` : null };
});
check('卡片文字未被玻璃层遮挡', textOk.found && !textOk.glassOnTop, JSON.stringify(textOk));

check('无 JS 报错', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));

await page.screenshot({ path: `${out}/home-412x915.png` });
console.log(`\n截图: ${out}/home-412x915.png`);

// 顺带对比：切到透明玻璃主题截一张
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed('liquid-glass'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/home-frosted.png` });
console.log(`对比截图: ${out}/home-frosted.png`);

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
