/**
 * 作业清单页
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求：新增一页「作业清单」（按科目分组勾选 + 进度条）。
 * 设计决定：**复用现有 Goal 数据**（subject 分组、setGoalStatus 勾选），不新建模型；
 * 口径与目标页「今天」页签共用 lib/goals.ts 的 isTodayGoal（单一来源）。
 *
 * 验：
 *  ① 按科目分组正确（含"其他"兜底）
 *  ② 整体进度 = 已完成/总数，且百分比与数字都显示
 *  ③ 勾选真的改目标状态（不是只改本地复选框）→ 首页进度/统计会跟着动
 *  ④ 取消勾选可回退
 *  ⑤ 刷新后状态仍在（存进了本机）
 *  ⑥ 空清单有引导，不显示假的进度
 *  ⑦ 无运行时错误
 */
import assert from 'node:assert/strict';
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';

const BASE = 'http://127.0.0.1:5188';
let n = 0;
const check = (name, ok, detail = '') => {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  n++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 150);
    if (/net::ERR_|Failed to load resource|CORS/i.test(t)) return;
    errors.push(`[console] ${t}`);
  });
  await acknowledgeReleaseNotes(p);
  await p.goto(`${BASE}/#/goals`);
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);

  /* ---------- 种数据：3 个科目、5 条，其中 2 条已完成 ---------- */
  await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    s.patchSettings({ onboarded: true, theme: 'soft', motion: false });
    for (const g of s.goals) s.removeGoal(g.id);
    const mk = (title, subject, done) => {
      const id = s.addGoal({ title, subject, plannedMinutes: null });
      if (done) window.__LOS__.useStore.getState().setGoalStatus(id, 'done');
    };
    mk('阶段综合测试卷（含作文）', '语文', true);
    mk('词汇小卷 1~5 页', '英语', false);
    mk('电学卷子 3 张', '物理', true);
    mk('课后题', '物理', false);
    mk('没有科目的杂事', '', false);
  });
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1200);

  /* ---------- 进清单页 ---------- */
  await p.goto(`${BASE}/#/checklist`, { waitUntil: 'load' });
  await sleep(1500);
  await p.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('知道了'))?.click();
  });
  await sleep(600);

  const text = () => p.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
  const progress = () => p.evaluate(() => {
    const el = document.querySelector('[data-testid="checklist-progress"]');
    return el ? el.textContent.replace(/\s+/g, ' ') : null;
  });
  const storeDone = () =>
    p.evaluate(() => window.__LOS__.useStore.getState().goals.filter((g) => g.status === 'done').length);

  /* ---------- ① 分组 ---------- */
  const t0 = await text();
  check('页面标题是「作业清单」', t0.includes('作业清单'), t0.slice(0, 40));
  for (const subj of ['语文', '英语', '物理', '其他']) {
    check(`按科目分组里出现「${subj}」`, t0.includes(subj));
  }

  /* ---------- ② 进度 ---------- */
  const p0 = await progress();
  check('整体进度显示「已完成 2 / 5 项」', !!p0 && p0.includes('2 / 5'), p0 ?? '(没有进度卡)');
  check('整体进度百分比是 40%', !!p0 && p0.includes('40%'), p0 ?? '');

  /* ---------- ③ 勾选真的改状态 ---------- */
  const doneBefore = await storeDone();
  await p.getByRole('checkbox', { name: /词汇小卷/ }).click();
  await sleep(700);
  const doneAfter = await storeDone();
  check('勾选一条 → 目标状态真的变成 done', doneAfter === doneBefore + 1, `${doneBefore} → ${doneAfter}`);
  const p1 = await progress();
  check('进度跟着更新为「3 / 5」', !!p1 && p1.includes('3 / 5'), p1 ?? '');

  /* ---------- ④ 取消勾选可回退 ---------- */
  await p.getByRole('checkbox', { name: /词汇小卷/ }).click();
  await sleep(700);
  check('再点一次 → 回到未完成', (await storeDone()) === doneBefore, `现在 ${await storeDone()}`);

  /* ---------- ⑤ 刷新后仍在 ---------- */
  await p.getByRole('checkbox', { name: /课后题/ }).click();
  await sleep(700);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1200);
  const p2 = await progress();
  check('刷新后勾选仍在（进度 3 / 5）', !!p2 && p2.includes('3 / 5'), p2 ?? '');

  /* ---------- ⑥ 空清单 ---------- */
  await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    for (const g of s.goals) s.removeGoal(g.id);
  });
  await sleep(800);
  const tEmpty = await text();
  check('空清单给出引导而不是假的进度', tEmpty.includes('今天还没有要做的作业') && tEmpty.includes('去目标里新建'), tEmpty.slice(0, 60));

  await p.screenshot({ path: '.preview/checklist.png' });
  check('无运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
