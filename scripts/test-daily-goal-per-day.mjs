/**
 * 每日学习目标可按星期几单独设 + 搬到作息页 + 超窗提示
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求：「每日计划学习时长可单独改变，也可以选择跟随周几的配置」，
 * 并确认了三条：(A) 跟随那天的默认值 / 搬到【设置→作息】/ 超窗只提示不改。
 *
 * 这个用例守的是**真的生效**：改今天 → 首页进度环和小组件载荷都跟着变；
 * 改别的星期几 → 今天不受影响。日期不伪造，全部在「今天」上验。
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

/** 首页进度环里的百分比 */
const ringPercent = (page) =>
  page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((x) => /^\d+%$/.test((x.textContent || '').trim()));
    return p ? Number((p.textContent || '').replace('%', '')) : null;
  });

/** 小组件载荷里的目标分钟数与百分比 */
const widgetGoal = (page) =>
  page.evaluate(async () => {
    const m = await import('/src/lib/widgetBridge.ts');
    const p = JSON.parse(m.buildWidgetPayload());
    return { goalMinutes: p.percent.goalMinutes, percent: p.percent.percent };
  });

try {
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await acknowledgeReleaseNotes(p);
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);

  const todayWd = await p.evaluate(() => (new Date().getDay() + 6) % 7);
  const otherWd = (todayWd + 1) % 7;
  const LABEL = '一二三四五六日';
  console.log(`今天 = 周${LABEL[todayWd]}，对照日 = 周${LABEL[otherWd]}`);

  /* 种一份「今天已学 60 分钟」的记录，这样百分比能算出整数，好断言 */
  await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    s.patchSettings({ onboarded: true, theme: 'pure-light', colorMode: 'light', blocks: [], byWeekday: null, studyFrom: '00:00', studyTo: '23:59', dailyGoalMinutes: 120 });
    s.patchBackground({ current: 'none' });
    s.sessions.forEach((x) => s.removeSession(x.id));
    s.addSession({ subject: '数学', startedAt: Date.now() - 60_000, endedAt: Date.now(), durationSec: 3600, source: 'manual' });
  });
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(1400);

  /* ---------- 位置：在作息页，不在数据页 ---------- */
  check('每日学习目标已在【设置→作息】里',
    await p.getByLabel('每日学习目标（分钟）').count() === 1);
  await p.goto('http://127.0.0.1:5188/#/settings/data');
  await p.waitForTimeout(900);
  check('【设置→数据】里已经没有这一项',
    await p.getByLabel('每天计划学习时长（分钟）').count() === 0);
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForTimeout(900);

  /* ---------- 全周模式：写全局默认，不造按天覆盖 ---------- */
  check('默认停在「全周相同」模式',
    await p.getByRole('button', { name: '全周相同' }).getAttribute('aria-pressed') === 'true');
  await p.getByLabel('每日学习目标（分钟）').fill('120');
  await p.waitForTimeout(700);
  const afterAll = await p.evaluate(() => {
    const st = window.__LOS__.useStore.getState().settings;
    return { goal: st.dailyGoalMinutes, byWeekday: st.byWeekday ?? null };
  });
  check('全周模式改的是全局默认值', afterAll.goal === 120, JSON.stringify(afterAll));
  check('全周模式不会顺手造出按天覆盖', afterAll.byWeekday === null);

  /* ---------- 功能证明：60/120 = 50%，小组件同源 ---------- */
  await p.goto('http://127.0.0.1:5188/#/');
  await p.waitForTimeout(1200);
  check('首页进度环 = 60/120 = 50%', await ringPercent(p) === 50, `实际 ${await ringPercent(p)}%`);
  check('小组件载荷的目标也是 120 分钟',
    (await widgetGoal(p)).goalMinutes === 120, JSON.stringify(await widgetGoal(p)));

  /* ---------- 按星期几：改今天 → 首页跟着变 ---------- */
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForTimeout(900);
  await p.getByRole('button', { name: '按星期几' }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: new RegExp('^周' + LABEL[todayWd]) }).click();
  await p.waitForTimeout(300);
  await p.getByLabel('每日学习目标（分钟）').fill('60');
  await p.waitForTimeout(700);
  const todayOnly = await p.evaluate((wd) => {
    const st = window.__LOS__.useStore.getState().settings;
    return { global: st.dailyGoalMinutes, per: st.byWeekday?.[wd]?.dailyGoalMinutes ?? null };
  }, todayWd);
  check('按天模式只给今天加覆盖，全局默认不动',
    todayOnly.global === 120 && todayOnly.per === 60, JSON.stringify(todayOnly));

  await p.goto('http://127.0.0.1:5188/#/');
  await p.waitForTimeout(1200);
  check('首页进度环变成 60/60 = 100%（按星期几真的生效）',
    await ringPercent(p) === 100, `实际 ${await ringPercent(p)}%`);
  check('小组件载荷的目标跟着变成 60 分钟',
    (await widgetGoal(p)).goalMinutes === 60, JSON.stringify(await widgetGoal(p)));
  await p.screenshot({ path: '.preview/daily-goal-per-day.png' });

  /* ---------- 改别的星期几 → 今天不受影响 ---------- */
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForTimeout(900);
  await p.getByRole('button', { name: new RegExp('^周' + LABEL[otherWd]) }).click();
  await p.waitForTimeout(300);
  await p.getByLabel('每日学习目标（分钟）').fill('240');
  await p.waitForTimeout(700);
  await p.goto('http://127.0.0.1:5188/#/');
  await p.waitForTimeout(1200);
  check('改别的星期几不影响今天（仍是 100%）',
    await ringPercent(p) === 100, `实际 ${await ringPercent(p)}%`);

  /* ---------- 持久化 ---------- */
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(1200);
  const persisted = await p.evaluate((wd) => {
    const st = window.__LOS__.useStore.getState().settings;
    return { global: st.dailyGoalMinutes, today: st.byWeekday?.[wd]?.dailyGoalMinutes ?? null };
  }, todayWd);
  check('刷新后按天的目标还在', persisted.global === 120 && persisted.today === 60, JSON.stringify(persisted));

  /* ---------- 超窗提示：只提示，不改数字 ---------- */
  await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    s.patchSettings({ byWeekday: null, studyFrom: '18:00', studyTo: '19:00', dailyGoalMinutes: 300 });
  });
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForTimeout(1100);
  const hint = await p.getByText(/超过了周.的可支配时间/).count();
  check('目标超过当天可支配时出现提示', hint > 0, `命中 ${hint} 处`);
  check('提示里不改用户填的数字（仍是 300）',
    (await p.evaluate(() => window.__LOS__.useStore.getState().settings.dailyGoalMinutes)) === 300);

  /* ---------- 坏数据清洗（数字字段也要校验） ---------- */
  /*
   * 必须**同时写 localStorage 和 IndexedDB**，并把 setItem 打成空操作挡住卸载落盘。
   * 只写 localStorage 的话，`loadState()` 会在两份存储之间挑「更完整」的一份，
   * IndexedDB 里的干净副本胜出 —— 注入根本没生效（这是坑 55，第一版就这么假失败的）。
   */
  await p.evaluate(async () => {
    const KEY = 'learning-os:v1:state';
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    raw.settings = {
      ...(raw.settings || {}),
      byWeekday: { 1: { dailyGoalMinutes: 'abc' }, 2: { dailyGoalMinutes: -5 }, 3: { dailyGoalMinutes: 90 } },
    };
    localStorage.setItem(KEY, JSON.stringify(raw));
    await new Promise((resolve) => {
      const req = indexedDB.open('learning-os-db');
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(raw, KEY);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); resolve(); };
        } catch { db.close(); resolve(); }
      };
    });
    Storage.prototype.setItem = function () {};
    location.reload();
  });
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(1000);
  const cleaned = await p.evaluate(() => window.__LOS__.useStore.getState().settings.byWeekday);
  check('数字字段的坏数据被清掉（只留合法的 90）',
    !!cleaned && Object.keys(cleaned).length === 1 && cleaned[3]?.dailyGoalMinutes === 90,
    JSON.stringify(cleaned));

  check('无运行时错误', errors.length === 0, errors.slice(0, 1).join(' | '));
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
