/**
 * 学习评价 · 语言模板层测试（规格书场景 12、14 + 文字质量）
 * ──────────────────────────────────────────────────────────────────────────────
 * 规格书对这一层的要求，逐条验：
 *   · 三段式：今日表现 / 值得关注的地方 / 下一步建议
 *   · 多套语句 + 组合策略
 *   · **同一组数据核心结论一致，只改表达方式**（场景 12：多次重新生成）
 *   · 避免「非常棒」「继续加油」「相信自己」等套话
 *   · 不把学习时长等同于学习效率
 *   · 不在缺乏证据时推测情绪/态度/能力
 *   · 场景 14：四种语气模式各自表现正常，且**换模式不改结论**
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

/* 几组典型事实：正常一天 / 超额 / 数据不足 / 没记录 */
const cases = {
  正常: { sessions: [session(NOW - 3600000, 45)], tasks: [task('a', true), task('b', true), task('c', false)], dailyGoalMinutes: 60 },
  超额: { sessions: [session(NOW - 3600000, 120)], tasks: [], dailyGoalMinutes: 60 },
  波动: { sessions: [10, 120, 10, 120, 10].map((m, i) => session(NOW - i * DAY - 3600000, m)), tasks: [], dailyGoalMinutes: 60 },
  没记录: { sessions: [], tasks: [], dailyGoalMinutes: 60 },
  连续: { sessions: [0, 1, 2, 3, 4, 5].map((i) => session(NOW - i * DAY - 3600000, 45)), tasks: [], dailyGoalMinutes: 40 },
};

const b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  await p.goto('http://127.0.0.1:5188/#/');
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);

  const run = (caseData, seeds, tones) =>
    p.evaluate(async ([c, nowTs, seeds, tones]) => {
      const ev = await import('/src/lib/evaluate.ts');
      const tx = await import('/src/lib/evaluateText.ts');
      const facts = ev.computeEvalFacts({
        sessions: c.sessions,
        goals: [],
        tasks: c.tasks,
        settings: { dailyGoalMinutes: c.dailyGoalMinutes, theme: 'soft' },
        dayOverrides: [],
        nowTs,
      });
      const out = [];
      for (const tone of tones) {
        for (const seed of seeds) {
          out.push({ tone, seed, ...tx.buildEvaluation(facts, { tone, seed }) });
        }
      }
      return out;
    }, [caseData, NOW, seeds, tones]);

  /* ---------- 三段式 ---------- */
  const normal = await run(cases['正常'], [1], ['concise']);
  const ev0 = normal[0];
  check('三段都在（今日表现 / 值得关注 / 下一步建议）', !!ev0.parts.today && !!ev0.parts.watch && !!ev0.parts.next, JSON.stringify(ev0.parts));
  check('带关键表现标签（复用引擎给的标签）', Array.isArray(ev0.tags), JSON.stringify(ev0.tags));
  check('有标题', typeof ev0.title === 'string' && ev0.title.length > 0, ev0.title);

  /* ---------- 场景 12：多次重新生成 → 结论不变、措辞会变 ---------- */
  const many = await run(cases['正常'], [1, 2, 3, 4, 5, 6, 7, 8], ['concise']);
  const conclusions = new Set(many.map((x) => JSON.stringify(x.conclusion)));
  check('场景⑫ 换 8 个种子 → 核心结论**始终一致**', conclusions.size === 1, [...conclusions][0]);
  const words = new Set(many.map((x) => JSON.stringify(x.parts)));
  check('场景⑫ 换 8 个种子 → 措辞**至少出现过不同版本**（不是永远同一句）', words.size > 1, `不同措辞 ${words.size} 种`);
  check('场景⑫ 但不会每句都换（保持核心结论同一批事实）', many.every((x) => x.conclusion.duration === ev0.conclusion.duration), '');
  const same1 = await run(cases['正常'], [3], ['concise']);
  const same2 = await run(cases['正常'], [3], ['concise']);
  check('场景⑫ 同一种子 → 完全可复现（同输入同输出）', JSON.stringify(same1[0].parts) === JSON.stringify(same2[0].parts));

  /* ---------- 场景 14：四种语气模式 ---------- */
  const tones = await run(cases['正常'], [1], ['concise', 'detailed', 'gentle', 'objective']);
  const byTone = Object.fromEntries(tones.map((t) => [t.tone, t]));
  check('场景⑭ 四种模式都能生成且三段齐全', tones.every((t) => t.parts.today && t.parts.watch && t.parts.next), JSON.stringify(tones.map((t) => t.tone)));
  check('场景⑭ 详细模式确实更详细（比简洁长）', byTone['detailed'].parts.today.length > byTone['concise'].parts.today.length, `${byTone['detailed'].parts.today.length} vs ${byTone['concise'].parts.today.length}`);
  check('场景⑭ 标题能区分模式', byTone['detailed'].title !== byTone['concise'].title, `${byTone['detailed'].title} / ${byTone['concise'].title}`);
  const toneConclusions = new Set(tones.map((t) => JSON.stringify(t.conclusion)));
  check('场景⑭ **换模式不改结论**（事实唯一）', toneConclusions.size === 1, [...toneConclusions][0]);
  check('场景⑭ 温和模式也不隐瞒问题（"值得关注"段仍在）', byTone['gentle'].parts.watch.length > 0, byTone['gentle'].parts.watch);
  check('场景⑭ 客观模式不出现"值得记下来"这类鼓励性措辞', !byTone['objective'].parts.today.includes('值得记下来'), byTone['objective'].parts.today);

  /* ---------- 文字质量：套话、效率、情绪推测 ---------- */
  const allText = (await run(cases['正常'], [1, 2, 3], ['concise', 'detailed', 'gentle', 'objective'])).map((x) => JSON.stringify(x.parts)).join(' ');
  const allText2 = (await run(cases['波动'], [1, 2], ['concise'])).map((x) => JSON.stringify(x.parts)).join(' ');
  const allText3 = (await run(cases['没记录'], [1], ['concise'])).map((x) => JSON.stringify(x.parts)).join(' ');
  const banned = ['非常棒', '继续加油', '相信自己', '棒极了', '加油', '努力', '懒惰', '态度', '天赋', '聪明', '效率'];
  const hit = banned.filter((w) => (allText + allText2 + allText3).includes(w));
  check('文字里没有套话/情绪推测/效率暗示（禁用词表）', hit.length === 0, hit.join(' / ') || '干净');

  /* ---------- 没记录时不编造数字 ---------- */
  const empty = (await run(cases['没记录'], [1], ['concise']))[0];
  check('没记录时"今日表现"不出现"分钟"之类的编造数字', !/学了\s*\d+\s*分钟/.test(empty.parts.today), empty.parts.today);
  check('没记录时仍给出可执行建议（不空着）', empty.parts.next.length > 0, empty.parts.next);

  /* ---------- 超额时不给"再多学"的建议（规格书：避免鼓励无节制延长） ---------- */
  const over = (await run(cases['超额'], [1, 2, 3, 4], ['concise']))[0];
  /*
   * 判据是语义，不是某一句原文：
   *   · 必须明确"不用再加量"这一类（含多种说法）
   *   · 且不能出现"再开一段/补上/再多学"这类催促
   * 第一版把判据写成几条固定词组，结果在新说法「今天不用再加量」上假失败。
   */
  check(
    '超额时建议是"不用再加量"这一类',
    /不用再加|不用再往上加|不用堆时长|够了|留给休息/.test(over.parts.next) && !/再开一段|补上|再多学/.test(over.parts.next),
    over.parts.next,
  );

  /* ---------- 打印几条真实生成结果（人眼看一下像不像人话） ---------- */
  console.log('\n--- 抽样看文字（正常一天 · 简洁 · 种子 1）---');
  console.log('  标题：' + ev0.title);
  console.log('  今日表现：' + ev0.parts.today);
  console.log('  值得关注：' + ev0.parts.watch);
  console.log('  下一步建议：' + ev0.parts.next);
  console.log('  标签：' + JSON.stringify(ev0.tags));
  const w = (await run(cases['波动'], [2], ['concise']))[0];
  console.log('--- 抽样看文字（时长波动 · 种子 2）---');
  console.log('  今日表现：' + w.parts.today);
  console.log('  值得关注：' + w.parts.watch);
  console.log('  下一步建议：' + w.parts.next);
  console.log('--- 抽样看文字（今天没记录）---');
  console.log('  今日表现：' + empty.parts.today);
  console.log('  下一步建议：' + empty.parts.next);

  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
