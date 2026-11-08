/**
 * 零副作用哈希协议（协作任务第二轮 §5.2）
 * 固定条件：412×915 @2x · motion off · reducedMotion · **glassBlur=false（关玻璃）**
 * → 所有主题的玻璃表面都降级为 mica/solid，玻璃重做不应影响它们。
 * 判据：改前/改后 SHA-256 逐字节一致。首页有时钟 → 以「同代码连拍两次」为本底噪声。
 * 用法：node scripts/audit-glass-hash.mjs before|after
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const phase = process.argv[2] === 'after' ? 'after' : 'before';
const OUT = `.preview/glass-hash/${phase}`;
mkdirSync(OUT, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const THEMES = ['pure-light', 'pure-dark', 'soft', 'immersive', 'liquid-glass', 'liquid-glass-wc'];
const ROUTES = ['#/', '#/goals', '#/timer', '#/stats', '#/settings/appearance'];

const seed = (theme) => ({
  schema: 3,
  settings: {
    theme, colorMode: 'dark', perf: 'balanced', glassBlur: false, motion: 'off',
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'hash',
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
  dates: [{ id: 'd1', title: '中考', date: '2027-06-30', primary: true, hidden: false }],
  background: {
    current: 'scene:grid', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['scene:grid'], custom: [], dim: 0.3,
    dynamic: false, showVeil: true, grid: false,
  },
  timer: null,
  courseStatus: {},
});

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

// 每主题连拍两次（本底噪声判据），共 THEMES×ROUTES×2 张
const out = {};
for (const theme of THEMES) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2,
    locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  for (const route of ROUTES) {
    await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
    await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed(theme));
    await page.goto(`http://127.0.0.1:5188/${route}`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click();
    });
    await page.waitForTimeout(400);
    const key = `${theme}${route.replace(/[#/]/g, '_')}`;
    out[key] = [];
    for (let shot = 1; shot <= 2; shot++) {
      const buf = await page.screenshot({ path: `${OUT}/${key}--s${shot}.png` });
      out[key].push(createHash('sha256').update(buf).digest('hex').slice(0, 16));
    }
  }
  await ctx.close();
}
await browser.close();

// 汇总：s1==s2 → 稳定；before/after 对比只比「稳定」项
const stable = {};
for (const [k, hashes] of Object.entries(out)) stable[k] = hashes[0] === hashes[1] ? hashes[0] : `不稳定(${hashes[0]}/${hashes[1]})`;
writeFileSync(`${OUT}/hashes.json`, JSON.stringify({ out, stable }, null, 2), 'utf8');

if (phase === 'after' && existsSync('.preview/glass-hash/before/hashes.json')) {
  const before = JSON.parse(readFileSync('.preview/glass-hash/before/hashes.json', 'utf8')).stable;
  const rows = Object.keys(stable).map((k) => {
    const b = before[k], a = stable[k];
    const same = b === a;
    return `${same ? '一致' : '变了'}  ${k}  ${String(b).slice(0, 18)} → ${String(a).slice(0, 18)}`;
  });
  writeFileSync(`${OUT}/diff.txt`, rows.join('\n'), 'utf8');
  console.log(rows.join('\n'));
}
console.log(`\n${phase} 完成：${Object.keys(out).length} 状态 × 2 连拍 → ${OUT}`);
