/**
 * 「起床」时间真的有作用了（1.3.0 修 Bug ⑦）
 * ──────────────────────────────────────────────────────────────────────────────
 * 修之前：`wakeTime`（起床）**只存不算** —— 用户填了完全没反应，是个死控件，
 * 比没有这个字段更糟。不能靠删掉解决（会丢用户已填的数据）。
 *
 * 修法：给它真实作用 —— 检查学习窗口是否落在「起床 ~ 睡觉」之内，超出就提示。
 * **只提示，不改任何计算口径**（可支配时间仍是「窗口 − 上课 − 固定活动」）。
 *
 * 这个用例守两件事：
 *   ① 字段真的被用上了（改它会改变提示）；
 *   ② 它**没有**偷偷影响任何数字（只改起床时间，可支配必须一动不动）。
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
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    s.patchSettings({
      onboarded: true, theme: 'pure-light', colorMode: 'light',
      blocks: [], byWeekday: null, dailyGoalMinutes: 120,
    });
    s.patchBackground({ current: 'none' });
  });
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1300);

  const pageText = async () => (await p.locator('main').innerText()).replace(/\s+/g, ' ');
  /** 首页某个统计项的分钟数 */
  const statMinutes = async (label) =>
    p.evaluate((lb) => {
      const el = [...document.querySelectorAll('p')].find((x) => (x.textContent || '').trim() === lb);
      if (!el) return null;
      const v = el.nextElementSibling?.textContent ?? '';
      const m = v.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/);
      return (Number(m?.[1] ?? 0) * 60) + Number(m?.[2] ?? 0);
    }, label);

  /* ---------- 窗口 06:00–22:00，起床 06:40 → 应提示"早于起床" ---------- */
  await p.getByLabel('开始').fill('06:00');
  await p.getByLabel('结束').fill('22:00');
  await p.getByLabel('起床').fill('06:40');
  await p.getByLabel('睡觉').fill('22:30');
  await sleep(800);

  const t1 = await pageText();
  check('窗口开始早于起床 → 出现提示', t1.includes('早于起床时间 06:40'), t1.match(/学习窗口从[^。]*。/)?.[0] ?? '');
  check('提示把"在睡觉"的时长说具体（06:00→06:40 = 40m）',
    /约\s*40m\s*在睡觉/.test(t1) || /约\s*40\s*m/.test(t1), t1.match(/约[^）]*在睡觉/)?.[0] ?? '');

  /* ---------- 关键：改起床时间 → 提示消失，证明字段真的被用了 ---------- */
  await p.getByLabel('起床').fill('05:30');
  await sleep(800);
  const t2 = await pageText();
  check('把起床改到 05:30（早于窗口）后提示消失 —— 说明这个字段真的被用上了',
    !t2.includes('早于起床时间'), t2.match(/学习窗口从[^。]*。/)?.[0] ?? '(无提示)');

  /* ---------- 窗口结束晚于睡觉 → 另一条提示 ---------- */
  await p.getByLabel('睡觉').fill('21:00');
  await sleep(800);
  const t3 = await pageText();
  check('窗口结束晚于睡觉 → 出现提示', t3.includes('晚于睡觉时间 21:00'), t3.match(/学习窗口到[^。]*。/)?.[0] ?? '');

  /* ---------- 只改起床时间，可支配时间必须一动不动 ---------- */
  await p.getByLabel('起床').fill('04:00');
  await sleep(700);
  const availA = await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState().settings;
    return s.wakeTime;
  });
  await p.goto('http://127.0.0.1:5188/#/');
  await sleep(1400);
  const availA2 = await statMinutes('课后可支配');
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await sleep(1000);
  await p.getByLabel('起床').fill('08:00');
  await sleep(700);
  await p.goto('http://127.0.0.1:5188/#/');
  await sleep(1400);
  const availB = await statMinutes('课后可支配');
  check('只改起床时间不会影响「课后可支配」（它只是提示，不改计算口径）',
    availA2 === availB && availA2 !== null, `起床 04:00 时 ${availA2} 分钟 / 起床 08:00 时 ${availB} 分钟`);

  /* ---------- 文案说明它做什么、不做什么 ---------- */
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await sleep(1100);
  const t4 = await pageText();
  check('卡片写明「起床」用来检查清醒时段，且不参与可支配计算',
    t4.includes('检查上面两项是否落在清醒时段内') && t4.includes('不参与'),
    t4.match(/起床时间用来[^。]*。/)?.[0] ?? '');
  check('「起床」字段被真实保存（不是只改 UI）',
    (await p.evaluate(() => window.__LOS__.useStore.getState().settings.wakeTime)) === '08:00');

  /* ---------- 一切合理时不应该有提示 ---------- */
  await p.getByLabel('开始').fill('07:00');
  await p.getByLabel('结束').fill('20:00');
  await p.getByLabel('起床').fill('06:30');
  await p.getByLabel('睡觉').fill('22:00');
  await sleep(900);
  const t5 = await pageText();
  check('窗口完全落在清醒时段内时两条提示都不出现',
    !t5.includes('早于起床时间') && !t5.includes('晚于睡觉时间'));
  await p.screenshot({ path: '.preview/awake-window.png' });

  check('无运行时错误', errors.length === 0, errors.slice(0, 1).join(' | '));
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
