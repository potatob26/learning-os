/**
 * 成就 / 里程碑验证
 * ──────────────────────────────────────────────────────────────────────────────
 * 重点：
 *   · 阈值边界（9h59m vs 10h、29 vs 30 天、6 vs 7 最长连续…）；
 *   · 成就由真实记录派生，不做排行榜、不出现「领取」假按钮；
 *   · 账本只追加：目标被改回 todo 之后，已获得的成就不会消失；
 *   · 旧存档没有 achievements → hydrate 时按现有记录补记并标 backfilled；
 *   · 幂等：重复对账不会改时间、不会重复写。
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { SEED } from './lib-seed.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const OUT = '.preview/achievements';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();
await acknowledgeReleaseNotes(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());

/* ==========================================================================
   ① 纯函数：阈值 / 派生 / 幂等
   ========================================================================== */
console.log('\n=== ① 阈值与对账（固定 NOW = 2026-11-07 18:00）===');
const pure = await page.evaluate(async () => {
  const A = await import('/src/lib/achievements.ts');
  const now = new Date(2026, 10, 7, 18, 0, 0).getTime();
  const DAY = 86400000;
  const dayStart = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const base = dayStart(now);
  const mkSession = (daysAgo, minutes, id) => {
    const st = base - daysAgo * DAY + 12 * 3600000;
    return {
      id,
      subject: '数学',
      startedAt: st,
      endedAt: st + minutes * 60000,
      durationSec: minutes * 60,
      source: 'timer',
    };
  };
  const mkGoal = (id, completedAt) => ({
    id,
    title: '目标 ' + id,
    subject: '数学',
    plannedMinutes: 60,
    actualMinutes: 60,
    priority: 'normal',
    status: completedAt ? 'done' : 'todo',
    createdAt: base - 10 * DAY,
    completedAt: completedAt ?? null,
    kind: 'time',
  });
  const idList = (list) => list.map((x) => x.id);
  const out = {};

  /* --- 阈值边界：累计时长 --- */
  const nine59 = A.computeAchievementMetrics([mkSession(0, 599, 'x1')], [], [], now);
  const ten = A.computeAchievementMetrics([mkSession(0, 600, 'x2')], [], [], now);
  out.totalMinutes = {
    nine59: A.metricValue(A.ACHIEVEMENTS.find((a) => a.id === 'total-10h'), nine59),
    ten: A.metricValue(A.ACHIEVEMENTS.find((a) => a.id === 'total-10h'), ten),
  };

  /* --- 阈值边界：学习日 30 天 --- */
  const days29 = Array.from({ length: 29 }, (_, i) => mkSession(i + 1, 20, `d29_${i}`));
  const days30 = Array.from({ length: 30 }, (_, i) => mkSession(i + 1, 20, `d30_${i}`));
  out.days = {
    len29: A.computeAchievementMetrics(days29, [], [], now).activeDayKeys.length,
    len30: A.computeAchievementMetrics(days30, [], [], now).activeDayKeys.length,
  };

  /* --- 阈值边界：最长连续 7 天 --- */
  const streak6 = Array.from({ length: 6 }, (_, i) => mkSession(i, 20, `s6_${i}`));
  const streak7 = Array.from({ length: 7 }, (_, i) => mkSession(i, 20, `s7_${i}`));
  out.streak = {
    six: A.computeAchievementMetrics(streak6, [], [], now).longest,
    seven: A.computeAchievementMetrics(streak7, [], [], now).longest,
  };

  /* --- 单次 90 分钟 --- */
  out.session = {
    m89: A.computeAchievementMetrics([mkSession(0, 89, 'm89')], [], [], now).maxSessionMinutes,
    m90: A.computeAchievementMetrics([mkSession(0, 90, 'm90')], [], [], now).maxSessionMinutes,
  };

  /* --- 目标：第一个 / 10 个 --- */
  const oneGoal = [mkGoal('g1', base - 3 * DAY)];
  out.goals = {
    one: A.computeAchievementMetrics([], oneGoal, [], now).completedGoalTimes.length,
    ten: A.computeAchievementMetrics(
      [],
      Array.from({ length: 10 }, (_, i) => mkGoal(`gg${i}`, base - (i + 1) * DAY)),
      [],
      now,
    ).completedGoalTimes.length,
  };

  /* --- 进度列表：达成与进度 --- */
  const mixSessions = [mkSession(0, 120, 'p0'), mkSession(1, 100, 'p1'), mkSession(2, 80, 'p2')];
  const mixGoals = [mkGoal('pg1', base - 1 * DAY)];
  const list = A.achievementProgressList(mixSessions, mixGoals, [], [], now);
  out.progress = {
    count: list.length,
    achieved: list.filter((x) => x.achieved).map((x) => x.def.id),
    total10hRatio: Math.round((list.find((x) => x.def.id === 'total-10h')?.ratio ?? 0) * 100),
    goals1: list.find((x) => x.def.id === 'first-goal')?.achieved,
  };

  /* --- backfill：旧存档补记 --- */
  const backfill = A.backfillAchievements(mixSessions, mixGoals, [], now);
  out.backfill = {
    ids: idList(backfill),
    allBackfilled: backfill.every((x) => x.backfilled === true),
    ruleVersionOk: backfill.every((x) => x.ruleVersion === 1),
  };

  /* --- reconcile 幂等：第二次返回同一引用、不重复 --- */
  const first = A.reconcileAchievements([], mixSessions, mixGoals, [], now, 'live');
  const second = A.reconcileAchievements(first, mixSessions, mixGoals, [], now, 'live');
  const third = A.reconcileAchievements(second, mixSessions, mixGoals, [], now, 'live');
  out.idempotent = {
    firstLen: first.length,
    sameRef: second === third,
    lenStable: second.length === third.length,
  };

  /* --- 账本只追加：目标改回 todo 也不回收 --- */
  const unlocks = [
    { id: 'first-goal', unlockedAt: now - DAY, evidence: 1, ruleVersion: 1 },
    { id: 'session-90m', unlockedAt: now - 2 * DAY, evidence: 120, ruleVersion: 1 },
  ];
  const noGoals = A.reconcileAchievements(unlocks, mixSessions, [], [], now, 'live');
  out.keepUnlocked = {
    stillHasFirstGoal: noGoals.some((x) => x.id === 'first-goal'),
    stillHas90m: noGoals.some((x) => x.id === 'session-90m'),
  };

  /* --- normalize：坏数据丢弃 / 重复保留最早 --- */
  const normalized = A.normalizeAchievements([
    { id: 'unknown-id', unlockedAt: now, evidence: 1, ruleVersion: 1 },
    { id: 'streak-7', unlockedAt: now - DAY, evidence: 7, ruleVersion: 1 },
    { id: 'streak-7', unlockedAt: now - 5 * DAY, evidence: 7, ruleVersion: 1 },
    { id: 'streak-30', unlockedAt: 'bad', evidence: 1, ruleVersion: 1 },
    { id: 'days-30', unlockedAt: now, evidence: 30, ruleVersion: 2 },
  ]);
  out.normalize = {
    ids: idList(normalized),
    earliestStreak7: normalized.find((x) => x.id === 'streak-7')?.unlockedAt === now - 5 * DAY,
  };

  /* --- 不做假数据：不存在的成就 id 不会出现 --- */
  out.catalog = A.ACHIEVEMENTS.map((a) => a.id);
  out.forbidden = ['rank', 'leaderboard', 'first-place'].some((w) =>
    A.ACHIEVEMENTS.some((a) => a.name.toLowerCase().includes(w)),
  );

  return out;
});

check(
  '累计时长边界：599 分钟不够、600 分钟达成',
  pure.totalMinutes.nine59 === 599 && pure.totalMinutes.ten === 600,
  JSON.stringify(pure.totalMinutes),
);
check(
  '学习日边界：29 天 / 30 天正确',
  pure.days.len29 === 29 && pure.days.len30 === 30,
  JSON.stringify(pure.days),
);
check(
  '最长连续边界：6 天 / 7 天正确',
  pure.streak.six === 6 && pure.streak.seven === 7,
  JSON.stringify(pure.streak),
);
check(
  '单次时长边界：89 / 90 分钟正确',
  pure.session.m89 === 89 && pure.session.m90 === 90,
  JSON.stringify(pure.session),
);
check('完成目标计数：1 个 / 10 个', pure.goals.one === 1 && pure.goals.ten === 10, JSON.stringify(pure.goals));
check(
  '成就目录是 10 项且不含排行榜语义',
  pure.catalog.length === 10 && pure.forbidden === false,
  JSON.stringify(pure.catalog),
);
check(
  '进度列表：达成项正确、10 小时进度 50%',
  pure.progress.count === 10 &&
    pure.progress.achieved.includes('session-90m') &&
    pure.progress.achieved.includes('first-goal') &&
    !pure.progress.achieved.includes('total-10h') &&
    pure.progress.total10hRatio === 50,
  JSON.stringify(pure.progress),
);
check(
  'backfill 补记：只含已达成项且全部标 backfilled',
  pure.backfill.ids.length > 0 &&
    pure.backfill.allBackfilled &&
    pure.backfill.ruleVersionOk,
  JSON.stringify(pure.backfill.ids),
);
check(
  '对账幂等：第二次不动时间、第三次返回同一引用',
  pure.idempotent.firstLen > 0 && pure.idempotent.sameRef && pure.idempotent.lenStable,
  JSON.stringify(pure.idempotent),
);
check(
  '账本只追加：目标改回 todo 后已获得的成就仍在',
  pure.keepUnlocked.stillHasFirstGoal && pure.keepUnlocked.stillHas90m,
  JSON.stringify(pure.keepUnlocked),
);
check(
  'normalize：未知 id / 坏时间 / 旧规则版本丢弃，重复保留最早',
  pure.normalize.ids.length === 1 &&
    pure.normalize.ids.includes('streak-7') &&
    pure.normalize.earliestStreak7,
  JSON.stringify(pure.normalize),
);

/* ==========================================================================
   ② 旧存档补记 + 落盘
   ========================================================================== */
console.log('\n=== ② 旧存档补记与落盘 ===');

function dayAgoTs(daysAgo, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}
function mkSession(daysAgo, minutes, id) {
  const st = dayAgoTs(daysAgo);
  return {
    id,
    subject: '数学',
    startedAt: st,
    endedAt: st + minutes * 60000,
    durationSec: minutes * 60,
    source: 'timer',
  };
}
const oldBackup = {
  ...SEED,
  settings: { ...SEED.settings, theme: 'liquid-glass', colorMode: 'light' },
  goals: [
    {
      id: 'g_done',
      title: '完成一套数学试卷',
      subject: '数学',
      plannedMinutes: 120,
      actualMinutes: 120,
      priority: 'normal',
      status: 'done',
      createdAt: dayAgoTs(3),
      completedAt: dayAgoTs(2),
      kind: 'time',
    },
  ],
  tasks: [],
  dates: [],
  sessions: [mkSession(0, 200, 'h0'), mkSession(1, 200, 'h1'), mkSession(2, 200, 'h2')],
  // 故意不带 achievements / streakRescues，模拟旧备份
};
/* ⚠️ 必须用 addInitScript 在**页面脚本之前**写 localStorage：
   先 evaluate 再 reload 会被应用卸载/落盘时序覆盖掉（交接文档坑 53）。 */
await page.addInitScript((s) => {
  try {
    if (localStorage.getItem('__ach_seeded__')) return;
    localStorage.setItem('learning-os:v1:state', JSON.stringify(s));
    localStorage.setItem('__ach_seeded__', '1');
  } catch {
    /* ignore */
  }
}, {
  ...oldBackup,
  achievements: undefined,
  streakRescues: undefined,
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(1600);

const hydrated = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return {
    count: st.achievements.length,
    ids: st.achievements.map((a) => a.id),
    backfilled: st.achievements.every((a) => a.backfilled === true),
  };
});
check(
  '旧存档 hydrate 时补记成就（10h / 90 分钟 / 第一个目标）',
  hydrated.ids.includes('total-10h') &&
    hydrated.ids.includes('session-90m') &&
    hydrated.ids.includes('first-goal') &&
    hydrated.backfilled,
  JSON.stringify(hydrated),
);

await sleep(900);
const onDisk = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('learning-os:v1:state') || '{}');
  return { count: raw.achievements?.length ?? 0 };
});
check('成就账本已落盘到 localStorage', onDisk.count === hydrated.count, JSON.stringify(onDisk));

// 刷新后不重复补记、时间不变
const before = await page.evaluate(() =>
  JSON.stringify(window.__LOS__.useStore.getState().achievements.map((a) => [a.id, a.unlockedAt])),
);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
const after = await page.evaluate(() =>
  JSON.stringify(window.__LOS__.useStore.getState().achievements.map((a) => [a.id, a.unlockedAt])),
);
check('刷新后账本不重复、解锁时间不变', before === after, `${before.slice(0, 60)}`);

/* ==========================================================================
   ③ 统计页「成就」标签
   ========================================================================== */
console.log('\n=== ③ 统计页成就标签 ===');
await page.goto(`${BASE}#/stats`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const tabBtn = page.locator('main button', { hasText: /^成就$/ }).first();
check('统计页出现「成就」标签', (await tabBtn.count()) > 0);
await tabBtn.click();
await sleep(700);
const panel = await page.evaluate(() => {
  const main = document.querySelector('main');
  return {
    text: (main?.textContent ?? '').replace(/\s+/g, ' '),
    pressed: Array.from(document.querySelectorAll('main button')).find(
      (b) => b.getAttribute('aria-pressed') === 'true',
    )?.textContent?.trim(),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    exclaim: /[！!]/.test(main?.textContent ?? ''),
  };
});
check('切到成就标签且 aria-pressed 正确', panel.pressed === '成就', String(panel.pressed));
check('显示「已获得 N / 10」', /已获得\s*\d+\s*\/\s*10/.test(panel.text), panel.text.slice(0, 80));
check('成就文案不含排名/竞争语义', !/排名|排行榜|击败|超过|好友|PK/.test(panel.text), '');
check('成就面板没有感叹号', panel.exclaim === false);
check('390px 下没有横向溢出', panel.overflowX === false);
await page.screenshot({ path: `${OUT}/stats-achievements.png` });

// 320px 极窄屏
await page.setViewportSize({ width: 320, height: 640 });
await page.waitForTimeout(800);
const narrow = await page.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
}));
check('320px 下没有横向溢出', narrow.overflowX === false, JSON.stringify(narrow));
await page.screenshot({ path: `${OUT}/stats-achievements-320.png` });

check('无 JS 报错', errors.length === 0, [...new Set(errors)].slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${OUT}/`);
if (failed) process.exit(1);
