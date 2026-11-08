/**
 * 节假日表与「按日期覆盖课表」的验证
 *
 * 内置表是从国务院办公厅通知原文逐条抄的，抄错就会直接给出错误的放假/补课判断，
 * 所以这里把关键日期逐条对一遍，并且验证星期几与官方文件里写的一致
 * （官方原文每个日期后面都标了星期几，正好可以当交叉校验）。
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const r = await page.evaluate(async () => {
  const H = await import('/src/lib/holidays.ts');
  const T = await import('/src/lib/time.ts');

  /** 官方原文标注的星期几，用来交叉校验内置表的日期没抄错 */
  const official = (iso, label) => ({ iso, label, jsDow: new Date(iso + 'T00:00:00').getDay() });
  const dowLabel = (iso) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(iso + 'T00:00:00').getDay()];

  const holidayOf = (iso) => H.holidayOf(iso);
  const resolve = (iso, overrides = []) => {
    const wd = T.toWeekday(new Date(iso + 'T00:00:00').getDay());
    const d = H.resolveDay(iso, wd, overrides);
    return { hasClass: d.hasClass, weekday: d.weekday, reason: d.reason, label: d.label, needs: d.needsMakeupChoice, realWeekday: wd };
  };

  return {
    covered: H.COVERED_YEARS,
    uncovered: H.isYearCovered(2030),
    // 官方原文里的关键日期
    y2025: {
      newYear: holidayOf('2025-01-01'),
      springOff: ['2025-01-28', '2025-01-30', '2025-02-04'].map(holidayOf),
      springWork: ['2025-01-26', '2025-02-08'].map(holidayOf),
      labourWork: holidayOf('2025-04-27'),
      nationalWork: ['2025-09-28', '2025-10-11'].map(holidayOf),
      nationalOff: ['2025-10-01', '2025-10-08'].map(holidayOf),
      plain: holidayOf('2025-03-15'),
    },
    y2026: {
      newYearOff: ['2026-01-01', '2026-01-03'].map(holidayOf),
      newYearWork: holidayOf('2026-01-04'),
      springOff: ['2026-02-15', '2026-02-23'].map(holidayOf),
      springWork: ['2026-02-14', '2026-02-28'].map(holidayOf),
      qingmingOff: ['2026-04-04', '2026-04-06'].map(holidayOf),
      labourWork: holidayOf('2026-05-09'),
      dragonOff: ['2026-06-19', '2026-06-21'].map(holidayOf),
      midAutumnOff: ['2026-09-25', '2026-09-27'].map(holidayOf),
      nationalWork: ['2026-09-20', '2026-10-10'].map(holidayOf),
      nationalOff: ['2026-10-01', '2026-10-07'].map(holidayOf),
      plain: holidayOf('2026-03-15'),
    },
    // 星期几与官方原文的交叉校验
    dows: {
      '2026-01-01': dowLabel('2026-01-01'),
      '2026-01-04': dowLabel('2026-01-04'),
      '2026-02-14': dowLabel('2026-02-14'),
      '2026-09-20': dowLabel('2026-09-20'),
      '2026-10-10': dowLabel('2026-10-10'),
      '2025-01-26': dowLabel('2025-01-26'),
      '2025-04-27': dowLabel('2025-04-27'),
      '2025-10-11': dowLabel('2025-10-11'),
    },
    // 解析：放假 / 调休 / 普通
    resolved: {
      holiday: resolve('2026-02-17'),          // 春节里的一天
      makeupNoChoice: resolve('2026-01-04'),   // 元旦调休（周日上班），用户还没选
      makeupWithChoice: resolve('2026-01-04', [{ date: '2026-01-04', schedule: 0, note: '按周一' }]),
      userOffOnWorkday: resolve('2026-01-04', [{ date: '2026-01-04', schedule: 'off' }]),
      userOffOnHoliday: resolve('2026-02-17', [{ date: '2026-02-17', schedule: 2 }]),
      normal: resolve('2026-03-15'),
      normalSunday: resolve('2026-03-22'),
    },
    official,
  };
});

console.log('=== 覆盖年份 ===');
check('表里含 2025 与 2026', r.covered.includes(2025) && r.covered.includes(2026), JSON.stringify(r.covered));
check('未收录年份可被识别（用于提示用户）', r.uncovered === false, `2030 已收录=${!r.uncovered}`);

console.log('\n=== 2025 年（对照国办发明电〔2024〕12号）===');
check('元旦放假', r.y2025.newYear?.kind === 'off', JSON.stringify(r.y2025.newYear));
check('春节 1/28–2/4 放假', r.y2025.springOff.every((x) => x?.kind === 'off'), JSON.stringify(r.y2025.springOff));
check('春节调休 1/26、2/8 上班', r.y2025.springWork.every((x) => x?.kind === 'work'), JSON.stringify(r.y2025.springWork));
check('劳动节调休 4/27 上班', r.y2025.labourWork?.kind === 'work', JSON.stringify(r.y2025.labourWork));
check('国庆调休 9/28、10/11 上班', r.y2025.nationalWork.every((x) => x?.kind === 'work'), JSON.stringify(r.y2025.nationalWork));
check('国庆 10/1–10/8 放假', r.y2025.nationalOff.every((x) => x?.kind === 'off'), JSON.stringify(r.y2025.nationalOff));
check('普通日子无标注', r.y2025.plain === null, JSON.stringify(r.y2025.plain));

console.log('\n=== 2026 年（对照国办发明电〔2025〕7号）===');
check('元旦 1/1–1/3 放假', r.y2026.newYearOff.every((x) => x?.kind === 'off'), JSON.stringify(r.y2026.newYearOff));
check('元旦调休 1/4 上班（正是用户举的「周日补课」）', r.y2026.newYearWork?.kind === 'work', JSON.stringify(r.y2026.newYearWork));
check('春节 2/15–2/23 放假', r.y2026.springOff.every((x) => x?.kind === 'off'), JSON.stringify(r.y2026.springOff));
check('春节调休 2/14、2/28 上班', r.y2026.springWork.every((x) => x?.kind === 'work'), JSON.stringify(r.y2026.springWork));
check('清明 4/4–4/6 放假', r.y2026.qingmingOff.every((x) => x?.kind === 'off'), JSON.stringify(r.y2026.qingmingOff));
check('劳动节调休 5/9 上班', r.y2026.labourWork?.kind === 'work', JSON.stringify(r.y2026.labourWork));
check('端午 6/19–6/21 放假', r.y2026.dragonOff.every((x) => x?.kind === 'off'), JSON.stringify(r.y2026.dragonOff));
check('中秋 9/25–9/27 放假', r.y2026.midAutumnOff.every((x) => x?.kind === 'off'), JSON.stringify(r.y2026.midAutumnOff));
check('国庆调休 9/20、10/10 上班', r.y2026.nationalWork.every((x) => x?.kind === 'work'), JSON.stringify(r.y2026.nationalWork));
check('国庆 10/1–10/7 放假', r.y2026.nationalOff.every((x) => x?.kind === 'off'), JSON.stringify(r.y2026.nationalOff));
check('普通日子无标注', r.y2026.plain === null, JSON.stringify(r.y2026.plain));

console.log('\n=== 星期几交叉校验（官方原文每个日期后都标了星期）===');
const expectedDow = {
  '2026-01-01': '周四', '2026-01-04': '周日', '2026-02-14': '周六',
  '2026-09-20': '周日', '2026-10-10': '周六',
  '2025-01-26': '周日', '2025-04-27': '周日', '2025-10-11': '周六',
};
for (const [iso, exp] of Object.entries(expectedDow)) {
  check(`${iso} 是${exp}`, r.dows[iso] === exp, `实得 ${r.dows[iso]}`);
}

console.log('\n=== 解析：放假 / 补课 / 普通 ===');
check('法定放假日 → 不上课', r.resolved.holiday.hasClass === false && r.resolved.holiday.reason === 'holiday', JSON.stringify(r.resolved.holiday));
check('调休日 → 要上课，并提示用户选按周几', r.resolved.makeupNoChoice.hasClass === true && r.resolved.makeupNoChoice.needs === true, JSON.stringify(r.resolved.makeupNoChoice));
check('用户指定「按周一」→ 按周一排课', r.resolved.makeupWithChoice.weekday === 0 && r.resolved.makeupWithChoice.reason === 'user-makeup', JSON.stringify(r.resolved.makeupWithChoice));
check('用户手动设为不上课 → 即使那天是调休上班日也不上课', r.resolved.userOffOnWorkday.hasClass === false && r.resolved.userOffOnWorkday.reason === 'user-off', JSON.stringify(r.resolved.userOffOnWorkday));
check('用户覆盖优先于内置放假日', r.resolved.userOffOnHoliday.hasClass === true && r.resolved.userOffOnHoliday.weekday === 2, JSON.stringify(r.resolved.userOffOnHoliday));
check('普通日子按真实星期几', r.resolved.normal.hasClass === true && r.resolved.normal.needs === false, JSON.stringify(r.resolved.normal));
check('普通周日按周日（可能没课，属正常）', r.resolved.normalSunday.weekday === r.resolved.normalSunday.realWeekday, JSON.stringify(r.resolved.normalSunday));

/* ---------- 界面层：日期覆盖生效 + 上课/自学分开显示 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate(() => {
    const seed = {
      schema: 3,
      settings: {
        theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true, dynamicBackground: false,
        onboarded: true, blocks: [], quoteSeed: 'x', dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '23:00',
      },
      periods: [
        { id: 'p1', name: '第 1 节', start: '08:00', end: '08:45', counts: true },
        { id: 'p2', name: '第 2 节', start: '08:55', end: '09:40', counts: true },
      ],
      courses: (() => {
        /*
         * 按**今天的星期几**排课，而不是写死周一。
         * 否则今天要是没课，首页课程卡会走「今天没有课程」的空状态，
         * 那条「上课占用」就不会出现 —— 第一版就栽在这，误判成功能缺失。
         * 这里用与 lib/time 一致的换算：周一 = 0。
         */
        const jsDow = new Date().getDay();
        const wd = (jsDow + 6) % 7;
        return [
          { id: 'c1', subject: '数学', title: '数学', weekday: wd, periodId: 'p1' },
          { id: 'c2', subject: '英语', title: '英语', weekday: wd, periodId: 'p2' },
        ];
      })(),
      /*
       * 同时用「按日覆盖」把今天的课表钉回它自己的星期几：
       * 种子按今天星期几排课，但今天是法定假日（如中秋）时内置表会把课全吃掉，
       * 「上课占用」用例就与运行日期耦合了（2026-09-25 中秋当天实测复现）。
       * 用户覆盖的优先级高于内置节假日表（resolveDay 的既定口径），可以钉住。
       */
      dayOverrides: [
        {
          date: (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })(),
          schedule: (new Date().getDay() + 6) % 7,
          note: '测试：钉住今天的课表',
        },
      ],
      background: { current: 'none', mode: 'fixed', rotateMinutes: 60, enabledIds: [], custom: [], dim: 0, dynamic: false, showVeil: false, grid: false, dimAuto: false },
      timer: null, courseStatus: {},
    };
    localStorage.setItem('learning-os:v1:state', JSON.stringify(seed));
  });

  // 打开日历页，选到 2026-01-04（元旦调休，周日上班）
  await page.goto('http://127.0.0.1:5188/#/calendar', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => { Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click(); });
  await page.waitForTimeout(700);

  console.log('\n=== 界面：调休日与按周几上课 ===');
  // 把标题切到 2026 年 1 月，再点 1 月 4 日
  const picked = await page.evaluate(async () => {
    // 一路往回切到 2026 年 1 月
    for (let i = 0; i < 24; i++) {
      const t = document.querySelector('[data-calendar-title]')?.textContent ?? '';
      if (t.includes('2026 年 1 月')) break;
      const prev = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').includes('上个月'));
      prev?.click();
      await new Promise((r) => setTimeout(r, 90));
    }
    const title = document.querySelector('[data-calendar-title]')?.textContent?.trim() ?? '';
    const cell = document.querySelector('[data-calendar-cell="2026-01-04"]');
    cell?.click();
    await new Promise((r) => setTimeout(r, 400));
    const text = document.querySelector('main')?.textContent ?? '';
    return { title, hasCell: Boolean(cell), text: text.replace(/\s+/g, ' ').slice(0, 400) };
  });
  check('能切到 2026 年 1 月', picked.title.includes('2026 年 1 月'), picked.title);
  check('1 月 4 日识别为调休上课', picked.text.includes('调休上课'), picked.text.match(/.{0,12}调休上课.{0,16}/)?.[0] ?? '未找到');

  // 点「周一」，让这天按周一的课表
  const applied = await page.evaluate(async () => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '周一');
    if (!btn) return { ok: false, step: 'no-button' };
    btn.click();
    await new Promise((r) => setTimeout(r, 500));
    const saved = JSON.parse(localStorage.getItem('learning-os:v1:state') || '{}').dayOverrides ?? [];
    const text = document.querySelector('main')?.textContent ?? '';
    return { ok: true, saved, text: text.replace(/\s+/g, ' ').slice(0, 300) };
  });
  check('能指定「按周一的课表」', applied.ok && applied.saved.some((o) => o.date === '2026-01-04' && o.schedule === 0), JSON.stringify(applied.saved ?? []));
  check('界面回显「按周一的课表」', (applied.text ?? '').includes('按周一的课表'), (applied.text ?? '').match(/.{0,8}按周一.{0,8}/)?.[0] ?? '未找到');

  // 首页：今日课程卡应显示上课占用
  await page.goto('http://127.0.0.1:5188/#/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click(); });
  await page.waitForTimeout(800);
  const home = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
  check('首页有「上课占用」一项', home.includes('上课占用'), home.match(/.{0,6}上课占用.{0,10}/)?.[0] ?? '未找到');
  check('首页学习卡已改名为「今日自学」', home.includes('今日自学'), home.match(/.{0,4}今日自学.{0,6}/)?.[0] ?? '未找到');

  // 统计页：自学与上课分列两项
  await page.goto('http://127.0.0.1:5188/#/stats', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const stats = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
  check('统计页有「自学时长」', stats.includes('自学时长'), stats.match(/.{0,8}自学时长.{0,10}/)?.[0] ?? '未找到');
  check('统计页有「上课占用」', stats.includes('上课占用'), stats.match(/.{0,8}上课占用.{0,14}/)?.[0] ?? '未找到');

  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((x) => !x).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);