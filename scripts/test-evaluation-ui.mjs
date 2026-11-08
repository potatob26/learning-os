/**
 * 学习评价 · 界面测试（规格书场景 ⑫ 在真实界面里验 + 场景 ⑬ 的一部分）
 * ──────────────────────────────────────────────────────────────────────────────
 * 引擎与模板层各有单测；这里验"接进统计页之后"的行为：
 *   · 概览页出现评价卡，三段齐全，标签来自事实
 *   · **点「重新生成」只换说法、结论不变**（规格书场景 ⑫ 的界面版）
 *   · 没有计划也没有记录时 → 显示引导，**不硬编评价**（规格书硬约束）
 *   · 触摸目标 ≥44px、正文对比不依赖颜色仅靠亮度（低对比由 audit-quality 守着）
 *   · 场景 ⑬ 的深浅色：顺带在浅色与深色各跑一次，卡片都要正常渲染
 */
import assert from 'node:assert/strict';
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';

let n = 0;
function check(name, ok, detail = '') {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  n++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

/** 种一批真实感的数据：过去 7 天有记录（有起伏），今天 45 分钟，两条目标一完成一未完成 */
async function seed(page, withData) {
  await page.evaluate(
    ([now, day, withData]) => {
      const store = window.__LOS__.useStore;
      const s = store.getState();
      s.patchSettings({ onboarded: true, theme: 'soft', motion: false, dailyGoalMinutes: 90 });
      for (const g of store.getState().goals) store.getState().removeGoal(g.id);
      if (!withData) {
        store.setState({ sessions: [], tasks: [] });
        return;
      }
      const mins = [40, 70, 35, 80, 50, 60, 45];
      store.setState({
        sessions: mins.map((m, i) => {
          const started = now - i * day - 3 * 3600000;
          return {
            id: `s${i}`,
            subject: i % 2 === 0 ? '数学' : '英语',
            goalId: null,
            startedAt: started,
            endedAt: started + m * 60000,
            durationSec: m * 60,
            source: 'timer',
          };
        }),
      });
      const g1 = store.getState().addGoal({ title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60 });
      store.getState().setGoalStatus(g1, 'done');
      store.getState().addGoal({ title: '英语词汇 20 个', subject: '英语', plannedMinutes: 20 });
    },
    [Date.now(), DAY, withData],
  );
}

const card = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="evaluation-card"]');
  if (!el) return null;
  const part = (k) => el.querySelector(`[data-eval-part="${k}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return {
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    today: part('today'),
    watch: part('watch'),
    next: part('next'),
    tags: Array.from(el.querySelectorAll('span')).map((s) => s.textContent.trim()).filter(Boolean),
  };
});
const regenerateBox = async (page) => {
  const btn = page.getByRole('button', { name: '重新生成' });
  if ((await btn.count()) === 0) return null;
  return btn.boundingBox();
};

const b = await chromium.launch({ headless: true });
try {
  /* ---------- ① 有数据：卡片出现、三段齐全、有标签 ---------- */
  {
    const p = await b.newPage({ viewport: { width: 412, height: 915 } });
    await acknowledgeReleaseNotes(p);
    await p.goto('http://127.0.0.1:5188/#/goals');
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await seed(p, true);
    await p.reload();
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await sleep(1200);
    await p.goto('http://127.0.0.1:5188/#/stats');
    await sleep(1600);
    await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('知道了'))?.click());
    await sleep(600);

    const c0 = await card(p);
    check('评分卡出现在统计页「概览」里', !!c0, c0 ? '有' : '没有');
    check('三段齐全（今日表现 / 值得关注的地方 / 下一步建议）', !!c0?.today && !!c0?.watch && !!c0?.next, JSON.stringify({ t: !!c0?.today, w: !!c0?.watch, n: !!c0?.next }));
    check('三段都有实际内容（不是空串）', [c0.today, c0.watch, c0.next].every((s) => s.replace(/^[^：]*：/, '').trim().length > 4), JSON.stringify([c0.today, c0.watch, c0.next]));
    check('标签来自事实（连续 N 天 / 集中在某科 之类）', c0.tags.some((t) => /连续|集中|完成|目标|进步|波动/.test(t)), JSON.stringify(c0.tags));
    check('副标题说明不依赖外部服务', c0.text.includes('不用任何外部服务'), '');

    /* ---------- ② 重新生成：措辞变、结论不变（场景 ⑫） ---------- */
    const texts = [c0.text];
    for (let i = 0; i < 5; i++) {
      await p.getByRole('button', { name: '重新生成' }).click();
      await sleep(500);
      texts.push((await card(p)).text);
    }
    const uniq = new Set(texts);
    check('场景⑫ 连点 5 次「重新生成」→ 至少出现过 2 种不同措辞', uniq.size >= 2, `不同 ${uniq.size} 种`);
    /*
     * 结论不变的判据：抽出"事实性数字/词组"再比较。
     * ⚠️ 必须**去重**后比较：同一个事实可能在标签和正文里各出现一次
     * （比如「连续 7 天」既是标签又在"值得关注"里），按出现次数比会假失败 —— 我第一版就这么错了。
     */
    const factKey = (t) => [...new Set(t.match(/\d+\s*分钟|\d+\s*\/\s*\d+|连续\s*\d+\s*天/g) ?? [])].sort().join('|');
    const keys = new Set(texts.map(factKey));
    check('场景⑫ 重新生成不改变事实数字（结论不变）', keys.size === 1, [...keys].join('  ///  '));

    /* ---------- ③ 触摸目标 ---------- */
    const bb = await regenerateBox(p);
    check('「重新生成」触摸目标高度 ≥44px', !!bb && bb.height >= 44, bb ? `${Math.round(bb.height)}px` : '没找到');

    /* ---------- ④ 场景 ⑬：深色下也要正常 ---------- */
    await p.evaluate(() => window.__LOS__.useStore.getState().patchSettings({ colorMode: 'dark' }));
    await sleep(900);
    const cDark = await card(p);
    check('场景⑬ 深色模式下评价卡仍完整渲染', !!cDark?.today && !!cDark?.next && cDark.text.length > 40, cDark ? cDark.today : '没有');
    await p.screenshot({ path: '.preview/evaluation-card-dark.png' });
    await p.close();
  }

  /* ---------- ⑤ 没有计划也没有记录 → 引导，不硬编评价 ---------- */
  {
    const p = await b.newPage({ viewport: { width: 412, height: 915 } });
    await acknowledgeReleaseNotes(p);
    await p.goto('http://127.0.0.1:5188/#/goals');
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await seed(p, false);
    await p.evaluate(() => window.__LOS__.useStore.getState().patchSettings({ dailyGoalMinutes: 0 }));
    await p.reload();
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await sleep(1200);
    await p.goto('http://127.0.0.1:5188/#/stats');
    await sleep(1600);
    await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('知道了'))?.click());
    await sleep(600);

    const cEmpty = await card(p);
    check('没计划没记录 → 不出现评价卡（改为引导）', cEmpty === null, cEmpty ? '仍然出现了评价卡 ✗' : '没有评价卡 ✓');
    const mainText = await p.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
    check('给出"不编评价"的引导文案', mainText.includes('没有依据就不编评价'), mainText.slice(0, 80));
    check('引导里给出下一步（去记录 / 去设目标）', mainText.includes('去记一段') || mainText.includes('作息'), '');
    await p.screenshot({ path: '.preview/evaluation-empty.png' });
    await p.close();
  }

  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
