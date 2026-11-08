/**
 * 火花（连续学习天数）与断签挽救的验证
 * ──────────────────────────────────────────────────────────────────────────────
 * 重点不是「数字算得对」，而是几条产品/铁律口径不被破坏：
 *   · 今天没学不算断；断一天可以救，断两天以上不可救；
 *   · 救的条件是「缺口后连续 2 天各 ≥20 分钟」，且缺口前要连续够 3 天；
 *   · 接回**不生成 Session、不增加任何学习时长**；缺口日仍然不算学习日；
 *   · 缺口日后来被补录了真实记录 → 账本失效，按真实连续算（防双算）；
 *   · 14 天冷却生效；冷却中不能接回。
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { SEED } from './lib-seed.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const OUT = '.preview/streak';
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
   ① 纯函数：状态机
   ========================================================================== */
console.log('\n=== ① 状态机（固定 NOW = 2026-11-07 18:00）===');
const pure = await page.evaluate(async () => {
  const S = await import('/src/lib/streak.ts');
  const now = new Date(2026, 10, 7, 18, 0, 0).getTime();
  const DAY = 86400000;
  const dayStart = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const base = dayStart(now);
  const mk = (daysAgo, minutes, source = 'timer') => ({
    id: `s-${daysAgo}-${minutes}-${source}`,
    subject: '数学',
    startedAt: base - daysAgo * DAY + 19 * 3600000,
    endedAt: base - daysAgo * DAY + 19 * 3600000 + minutes * 60000,
    durationSec: minutes * 60,
    source,
  });
  const st = (sessions, rescues = []) => S.computeStreakState(sessions, rescues, now);

  const out = {};
  let s = st([]);
  out.empty = { phase: s.phase, streak: s.streak, longest: s.longest, active: s.activeDayKeys.length };

  s = st([mk(0, 30)]);
  out.active = { phase: s.phase, streak: s.streak, longest: s.longest };

  // 今天 9 分钟：不到 10 分钟阈值，但昨天学了 → 连续没断
  s = st([mk(0, 9), mk(1, 30)]);
  out.pending = { phase: s.phase, streak: s.streak, todayMinutes: s.todayMinutes, longest: s.longest };

  s = st([mk(0, 12), mk(1, 30), mk(2, 30)]);
  out.active3 = { phase: s.phase, streak: s.streak, longest: s.longest };

  // 缺昨天：-2/-3/-4 连续 3 天；今天 19 分钟 → 还差一点，restorable
  const gapYesterday = [mk(2, 30), mk(3, 30), mk(4, 30)];
  s = st([...gapYesterday, mk(0, 19)]);
  out.restorable = { phase: s.phase, gapDay: s.gapDay, preGapRun: s.preGapRun, repairDone: s.repairDone };

  // 今天 20 分钟 → repairing 1/2
  s = st([...gapYesterday, mk(0, 20)]);
  out.repairing = {
    phase: s.phase,
    gapDay: s.gapDay,
    repairDone: s.repairDone,
    repairDays: s.repairDays,
  };

  // 缺前天：昨天 + 今天各 25 分钟 → ready（今天是第 2 个补学日）
  const readySessions = [mk(1, 25), mk(0, 25), mk(3, 30), mk(4, 30), mk(5, 30)];
  s = st(readySessions);
  out.ready = {
    phase: s.phase,
    gapDay: s.gapDay,
    preGapRun: s.preGapRun,
    repairDone: s.repairDone,
  };

  // 缺口前不足 3 天 → 不可救
  s = st([mk(2, 30)]);
  out.shortRun = { phase: s.phase, streak: s.streak };

  // 缺两天 → 今天学 30 分钟只能从 1 重新开始
  s = st([mk(5, 30), mk(4, 30), mk(3, 30), mk(0, 30)]);
  out.twoDayGap = { phase: s.phase, streak: s.streak, repaired: s.repairedGapDays.length };

  // 未来日期的脏数据不参与
  s = st([mk(-1, 60)]);
  out.futureIgnored = { phase: s.phase, active: s.activeDayKeys.length };

  // 跨零点：昨晚 23:50 开始 30 分钟 → 算昨天（按开始时间归日）
  const lateStart = base - 1 * DAY + 23 * 3600000 + 50 * 60000;
  s = st([{ id: 'late', subject: '数学', startedAt: lateStart, endedAt: lateStart + 30 * 60000, durationSec: 30 * 60, source: 'timer' }]);
  out.crossMidnight = { phase: s.phase, streak: s.streak };

  /* ---------- 接回 ---------- */
  const readyState = st(readySessions);
  const rescue = S.makeStreakRescue(readyState, 'sr_test');
  out.makeRescue = {
    ok: Boolean(rescue),
    gapDay: rescue?.gapDay ?? null,
    beforeGapDay: rescue?.beforeGapDay ?? null,
    repairDays: rescue?.repairDays ?? [],
    restoredFrom: rescue?.restoredFrom ?? null,
  };
  const after = st(readySessions, [rescue]);
  out.afterRescue = {
    phase: after.phase,
    streak: after.streak,
    longest: after.longest,
    repaired: after.repairedGapDays,
    // 缺口日仍然不是学习日
    gapIsActive: after.activeDayKeys.includes(rescue.gapDay),
  };

  // 补录了缺口日的真实记录 → 账本失效，按真实连续算（4 天）
  const backfilled = st([...readySessions, mk(2, 30)], [rescue]);
  out.backfilled = {
    repaired: backfilled.repairedGapDays.length,
    streak: backfilled.streak,
  };

  // 补学日被改短（5 分钟）→ 账本失效
  const shortRepair = st([mk(0, 25), mk(1, 5), mk(3, 30), mk(4, 30), mk(5, 30)], [rescue]);
  out.invalidAfterShort = { repaired: shortRepair.repairedGapDays.length, streak: shortRepair.streak };

  // 14 天冷却：最近一次接回在 3 天前 → ready 被压掉
  const recentRescue = {
    id: 'sr_recent',
    gapDay: '2026-10-20',
    beforeGapDay: '2026-10-19',
    repairDays: ['2026-10-21', '2026-10-22'],
    restoredFrom: 5,
    rescuedAt: now - 3 * DAY,
    ruleVersion: 1,
  };
  s = st(readySessions, [recentRescue]);
  out.cooldown = {
    phase: s.phase,
    cooldownUntil: s.cooldownUntil,
    cooled: s.cooldownUntil === null || now >= s.cooldownUntil,
  };

  // 非 ready 时不能生成账本
  out.makeRescueRejected = S.makeStreakRescue(st([mk(0, 30)]), 'x') === null;

  // 补录来源也计入补学（manual 与 timer 同权）
  s = st([mk(2, 30), mk(3, 30), mk(4, 30), mk(0, 20, 'manual')]);
  out.manualCounts = { phase: s.phase, repairDone: s.repairDone };

  return out;
});

check('无记录 → empty', pure.empty.phase === 'empty' && pure.empty.streak === 0, JSON.stringify(pure.empty));
check('今天 30 分钟 → active / 连续 1 天', pure.active.phase === 'active' && pure.active.streak === 1, JSON.stringify(pure.active));
check(
  '今天 9 分钟 + 昨天 30 分钟 → pending（今天没学不算断）',
  pure.pending.phase === 'pending' && pure.pending.streak === 1 && pure.pending.todayMinutes === 9,
  JSON.stringify(pure.pending),
);
check('连续 3 天 → 3 天 / 最长 3 天', pure.active3.streak === 3 && pure.active3.longest === 3, JSON.stringify(pure.active3));
check(
  '缺昨天、今天 19 分钟 → restorable（差 1 分钟不进修复）',
  pure.restorable.phase === 'restorable' && pure.restorable.repairDone === 0 && pure.restorable.preGapRun === 3,
  JSON.stringify(pure.restorable),
);
check(
  '今天 20 分钟 → repairing 1/2（补学日从今天开始）',
  pure.repairing.phase === 'repairing' && pure.repairing.repairDone === 1 && pure.repairing.repairDays.length === 1,
  JSON.stringify(pure.repairing),
);
check(
  '缺前天、昨天+今天各 25 分钟 → ready（缺口前 3 天）',
  pure.ready.phase === 'ready' && pure.ready.preGapRun === 3 && pure.ready.repairDone === 2,
  JSON.stringify(pure.ready),
);
check(
  '缺口前只连续 1 天 → 不可救（broken）',
  pure.shortRun.phase === 'broken',
  JSON.stringify(pure.shortRun),
);
check(
  '缺两天 → 不产生接回，今天只算重新开始 1 天',
  pure.twoDayGap.streak === 1 && pure.twoDayGap.repaired === 0,
  JSON.stringify(pure.twoDayGap),
);
check('未来日期的数据不参与连续', pure.futureIgnored.active === 0, JSON.stringify(pure.futureIgnored));
check(
  '跨零点记录按开始时间归日（23:50 算昨天）',
  pure.crossMidnight.streak === 1,
  JSON.stringify(pure.crossMidnight),
);
check(
  'ready 时能生成账本（缺口/补学日正确）',
  pure.makeRescue.ok &&
    pure.makeRescue.repairDays.length === 2 &&
    pure.makeRescue.restoredFrom === 3,
  JSON.stringify(pure.makeRescue),
);
check(
  '接回后显示 3+2=5 天，缺口日仍不是学习日',
  pure.afterRescue.streak === 5 &&
    pure.afterRescue.longest === 5 &&
    pure.afterRescue.repaired.length === 1 &&
    pure.afterRescue.gapIsActive === false,
  JSON.stringify(pure.afterRescue),
);
check(
  '缺口日后来被补录 → 账本失效，按真实连续 6 天算',
  pure.backfilled.repaired === 0 && pure.backfilled.streak === 6,
  JSON.stringify(pure.backfilled),
);
check(
  '补学日记录被改短 → 账本失效',
  pure.invalidAfterShort.repaired === 0 && pure.invalidAfterShort.streak === 1,
  JSON.stringify(pure.invalidAfterShort),
);
check(
  '14 天冷却：3 天前接回过 → phase 不是 ready',
  pure.cooldown.phase !== 'ready' && pure.cooldown.cooled === false,
  JSON.stringify(pure.cooldown),
);
check('非 ready 不能生成账本', pure.makeRescueRejected === true);
check(
  '手动补录与计时同权（都算补学日）',
  pure.manualCounts.phase === 'repairing' && pure.manualCounts.repairDone === 1,
  JSON.stringify(pure.manualCounts),
);

/* ==========================================================================
   ② 真实 UI：首页徽章 → 火花独立页 → 接回 → 复燃动画 → 落盘
   ========================================================================== */
console.log('\n=== ② 真实 UI：徽章 → 火花页 ===');

function dayAgoTs(daysAgo, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}
const mkSession = (daysAgo, minutes, id) => {
  const st = dayAgoTs(daysAgo);
  return {
    id,
    subject: '数学',
    startedAt: st,
    endedAt: st + minutes * 60000,
    durationSec: minutes * 60,
    source: 'timer',
  };
};

async function seed(sessions) {
  const state = {
    ...SEED,
    settings: { ...SEED.settings, theme: 'liquid-glass', colorMode: 'light' },
    goals: [],
    tasks: [],
    dates: [],
    sessions,
  };
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), state);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
}

const BADGE = 'main header button[title="连续学习天数，打开火花页面"]';

// 场景 A0：第一天（没有任何学习记录）也要有火花入口，不能藏起来
await seed([]);
const badgeEmpty = await page.evaluate(() => {
  const b = document.querySelector('main header button[title="连续学习天数，打开火花页面"]');
  return b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : null;
});
check('第一天没有连胜时徽章仍在，并显示「开始」', badgeEmpty?.includes('开始') === true, String(badgeEmpty));
await page.locator(BADGE).click();
await page.waitForTimeout(900);
const emptyPageText = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
check('第一天的火花页给出「还没有第一天」的引导', /还没有第一天/.test(emptyPageText), emptyPageText.slice(0, 80));
await page.locator('main button[aria-label="返回"]').click();
await page.waitForTimeout(600);

// 场景 A：连续 3 天 → 首页徽章显示「3 天」，点开是独立页面
await seed([mkSession(0, 12, 'a0'), mkSession(1, 30, 'a1'), mkSession(2, 30, 'a2')]);
const badgeA = await page.evaluate(() => {
  const b = document.querySelector('main header button[title="连续学习天数，打开火花页面"]');
  return b ? { text: (b.textContent || '').replace(/\s+/g, ' ').trim(), h: Math.round(b.getBoundingClientRect().height) } : null;
});
check(
  '首页徽章显示「3 天」（不只是一个小数字）',
  Boolean(badgeA) && badgeA.text.includes('3') && badgeA.text.includes('天'),
  JSON.stringify(badgeA),
);
check('火焰徽章触控高度 ≥44', Boolean(badgeA) && badgeA.h >= 44, badgeA ? `${badgeA.h}px` : '无');
await page.locator(BADGE).click();
await page.waitForTimeout(900);
const pageA = await page.evaluate(() => ({
  hash: location.hash,
  text: (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 260),
  hasBack: Boolean(document.querySelector('main button[aria-label="返回"]')),
  hasH1: Boolean(document.querySelector('main h1')),
}));
check('点徽章进入独立页面 #/streak（不再是弹层）', pageA.hash.includes('/streak'), pageA.hash);
check('火花页有返回按钮和标题', pageA.hasBack && pageA.hasH1);
check('火花页写明连续 3 天', /3\s*天/.test(pageA.text) && /最长连续/.test(pageA.text), pageA.text.slice(0, 80));
await page.screenshot({ path: `${OUT}/1-page-active.png` });
await page.locator('main button[aria-label="返回"]').click();
await page.waitForTimeout(700);

// 场景 B：ready → 接回 → 复燃动画 → 落盘 + 不产生学习记录
console.log('\n=== ③ 接回：复燃动画、写账本、不产生学习记录 ===');
const readySessions = [
  mkSession(0, 25, 'b0'),
  mkSession(1, 25, 'b1'),
  mkSession(3, 30, 'b3'),
  mkSession(4, 30, 'b4'),
  mkSession(5, 30, 'b5'),
];
await seed(readySessions);
const before = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return {
    sessions: st.sessions.length,
    totalSec: st.sessions.reduce((a, s) => a + s.durationSec, 0),
    rescues: st.streakRescues.length,
  };
});
const badgeB = await page.evaluate(() => {
  const b = document.querySelector('main header button[title="连续学习天数，打开火花页面"]');
  return b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : null;
});
check('ready 时首页徽章出现（数字或小圆点）', Boolean(badgeB), String(badgeB));
await page.locator(BADGE).click();
await page.waitForTimeout(900);
const readyPage = await page.evaluate(() => {
  const main = document.querySelector('main');
  const btns = Array.from(main?.querySelectorAll('button') ?? []).map((b) =>
    (b.textContent || '').replace(/\s+/g, ' ').trim(),
  );
  return { text: (main?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 260), btns };
});
check(
  '火花页出现「接回 5 天」按钮',
  readyPage.btns.some((t) => /接回 5 天/.test(t)),
  JSON.stringify(readyPage.btns),
);
check('火花页出现接回进度 2 / 2', /2 \/ 2/.test(readyPage.text), readyPage.text.slice(0, 120));
await page.screenshot({ path: `${OUT}/2-page-ready.png` });

await page.locator('main button', { hasText: /^接回 5 天$/ }).first().click();
// 动画进行中（约 350ms）截一帧，证明复燃层真的出现了
await page.waitForTimeout(350);
const mid = await page.evaluate(() => {
  const el = document.querySelector('[role="status"][aria-label="火花已经接回"]');
  return el
    ? {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        embers: el.querySelectorAll('.spark-ember').length,
        glowing: Boolean(el.querySelector('.spark-glow')),
      }
    : null;
});
check('接回后出现复燃动画层', Boolean(mid) && /火花接上了/.test(mid.text), JSON.stringify(mid));
check('复燃层有火星与光晕（不是干巴巴一个数字）', Boolean(mid) && mid.embers > 0 && mid.glowing, JSON.stringify(mid));
await page.screenshot({ path: `${OUT}/3-revive-mid.png` });
await page.waitForTimeout(2400);

const after = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return {
    sessions: st.sessions.length,
    totalSec: st.sessions.reduce((a, s) => a + s.durationSec, 0),
    rescues: st.streakRescues,
    overlays: document.querySelectorAll('[aria-label="火花已经接回"]').length,
    pageStreak: (document.querySelector('main .num-hero')?.textContent ?? '').trim(),
  };
});
check('复燃动画自动收起', after.overlays === 0, `还剩 ${after.overlays} 层`);
check('接回后写入 1 条账本', after.rescues.length === 1, JSON.stringify(after.rescues));
check(
  '账本字段正确（缺口/补学日/缺口前天数）',
  after.rescues[0]?.repairDays?.length === 2 &&
    after.rescues[0]?.restoredFrom === 3 &&
    after.rescues[0]?.ruleVersion === 1,
  JSON.stringify(after.rescues[0]),
);
check(
  '接回没有生成学习记录、总时长不变（铁律）',
  after.sessions === before.sessions && after.totalSec === before.totalSec,
  `${before.sessions}/${before.totalSec} → ${after.sessions}/${after.totalSec}`,
);
check('火花页数字更新为 5', after.pageStreak === '5', after.pageStreak);
await page.screenshot({ path: `${OUT}/4-page-after-revive.png` });

// 落盘：等过 400ms 节流，再分别断言 store 与 localStorage
await sleep(900);
const onDisk = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('learning-os:v1:state') || '{}');
  return {
    rescues: raw.streakRescues?.length ?? 0,
    gap: raw.streakRescues?.[0]?.gapDay ?? null,
  };
});
check('账本已落盘到 localStorage', onDisk.rescues === 1, JSON.stringify(onDisk));

// 刷新后回首页：徽章显示 5 天，账本还在
await page.goto(`${BASE}#/`, { waitUntil: 'load' });
await page.waitForTimeout(1600);
const afterReload = await page.evaluate(() => {
  const b = document.querySelector('main header button[title="连续学习天数，打开火花页面"]');
  const st = window.__LOS__.useStore.getState();
  return {
    badge: b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : null,
    rescues: st.streakRescues.length,
  };
});
check(
  '刷新后首页徽章显示「5 天」（3+2）',
  afterReload.badge?.includes('5') && afterReload.badge?.includes('天') && afterReload.rescues === 1,
  JSON.stringify(afterReload),
);
await page.screenshot({ path: `${OUT}/5-home-after-revive.png` });

// 统计页「连续学习」也走同一口径
await page.goto(`${BASE}#/stats`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const statsText = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
check('统计页连续学习显示 5 天', /连续学习\s*5 天/.test(statsText), statsText.match(/连续学习[^ ]*\s*[^最长]{0,12}/)?.[0] ?? '');

check('无 JS 报错', errors.length === 0, [...new Set(errors)].slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${OUT}/`);
if (failed) process.exit(1);
