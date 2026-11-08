import { parseDay, solarTermOf, solarToLunar, lunarToSolar, toDayISO, lunarMonthName, lunarDayName } from './lunar';
import { holidayOf } from './holidays';

/* ==========================================================================
   节日库
   ──────────────────────────────────────────────────────────────────────────
   三类来源：
     1. 公历固定日期（元旦、国庆、圣诞…）—— 直接查表
     2. 农历传统节日（春节、端午、中秋、除夕…）—— 靠 lib/lunar 的换算
     3. 二十四节气 —— 同样来自 lib/lunar

   应用是本地优先、无后端、无 API，所以这里**只内置节日名**，不内置放假安排。
   调休（哪天补班）每年由国务院单独发布，硬编码进去会很快过期并产生错误信息，
   因此本模块只回答「今天是什么节日」，不回答「今天放不放假」。

   排序规则：农历节日与节气优先于公历节日 —— 因为春节、中秋这类是中国人真正
   在意的，而 2/14、12/25 属于点缀。同一天多个节日会全部返回，由界面决定怎么显示。
   ========================================================================== */

export type FestivalKind = 'solar' | 'lunar' | 'term';

export interface Festival {
  name: string;
  kind: FestivalKind;
  /** 是否为要紧的节日（春节/中秋/国庆这类），界面据此决定是否突出显示 */
  major: boolean;
}

/** 公历固定日期：'MM-DD' → 节日 */
const SOLAR_FESTIVALS: Record<string, { name: string; major: boolean }[]> = {
  '01-01': [{ name: '元旦', major: true }],
  '02-14': [{ name: '情人节', major: false }],
  '03-08': [{ name: '妇女节', major: false }],
  '03-12': [{ name: '植树节', major: false }],
  '04-01': [{ name: '愚人节', major: false }],
  '05-01': [{ name: '劳动节', major: true }],
  '05-04': [{ name: '青年节', major: false }],
  '05-12': [{ name: '护士节', major: false }],
  '06-01': [{ name: '儿童节', major: false }],
  '07-01': [{ name: '建党节', major: false }],
  '08-01': [{ name: '建军节', major: false }],
  '09-10': [{ name: '教师节', major: true }],
  '10-01': [{ name: '国庆节', major: true }],
  '12-24': [{ name: '平安夜', major: false }],
  '12-25': [{ name: '圣诞节', major: false }],
};

/**
 * 农历传统节日：'月-日' → 节日。
 * 除夕不在此表 —— 它是「腊月的最后一天」，随年份在廿九或三十，需单独判断。
 */
const LUNAR_FESTIVALS: Record<string, { name: string; major: boolean }[]> = {
  '1-1': [{ name: '春节', major: true }],
  '1-15': [{ name: '元宵节', major: true }],
  '2-2': [{ name: '龙抬头', major: false }],
  '3-3': [{ name: '上巳节', major: false }],
  '5-5': [{ name: '端午节', major: true }],
  '6-6': [{ name: '天贶节', major: false }],
  '7-7': [{ name: '七夕', major: false }],
  '7-15': [{ name: '中元节', major: false }],
  '8-15': [{ name: '中秋节', major: true }],
  '9-9': [{ name: '重阳节', major: false }],
  '10-1': [{ name: '寒衣节', major: false }],
  '10-15': [{ name: '下元节', major: false }],
  '12-8': [{ name: '腊八节', major: false }],
  '12-23': [{ name: '小年', major: false }],
};

/** 该天是否为除夕（次日为农历正月初一） */
function isNewYearsEve(date: Date): boolean {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const l = solarToLunar(next);
  return l !== null && l.month === 1 && l.day === 1 && !l.isLeap;
}

/** 取某一天的全部节日 */
export function festivalsOf(date: Date): Festival[] {
  const out: Festival[] = [];
  const iso = toDayISO(date);
  const md = iso.slice(5);

  for (const f of SOLAR_FESTIVALS[md] ?? []) {
    out.push({ name: f.name, kind: 'solar', major: f.major });
  }

  const lunar = solarToLunar(date);
  if (lunar) {
    for (const f of LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`] ?? []) {
      // 闰月不过节：闰五月初五不是端午
      if (lunar.isLeap) continue;
      out.push({ name: f.name, kind: 'lunar', major: f.major });
    }
    if (isNewYearsEve(date)) out.push({ name: '除夕', kind: 'lunar', major: true });
  }

  const term = solarTermOf(date);
  if (term) out.push({ name: term, kind: 'term', major: term === '清明' || term === '冬至' });

  // 农历节日与节气排在前面
  const order: Record<FestivalKind, number> = { lunar: 0, term: 1, solar: 2 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || Number(b.major) - Number(a.major));
  return out;
}

/**
 * 日历格子里的那行小字。
 * 优先级：重要节日 > 节气 > 农历日名（初一显示月名）。
 */
/** 供「今天是什么日子」这类提示使用：取最重要的一个节日名 */
export function primaryFestivalOf(date: Date): string | null {
  const fs = festivalsOf(date);
  return fs.length ? fs[0].name : null;
}

/**
 * 日历格子里的那行小字。
 * 优先级：**法定放假/调休** > 重要节日 > 节气 > 农历日名（初一显示月名）。
 *
 * 把放假与调休排在最前，是因为它们**会改变当天上不上课**，
 * 比「今天是什么节日」更该被一眼看到 ——
 * 尤其调休上班日（周末要上课），漏看就等于白丢一天课。
 */
export function cellSubLabel(date: Date): {
  text: string;
  kind: FestivalKind | 'lunar-day' | 'holiday';
  major: boolean;
} {
  const iso = toDayISO(date);
  const h = holidayOf(iso);
  if (h) {
    // 放假区间的显示规则（要求四十七）：节日当天写节日名称，连休其余天写「假」，
    // 不再整个区间重复同一个名字（例：中秋三天 = 中秋 / 假 / 假）。
    // 判定「节日当天」：这天有和假日同名的节日（中秋 09-25、春节 02-17、国庆 10-01）。
    // 调休上班日（kind: 'work'，如「国庆调休」）自带信息量，保持原样。
    if (h.kind === 'off') {
      const matchedFestival = festivalsOf(date).find(
        (f) => f.name === h.name || f.name.includes(h.name) || h.name.includes(f.name),
      );
      if (matchedFestival) {
        return { text: h.name, kind: 'holiday', major: true };
      }
      const prev = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
      const ph = holidayOf(toDayISO(prev));
      const isContinuation = !!ph && ph.kind === 'off' && ph.name === h.name;
      return { text: isContinuation ? '假' : h.name, kind: 'holiday', major: true };
    }
    return { text: h.name, kind: 'holiday', major: true };
  }

  const fs = festivalsOf(date);
  const major = fs.find((f) => f.major);
  if (major) return { text: major.name, kind: major.kind, major: true };
  const any = fs[0];
  if (any) return { text: any.name, kind: any.kind, major: any.major };
  const l = solarToLunar(date);
  if (!l) return { text: '', kind: 'lunar-day', major: false };
  return {
    text: l.day === 1 ? lunarMonthName(l.month, l.isLeap) : lunarDayName(l.day),
    kind: 'lunar-day',
    major: false,
  };
}

/* ---------------- 月历数据 ---------------- */

export interface DayCell {
  /** 'yyyy-MM-dd' */
  iso: string;
  date: Date;
  day: number;
  /** 是否属于当前显示的月份（月历首尾会补上相邻月的日子） */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  subLabel: string;
  subKind: FestivalKind | 'lunar-day' | 'holiday';
  festivals: Festival[];
}

/**
 * 生成某个月的月历格子（6 行 × 7 列 = 42 格，周一起始）。
 * 固定 42 格是为了让切换月份时高度不跳动。
 */
export function monthGrid(year: number, month: number, today = new Date()): DayCell[] {
  const first = new Date(year, month - 1, 1);
  // 周一为每周第一天：JS 里 getDay() 周日=0，换算成周一=0
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - lead);
  const todayIso = toDayISO(today);

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toDayISO(date);
    const fs = festivalsOf(date);
    const sub = cellSubLabel(date);
    const dow = date.getDay();
    cells.push({
      iso,
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === month - 1,
      isToday: iso === todayIso,
      isWeekend: dow === 0 || dow === 6,
      subLabel: sub.text,
      subKind: sub.kind,
      festivals: fs,
    });
  }
  return cells;
}

/** 反查某年春节（正月初一）的公历日期，供「下一个春节还有多久」这类提示使用 */
export function springFestivalOf(year: number): Date | null {
  return lunarToSolar(year, 1, 1);
}

/** 把 'yyyy-MM-dd' 解析成 Date（统一走 lunar 模块的实现，避免时区差一天） */
export { parseDay };
