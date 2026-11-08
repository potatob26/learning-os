/**
 * 节日库 + 日历页验证
 *   1. 节日库：公历节日、农历传统节日、除夕、节气
 *   2. 月历格子：42 格、周一起始、跨月补齐、今天标记
 *   3. 日历页（独立页面）：能打开、能切月、能标注事件、数据持久化
 *
 * 农历换算本身的正确性由 test-lunar.mjs 单独负责（那份拿公开发布日期核对）。
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/calendar';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const BASE = 'http://127.0.0.1:5188/';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'] });
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

/* ---------- 1 & 2：纯函数层（走 dev server 动态 import） ---------- */
{
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const F = await import('/src/lib/festivals.ts');
    const L = await import('/src/lib/lunar.ts');
    const names = (iso) => F.festivalsOf(L.parseDay(iso)).map((f) => f.name);

    const cases = {
      春节2024: names('2024-02-10'),
      春节2025: names('2025-01-29'),
      春节2026: names('2026-02-17'),
      除夕2024: names('2024-02-09'),
      除夕2025: names('2025-01-28'),
      除夕2026: names('2026-02-16'),
      中秋2024: names('2024-09-17'),
      端午2024: names('2024-06-10'),
      元宵2024: names('2024-02-24'),
      元旦2024: names('2024-01-01'),
      国庆2024: names('2024-10-01'),
      清明2024: names('2024-04-04'),
      劳动节2024: names('2024-05-01'),
      圣诞2024: names('2024-12-25'),
      普通日: names('2024-03-20'),
    };

    // 闰月不过节：2023 闰二月，闰二月初二不应算作龙抬头
    const leapTest = (() => {
      const d = L.lunarToSolar(2023, 2, 2, true);
      return d ? F.festivalsOf(d).map((f) => f.name) : ['(换算失败)'];
    })();

    // 月历格子
    const grid = F.monthGrid(2026, 2, L.parseDay('2026-02-17'));
    const gridInfo = {
      len: grid.length,
      firstIso: grid[0].iso,
      firstDow: grid[0].date.getDay(),
      inMonthCount: grid.filter((c) => c.inMonth).length,
      todayCount: grid.filter((c) => c.isToday).length,
      todayIso: grid.find((c) => c.isToday)?.iso ?? null,
      springCell: grid.find((c) => c.iso === '2026-02-17')?.subLabel ?? null,
    };

    // cellSubLabel 的优先级：重要节日 > 节气 > 农历日名
    const sub = {
      spring: F.cellSubLabel(L.parseDay('2026-02-17')),
      qingming: F.cellSubLabel(L.parseDay('2024-04-04')),
      plain: F.cellSubLabel(L.parseDay('2024-03-20')),
      firstDayOfMonth: F.cellSubLabel(L.parseDay('2024-03-10')), // 二月初一
    };

    return { cases, leapTest, gridInfo, sub };
  });

  console.log('=== 节日识别 ===');
  const expect = {
    春节2024: '春节', 春节2025: '春节', 春节2026: '春节',
    除夕2024: '除夕', 除夕2025: '除夕', 除夕2026: '除夕',
    中秋2024: '中秋节', 端午2024: '端午节', 元宵2024: '元宵节',
    元旦2024: '元旦', 国庆2024: '国庆节', 清明2024: '清明',
    劳动节2024: '劳动节', 圣诞2024: '圣诞节',
  };
  for (const [k, v] of Object.entries(expect)) {
    check(`${k} → ${v}`, r.cases[k].includes(v), `实得 [${r.cases[k].join(', ')}]`);
  }
  check('普通日子没有节日', r.cases.普通日.length === 0, `实得 [${r.cases.普通日.join(', ')}]`);

  console.log('\n=== 闰月不过节 ===');
  check('2023 闰二月初二不算龙抬头', !r.leapTest.includes('龙抬头'), `实得 [${r.leapTest.join(', ')}]`);

  console.log('\n=== 月历格子 ===');
  check('固定 42 格（高度不跳动）', r.gridInfo.len === 42, `${r.gridInfo.len}`);
  check('周一起始', r.gridInfo.firstDow === 1, `首格星期 ${r.gridInfo.firstDow}`);
  check('2026 年 2 月共 28 天', r.gridInfo.inMonthCount === 28, `${r.gridInfo.inMonthCount}`);
  check('今天只有一个格子被标记', r.gridInfo.todayCount === 1, `${r.gridInfo.todayCount}`);
  check('今天标记正确', r.gridInfo.todayIso === '2026-02-17', `${r.gridInfo.todayIso}`);
  check('春节格子显示「春节」', r.gridInfo.springCell === '春节', `${r.gridInfo.springCell}`);

  console.log('\n=== 格子小字优先级 ===');
  check('重要节日优先', r.sub.spring.text === '春节' && r.sub.spring.major === true, JSON.stringify(r.sub.spring));
  check('节气次之', r.sub.qingming.text === '清明', JSON.stringify(r.sub.qingming));
  check('普通日子显示农历日名', r.sub.plain.kind === 'lunar-day' && r.sub.plain.text.length > 0, JSON.stringify(r.sub.plain));
  check('农历初一显示月名', /月$/.test(r.sub.firstDayOfMonth.text), JSON.stringify(r.sub.firstDayOfMonth));

  await page.close();
}

/* ---------- 3：日历页面 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 200);
    const url = m.location()?.url ?? '';
    if (/net::ERR_|Failed to load resource|CORS/i.test(t) && url && !/localhost|127\.0\.0\.1/.test(url)) return;
    errors.push(`[console] ${t}`);
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => {
    const seed = {
      schema: 3,
      settings: { theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true, dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x', dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '23:00' },
      periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [], calendarEvents: [],
      background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false, dimAuto: false },
      timer: null, courseStatus: {},
    };
    localStorage.setItem('learning-os:v1:state', JSON.stringify(seed));
  });
  await page.goto(`${BASE}#/calendar`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2400);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click();
  });
  await page.waitForTimeout(900);

  console.log('\n=== 日历页 ===');
  const info = await page.evaluate(() => ({
    hash: location.hash,
    title: document.body.textContent.includes('日历'),
    cells: document.querySelectorAll('[data-calendar-cell]').length,
    hasTodayBtn: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === '今天'),
    yearMonth: document.querySelector('[data-calendar-title]')?.textContent?.trim() ?? null,
  }));
  check('路由 #/calendar 可打开', info.hash === '#/calendar', info.hash);
  check('月历渲染出 42 个格子', info.cells === 42, `${info.cells}`);
  check('显示年月标题', Boolean(info.yearMonth), info.yearMonth ?? '未找到');
  check('有「今天」按钮', info.hasTodayBtn);

  // 切到上个月再切回来
  const nav = await page.evaluate(async () => {
    const before = document.querySelector('[data-calendar-title]')?.textContent?.trim();
    const prev = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').includes('上个月'));
    const next = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').includes('下个月'));
    if (!prev || !next) return { ok: false };
    prev.click();
    await new Promise((r) => setTimeout(r, 400));
    const afterPrev = document.querySelector('[data-calendar-title]')?.textContent?.trim();
    next.click();
    await new Promise((r) => setTimeout(r, 400));
    const afterNext = document.querySelector('[data-calendar-title]')?.textContent?.trim();
    return { ok: true, before, afterPrev, afterNext };
  });
  check('能切换到上个月', nav.ok && nav.afterPrev !== nav.before, `${nav.before} → ${nav.afterPrev}`);
  check('能切回下个月', nav.ok && nav.afterNext === nav.before, `${nav.afterPrev} → ${nav.afterNext}`);

  // 点某天 → 标注事件
  console.log('\n=== 事件标注 ===');
  const add = await page.evaluate(async () => {
    // 找一个本月内的格子
    const cell = Array.from(document.querySelectorAll('[data-calendar-cell]')).find((c) => c.getAttribute('data-in-month') === 'true');
    if (!cell) return { ok: false, step: 'no-cell' };
    const iso = cell.getAttribute('data-calendar-cell');
    cell.click();
    await new Promise((r) => setTimeout(r, 500));
    const input = document.querySelector('[data-calendar-event-input]');
    if (!input) return { ok: false, step: 'no-input', iso };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '数学月考');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '添加');
    if (!btn) return { ok: false, step: 'no-button', iso };
    btn.click();
    await new Promise((r) => setTimeout(r, 1500));
    // 同时看 store 与 localStorage：store 是内存真值，localStorage 是落盘结果。
    // 两者分开看才能判断「没存进去」和「还没落盘」是两回事。
    const inStore = window.__LOS__?.useStore?.getState?.().calendarEvents ?? null;
    const onDisk = JSON.parse(localStorage.getItem('learning-os:v1:state') || '{}').calendarEvents ?? null;
    return { ok: true, iso, inStore, onDisk };
  });
  check('点击日期能打开事件输入', add.ok || add.step !== 'no-input', add.step ?? '');
  check('事件写入了 store', Array.isArray(add.inStore) && add.inStore.length === 1 && add.inStore[0].title === '数学月考', JSON.stringify(add.inStore ?? []));
  check('事件已落盘到 localStorage', Array.isArray(add.onDisk) && add.onDisk.length === 1 && add.onDisk[0].title === '数学月考', JSON.stringify(add.onDisk ?? []));

  const shown = await page.evaluate(() => {
    const cell = Array.from(document.querySelectorAll('[data-calendar-cell]')).find((c) => c.getAttribute('data-has-event') === 'true');
    return { hasEventMark: Boolean(cell), cellIso: cell?.getAttribute('data-calendar-cell') ?? null };
  });
  check('事件在日历格上有标记', shown.hasEventMark, shown.cellIso ?? '');

  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: `${out}/calendar.png` });
  await ctx.close();
}

/* ---------- 4：重要日期模块的独立背景 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 造一张纯色测试图当「用户上传的背景」
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#c81e3c';
    g.fillRect(0, 0, 64, 64);
    return c.toDataURL('image/png');
  }).catch(() => null);

  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(({ dataUrl }) => {
    const seed = {
      schema: 3,
      settings: {
        theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true, dynamicBackground: false,
        onboarded: true, blocks: [], quoteSeed: 'x', dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '23:00',
        dateModuleBackground: { imageId: 'bg_test', dim: 0.25 },
      },
      periods: [], courses: [], goals: [], tasks: [], sessions: [],
      dates: [{ id: 'd1', title: '中考', date: '2027-06-15', allDay: true, primary: true, visible: true, kind: 'exam', createdAt: Date.now() }],
      calendarEvents: [],
      background: {
        current: 'none', mode: 'fixed', rotateMinutes: 60, enabledIds: [],
        custom: dataUrl ? [{ id: 'bg_test', name: '测试图', dataUrl, width: 64, height: 64, bytes: 100, createdAt: Date.now() }] : [],
        dim: 0, dynamic: false, showVeil: false, grid: false, dimAuto: false,
      },
      timer: null, courseStatus: {},
    };
    localStorage.setItem('learning-os:v1:state', JSON.stringify(seed));
  }, { dataUrl });
  await page.goto(`${BASE}#/`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2400);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click();
  });
  await page.waitForTimeout(1000);

  console.log('\n=== 重要日期模块的独立背景 ===');
  const bg = await page.evaluate(() => {
    // 找那个套了模块背景的容器：内部有一个 bg-cover 的层
    const layers = Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter((el) => {
      const s = getComputedStyle(el);
      return s.backgroundImage && s.backgroundImage.includes('data:image');
    });
    return {
      found: layers.length > 0,
      count: layers.length,
      hasDim: document.querySelectorAll('[aria-hidden="true"]').length,
    };
  });
  check('首页渲染出模块背景图', bg.found, `找到 ${bg.count} 个背景层`);

  // 关掉后应消失
  const off = await page.evaluate(async () => {
    const st = window.__LOS__.useStore.getState();
    st.patchSettings({ dateModuleBackground: { imageId: null, dim: 0.25 } });
    await new Promise((r) => setTimeout(r, 500));
    return Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter((el) => {
      const s = getComputedStyle(el);
      return s.backgroundImage && s.backgroundImage.includes('data:image');
    }).length;
  });
  check('设为「不使用」后背景消失', off === 0, `仍剩 ${off} 个`);

  // 日历内嵌在首页（用户要求「日历放主页」）
  const entry = await page.evaluate(async () => {
    const st = window.__LOS__.useStore.getState();
    st.patchSettings({ dateModuleBackground: { imageId: 'bg_test', dim: 0.25 } });
    await new Promise((r) => setTimeout(r, 400));
    return {
      cells: document.querySelectorAll('[data-calendar-cell]').length,
      title: document.querySelector('[data-calendar-title]')?.textContent?.trim() ?? null,
      detail: document.querySelector('[data-calendar-event-input]') !== null,
      hash: location.hash,
    };
  });
  check('首页内嵌了日历（42 格）', entry.cells === 42, `${entry.cells} 格`);
  check('首页日历有年月标题', Boolean(entry.title), entry.title ?? '未找到');
  check('首页日历能标注事件', entry.detail);
  check('确实在首页而非独立路由', entry.hash === '#/' || entry.hash === '', entry.hash);
  await page.screenshot({ path: `${out}/home-with-calendar.png` });

  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: `${out}/date-module-bg.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${out}/`);
if (failed) process.exit(1);
