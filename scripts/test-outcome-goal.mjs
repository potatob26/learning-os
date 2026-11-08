/**
 * 「成果目标」（不计时的目标）验证
 * ──────────────────────────────────────────────────────────────────────────────
 * 背景：「期中到达班级多少名」这类事没法定时长，强行填一个计划时长，
 * 那个数字是编的、进度条也是假的。所以加了一类**不计时**的目标：
 * 只记「当前值 → 目标值」的数值进度，不参与计时、不写学习时长。
 *
 * 这个脚本按**真实 UI 操作**走一遍，重点验「不该发生的事」：
 *   · 成果目标的 plannedMinutes / actualMinutes 必须都是 0（否则会污染时长统计）
 *   · 关联目标列表里**不能**出现它（否则计上去就破了自己「不计时」的定义）
 *   · 「现在该做什么」里它必须是「完成打卡」，不能是「开始 N 分钟」
 *   · 首页/目标页不能出现「计划 0m」这种读数
 *   · 编辑时改当前值，进度不能被重置成 0%（起始值必须只在创建时取一次）
 * 光验「能创建出来」是不够的 —— 上面每一条都是设计决定，破了就是错的。
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const OUT = '.preview/outcome-goal';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('learning-os:v1:state') || '{}'));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });

/* 种一份干净数据：学习窗口放大到全天，保证「现在该做什么」有可支配时间可用 */
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(1200);
for (let i = 0; i < 12; i++) {
  const c = await page.evaluate(() => {
    for (const l of ['继续', '下一步', '完成', '开始使用', '知道了，开始使用', '知道了']) {
      const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === l);
      if (b) { b.click(); return l; }
    }
    return null;
  });
  if (!c) break;
  await sleep(600);
}
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('learning-os:v1:state') || '{}');
  raw.settings = { ...(raw.settings || {}), onboarded: true, studyFrom: '00:00', studyTo: '23:59' };
  raw.goals = [];
  raw.sessions = [];
  localStorage.setItem('learning-os:v1:state', JSON.stringify(raw));
  return true;
});
await page.reload({ waitUntil: 'load' });   // 坑 36：不 reload 应用不重读状态
await sleep(2500);

/* ---------- ① 走真实 UI 创建一个成果目标 ---------- */
console.log('\n=== ① 目标页 → 新建 → 成果目标 ===');
await page.evaluate(() => { location.hash = '#/goals'; });
await sleep(1500);

await page.locator('button', { hasText: /^新建$/ }).first().click();
await sleep(1000);
const sheet = page.locator('[role="dialog"]');
check('打开了新建目标表单', (await sheet.count()) > 0);

// 切成成果目标
await sheet.locator('button', { hasText: '成果目标' }).first().click();
await sleep(500);
const hasNumFields = await sheet.locator('input[placeholder="比如 25"]').count();
check('切到成果目标后出现「当前值」输入', hasNumFields === 1);
const planGone = await sheet.locator('text=计划时长').count();
check('成果目标下不再要求填计划时长', planGone === 0);

await sheet.locator('input').first().fill('期中到达班级多少名');
await sheet.locator('input[placeholder="比如 25"]').fill('25');
await sheet.locator('input[placeholder="比如 10"]').fill('10');
await sheet.locator('input[placeholder="名 / 套 / 分 / 个"]').fill('名');
await sleep(400);
const dirHint = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').replace(/\s+/g, ' '));
check('自动判出「越小越好」方向', dirHint.includes('越小越好'), dirHint.match(/越小越好[^。]*/)?.[0] ?? '');

await page.locator('[role="dialog"] button', { hasText: /^创建目标$/ }).first().click();
await sleep(1200);

const created = await state();
const g1 = (created.goals || [])[0];
check('目标已写入存档', Boolean(g1), g1 ? g1.title : '未找到');
check('kind 记为 outcome', g1?.kind === 'outcome', String(g1?.kind));
check('plannedMinutes 为 0（不编造时长）', g1?.plannedMinutes === 0, String(g1?.plannedMinutes));
check('actualMinutes 为 0', g1?.actualMinutes === 0, String(g1?.actualMinutes));
check('起始值 start = 创建时的当前值 25', g1?.progress?.start === 25, JSON.stringify(g1?.progress));
check('目标值 / 单位正确', g1?.progress?.target === 10 && g1?.progress?.unit === '名', JSON.stringify(g1?.progress));
await page.screenshot({ path: `${OUT}/1-goals-list.png`, fullPage: true });

/* ---------- ② 进度：初始 0%，且方向正确 ---------- */
console.log('\n=== ② 进度计算（越小越好）===');
const ratioAt = (cur) => page.evaluate((c) => {
  const st = window.__LOS__.useStore.getState();
  const g = st.goals[0];
  return { before: g.progress.current, label: null, cur: c };
}, cur);
void ratioAt;

const progressText = async () => page.evaluate(() =>
  (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
const t0 = await progressText();
check('刚创建时进度显示 0%', t0.includes('25 / 10 名（0%）') || t0.includes('（0%）'), t0.match(/25 \/ 10 名[^）]*）?/)?.[0] ?? '');
const noZeroPlan = !t0.includes('计划 0m') && !t0.includes('0m / 0m');
check('目标页没有出现「计划 0m」', noZeroPlan);

/* 把当前值改到 18：期望 (18-25)/(10-25) = 46.67% → 47% */
await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  st.setGoalProgress(st.goals[0].id, 18);
});
await sleep(600);
const t1 = await progressText();
check('当前值 18 时进度 ≈ 47%（方向自动成立）', t1.includes('18 / 10 名') && t1.includes('47%'),
  t1.match(/18 \/ 10 名[^）]*）?/)?.[0] ?? t1.slice(0, 80));

/* 超额完成也不该显示 >100% */
await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  st.setGoalProgress(st.goals[0].id, 4);
});
await sleep(600);
const t2 = await progressText();
check('超额完成被 clamp 到 100%，不显示 140%', t2.includes('100%') && !t2.includes('140%'),
  t2.match(/\d+%/g)?.join(' ') ?? '');
await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  st.setGoalProgress(st.goals[0].id, 18);
});
await sleep(500);

/* ---------- ③ 编辑时起始值不能被重置 ---------- */
console.log('\n=== ③ 编辑不重置进度 ===');
await page.locator('main button', { hasText: '期中到达班级多少名' }).first().click();
await sleep(1000);
const editSheet = page.locator('[role="dialog"]');
check('打开编辑表单且仍是成果目标', (await editSheet.locator('input[placeholder="比如 25"]').count()) === 1);
const editHint = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').replace(/\s+/g, ' '));
check('表单显示起始值（用于说明进度怎么算）', editHint.includes('起始值 25'), editHint.match(/起始值 \d+/)?.[0] ?? '');
// 只改当前值，保存
await editSheet.locator('input[placeholder="比如 25"]').fill('15');
await page.locator('[role="dialog"] button', { hasText: /^保存$/ }).first().click();
await sleep(1200);
const afterEdit = await state();
check('编辑后 start 仍是 25（没被重置）', afterEdit.goals[0]?.progress?.start === 25, JSON.stringify(afterEdit.goals[0]?.progress));
// (15-25)/(10-25) = 66.67% → 67%
const t3 = await progressText();
check('当前值 15 时进度 ≈ 67%', t3.includes('67%'), t3.match(/\d+%/g)?.join(' ') ?? '');

/* ---------- ④ 「现在该做什么」：必须是「完成打卡」 ---------- */
console.log('\n=== ④ 首页「现在该做什么」===');
await page.evaluate(() => { location.hash = '#/'; });
await sleep(2500);
const homeText = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
check('成果目标出现在推荐里（不再被静默丢掉）', homeText.includes('期中到达班级多少名'), homeText.slice(0, 120));
check('推荐理由给出「距目标还差 N 名」', /距目标还差\s*\d+\s*名/.test(homeText), homeText.match(/距目标还差[^·]*/)?.[0] ?? '');
const primaryBtn = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('main button')).map((b) => (b.textContent || '').trim());
  return btns.find((t) => t === '完成打卡') ?? btns.find((t) => /^开始 \d+ 分钟$/.test(t)) ?? null;
});
check('按钮是「完成打卡」而不是「开始 N 分钟」', primaryBtn === '完成打卡', String(primaryBtn));
/*
 * 首页「今天要做什么」用的是 compact 版 GoalItem，**整块副标题本来就不渲染**
 * （科目/时长那一行），所以这里只可能因为回归才冒出「计划 0m」。
 * 数值进度的展示由目标页那条断言覆盖（那里是完整版）。
 * 第一版把这条写成「首页显示数值进度」，名不副实 —— 断言的名字要跟它真正验的东西一致。
 */
check('首页今日目标里不会出现「计划 0m」这类读数',
  !homeText.includes('计划 0m') && !homeText.includes('0m / 0m'),
  homeText.includes('计划 0m') ? '出现了' : '无此时长读数');
await page.screenshot({ path: `${OUT}/2-home-suggest.png`, fullPage: true });

/* ---------- ⑤ 计时器不能关联它 ---------- */
console.log('\n=== ⑤ 计时器侧 ===');
await page.evaluate(() => { location.hash = '#/timer'; });
await sleep(2000);
const timerText = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
// 打开「开始学习」弹层，看关联目标列表
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /开始学习|开始计时/.test((x.textContent || '').trim()));
  b?.click();
});
await sleep(1000);
const pickerText = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent ?? '') || (document.querySelector('main')?.textContent ?? ''));
check('计时器的关联目标里没有成果目标', !pickerText.includes('期中到达班级多少名'),
  pickerText.includes('关联目标') ? '列表已渲染' : '（无可选目标，列表未渲染）');
await page.keyboard.press('Escape');
await sleep(600);
void timerText;

/* ---------- ⑥ 打卡完成 ---------- */
console.log('\n=== ⑥ 完成打卡 ===');
await page.evaluate(() => { location.hash = '#/'; });
await sleep(2200);
await page.locator('main button', { hasText: /^完成打卡$/ }).first().click();
await sleep(1000);
const done = await state();
check('点「完成打卡」后目标状态为 done', done.goals[0]?.status === 'done', String(done.goals[0]?.status));
check('打卡不会产生任何学习记录（不计时）', (done.sessions || []).length === 0, `${(done.sessions || []).length} 条`);
check('打卡后 actualMinutes 仍是 0', done.goals[0]?.actualMinutes === 0, String(done.goals[0]?.actualMinutes));

/* ---------- ⑦ 越大越好的方向 ---------- */
console.log('\n=== ⑦ 越大越好（方向自动）===');
await page.evaluate(() => { location.hash = '#/goals'; });
await sleep(1500);
await page.locator('button', { hasText: /^新建$/ }).first().click();
await sleep(900);
await page.locator('[role="dialog"] button', { hasText: '成果目标' }).first().click();
await sleep(400);
await page.locator('[role="dialog"] input').first().fill('刷完十套卷子');
await page.locator('[role="dialog"] input[placeholder="比如 25"]').fill('3');
await page.locator('[role="dialog"] input[placeholder="比如 10"]').fill('10');
await sleep(400);
const dir2 = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').replace(/\s+/g, ' '));
check('3 → 10 自动判成「越大越好」', dir2.includes('越大越好'), dir2.match(/越大越好[^。]*/)?.[0] ?? '');
await page.locator('[role="dialog"] button', { hasText: /^创建目标$/ }).first().click();
await sleep(1200);
await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  st.setGoalProgress(st.goals[0].id, 6);   // (6-3)/(10-3) = 42.8% → 43%
});
await sleep(700);
const t4 = await progressText();
check('3→10 走到 6 时进度 ≈ 43%', t4.includes('43%'), t4.match(/\d+%/g)?.join(' ') ?? '');

/* ---------- ⑧ 目标值 = 当前值 时拦住 ---------- */
console.log('\n=== ⑧ 边界：目标值不能等于当前值 ===');
await page.locator('button', { hasText: /^新建$/ }).first().click();
await sleep(900);
await page.locator('[role="dialog"] button', { hasText: '成果目标' }).first().click();
await sleep(400);
await page.locator('[role="dialog"] input').first().fill('边界用例');
await page.locator('[role="dialog"] input[placeholder="比如 25"]').fill('5');
await page.locator('[role="dialog"] input[placeholder="比如 10"]').fill('5');
await sleep(400);
const guarded = await page.evaluate(() => {
  const s = document.querySelector('[role="dialog"]');
  const btn = Array.from(s.querySelectorAll('button')).find((b) => /创建目标/.test(b.textContent || ''));
  return { disabled: btn?.disabled === true, text: (s.textContent || '').replace(/\s+/g, ' ') };
});
check('目标值 = 当前值时创建按钮被禁用', guarded.disabled === true);
check('并给出明确提示', guarded.text.includes('不能和当前值一样'), guarded.text.match(/目标值不能[^。]*。/)?.[0] ?? '');
await page.keyboard.press('Escape');
await sleep(600);

/* ---------- ⑨ 持久化 + 旧数据兼容 ---------- */
console.log('\n=== ⑨ 持久化与旧数据兼容 ===');
await page.reload({ waitUntil: 'load' });
await sleep(2500);
const reloaded = await state();
check('刷新后成果目标仍在（落盘正确）', (reloaded.goals || []).some((g) => g.kind === 'outcome'),
  `${(reloaded.goals || []).length} 个目标`);

// 旧数据：没有 kind 字段的目标必须仍按「计时目标」工作
const legacy = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  const id = st.addGoal({ title: '旧版目标', subject: '数学', plannedMinutes: 60 });
  const g = useStoreGoal(id);
  return { id, kind: g.kind, planned: g.plannedMinutes };
  function useStoreGoal(gid) {
    return window.__LOS__.useStore.getState().goals.find((x) => x.id === gid);
  }
});
check('新建的计时目标 kind = time', legacy.kind === 'time', String(legacy.kind));
check('计时目标的计划时长保持原值 60', legacy.planned === 60, String(legacy.planned));

/*
 * 真正模拟「旧存档」：手写一个**没有 kind / progress 字段**的目标。
 *
 * 必须开一个干净上下文并用 addInitScript 在**页面脚本之前**写入 ——
 * 直接在已加载的页面里改 localStorage 再 reload 会被上一个页面
 * 尚未落盘的 400ms 节流写入覆盖掉（坑 36 的姊妹坑，第一版就是这么误报的）。
 */
const baseState = await state();
const legacySeed = {
  ...baseState,
  goals: [
    {
      id: 'legacy1',
      title: '老存档里的目标',
      subject: '英语',
      plannedMinutes: 45,
      actualMinutes: 20,
      priority: 'normal',
      status: 'todo',
      createdAt: Date.now(),
      completedAt: null,
      // 故意不带 kind / progress —— 这就是加功能之前的存档样子
    },
  ],
  sessions: [],
};

const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await ctx2.newPage();
await p2.addInitScript((seed) => {
  try { localStorage.setItem('learning-os:v1:state', JSON.stringify(seed)); } catch { /* ignore */ }
}, legacySeed);
await p2.goto(`${BASE}#/goals`, { waitUntil: 'load' });
await sleep(2500);
const legacyText = (await p2.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ')));
const legacyGoal = await p2.evaluate(() => {
  const g = window.__LOS__.useStore.getState().goals[0];
  return g ? { kind: g.kind, planned: g.plannedMinutes, actual: g.actualMinutes } : null;
});
check('旧存档目标被当作计时目标（kind 缺省即 time）',
  legacyGoal && legacyGoal.kind !== 'outcome', JSON.stringify(legacyGoal));
/*
 * 计时目标的百分比**不在 DOM 文本里**（文本只有「20m / 45m」），
 * 它体现在进度条宽度上 —— 所以读 Progress 的 aria-valuenow。
 * 第一版这里断言「文本里含 44%」，抓到的是头部「总体完成率 0%」，
 * 属于断言写错，不是应用错。
 */
const barVals = await p2.evaluate(() =>
  Array.from(document.querySelectorAll('[role="progressbar"]')).map((b) =>
    Number(b.getAttribute('aria-valuenow')),
  ),
);
check('旧存档目标仍按计时口径算出 44%（进度条 aria-valuenow）', barVals.includes(44),
  `进度条数值 = [${barVals.join(', ')}]`);
check('旧存档目标显示的是时长而不是数值', /\d+m \/ 45m/.test(legacyText),
  legacyText.match(/\d+m \/ \d+m/)?.[0] ?? '');
await ctx2.close();

check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${OUT}/`);
if (failed) process.exit(1);
