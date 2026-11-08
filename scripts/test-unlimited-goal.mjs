/**
 * 「不限时长」的计时目标（1.3.0 新功能）
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求：设定目标可以不限时间。确认的方案：计时目标可选「不限」，
 * 用 `plannedMinutes: null` 表达（成果目标仍保持 0，那是历史约定，统计依赖它）。
 *
 * 这个用例守的是**真的一路生效**：存得进去、刷新还在、各处显示不出现「0m 计划」、
 * 而且**编辑之后不会被改回 30 分钟**（这是改类型时发现并修掉的真 bug：
 * store 里原来写「≤0 就改成 30」，会把"不限"悄悄改成 30 分钟）。
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
    s.sessions.forEach((x) => s.removeSession(x.id));
  });
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(1300);

  /* ---------- 通过界面创建一个「不限时长」的目标 ---------- */
  await p.getByRole('button', { name: '新建', exact: true }).click();
  await p.waitForTimeout(600);
  // 标题输入框：表单里第一个 input。注意不能写 input[type="text"] ——
  // 这个 input 没写 type 属性，DOM 里就没有该属性，选择器匹配不到（已踩）。
  const sheet = p.locator('[role="dialog"]');
  const titleInput = sheet.locator('input').first();
  await titleInput.fill('整理错题');
  await sheet.getByRole('button', { name: '不限时长', exact: true }).click();
  await p.waitForTimeout(300);
  check('点「不限时长」后，滑块与分钟框都消失（不再让人以为还要填）',
    await p.getByLabel('计划时长（分钟）').count() === 0 && await p.getByLabel('计划时长滑块').count() === 0);
  await sheet.locator('button', { hasText: /^创建目标$/ }).first().click();
  await p.waitForTimeout(800);

  const created = await p.evaluate(() => {
    const g = window.__LOS__.useStore.getState().goals.find((x) => x.title === '整理错题');
    return g ? { kind: g.kind ?? 'time', planned: g.plannedMinutes } : null;
  });
  check('创建成功且 plannedMinutes 是 null（不是 0、不是 30）',
    created !== null && created.planned === null && created.kind === 'time', JSON.stringify(created));

  /* ---------- 编辑一次：不能被改回 30 分钟（这是修掉的真 bug） ---------- */
  await p.locator('main button', { hasText: '整理错题' }).first().click();
  await p.waitForTimeout(700);
  check('再次打开表单时「不限时长」是选中态',
    await p.locator('[role="dialog"]').getByRole('button', { name: '不限时长', exact: true }).getAttribute('aria-pressed') === 'true');
  const editSheet = p.locator('[role="dialog"]');
  await editSheet.locator('input').first().fill('整理错题（改过名）');
  await editSheet.locator('button', { hasText: /^保存$/ }).first().click();
  await p.waitForTimeout(800);
  const afterEdit = await p.evaluate(() => {
    const g = window.__LOS__.useStore.getState().goals.find((x) => x.title.includes('整理错题'));
    return g ? g.plannedMinutes : 'missing';
  });
  check('编辑保存后仍然是 null（没有被悄悄改成 30 分钟）', afterEdit === null, `实际 ${JSON.stringify(afterEdit)}`);

  /* ---------- 刷新后仍是 null ---------- */
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(1200);
  check('刷新后仍是 null（存档不做归一化，null 能活下来）',
    (await p.evaluate(() => window.__LOS__.useStore.getState().goals[0]?.plannedMinutes)) === null);

  /* ---------- 各处显示不能出现「0m 计划」 ---------- */
  await p.goto('http://127.0.0.1:5188/#/goals');
  await p.waitForTimeout(1100);
  const goalsText = await p.evaluate(() => document.body.innerText);
  check('目标页显示「不限时长」，且不出现「计划 0m」',
    goalsText.includes('不限时长') && !/计划\s*0\s*m/.test(goalsText));
  check('目标页头部不出现「计划 0m」（只有不限时长目标时只报实际）',
    !/计划\s*0m/.test(goalsText));

  /* ---------- 首页：紧凑行只显示标题，但绝不能出现「计划 0m」 ---------- */
  await p.goto('http://127.0.0.1:5188/#/');
  await p.waitForTimeout(1300);
  const homeText = await p.evaluate(() => document.body.innerText);
  check('首页不出现「计划 0m」这种读数', !/计划\s*0\s*m/.test(homeText));
  check('不限时长的目标仍被推荐（「现在该做什么」里有它，没被当成已完成排除）',
    /现在该做什么[\s\S]{0,60}整理错题/.test(homeText));

  /* ---------- 开始学习弹层：显示「不限」而不是 0m ---------- */
  await p.goto('http://127.0.0.1:5188/#/timer');
  await p.waitForTimeout(1100);
  await p.locator('button', { hasText: /^开始学习$/ }).first().click();
  await p.waitForTimeout(800);
  const sheetText = await p.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').replace(/\s+/g, ' '));
  /*
   * 精确读**目标行自身**的文本再断言。
   * 不能只查整个弹层里有没有「不限」—— 弹层的「目标时长」选择器本来就有「不限」选项
   * （那是"计时提醒多长"，和目标的"计划时长"是两件事），整层查会被它蒙对。
   */
  const goalRowText = await p
    .locator('[role="dialog"] button', { hasText: '整理错题' })
    .first()
    .textContent();
  check('目标行显示「不限」而不是 0m',
    /不限/.test(goalRowText ?? '') && !/0m/.test(goalRowText ?? ''), (goalRowText ?? '').replace(/\s+/g, ' ').trim());
  check('开始学习弹层里不出现「0m」', !/\b0m\b/.test(sheetText));

  /* ---------- 计时器：关联它时不显示「X 计划」 ---------- */
  await p.locator('[role="dialog"] button', { hasText: '整理错题' }).first().click();
  await p.waitForTimeout(400);
  await p.locator('[role="dialog"] button', { hasText: /^开始计时$/ }).first().click();
  await p.waitForTimeout(1200);
  const timerLine = await p.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(
      (x) => x.children.length === 0 && (x.textContent || '').trim().startsWith('目标：'),
    );
    return el ? (el.parentElement?.textContent ?? '').replace(/\s+/g, ' ') : '(未找到目标行)';
  });
  check('计时器的目标行显示目标名但不出现「X 计划」',
    timerLine.includes('整理错题') && !timerLine.includes('计划'), timerLine);
  await p.screenshot({ path: '.preview/unlimited-timer.png' });
  await p.evaluate(() => window.__LOS__.useStore.getState().cancelTimer?.());

  /* ---------- 统计页：计划不含它，实际含它 ---------- */
  await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    const g = s.goals[0];
    s.updateGoal(g.id, { actualMinutes: 45 });
  });
  await p.goto('http://127.0.0.1:5188/#/stats');
  await p.waitForTimeout(1300);
  const stats = await p.evaluate(() => window.__LOS__.useStore.getState().goals[0]);
  check('不限时长的目标不产生「计划时长」但保留「实际时长」',
    stats.plannedMinutes === null && stats.actualMinutes === 45, JSON.stringify(stats));

  /* ---------- 推荐：不限时长的目标仍然会被推荐（不被"计划已完成"排除） ---------- */
  const suggested = await p.evaluate(async () => {
    const m = await import('/src/lib/suggest.ts');
    const s = window.__LOS__.useStore.getState();
    const list = m.suggestNext({
      goals: s.goals, todaySessions: [], todayMinutes: 0, remainingMinutes: 300,
      dailyGoalMinutes: 180, nowTs: Date.now(),
    });
    return list.map((x) => x.goal?.title ?? x.title ?? '');
  });
  check('不限时长的目标出现在推荐里（不会被当成"已超额完成"排除）',
    suggested.some((t) => String(t).includes('整理错题')), JSON.stringify(suggested));

  /* ---------- 成果目标仍是 0，两者没被混为一谈 ---------- */
  const mixup = await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    const id = s.addGoal({ title: '数学考到 90', subject: '数学', kind: 'outcome', plannedMinutes: 0, priority: 'normal', status: 'todo', progress: { start: 60, current: 60, target: 90 } });
    const g = window.__LOS__.useStore.getState().goals.find((x) => x.id === id);
    return { kind: g.kind, planned: g.plannedMinutes };
  });
  check('成果目标依然钉成 0（不是 null）—— 两种"没有计划"没有混用',
    mixup.kind === 'outcome' && mixup.planned === 0, JSON.stringify(mixup));

  check('无运行时错误', errors.length === 0, errors.slice(0, 1).join(' | '));
  await p.screenshot({ path: '.preview/unlimited-goal.png' });
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
