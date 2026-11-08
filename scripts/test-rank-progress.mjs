/**
 * 名次类成果目标的进度要「讲得清」（1.3.0 修 Bug ②）
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户报：名次目标的进度显示 80%，看着不对。
 *
 * 实测结论：**公式本身没错**，`(当前 − 起始) ÷ (目标 − 起始)`，80% 只可能来自
 * 「起始记成了 21」这一种情况（创建目标时人在 21 名，后来进步到 5 名）。
 * 真正的问题是**界面上看不出起点在哪** —— 数字无法自证。
 *
 * 所以修法不是改公式，而是：
 *   ① 把推导写到界面上（从 X 起 · 已前进 N · 还差 M）；
 *   ② 把「起始值」改成可编辑 —— 原来只能创建时记录一次、改不了，
 *      记错就永久错，只能删了重建（会丢进度）。
 * 本用例复现用户那个确切场景，并验证两条修法都生效。
 */
import assert from 'node:assert/strict';
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';

const b = await chromium.launch({ headless: true });
let n = 0;
const check = (name, ok, detail = '') => {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  n++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await acknowledgeReleaseNotes(p);
  await p.goto('http://127.0.0.1:5188/#/goals');
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    s.patchSettings({ onboarded: true, theme: 'pure-light', colorMode: 'light' });
    s.patchBackground({ current: 'none' });
    s.goals.forEach((g) => s.removeGoal(g.id));
  });
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1300);

  const sheet = () => p.locator('[role="dialog"]');
  const rowText = async () =>
    (await p.locator('main').innerText()).replace(/\s+/g, ' ');

  /* ---------- 复现：创建时在 21 名，目标 1 名 ---------- */
  await p.locator('button', { hasText: /^新建$/ }).first().click();
  await sleep(600);
  await sheet().locator('input').first().fill('期中名次');
  await p.locator('[role="dialog"] button', { hasText: '成果目标' }).first().click();
  await sleep(300);
  await sheet().locator('input[placeholder="比如 25"]').fill('21');
  await sheet().locator('input[placeholder="比如 10"]').fill('1');
  await sheet().locator('input[placeholder="名 / 套 / 分 / 个"]').fill('名');
  await p.locator('[role="dialog"] button', { hasText: /^创建目标$/ }).first().click();
  await sleep(1200);

  const created = await p.evaluate(() => window.__LOS__.useStore.getState().goals[0]?.progress);
  check('创建时起始值记成当时的当前值 21', created?.start === 21 && created?.current === 21, JSON.stringify(created));

  /* ---------- 进步到第 5 名：这就是用户看到 80% 的那一刻 ---------- */
  await p.locator('main button', { hasText: '期中名次' }).first().click();
  await sleep(900);
  await sheet().locator('input[placeholder="比如 25"]').fill('5');
  await p.locator('[role="dialog"] button', { hasText: /^保存$/ }).first().click();
  await sleep(1200);

  const row = await rowText();
  check('显示 80%（(21−5)/(21−1)）', row.includes('80%'), row.match(/\d+%/g)?.join(',') ?? '');
  check('界面上写明起点：从 21 名起步', row.includes('从 21 名起步'), row.slice(0, 200));
  check('界面上写明已前进 16 名', row.includes('已前进 16 名'));
  check('界面上写明还差 4 名', row.includes('还差 4 名'));
  await p.screenshot({ path: '.preview/rank-progress.png' });

  /* ---------- 编辑表单：起始值可改，且写明算式 ---------- */
  await p.locator('main button', { hasText: '期中名次' }).first().click();
  await sleep(900);
  check('编辑表单里出现「起始值」输入框', await p.getByLabel('起始值').count() === 1);
  check('起始值预填成 21', (await p.getByLabel('起始值').inputValue()) === '21');
  const sheetText = await p.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').replace(/\s+/g, ' '));
  check('表单里写出算式：(21 − 5) ÷ (21 − 1) = 80%',
    /\(21 − 5\) ÷ \(21 − 1\) = 80%/.test(sheetText), sheetText.match(/现在：.*?%。/)?.[0] ?? sheetText.slice(0, 160));

  /* ---------- 起始值记错了 → 能改成 30，且百分比随之改变 ---------- */
  await p.getByLabel('起始值').fill('30');
  await p.locator('[role="dialog"] button', { hasText: /^保存$/ }).first().click();
  await sleep(1200);
  const afterFix = await p.evaluate(() => window.__LOS__.useStore.getState().goals[0]?.progress);
  check('起始值改成了 30 并被保存', afterFix?.start === 30, JSON.stringify(afterFix));
  const row2 = await rowText();
  // (30−5)/(30−1) = 86.2% → 86%
  check('百分比按新起始值重算成 86%', row2.includes('86%'), row2.match(/\d+%/g)?.join(',') ?? '');
  // 「还差」= 当前 − 目标 = 5 − 1 = 4（与起始值无关）；「已前进」= 起始 − 当前 = 30 − 5 = 25
  check('推导跟着更新：从 30 名起步 · 已前进 25 名 · 还差 4 名',
    row2.includes('从 30 名起步') && row2.includes('已前进 25 名') && row2.includes('还差 4 名'), row2.slice(0, 200));

  /* ---------- 起始值清空 → 沿用原来的 30，不会被打回当前值 ---------- */
  await p.locator('main button', { hasText: '期中名次' }).first().click();
  await sleep(900);
  await p.getByLabel('起始值').fill('');
  await p.locator('[role="dialog"] button', { hasText: /^保存$/ }).first().click();
  await sleep(1200);
  const afterEmpty = await p.evaluate(() => window.__LOS__.useStore.getState().goals[0]?.progress);
  check('清空起始值不会把进度打回 0%（沿用原值 30）',
    afterEmpty?.start === 30 && afterEmpty?.current === 5, JSON.stringify(afterEmpty));

  /* ---------- 刷新后仍然保留 ---------- */
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1300);
  const persisted = await p.evaluate(() => window.__LOS__.useStore.getState().goals[0]?.progress);
  check('刷新后起始值仍是 30', persisted?.start === 30, JSON.stringify(persisted));

  check('无运行时错误', errors.length === 0, errors.slice(0, 1).join(' | '));
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
