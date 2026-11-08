/**
 * 计划时长没有上限
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户反馈：目标表单的「计划时长」最长只有 4 小时，太短。
 *
 * 原来的实现是一个 `min=5 max=240` 的滑块，所以 240 分钟就是**硬上限**。
 * 现在的做法：滑块只管常用区间，旁边的数字框可以填任意分钟数；
 * 填超过 4 小时后滑块上限跟着抬高，保证滑块本身不失真。
 * 设置里「每天计划学习时长」同理（原来只能在 7 个快捷值里选）。
 *
 * 这个用例守的是**真的存进去并持久化**，而不是"界面上看着能填"。
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
  });
  await p.waitForTimeout(600);

  /* ---------- 目标表单 ---------- */
  await p.getByRole('button', { name: '新建', exact: true }).click();
  await p.waitForTimeout(600);
  const sheet = p.getByRole('dialog');
  const minutes = sheet.getByLabel('计划时长（分钟）');
  await minutes.waitFor();
  check('计划时长旁边有可填的分钟输入框', await minutes.count() === 1);

  const sliderMax = () => sheet.getByLabel('计划时长滑块').evaluate((el) => Number(el.max));
  check('常用区间滑块上限是 240（4 小时）', await sliderMax() === 240, `max=${await sliderMax()}`);

  // 填一个远超 4 小时的值
  await minutes.fill('600');
  await p.waitForTimeout(300);
  check('可以填 600 分钟（10 小时），不再被 4 小时挡住',
    await minutes.inputValue() === '600', await minutes.inputValue());
  check('超长值下滑块上限自动抬到 600，滑块不会失真',
    await sliderMax() === 600, `max=${await sliderMax()}`);
  check('时长以「10 小时」可读形式回显',
    await sheet.getByText('10 小时', { exact: true }).count() > 0);
  await p.screenshot({ path: '.preview/goal-duration-600.png' });

  await sheet.getByLabel('目标名称').fill('假期冲刺');
  await p.getByRole('button', { name: /保存|创建/ }).first().click();
  await p.waitForTimeout(800);

  const saved = await p.evaluate(() => {
    const g = window.__LOS__.useStore.getState().goals[0];
    return g ? { title: g.title, planned: g.plannedMinutes } : null;
  });
  check('保存后真的写入了 600 分钟', saved?.planned === 600, JSON.stringify(saved));

  // 刷新后仍在（证明不是只改了内存）
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(1100);
  check('刷新后仍是 600 分钟（已持久化）',
    (await p.evaluate(() => window.__LOS__.useStore.getState().goals[0]?.plannedMinutes)) === 600);

  /* ---------- 清空不该写出 0 分钟的目标 ---------- */
  await p.evaluate(() => window.__LOS__.useStore.getState().goals.forEach((g) => window.__LOS__.useStore.getState().removeGoal(g.id)));
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: '新建', exact: true }).click();
  await p.waitForTimeout(600);
  const sheet2 = p.getByRole('dialog');
  await sheet2.getByLabel('计划时长（分钟）').fill('');
  await p.waitForTimeout(200);
  await sheet2.getByLabel('目标名称').fill('空时长的目标');
  await p.getByRole('button', { name: /保存|创建/ }).first().click();
  await p.waitForTimeout(800);
  const emptyPlanned = await p.evaluate(() => window.__LOS__.useStore.getState().goals[0]?.plannedMinutes);
  check('清空输入框不会写出 0 分钟的目标（兜底为 5）', emptyPlanned === 5, `planned=${emptyPlanned}`);

  /* ---------- 每日学习目标不设上限（1.3.0 已从「数据」搬到「作息」并改名为「每日学习目标」） ---------- */
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForTimeout(900);
  const daily = p.getByLabel('每日学习目标（分钟）');
  await daily.waitFor();
  await daily.fill('480');
  await p.waitForTimeout(600);
  check('每日学习目标可以填 480 分钟（8 小时，超出原来的 300 上限）',
    await p.evaluate(() => window.__LOS__.useStore.getState().settings.dailyGoalMinutes) === 480);
  check('回显成「8 小时」', await p.getByText(/8 小时/).count() > 0);
  await p.screenshot({ path: '.preview/settings-daily-goal-480.png' });
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(1100);
  check('刷新后仍是 480 分钟（已持久化）',
    (await p.evaluate(() => window.__LOS__.useStore.getState().settings.dailyGoalMinutes)) === 480);

  check('无运行时错误', errors.length === 0, errors.slice(0, 1).join(' | '));
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
