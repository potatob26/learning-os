/**
 * 各科考试分数 vs 目标分 验证
 * ──────────────────────────────────────────────────────────────────────────────
 * 重点：
 *   · 100/150 分制不能直接比大小，一律折成比率；
 *   · 缺考（score=null）不进均值、不当最近一次、不判达标；
 *   · 目标分按科目存一份，趋势图上是一条虚线；
 *   · 录入成绩**不产生任何学习记录、不改学习时长**（铁律）；
 *   · 旧备份没有这两个字段也能正常导入，原有数据不丢。
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { SEED } from './lib-seed.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const OUT = '.preview/exam-scores';
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
   ① 纯函数：折合率 / 最近一次 / 缺考 / 目标 / 趋势 / 校验
   ========================================================================== */
console.log('\n=== ① 折合率与统计口径 ===');
const pure = await page.evaluate(async () => {
  const E = await import('/src/lib/examScores.ts');
  const NOW = new Date(2026, 10, 7, 18, 0, 0).getTime();
  const todayKey = '2026-11-07';
  const mk = (id, subject, date, score, fullScore, createdAt = NOW) => ({
    id,
    subject,
    examName: id,
    date,
    score,
    fullScore,
    createdAt,
  });
  const out = {};

  out.rate = {
    a: E.examRate({ score: 105, fullScore: 150 }),
    b: E.examRate({ score: 95, fullScore: 100 }),
    absent: E.examRate({ score: null, fullScore: 100 }),
    bad: E.examRate({ score: 10, fullScore: 0 }),
  };

  const scores = [
    mk('m1', '数学', '2026-09-01', 95, 150),
    mk('m2', '数学', '2026-10-01', null, 150),
    mk('m3', '数学', '2026-11-01', 112, 150),
    mk('m4', '数学', '2026-12-01', 130, 150), // 未来日期：不抢最近一次
    mk('c1', '语文', '2026-10-15', 95, 100),
    mk('bad1', '数学', '2026-10-20', 999, 150), // 越界，应被 sanitize 丢弃
  ];
  const targets = [
    { subject: '数学', targetScore: 120, fullScore: 150, updatedAt: NOW },
    { subject: '语文', targetScore: 92, fullScore: 100, updatedAt: NOW },
  ];
  const sums = E.subjectSummaries(E.sanitizeExamScores(scores), E.sanitizeSubjectTargets(targets), todayKey);
  const math = sums.find((s) => s.subject === '数学');
  const chinese = sums.find((s) => s.subject === '语文');
  out.math = {
    latestId: math.latest?.id,
    rate: math.rate,
    count: math.count,
    avg: math.avgRate,
    gap: math.gapScore,
    met: math.met,
    trend: math.trendDeltaRate,
  };
  out.chinese = { latestRate: chinese.rate, targetRate: chinese.targetRate, met: chinese.met };

  // 目标 = 满分：只在满分时达标，不产生 NaN
  const fullTarget = E.subjectSummaries(
    [mk('f1', '物理', '2026-10-10', 100, 100)],
    [{ subject: '物理', targetScore: 100, fullScore: 100, updatedAt: NOW }],
    todayKey,
  )[0];
  out.fullTarget = { met: fullTarget.met, gap: fullTarget.gapScore, rate: fullTarget.rate };

  // 趋势：两个点 + 目标线
  const series = E.trendSeries(
    E.sanitizeExamScores(scores),
    '数学',
    targets[0],
    todayKey,
  );
  out.series = {
    points: series.points.length,
    targetRate: series.targetRate,
    labels: series.points.map((p) => p.label),
    hasFuture: series.points.some((p) => p.label === '12/1'),
  };

  // 缺考不拉低均值：单独一科只有缺考 + 一条有效
  const absentCase = E.subjectSummaries(
    [mk('x1', '英语', '2026-10-01', null, 100), mk('x2', '英语', '2026-10-02', 80, 100)],
    [],
    todayKey,
  )[0];
  out.absent = { count: absentCase.count, avg: absentCase.avgRate, latestId: absentCase.latest?.id };

  // sanitize：坏日期 / 越界分数 / fullScore=0 都丢
  const cleaned = E.sanitizeExamScores([
    mk('ok', '数学', '2026-10-01', 100, 150),
    mk('baddate', '数学', '10月1日', 100, 150),
    mk('badscore', '数学', '2026-10-02', 200, 150),
    mk('badfull', '数学', '2026-10-03', 100, 0),
    { ...mk('absent', '数学', '2026-10-04', null, 150) },
  ]);
  out.sanitize = { ids: cleaned.map((c) => c.id), absentKept: cleaned.some((c) => c.id === 'absent') };

  // 目标校验：超过满分丢弃
  out.targets = E.sanitizeSubjectTargets([
    { subject: '数学', targetScore: 160, fullScore: 150, updatedAt: NOW },
    { subject: '语文', targetScore: 90, fullScore: 100, updatedAt: NOW },
  ]).map((t) => t.subject);

  // 表单输入：空分数 = 缺考；越界返回 null
  const emptyInput = E.normalizeExamScoreInput({ subject: '数学', examName: '期中', date: todayKey, score: null, fullScore: 150 });
  out.input = {
    emptyScore: emptyInput ? emptyInput.score : 'invalid',
    emptyOk: Boolean(emptyInput),
    overScore: E.normalizeExamScoreInput({ subject: '数学', examName: '期中', date: todayKey, score: 200, fullScore: 150 }),
    badDate: E.normalizeExamScoreInput({ subject: '数学', examName: '期中', date: 'x', score: 1, fullScore: 150 }),
  };

  return out;
});

check(
  '折合率：105/150=70%、95/100=95%，缺考/坏满分 = null',
  pure.rate.a === 0.7 && pure.rate.b === 0.95 && pure.rate.absent === null && pure.rate.bad === null,
  JSON.stringify(pure.rate),
);
check(
  '最近一次按日期取（未来日期不抢），缺考被跳过',
  pure.math.latestId === 'm3' && pure.math.count === 2,
  JSON.stringify(pure.math),
);
check(
  '数学：距目标 120/150 还差 8 分、未达标',
  pure.math.gap === 8 && pure.math.met === false,
  JSON.stringify({ gap: pure.math.gap, met: pure.math.met }),
);
check(
  '语文 95% ≥ 目标 92% → 达标',
  pure.chinese.met === true,
  JSON.stringify(pure.chinese),
);
check(
  '目标 = 满分时只在满分达标，不产生 NaN',
  pure.fullTarget.met === true && pure.fullTarget.gap === 0 && pure.fullTarget.rate === 1,
  JSON.stringify(pure.fullTarget),
);
check(
  '趋势：2 个点、不含未来记录、目标率 80%',
  pure.series.points === 2 &&
    pure.series.hasFuture === false &&
    Math.round((pure.series.targetRate ?? 0) * 100) === 80,
  JSON.stringify(pure.series),
);
check(
  '缺考不进均值 / 不当最近一次（count=1）',
  pure.absent.count === 1 && pure.absent.latestId === 'x2' && Math.round((pure.absent.avg ?? 0) * 100) === 80,
  JSON.stringify(pure.absent),
);
check(
  '坏数据清理：坏日期/越界分/满分 0 丢弃，缺考保留',
  pure.sanitize.ids.length === 2 &&
    pure.sanitize.ids.includes('ok') &&
    pure.sanitize.absentKept,
  JSON.stringify(pure.sanitize),
);
check('目标分越界被丢弃', pure.targets.length === 1 && pure.targets[0] === '语文', JSON.stringify(pure.targets));
check(
  '表单：空分数=缺考、越界/坏日期拒绝',
  pure.input.emptyOk === true && pure.input.emptyScore === null && pure.input.overScore === null && pure.input.badDate === null,
  JSON.stringify(pure.input),
);

/* ==========================================================================
   ② 真实 UI：录入两条成绩 + 设目标 → 图表与落盘
   ========================================================================== */
console.log('\n=== ② 真实 UI：录入 / 目标 / 趋势 ===');

function dayAgoTs(daysAgo, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}
const isoDay = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seedState = {
  ...SEED,
  settings: { ...SEED.settings, theme: 'liquid-glass', colorMode: 'light' },
  goals: [
    {
      id: 'g1',
      title: '完成一套数学试卷',
      subject: '数学',
      plannedMinutes: 60,
      actualMinutes: 40,
      priority: 'normal',
      status: 'doing',
      createdAt: dayAgoTs(2),
      completedAt: null,
      kind: 'time',
    },
  ],
  tasks: [],
  dates: [],
  sessions: [
    {
      id: 'sa',
      subject: '数学',
      goalId: 'g1',
      startedAt: dayAgoTs(1),
      endedAt: dayAgoTs(1) + 40 * 60000,
      durationSec: 40 * 60,
      source: 'timer',
    },
  ],
};
await page.addInitScript((s) => {
  try {
    if (localStorage.getItem('__exam_seeded__')) return;
    localStorage.setItem('learning-os:v1:state', JSON.stringify(s));
    localStorage.setItem('__exam_seeded__', '1');
  } catch {
    /* ignore */
  }
}, seedState);
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(1600);

const before = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return {
    sessions: st.sessions.length,
    totalSec: st.sessions.reduce((a, s) => a + s.durationSec, 0),
    actual: st.goals[0]?.actualMinutes ?? 0,
    exams: st.examScores.length,
  };
});

await page.goto(`${BASE}#/stats`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const examTab = page.locator('main button', { hasText: /^成绩$/ }).first();
check('统计页出现「成绩」标签', (await examTab.count()) > 0);
await examTab.click();
await sleep(700);
const emptyText = (await page.locator('main').textContent())?.replace(/\s+/g, ' ') ?? '';
check('无记录时显示空态与「记录第一次考试」', /还没有成绩记录/.test(emptyText) && /记录第一次考试/.test(emptyText));
await page.screenshot({ path: `${OUT}/1-empty.png` });

async function fillScoreSheet({ subject, name, date, score, full }) {
  const sheet = page.locator('[role="dialog"]');
  if (subject) await sheet.locator('input[placeholder="数学 / 英语 / 物理…"]').fill(subject);
  await sheet.locator('input[placeholder="期中 / 第一次月考 / 模考"]').fill(name);
  await sheet.locator('input[type="date"]').fill(date);
  const nums = sheet.locator('input[type="number"]');
  await nums.nth(0).fill(String(score));
  await nums.nth(1).fill(String(full));
  await page.locator('[role="dialog"] button', { hasText: /^保存成绩$/ }).click();
  await sleep(900);
}

await page.locator('button', { hasText: /^记录第一次考试$/ }).first().click();
await sleep(600);
await fillScoreSheet({ subject: '数学', name: '期中', date: isoDay(20), score: 112, full: 150 });
const afterFirst = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return { exams: st.examScores, sessions: st.sessions.length, actual: st.goals[0]?.actualMinutes ?? 0 };
});
check('第一条成绩写入 store', afterFirst.exams.length === 1 && afterFirst.exams[0].score === 112, JSON.stringify(afterFirst.exams[0]?.score));
check(
  '录入成绩不产生学习记录、不改目标实际用时（铁律）',
  afterFirst.sessions === before.sessions && afterFirst.actual === before.actual,
  `${before.sessions}/${before.actual} → ${afterFirst.sessions}/${afterFirst.actual}`,
);

// 第二条（更晚日期）→ 最近一次变成它
await page.locator('button', { hasText: /^记录成绩$/ }).first().click();
await sleep(600);
await fillScoreSheet({ subject: '数学', name: '月考', date: isoDay(5), score: 105, full: 150 });
await sleep(600);
const afterSecond = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return { exams: st.examScores.length, ids: st.examScores.map((e) => e.examName) };
});
check('第二条成绩写入', afterSecond.exams === 2, JSON.stringify(afterSecond));

// 设目标：120 / 150
await page.locator('main button', { hasText: /^记录$/ }).first().click();
await sleep(600);
await page.locator('[role="dialog"] button', { hasText: /^目标分$/ }).click();
await sleep(300);
const targetSheet = page.locator('[role="dialog"]');
await targetSheet.locator('input[type="number"]').nth(0).fill('120');
await targetSheet.locator('input[type="number"]').nth(1).fill('150');
await page.locator('[role="dialog"] button', { hasText: /^保存目标$/ }).click();
await sleep(900);
const afterTarget = await page.evaluate(() => window.__LOS__.useStore.getState().subjectScoreTargets);
check(
  '目标分按科目存一份（数学 120/150）',
  afterTarget.length === 1 && afterTarget[0].subject === '数学' && afterTarget[0].targetScore === 120,
  JSON.stringify(afterTarget),
);

const chart = await page.evaluate(() => {
  const main = document.querySelector('main');
  // 只看趋势图自己的 svg（role=img）；main 里还有大量图标 svg
  const svg = main?.querySelector('svg[role="img"]');
  const dashed = main?.querySelectorAll('line[stroke-dasharray]').length ?? 0;
  return {
    circles: svg?.querySelectorAll('circle').length ?? 0,
    dashed,
    text: (main?.textContent ?? '').replace(/\s+/g, ' '),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
check('趋势图 2 个点', chart.circles === 2, String(chart.circles));
check('目标虚线出现', chart.dashed >= 1, String(chart.dashed));
check('显示「距目标还差 15 分」', /距目标还差 15 分/.test(chart.text), chart.text.match(/距目标还差[^·]*/)?.[0] ?? '');
check('文案含「不计入学习时长」', /不计入学习时长/.test(chart.text));
check('390px 下没有横向溢出', chart.overflowX === false);
await page.screenshot({ path: `${OUT}/2-with-trend.png` });

// 落盘 + 刷新保留
await sleep(900);
const disk = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('learning-os:v1:state') || '{}');
  return { exams: raw.examScores?.length ?? 0, targets: raw.subjectScoreTargets?.length ?? 0 };
});
check('成绩与目标都已落盘', disk.exams === 2 && disk.targets === 1, JSON.stringify(disk));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1600);
const afterReload = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return { exams: st.examScores.length, targets: st.subjectScoreTargets.length };
});
check('刷新后成绩与目标仍在', afterReload.exams === 2 && afterReload.targets === 1, JSON.stringify(afterReload));

// 320px
await page.setViewportSize({ width: 320, height: 640 });
await page.waitForTimeout(800);
const narrow = await page.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
}));
check('320px 下没有横向溢出', narrow.overflowX === false, JSON.stringify(narrow));
await page.screenshot({ path: `${OUT}/3-320.png` });

/* ==========================================================================
   ③ 导入旧备份：没有成绩字段 → 空数组，原数据不丢
   ========================================================================== */
console.log('\n=== ③ 导入旧备份兼容 ===');
const imported = await page.evaluate(async () => {
  const st = window.__LOS__.useStore.getState();
  const backup = {
    schema: 1,
    settings: st.settings,
    periods: st.periods,
    courses: st.courses,
    goals: st.goals,
    tasks: st.tasks,
    sessions: st.sessions,
    dates: st.dates,
    calendarEvents: st.calendarEvents,
    dayOverrides: st.dayOverrides,
    background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: [], custom: [], dim: 0.35, dynamic: true, showVeil: true, grid: false, dimAuto: false },
    timer: null,
    courseStatus: {},
  };
  const result = st.importSnapshot(backup);
  const after = window.__LOS__.useStore.getState();
  return {
    ok: result.ok,
    exams: after.examScores.length,
    targets: after.subjectScoreTargets.length,
    sessions: after.sessions.length,
  };
});
check(
  '导入旧备份：成绩/目标为空、原有学习记录保留',
  imported.ok === true && imported.exams === 0 && imported.targets === 0 && imported.sessions === before.sessions,
  JSON.stringify(imported),
);

check('无 JS 报错', errors.length === 0, [...new Set(errors)].slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${OUT}/`);
if (failed) process.exit(1);
