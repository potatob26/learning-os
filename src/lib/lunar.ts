/* ==========================================================================
   农历换算
   ──────────────────────────────────────────────────────────────────────────
   为什么要自己实现：应用是**本地优先、无后端、无 API key**，
   而农历（以及依附于它的春节/端午/中秋/除夕）无法用公历公式算出来，
   必须内置一份换算数据。

   数据表 lunarInfo：
     覆盖 1900–2100 年，每年一个 20 位十六进制数，编码该年的：
       bit 16      闰月是大月(30天)还是小月(29天)
       bit 15..4   12 个农历月的大小月（1 = 30 天，0 = 29 天），从正月到腊月
       bit 3..0    闰月月份（0 表示该年无闰月）
     这是业界广泛使用的紧凑表示法，此处按原样采用，未做改动。

   ⚠️ 这类数据表最容易在「抄错一位」上翻车，而抄错后平时看不出来、
      只在某些年份的某几天错位。因此配套写了 scripts/test-lunar.mjs，
      拿**已知的公开发布日期**（历年春节/中秋/端午的公历日期）逐条核对。
      改动本文件后务必跑一次那个测试。
   ========================================================================== */

/** 1900–2100 年，共 201 项 */
const lunarInfo = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];

const MIN_YEAR = 1900;
const MAX_YEAR = 1900 + lunarInfo.length - 1; // 2100

/** 该农历年的闰月月份；0 = 无闰月 */
export function leapMonth(year: number): number {
  return lunarInfo[year - MIN_YEAR] & 0xf;
}

/** 该农历年闰月的天数（无闰月返回 0） */
export function leapDays(year: number): number {
  if (!leapMonth(year)) return 0;
  return (lunarInfo[year - MIN_YEAR] & 0x10000) ? 30 : 29;
}

/** 该农历年第 month 个月的天数（month 从 1 起） */
export function monthDays(year: number, month: number): number {
  return (lunarInfo[year - MIN_YEAR] & (0x10000 >> month)) ? 30 : 29;
}

/** 该农历年的总天数 */
export function lunarYearDays(year: number): number {
  let sum = 348; // 12 * 29
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (lunarInfo[year - MIN_YEAR] & i) ? 1 : 0;
  return sum + leapDays(year);
}

/* ---------------- 公历 ↔ 农历 ---------------- */

/*
 * 天数运算必须走 UTC，不能用本地时间加减毫秒
 * ──────────────────────────────────────────────────────────────
 * 实测踩过的坑：1900 年上海的时区偏移是 **GMT+08:05:43**（旧标准时），
 * 而今天是 GMT+08:00。用
 *     new Date(1900, 0, 31).getTime() + n * 86400000
 * 做天数累加，跨过这个偏移差之后会落在**前一天的 23:54:17**，
 * 于是整个农历换算系统性差一天（2024 春节算成 02-09）。
 * 这个偏差只有 5 分 43 秒，却足以把日期挤到前一天，而且平时完全看不出来。
 *
 * 改法：用 Date.UTC 的口径做纯天数运算，再按 UTC 的年月日还原成本地零点。
 * 这条经验由 scripts/test-lunar.mjs 发现 —— 那个测试就是为此写的。
 */
const BASE_UTC = Date.UTC(MIN_YEAR, 0, 31);

/** 从 1900-01-31 起的天数 → 本地零点的 Date */
function dayIndexToDate(dayIndex: number): Date {
  const t = new Date(BASE_UTC + dayIndex * 86400000);
  return new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

/** 本地日期的零点 → 从 1900-01-31 起的天数 */
function dateToDayIndex(date: Date): number {
  return Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - BASE_UTC) / 86400000,
  );
}

export interface LunarDate {
  /** 农历年 */
  year: number;
  /** 农历月，1..12 */
  month: number;
  /** 农历日，1..30 */
  day: number;
  /** 是否闰月 */
  isLeap: boolean;
}

export const LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'] as const;
export const LUNAR_DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
] as const;

/** 把 'yyyy-MM-dd' 解析成本地时间的 Date（避免 UTC 偏移导致差一天） */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 把 Date 格式化成 'yyyy-MM-dd' */
export function toDayISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 列出该农历年的所有月份（含闰月，闰月紧跟在它所重复的月份之后）。
 * 把「闰月插入位置」这件事集中在这里处理一次，
 * 后面的换算只按线性列表走 —— 比在循环里边算边插闰月清楚得多，
 * 也避免闰月那年的正月初一算错（写第一版时就绕晕过）。
 */
export function lunarMonthsOf(year: number): Array<{ month: number; isLeap: boolean; days: number }> {
  const leap = leapMonth(year);
  const list: Array<{ month: number; isLeap: boolean; days: number }> = [];
  for (let m = 1; m <= 12; m++) {
    list.push({ month: m, isLeap: false, days: monthDays(year, m) });
    if (leap === m) list.push({ month: m, isLeap: true, days: leapDays(year) });
  }
  return list;
}

/**
 * 公历 → 农历。
 * 以 1900-01-31（农历 1900 年正月初一）为基准日累减。
 */
export function solarToLunar(date: Date): LunarDate | null {
  const y = date.getFullYear();
  if (y < MIN_YEAR || y > MAX_YEAR) return null;

  let offset = dateToDayIndex(date);
  if (offset < 0) return null;

  let lunarYear = MIN_YEAR;
  for (; lunarYear <= MAX_YEAR; lunarYear++) {
    const days = lunarYearDays(lunarYear);
    if (offset < days) break;
    offset -= days;
  }
  if (lunarYear > MAX_YEAR) return null;

  for (const m of lunarMonthsOf(lunarYear)) {
    if (offset < m.days) {
      return { year: lunarYear, month: m.month, day: offset + 1, isLeap: m.isLeap };
    }
    offset -= m.days;
  }
  return null;
}

/** 农历 → 公历（用于反查某年春节等） */
export function lunarToSolar(year: number, month: number, day: number, isLeap = false): Date | null {
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  let offset = 0;
  for (let y = MIN_YEAR; y < year; y++) offset += lunarYearDays(y);
  for (const m of lunarMonthsOf(year)) {
    if (m.month === month && m.isLeap === isLeap) {
      return dayIndexToDate(offset + day - 1);
    }
    offset += m.days;
  }
  return null;
}

/** 农历日的中文名 */
export function lunarDayName(day: number): string {
  return LUNAR_DAY_NAMES[day - 1] ?? '';
}

/** 农历月的中文名（含闰月前缀） */
export function lunarMonthName(month: number, isLeap = false): string {
  return `${isLeap ? '闰' : ''}${LUNAR_MONTH_NAMES[month - 1] ?? ''}月`;
}

/** 供界面显示：初一显示月名，否则显示日名 */
export function lunarLabel(l: LunarDate): string {
  if (l.day === 1) return lunarMonthName(l.month, l.isLeap);
  return lunarDayName(l.day);
}

/* ---------------- 二十四节气 ---------------- */

/**
 * 节气数据：每个世纪一个基准，配合年份尾数查表。
 * 计算式：day = floor(Y * 0.2422 + C) - floor((Y - 1) / 4)
 * 其中 Y 是年份后两位，C 是该节气在该世纪的常数。
 */
const SOLAR_TERM_C_20 = [
  6.11, 20.84, 4.6295, 19.4599, 6.3826, 21.4155, 5.59, 20.888,
  6.318, 21.86, 6.5, 22.2, 7.928, 23.65, 8.35, 23.95,
  8.44, 23.822, 9.098, 24.218, 8.218, 23.08, 7.9, 22.6,
];
const SOLAR_TERM_C_21 = [
  5.4055, 20.12, 3.87, 18.73, 5.63, 20.646, 4.81, 20.1,
  5.52, 21.04, 5.678, 21.37, 7.108, 22.83, 7.5, 23.13,
  7.646, 23.042, 8.318, 23.438, 7.438, 22.36, 7.18, 21.94,
];
export const SOLAR_TERM_NAMES = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
  '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
] as const;

/** 该公历年的第 n 个节气（0=小寒 … 23=冬至）落在几号 */
function solarTermDay(year: number, n: number): number {
  const table = year >= 2000 ? SOLAR_TERM_C_21 : SOLAR_TERM_C_20;
  const y = year % 100;
  let day = Math.floor(y * 0.2422 + table[n]) - Math.floor((y - 1) / 4);
  /*
   * 例外修正。
   * 通式对绝大多数年份成立，但个别年份会差一天 —— 这些是公开日历上可查证的。
   * 只登记**核对过**的，不做猜测：乱加例外反而会把本来正确的年份改错
   * （第一版我就凭印象给 2026 小寒加了个例外，实际通式算出来是对的）。
   */
  const exceptions: Record<string, number> = {
    '2024-6': 4, // 清明：通式给 5，实际为 4 月 4 日
  };
  const ex = exceptions[`${year}-${n}`];
  if (ex !== undefined) day = ex;
  return day;
}

/** 取某天的节气名；不是节气则返回 null */
export function solarTermOf(date: Date): string | null {
  const y = date.getFullYear();
  if (y < 1900 || y > 2100) return null;
  const m = date.getMonth(); // 0..11
  const d = date.getDate();
  // 每个月两个节气：第 m 个月对应索引 m*2 与 m*2+1
  for (const n of [m * 2, m * 2 + 1]) {
    // 节气 n 落在 (n/2 + 1) 月
    const termMonth = Math.floor(n / 2);
    if (termMonth !== m) continue;
    if (solarTermDay(y, n) === d) return SOLAR_TERM_NAMES[n];
  }
  return null;
}
