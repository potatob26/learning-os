/**
 * 农历换算的正确性验证
 * ──────────────────────────────────────────────────────────────────────────────
 * 农历数据表最容易「抄错一位」，而抄错后平时看不出来、只在某些年份的某几天错位。
 * 所以这里拿**历年公开发布的节日公历日期**逐条核对：
 *   春节 = 正月初一 · 端午 = 五月初五 · 中秋 = 八月十五 · 元宵 = 正月十五
 * 另外核对闰月（2020 闰四月 / 2023 闰二月 / 2025 闰六月）与清明节气。
 *
 * 跑法：node scripts/test-lunar.mjs   （走 5188 开发服务器，用动态 import 取模块）
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/* 已知的历年节日公历日期（公开资料） */
const SPRING_FESTIVAL = {
  2020: '2020-01-25', 2021: '2021-02-12', 2022: '2022-02-01', 2023: '2023-01-22',
  2024: '2024-02-10', 2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06',
  2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03',
};
const DRAGON_BOAT = {
  2022: '2022-06-03', 2023: '2023-06-22', 2024: '2024-06-10', 2025: '2025-05-31', 2026: '2026-06-19',
};
const MID_AUTUMN = {
  2022: '2022-09-10', 2023: '2023-09-29', 2024: '2024-09-17', 2025: '2025-10-06', 2026: '2026-09-25',
};
const LANTERN = { 2023: '2023-02-05', 2024: '2024-02-24', 2025: '2025-02-12', 2026: '2026-03-03' };
const QINGMING = { 2023: '2023-04-05', 2024: '2024-04-04', 2025: '2025-04-04', 2026: '2026-04-05' };

const data = await page.evaluate(async ({ SPRING_FESTIVAL, DRAGON_BOAT, MID_AUTUMN, LANTERN, QINGMING }) => {
  const L = await import('/src/lib/lunar.ts');
  const iso = (d) => L.toDayISO(d);
  const out = {};

  // 1. 用「农历 → 公历」正推
  out.spring = {};
  for (const y of Object.keys(SPRING_FESTIVAL)) out.spring[y] = iso(L.lunarToSolar(+y, 1, 1));
  out.dragon = {};
  for (const y of Object.keys(DRAGON_BOAT)) out.dragon[y] = iso(L.lunarToSolar(+y, 5, 5));
  out.midAutumn = {};
  for (const y of Object.keys(MID_AUTUMN)) out.midAutumn[y] = iso(L.lunarToSolar(+y, 8, 15));
  out.lantern = {};
  for (const y of Object.keys(LANTERN)) out.lantern[y] = iso(L.lunarToSolar(+y, 1, 15));

  // 2. 反向：把已知公历日期转回农历，应得到对应月日
  out.back = {};
  for (const [y, d] of Object.entries(SPRING_FESTIVAL)) {
    const l = L.solarToLunar(L.parseDay(d));
    out.back[y] = l ? `${l.month}/${l.day}${l.isLeap ? '闰' : ''}` : 'null';
  }

  // 3. 闰月
  out.leap = {};
  for (const y of [2020, 2023, 2025, 2028]) out.leap[y] = L.leapMonth(y);

  // 4. 节气
  out.qingming = {};
  for (const [y, d] of Object.entries(QINGMING)) out.qingming[y] = L.solarTermOf(L.parseDay(d));

  // 5. 边界与鲁棒性
  out.bounds = {
    min: iso(L.lunarToSolar(1900, 1, 1)),
    max: iso(L.lunarToSolar(2100, 12, 1)),
    outOfRange: L.solarToLunar(new Date(1899, 0, 1)) === null,
  };
  // 6. 往返一致性：连续 3 年逐日 solar→lunar→solar 应完全回到原日期
  let roundTripFail = 0;
  const start = new Date(2025, 0, 1);
  for (let i = 0; i < 365 * 3; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const l = L.solarToLunar(d);
    if (!l) { roundTripFail++; continue; }
    const back = L.lunarToSolar(l.year, l.month, l.day, l.isLeap);
    if (!back || iso(back) !== iso(d)) roundTripFail++;
  }
  out.roundTripFail = roundTripFail;

  return out;
}, { SPRING_FESTIVAL, DRAGON_BOAT, MID_AUTUMN, LANTERN, QINGMING });

console.log('=== 春节（正月初一）===');
for (const [y, expect] of Object.entries(SPRING_FESTIVAL)) {
  check(`${y} 春节 = ${expect}`, data.spring[y] === expect, `实得 ${data.spring[y]}`);
}

console.log('\n=== 端午（五月初五）===');
for (const [y, expect] of Object.entries(DRAGON_BOAT)) {
  check(`${y} 端午 = ${expect}`, data.dragon[y] === expect, `实得 ${data.dragon[y]}`);
}

console.log('\n=== 中秋（八月十五）===');
for (const [y, expect] of Object.entries(MID_AUTUMN)) {
  check(`${y} 中秋 = ${expect}`, data.midAutumn[y] === expect, `实得 ${data.midAutumn[y]}`);
}

console.log('\n=== 元宵（正月十五）===');
for (const [y, expect] of Object.entries(LANTERN)) {
  check(`${y} 元宵 = ${expect}`, data.lantern[y] === expect, `实得 ${data.lantern[y]}`);
}

console.log('\n=== 反向换算（公历 → 农历，应回到正月初一）===');
for (const [y, d] of Object.entries(SPRING_FESTIVAL)) {
  check(`${d} → 农历 1/1`, data.back[y] === '1/1', `实得 ${data.back[y]}`);
}

console.log('\n=== 闰月 ===');
const expectLeap = { 2020: 4, 2023: 2, 2025: 6, 2028: 5 };
for (const [y, m] of Object.entries(expectLeap)) {
  check(`${y} 闰${m}月`, data.leap[y] === m, `实得闰${data.leap[y]}月`);
}

console.log('\n=== 清明（节气）===');
for (const [y, d] of Object.entries(QINGMING)) {
  check(`${d} 是清明`, data.qingming[y] === '清明', `实得 ${data.qingming[y]}`);
}

console.log('\n=== 边界与鲁棒性 ===');
check('1900 正月初一 = 1900-01-31', data.bounds.min === '1900-01-31', data.bounds.min);
check('支持到 2100 年', typeof data.bounds.max === 'string' && data.bounds.max.startsWith('2100'), data.bounds.max);
check('超出范围返回 null（不抛异常）', data.bounds.outOfRange === true);
check('连续 3 年逐日往返换算无错', data.roundTripFail === 0, `失败 ${data.roundTripFail} 天`);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
