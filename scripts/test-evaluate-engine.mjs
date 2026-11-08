/**
 * 学习评价 · 规则引擎测试（浏览器内 import 引擎，断言在 Node 侧）
 * ──────────────────────────────────────────────────────────────────────────────
 * 规格书「八、测试与质量要求」的 14 个场景：1~11 属于规则引擎（本文件），
 * 12/14 属于模板层、13 属于界面，分别在各自的测试里覆盖。
 *
 * 为什么跑在浏览器里而不是纯 Node：应用源码用的是**无扩展名导入**（`./time`），
 * Node 的 ESM 解析器不认（第一次就这么失败了），而 Vite 认 —— 项目里其它测试
 * 也都是在页面里 `import('/src/...')`。所以这里把场景数据传进页面、在页面里跑引擎、
 * 把事实结果传回 Node 断言。
 *
 * 另外重点验规格书里几条"不许越界"的硬约束。
 */
import assert from 'node:assert/strict';
import { chromium } from './browser.mjs';

let n = 0;
function check(name, ok, detail = '') {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  n++;
}

const DAY = 86400000;
const NOW = new Date(2026, 9, 4, 12, 0, 0).getTime();

const session = (startedAt, minutes, subject = '数学') => ({
  id: `s${startedAt}-${subject}`,
  subject,
  goalId: null,
  startedAt,
  endedAt: startedAt + minutes * 60000,
  durationSec: minutes * 60,
  source: 'timer',
});
const task = (id, done) => ({ id, title: id, done, createdAt: NOW, doneAt: done ? NOW : null });

const cases = [];
const add = (name, opts) => cases.push({ name, ...opts });

/* 1 超过计划 / 2 达到 / 3 明显低于 / 4 没有计划 / 5 没有记录 */
add('超过计划', { sessions: [session(NOW - 3600000, 90)], tasks: [], dailyGoalMinutes: 60 });
add('达到计划', { sessions: [session(NOW - 3600000, 60)], tasks: [], dailyGoalMinutes: 60 });
add('明显低于', { sessions: [session(NOW - 3600000, 20)], tasks: [], dailyGoalMinutes: 60 });
add('没有计划', { sessions: [session(NOW - 3600000, 30)], tasks: [], dailyGoalMinutes: 0 });
add('没有记录', { sessions: [], tasks: [], dailyGoalMinutes: 60 });
/* 6 任务全部 / 7 部分 / 7b 任务太少 */
add('任务全完成', { sessions: [session(NOW - 3600000, 60)], tasks: [task('a', true), task('b', true), task('c', true)], dailyGoalMinutes: 60 });
add('任务大部分', { sessions: [session(NOW - 3600000, 60)], tasks: [task('a', true), task('b', true), task('c', true), task('d', false)], dailyGoalMinutes: 60 });
add('任务很少', { sessions: [session(NOW - 3600000, 60)], tasks: [task('a', true), task('b', true)], dailyGoalMinutes: 60 });
/* 8 连续多天 */
add('连续五天', { sessions: [0, 1, 2, 3, 4].map((i) => session(NOW - i * DAY - 3600000, 45)), tasks: [], dailyGoalMinutes: 40 });
/* 9 明显波动 */
add('时长波动', { sessions: [10, 120, 10, 120, 10].map((m, i) => session(NOW - i * DAY - 3600000, m)), tasks: [], dailyGoalMinutes: 60 });
/* 10 历史不足 */
add('历史不足', { sessions: [session(NOW - 3600000, 30)], tasks: [], dailyGoalMinutes: 60 });
/* 11 某学科明显减少（与"自己"比） */
{
  const s = [];
  for (let i = 1; i <= 20; i++) {
    s.push(session(NOW - i * DAY - 7200000, 60, '数学'));
    s.push(session(NOW - i * DAY - 3600000, 60, '英语'));
  }
  s.push(session(NOW - 3600000, 60, '数学'));
  add('学科减少', { sessions: s, tasks: [], dailyGoalMinutes: 60 });
}
/* 边界：没计划没记录 */
add('空数据', { sessions: [], tasks: [], dailyGoalMinutes: 0 });

const b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  await p.goto('http://127.0.0.1:5188/#/');
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);

  const result = await p.evaluate(async ([cases, nowTs]) => {
    const m = await import('/src/lib/evaluate.ts');
    return {
      facts: cases.map((c) =>
        m.computeEvalFacts({
          sessions: c.sessions,
          goals: [],
          tasks: c.tasks,
          settings: { dailyGoalMinutes: c.dailyGoalMinutes, theme: 'soft' },
          dayOverrides: [],
          nowTs,
        }),
      ),
      canEvaluate: cases.map((c) =>
        m.canEvaluate(
          m.computeEvalFacts({
            sessions: c.sessions,
            goals: [],
            tasks: c.tasks,
            settings: { dailyGoalMinutes: c.dailyGoalMinutes, theme: 'soft' },
            dayOverrides: [],
            nowTs,
          }),
        ),
      ),
      thresholds: m.EVAL,
    };
  }, [cases, NOW]);

  const F = Object.fromEntries(cases.map((c, i) => [c.name, result.facts[i]]));

  check('① 超过计划 → over + 超额标签', F['超过计划'].durationLevel === 'over' && F['超过计划'].tags.includes('超额完成'), `ratio=${F['超过计划'].ratio}`);
  check('① 超额阈值集中在 EVAL', result.thresholds.overRatio === 1.25, `overRatio=${result.thresholds.overRatio}`);
  check('② 达到计划 → met', F['达到计划'].durationLevel === 'met', F['达到计划'].durationLevel);
  check('③ 明显低于计划 → below（只给事实）', F['明显低于'].durationLevel === 'below', F['明显低于'].durationLevel);
  check('④ 没有计划 → no-plan 且 ratio=null', F['没有计划'].durationLevel === 'no-plan' && F['没有计划'].ratio === null, `${F['没有计划'].durationLevel} ratio=${F['没有计划'].ratio}`);
  check('⑤ 没有记录 → no-record 且无任何表现标签', F['没有记录'].durationLevel === 'no-record' && F['没有记录'].tags.length === 0, JSON.stringify(F['没有记录'].tags));

  check('⑥ 任务全部完成 → all + 标签', F['任务全完成'].taskLevel === 'all' && F['任务全完成'].tags.includes('任务全部完成'), `${F['任务全完成'].taskDone}/${F['任务全完成'].taskTotal}`);
  check('⑦ 大部分完成 → most', F['任务大部分'].taskLevel === 'most', `${F['任务大部分'].taskDone}/${F['任务大部分'].taskTotal}`);
  check('⑦b 任务只有 2 个 → 标记不足以解读百分比，且不给按比例的标签', F['任务很少'].taskCountMeaningful === false && !F['任务很少'].tags.includes('任务大部分完成'), `total=${F['任务很少'].taskTotal}`);

  check('⑧ 连续 5 天 → streak=5 + 连续标签', F['连续五天'].streak === 5 && F['连续五天'].tags.some((t) => t.startsWith('连续')), `streak=${F['连续五天'].streak}`);
  check('⑧ 历史足够 → hasHistory', F['连续五天'].hasHistory === true, `activeDays7=${F['连续五天'].activeDays7}`);
  check('⑨ 明显波动 → fluctuating + 波动标签', F['时长波动'].habitLevel === 'fluctuating' && F['时长波动'].tags.includes('时长波动'), `cv=${F['时长波动'].fluctuation}`);

  check('⑩ 历史不足 → 不做趋势判断（habit unknown）', F['历史不足'].habitLevel === 'unknown', `activeDays7=${F['历史不足'].activeDays7}`);
  check('⑩ 进步结论也为 unknown', F['历史不足'].progressLevel === 'unknown', F['历史不足'].progressLevel);
  check('⑩ 上周没数据 → 与上周比不编结论（null）', F['历史不足'].vsLastWeek === null, String(F['历史不足'].vsLastWeek));

  check('⑪ 学科只剩一门 → subjectCount=1 且报告"集中"事实', F['学科减少'].subjectCount === 1 && F['学科减少'].tags.includes('集中在数学'), JSON.stringify(F['学科减少'].tags));
  check('⑪ 输出里不含"不足"这类评判字样（只陈述事实）', !JSON.stringify(F['学科减少']).includes('不足'), '');

  const emptyIdx = cases.findIndex((c) => c.name === '空数据');
  check('边界：没计划没记录 → canEvaluate=false（界面应给引导）', result.canEvaluate[emptyIdx] === false, '');

  const again = await p.evaluate(async ([c, nowTs]) => {
    const m = await import('/src/lib/evaluate.ts');
    const f = () => m.computeEvalFacts({ sessions: c.sessions, goals: [], tasks: c.tasks, settings: { dailyGoalMinutes: c.dailyGoalMinutes, theme: 'soft' }, dayOverrides: [], nowTs });
    return JSON.stringify(f()) === JSON.stringify(f());
  }, [cases[1], NOW]);
  check('纯函数：同输入两次结果完全一致（可预测、可测试）', again === true);

  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
