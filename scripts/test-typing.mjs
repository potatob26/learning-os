/**
 * 学习评价「逐字打出」专测
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求：要一个字一个字打出来的感觉，**但不能卡**。
 *
 * "不能卡"在这里是一条可量化的硬指标：**逐字过程中卡片高度必须恒定**。
 * 文字变长会让卡片变高 → 每帧重新排版整张卡 → 那才是"卡"的根源。
 * 所以 TypedText 用"完整文字占位 + 绝对定位显示层"，这里就断言这条不变式。
 *
 * 另外三条：
 *   · 字数必须**真的在增长**（不是一次性出现）
 *   · 最终必须补齐到完整文字
 *   · 关了动效（settings.motion=false）或系统"减少动画"时必须**立即完整显示**
 *     （这条同时也是 test-evaluation-ui 能继续通过的前提）
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

/** 种一批能让评价卡出现的真实感数据（有记录 + 有计划） */
async function seed(page, motion) {
  await page.evaluate(
    ([now, day, motion]) => {
      const store = window.__LOS__.useStore;
      const s = store.getState();
      s.patchSettings({ onboarded: true, theme: 'soft', motion, dailyGoalMinutes: 90, colorMode: 'dark' });
      store.setState({
        sessions: [40, 70, 35, 80, 50, 60, 45].map((m, i) => {
          const a = now - i * day - 3 * 3600000;
          return { id: `s${i}`, subject: i % 2 ? '英语' : '数学', goalId: null, startedAt: a, endedAt: a + m * 60000, durationSec: m * 60, source: 'timer' };
        }),
      });
      const g = store.getState().addGoal({ title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60 });
      store.getState().setGoalStatus(g, 'done');
    },
    [Date.now(), DAY, motion],
  );
}

/** 读「今日表现」那一段：已打出多少字 / 全文多少字 / 卡片高度 */
const read = (page) =>
  page.evaluate(() => {
    const card = document.querySelector('[data-testid="evaluation-card"]');
    const part = document.querySelector('[data-eval-part="today"]');
    if (!card || !part) return null;
    const spans = Array.from(part.querySelectorAll('span'));
    const typed = spans.find((x) => getComputedStyle(x).position === 'absolute');
    const holder = spans.find((x) => getComputedStyle(x).visibility === 'hidden');
    return {
      typed: (typed?.textContent ?? '').length,
      full: (holder?.textContent ?? '').length,
      h: +card.getBoundingClientRect().height.toFixed(2),
    };
  });

const b = await chromium.launch({ headless: true });
try {
  /* ---------- ① 开动效：真的逐字 + 高度恒定 ---------- */
  {
    const p = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
    await acknowledgeReleaseNotes(p);
    await p.goto('http://127.0.0.1:5188/#/goals');
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await seed(p, true);
    await p.reload();
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await sleep(900);
    await p.goto('http://127.0.0.1:5188/#/stats');
    await sleep(700);
    await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => /知道了|开始使用/.test(x.textContent || ''))?.click());

    const samples = [];
    for (let i = 0; i < 16; i++) {
      samples.push(await read(p));
      await sleep(110);
    }
    const live = samples.filter(Boolean);
    check('评价卡渲染出来了', live.length > 10, `${live.length}/16 次采到`);

    const lens = live.map((s) => s.typed);
    const grows = lens.some((v, i) => i > 0 && v > lens[i - 1]);
    check('字数**真的在逐字增长**（不是一次性出现）', grows, `采样：${lens.join('/')}`);

    const heights = [...new Set(live.map((s) => s.h))];
    check(
      '逐字过程中**卡片高度恒定**（"不能卡"的硬指标：零重排）',
      heights.length === 1,
      heights.length === 1 ? `恒定 ${heights[0]}px（${live.length} 次采样）` : `出现 ${heights.length} 种高度：${heights.join(' / ')}`,
    );

    await sleep(4200);
    const done = await read(p);
    check('最终补齐到完整文字', !!done && done.typed === done.full && done.full > 10, `${done?.typed}/${done?.full}`);

    // 点一下立刻显示完整
    await seed(p, true);
    await p.reload();
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await sleep(500);
    await p.goto('http://127.0.0.1:5188/#/stats');
    await sleep(600);
    await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => /知道了|开始使用/.test(x.textContent || ''))?.click());
    const mid = await read(p);
    await p.locator('[data-eval-part="today"] span').last().click({ force: true }).catch(() => {});
    await sleep(300);
    const after = await read(p);
    check(
      '点一下可立刻显示完整（不用等它打完）',
      !!after && after.typed === after.full && after.full > 0,
      `点前 ${mid?.typed}/${mid?.full} → 点后 ${after?.typed}/${after?.full}`,
    );
    await p.close();
  }

  /* ---------- ② 关动效：立即完整显示 ---------- */
  {
    const p = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
    await acknowledgeReleaseNotes(p);
    await p.goto('http://127.0.0.1:5188/#/goals');
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await seed(p, false);
    await p.reload();
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await sleep(900);
    await p.goto('http://127.0.0.1:5188/#/stats');
    await sleep(900);
    await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => /知道了|开始使用/.test(x.textContent || ''))?.click());
    await sleep(250);
    const v = await read(p);
    check('关了动效 → **立即完整显示**（不给一个半截的卡片）', !!v && v.typed === v.full && v.full > 10, `${v?.typed}/${v?.full}`);
    await p.close();
  }

  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
