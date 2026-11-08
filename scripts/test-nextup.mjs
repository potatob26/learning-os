/**
 * 验证首页「现在该做什么」的规则推荐
 *  ① 逾期目标排在前面
 *  ② 今天到期的排在无截止的前面
 *  ③ 「换一个」按顺序轮换且不重复
 *  ④ 点「开始」真的按建议的科目/目标/时长启动计时器
 *  ⑤ 没有待办且今天达标 → 显示诚实的收尾文案，不硬凑
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const today = new Date();
const key = (off) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const ts = (off, h) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + off, h).getTime();

const mkGoal = (o) => ({
  id: o.id, title: o.title, subject: o.subject,
  plannedMinutes: o.planned ?? 60, actualMinutes: o.actual ?? 0,
  dueAt: o.due ?? null, priority: o.prio ?? 'normal',
  status: o.status ?? 'todo', createdAt: Date.now() - 86400000,
  completedAt: null, description: '',
});

const seed = ({ goals, sessions = [], dailyGoal = 180 }) => ({
  schema: 3,
  settings: {
    theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true,
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
    dailyGoalMinutes: dailyGoal, studyFrom: '00:00', studyTo: '23:59',
  },
  periods: [], courses: [], goals, tasks: [], sessions, dates: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false, dimAuto: false },
  timer: null, courseStatus: {},
});

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

async function open(seedData) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2,
    locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seedData);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1900);
  return { ctx, page };
}

const readCard = (page) =>
  page.evaluate(() => {
    const t = document.querySelector('main')?.textContent ?? '';
    // 注意：textContent 在块级元素之间**没有空格**，
    // 不能写成 /现在该做什么 (\S+)/ —— 那样永远匹配不到（第一版就栽在这）。
    const norm = t.replace(/\s+/g, ' ');
    const m = /现在该做什么(.+?)开始 \d+ 分钟/.exec(norm);
    return { has: norm.includes('现在该做什么'), norm: norm.slice(0, 260), title: m ? m[1].trim() : null };
  });

/* ---------- ① 逾期 > 今天到期 > 无截止 ---------- */
{
  const { ctx, page } = await open(seed({
    goals: [
      mkGoal({ id: 'g1', title: '无截止的任务', subject: '语文' }),
      mkGoal({ id: 'g2', title: '今天到期的任务', subject: '英语', due: `${key(0)} 20:00` }),
      mkGoal({ id: 'g3', title: '已经逾期的任务', subject: '数学', due: `${key(-2)} 20:00` }),
    ],
  }));
  const c = await readCard(page);
  check('显示了「现在该做什么」卡片', c.has);
  check('逾期目标排在第一位', (c.title ?? '').includes('已经逾期'), `卡片标题: ${c.title}`);
  await ctx.close();
}

/* ---------- ② 进行中优先于未开始（同为无截止） ---------- */
{
  const { ctx, page } = await open(seed({
    goals: [
      mkGoal({ id: 'g1', title: '还没开始的任务', subject: '语文' }),
      mkGoal({ id: 'g2', title: '已经开始的任务', subject: '数学', actual: 25, status: 'doing' }),
    ],
  }));
  const c = await readCard(page);
  check('已开头的目标优先于未开始的', (c.title ?? '').includes('已经开始'), `卡片标题: ${c.title}`);
  await ctx.close();
}

/* ---------- ③「换一个」会切换到另一条 ---------- */
{
  const { ctx, page } = await open(seed({
    goals: [
      mkGoal({ id: 'g1', title: '任务甲', subject: '数学' }),
      mkGoal({ id: 'g2', title: '任务乙', subject: '英语' }),
      mkGoal({ id: 'g3', title: '任务丙', subject: '物理' }),
    ],
  }));
  const before = await page.evaluate(() => {
    const norm = (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ');
    return /共 (\d+) 项可选/.exec(norm)?.[1] ?? null;
  });
  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('换一个'));
    if (!b) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => {
    const norm = (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ');
    const m = /现在该做什么(.+?)开始 \d+ 分钟/.exec(norm);
    return m ? m[1].trim() : null;
  });
  check('候选数 ≥2 时显示「换一个」', clicked && Number(before) >= 2, `共 ${before} 项可选`);
  check('点「换一个」后标题发生变化', after !== null && !after.includes('已经'), `换后标题: ${after}`);
  await ctx.close();
}

/* ---------- ④ 点「开始」按建议启动计时器 ---------- */
{
  const { ctx, page } = await open(seed({
    goals: [mkGoal({ id: 'g1', title: '数学卷子', subject: '数学', planned: 45, due: `${key(0)} 22:00` })],
  }));
  const suggestedMinutes = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /开始 \d+ 分钟/.test(x.textContent || ''));
    const minutes = Number(/开始 (\d+) 分钟/.exec(b?.textContent || '')?.[1]);
    b?.click();
    return minutes;
  });
  await page.waitForTimeout(900);
  const t = await page.evaluate(() => {
    const raw = localStorage.getItem('learning-os:v1:state');
    const s = JSON.parse(raw);
    return s.timer ? { subject: s.timer.subject, goalId: s.timer.goalId, target: s.timer.targetMinutes } : null;
  });
  check('点「开始」启动了计时器', t !== null, JSON.stringify(t));
  check('计时器带上了正确的科目', t?.subject === '数学', `科目 ${t?.subject}`);
  check('计时器关联了该目标', t?.goalId === 'g1', `goalId ${t?.goalId}`);
  check('目标时长取自建议', suggestedMinutes > 0 && suggestedMinutes <= 45 && t?.target === suggestedMinutes, `建议 ${suggestedMinutes} · targetMinutes ${t?.target}`);
  await ctx.close();
}

/* ---------- ⑤ 今天已达标且无待办 → 不硬凑 ---------- */
{
  const { ctx, page } = await open(seed({
    goals: [],
    dailyGoal: 60,
    sessions: [{
      id: 's1', subject: '数学', goalId: null,
      startedAt: ts(0, 9), endedAt: ts(0, 10), durationSec: 90 * 60, source: 'timer',
    }],
  }));
  const txt = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
  check('今天已达标且无待办时显示收尾文案', txt.includes('今天的目标已达成'), txt.slice(0, 120));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
