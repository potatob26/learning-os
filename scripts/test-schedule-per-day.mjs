/**
 * 作息可以按星期几单独配 + 「睡觉」真正生效
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户反馈：学习窗口和每日作息都是全周共用一套，等于被锁死。
 *
 * 现在：
 *   · 「全周相同」模式 = 改全局默认值（**原来的行为**，默认停在这里）
 *   · 「按星期几」模式 = 只给选中的那一天加覆盖，没覆盖的字段回落默认
 *   · 「睡觉」接进了首页「距离睡觉」（以前用的是学习窗口终点，不是睡觉时间）
 *
 * 这里守的是**真的生效**：改今天 → 首页数字跟着变；改别的星期几 → 今天不受影响；
 * 刷新后还在。日期不伪造，全部在「今天」上验。
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

/**
 * 读首页某个统计项的时长（分钟）。label 例如「课后可支配」「距离睡觉」
 *
 * Stat 的结构是 `<div><p>标签</p><p>数值</p></div>`，所以数值就是**标签的下一个兄弟节点**。
 * 第一版往上找父元素再减掉标签文字，结果在三个统计项共用的那一行上读到
 * 「2h30m」拼出来的假 150 分钟 —— 必须精确到兄弟节点。
 */
const readStat = (page, label) =>
  page.evaluate((lb) => {
    const el = [...document.querySelectorAll('p')].find(
      (x) => (x.textContent || '').trim() === lb,
    );
    const valueEl = el?.nextElementSibling;
    const text = (valueEl?.textContent ?? '').trim();
    /*
     * 两个都要**不锚定**：fmtDuration 给出的是 "2h30m" 这种拼写，
     * 用 ^(\d+)\s*m 去找分钟会因为字符串以「2h」开头而匹配不到 30，
     * 于是 2h30m 被读成 2h —— 之前那条假失败就是这么来的。
     */
    const h = /(\d+)\s*h/.exec(text);
    const m = /(\d+)\s*m/.exec(text);
    if (!h && !m) return null;
    return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  }, label);

try {
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await acknowledgeReleaseNotes(p);
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);

  const todayWd = await p.evaluate(() => (new Date().getDay() + 6) % 7);
  const otherWd = (todayWd + 1) % 7;
  console.log(`今天 = 周${'一二三四五六日'[todayWd]}，对照日 = 周${'一二三四五六日'[otherWd]}`);

  // 清干净、给一个能算出整数的大窗口
  await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    s.patchSettings({ onboarded: true, theme: 'pure-light', colorMode: 'light', blocks: [], byWeekday: null });
    s.patchBackground({ current: 'none' });
  });
  await p.waitForTimeout(700);

  /* ---------- 全周相同模式：改的是全局默认值 ---------- */
  check('默认停在「全周相同」模式',
    await p.getByRole('button', { name: '全周相同' }).getAttribute('aria-pressed') === 'true');
  const winFrom = p.getByLabel('开始');
  const winTo = p.getByLabel('结束');
  await winFrom.fill('09:00');
  await winTo.fill('11:00');
  await p.waitForTimeout(700);
  const afterAll = await p.evaluate(() => {
    const st = window.__LOS__.useStore.getState().settings;
    return { from: st.studyFrom, to: st.studyTo, byWeekday: st.byWeekday ?? null };
  });
  check('全周模式改的是全局默认值', afterAll.from === '09:00' && afterAll.to === '11:00',
    JSON.stringify(afterAll));
  check('全周模式不会顺手造出按天覆盖（否则七天会被悄悄钉住）', afterAll.byWeekday === null);

  const availGlobal = await (async () => {
    await p.goto('http://127.0.0.1:5188/#/');
    await p.waitForTimeout(900);
    return readStat(p, '课后可支配');
  })();
  check('首页可支配 = 窗口 2 小时（09:00–11:00，无课无固定活动）', availGlobal === 120,
    `${availGlobal} 分钟`);

  /* ---------- 按星期几模式：只影响选中那天 ---------- */
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: '按星期几' }).click();
  await p.waitForTimeout(400);
  check('切到按星期几后出现星期选择器',
    await p.getByRole('button', { name: /^周一/ }).count() === 1);

  // 先改「另一天」，确认今天不受影响
  await p.getByRole('button', { name: new RegExp('^周' + '一二三四五六日'[otherWd]) }).click();
  await p.waitForTimeout(300);
  await p.getByLabel('开始').fill('06:00');
  await p.getByLabel('结束').fill('08:00');
  await p.waitForTimeout(600);
  const otherOnly = await p.evaluate(() => {
    const st = window.__LOS__.useStore.getState().settings;
    return { byWeekday: st.byWeekday, globalFrom: st.studyFrom };
  });
  check('改另一天只给那天加覆盖，全局默认不动',
    otherOnly.globalFrom === '09:00' && !!otherOnly.byWeekday && !!otherOnly.byWeekday[otherWd],
    JSON.stringify(otherOnly.byWeekday));
  const availStill = await (async () => {
    await p.goto('http://127.0.0.1:5188/#/');
    await p.waitForTimeout(900);
    return readStat(p, '课后可支配');
  })();
  check('改别的星期几不影响今天', availStill === 120, `${availStill} 分钟`);

  // 再改「今天」，确认今天跟着变
  await p.goto('http://127.0.0.1:5188/#/settings/schedule');
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: new RegExp('^周' + '一二三四五六日'[todayWd]) }).click();
  await p.waitForTimeout(300);
  await p.getByLabel('开始').fill('18:00');
  await p.getByLabel('结束').fill('20:30');
  await p.waitForTimeout(600);
  const availToday = await (async () => {
    await p.goto('http://127.0.0.1:5188/#/');
    await p.waitForTimeout(1500);
    return readStat(p, '课后可支配');
  })();
  check('改今天 → 首页可支配变成 2h30m（按星期几真的生效）', availToday === 150,
    `${availToday} 分钟`);
  await p.screenshot({ path: '.preview/schedule-per-day.png' });

  /* ---------- 「睡觉」真正生效 ---------- */
  /*
   * 睡觉时间设成「窗口起点 + 2 小时」——**必须晚于窗口起点**，
   * 否则会撞上应用那条规则（睡觉早于窗口开始 ⇒ 视为次日），算出来就是 26 小时。
   * 期望值也按同一条规则算，不写死数字。
   */
  const expectSleep = await p.evaluate(async () => {
    /*
     * 关键：窗口起点要读「今天实际生效」的值（这个测试前面把今天单独改成 20:00 开始了），
     * 不能读全局 settings.studyFrom —— 否则差整整 1440 分钟。
     * 用应用自己的帮手算，保证与实际渲染同源。
     */
    const time = await import('/src/lib/time.ts');
    const hol = await import('/src/lib/holidays.ts');
    const st = window.__LOS__.useStore.getState().settings;
    const overrides = window.__LOS__.useStore.getState().dayOverrides ?? [];
    const wd = hol.effectiveWeekday(time.dayKey(Date.now()), overrides);
    const eff = time.settingsForDay(st, wd);
    const parse = (v) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const fromMin = parse(eff.studyFrom) ?? 0;
    const d = new Date();
    const nowMin = d.getHours() * 60 + d.getMinutes();
    // 睡觉 = 窗口起点 + 2 小时（一定是"今天稍晚"，不会触发次日规则）
    const sleepMin = Math.min(1439, fromMin + 120);
    window.__LOS__.useStore.getState().patchSettings({
      sleepTime: String(Math.floor(sleepMin / 60)).padStart(2, '0') + ':' + String(sleepMin % 60).padStart(2, '0'),
    });
    // 应用规则：睡觉早于窗口起点 → 次日
    const effective = sleepMin > 0 && sleepMin < fromMin ? sleepMin + 1440 : sleepMin;
    return { expect: effective - nowMin, sleepMin, fromMin, nowMin };
  });
  await p.waitForTimeout(900);
  const toSleep = await readStat(p, '距离睡觉');
  /*
   * 已经过了睡觉时间时，首页显示「已过」（readStat 返回 null）而不是负分钟数；
   * 没到睡觉时间才比对具体分钟。测试在深夜跑时不应因此假失败。
   */
  const sleepOk =
    expectSleep.expect > 0
      ? toSleep !== null && Math.abs(toSleep - expectSleep.expect) <= 2
      : toSleep === null;
  check('首页「距离睡觉」按设置的睡觉时间算（睡觉=窗口起点+2小时）',
    sleepOk,
    `显示 ${toSleep === null ? '已过' : `${toSleep} 分钟`} / 期望 ${expectSleep.expect > 0 ? `${expectSleep.expect} 分钟` : '已过'}（睡觉 ${expectSleep.sleepMin} · 窗口起点 ${expectSleep.fromMin} · 现在 ${expectSleep.nowMin}）`);

  /* ---------- 持久化 ---------- */
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(1200);
  const persisted = await p.evaluate(() => {
    const st = window.__LOS__.useStore.getState().settings;
    return { byWeekday: st.byWeekday, globalFrom: st.studyFrom };
  });
  check('刷新后按星期几的设置还在',
    persisted.globalFrom === '09:00' && !!persisted.byWeekday?.[todayWd] && !!persisted.byWeekday?.[otherWd],
    JSON.stringify(persisted.byWeekday));

  /* ---------- 坏数据不能让页面崩 ---------- */
  /*
   * 三次才试对，每一层都是交接文档里记过的坑：
   *   ① setItem 之后单独 reload —— 应用卸载时落盘，盖掉刚写的东西（坑 53）。
   *   ② 就算写进同一次 evaluate 也没用 —— reload 不同步卸载，卸载回调仍在之后的任务里跑。
   *   ③ 挡住落盘之后仍不生效 —— 因为 loadState() 会在 localStorage 与 IndexedDB 之间
   *      **挑「更完整」的一份**，只写 localStorage 时 IndexedDB 的旧副本胜出。
   * 所以：两边都写坏数据，再把 setItem 打成空操作挡住卸载落盘。
   */
  await p.evaluate(async () => {
    const KEY = 'learning-os:v1:state';
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    raw.settings = {
      ...(raw.settings || {}),
      byWeekday: { 3: 'garbage', 9: { studyFrom: '01:00' }, 1: { studyFrom: 123, studyTo: '19:00' } },
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
    Storage.prototype.setItem = function () { /* 挡住应用卸载时的落盘 */ };
    location.reload();
  });
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await p.waitForTimeout(900);
  const cleaned = await p.evaluate(() => window.__LOS__.useStore.getState().settings.byWeekday);
  check('坏数据被清掉（只留下合法的那一项）',
    !!cleaned && Object.keys(cleaned).length === 1 && cleaned[1]?.studyTo === '19:00' && cleaned[1]?.studyFrom === undefined,
    JSON.stringify(cleaned));

  check('无运行时错误', errors.length === 0, errors.slice(0, 1).join(' | '));
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
