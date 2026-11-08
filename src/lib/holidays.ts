import type { DayOverride, Weekday } from './types';
import { toWeekday } from './time';

/* ==========================================================================
   法定节假日与调休安排（内置表）
   ──────────────────────────────────────────────────────────────────────────
   为什么必须内置：这份数据**无法推算** —— 哪天放假、哪个周末补班，
   每年由国务院办公厅单独发通知，跟农历、星期几都没有函数关系。

   数据来源（逐条抄自官方通知原文，未做任何推断）：
     2025 年  国办发明电〔2024〕12 号
       https://www.gov.cn/gongbao/2024/issue_11726/202411/content_6989767.html
     2026 年  国办发明电〔2025〕7 号
       https://www.gov.cn/zhengce/content/202511/content_7047090.htm

   ⚠️ 这张表会过期。
     新一年的安排通常在**前一年 11 月**公布，公布后必须往 YEARS 里补一年，
     否则次年所有「放假/补课」判断都会错（应用不会崩，但会显示成普通工作日）。
     用户也可以在日历上按日期手动覆盖（见 DayOverride），不受这张表限制。

   本模块只回答两件事：
     · 这天是不是放假日
     · 这天是不是调休上班日（周末要上课的那种）
   它**不判断补课日该上星期几的课** —— 那取决于学校，
   由用户在日历上指定（见 settings/日历里的「按周几的课表」）。
   ========================================================================== */

export interface YearArrangement {
  /** 放假日：'MM-DD' → 节日名 */
  off: Record<string, string>;
  /** 调休上班日：'MM-DD' → 为哪个节日调休（这些日子通常是周末但要上课） */
  work: Record<string, string>;
}

/** 把 '2026-02-15' 这种日期区间展开成 'MM-DD' 列表 */
function range(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const out: string[] = [];
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    out.push(`${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}

/** 把列表收成 { 'MM-DD': name } */
function fill(days: string[], name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of days) out[d] = name;
  return out;
}

export const YEARS: Record<number, YearArrangement> = {
  /* ── 2025 ──────────────────────────────────────────────────────────
     元旦：1月1日（周三）放假1天，不调休
     春节：1月28日（周二）至2月4日（周二）放假调休，共8天
           1月26日（周日）、2月8日（周六）上班
     清明：4月4日（周五）至6日（周日）放假，共3天
     劳动节：5月1日（周四）至5日（周一）放假调休，共5天，4月27日（周日）上班
     端午：5月31日（周六）至6月2日（周一）放假，共3天
     国庆·中秋：10月1日（周三）至8日（周三）放假调休，共8天
           9月28日（周日）、10月11日（周六）上班 */
  2025: {
    off: {
      ...fill(['01-01'], '元旦'),
      ...fill(range('2025-01-28', '2025-02-04'), '春节'),
      ...fill(range('2025-04-04', '2025-04-06'), '清明'),
      ...fill(range('2025-05-01', '2025-05-05'), '劳动节'),
      ...fill(range('2025-05-31', '2025-06-02'), '端午'),
      ...fill(range('2025-10-01', '2025-10-08'), '国庆·中秋'),
    },
    work: {
      ...fill(['01-26'], '春节调休'),
      ...fill(['02-08'], '春节调休'),
      ...fill(['04-27'], '劳动节调休'),
      ...fill(['09-28'], '国庆调休'),
      ...fill(['10-11'], '国庆调休'),
    },
  },

  /* ── 2026 ──────────────────────────────────────────────────────────
     元旦：1月1日（周四）至3日（周六）放假调休，共3天，1月4日（周日）上班
     春节：2月15日（周日）至23日（周一）放假调休，共9天
           2月14日（周六）、2月28日（周六）上班
     清明：4月4日（周六）至6日（周一）放假，共3天
     劳动节：5月1日（周五）至5日（周二）放假调休，共5天，5月9日（周六）上班
     端午：6月19日（周五）至21日（周日）放假，共3天
     中秋：9月25日（周五）至27日（周日）放假，共3天
     国庆：10月1日（周四）至7日（周三）放假调休，共7天
           9月20日（周日）、10月10日（周六）上班 */
  2026: {
    off: {
      ...fill(range('2026-01-01', '2026-01-03'), '元旦'),
      ...fill(range('2026-02-15', '2026-02-23'), '春节'),
      ...fill(range('2026-04-04', '2026-04-06'), '清明'),
      ...fill(range('2026-05-01', '2026-05-05'), '劳动节'),
      ...fill(range('2026-06-19', '2026-06-21'), '端午'),
      ...fill(range('2026-09-25', '2026-09-27'), '中秋'),
      ...fill(range('2026-10-01', '2026-10-07'), '国庆'),
    },
    work: {
      ...fill(['01-04'], '元旦调休'),
      ...fill(['02-14'], '春节调休'),
      ...fill(['02-28'], '春节调休'),
      ...fill(['05-09'], '劳动节调休'),
      ...fill(['09-20'], '国庆调休'),
      ...fill(['10-10'], '国庆调休'),
    },
  },
};

/** 表里已覆盖的年份 */
export const COVERED_YEARS = Object.keys(YEARS).map(Number).sort();

/** 表里**没有**这个年份 —— 调用方据此提示用户「今年的安排还没收录」 */
export function isYearCovered(year: number): boolean {
  return year in YEARS;
}

export type HolidayKind = 'off' | 'work';

export interface HolidayInfo {
  kind: HolidayKind;
  /** 节日名或调休说明 */
  name: string;
}

/**
 * 查某天的法定节假日状态。
 * 返回 null 表示「普通日子」（既不是放假日也不是调休上班日）。
 */
export function holidayOf(dateKey: string): HolidayInfo | null {
  const year = Number(dateKey.slice(0, 4));
  const md = dateKey.slice(5);
  const arr = YEARS[year];
  if (!arr) return null;
  if (arr.off[md]) return { kind: 'off', name: arr.off[md] };
  if (arr.work[md]) return { kind: 'work', name: arr.work[md] };
  return null;
}

/* ---------------- 按日期覆盖课表 ---------------- */

/*
 * DayOverride 定义在 lib/types.ts（它属于会被持久化的数据，
 * 放这里会与 AppSnapshot 形成循环引用）。
 * 本文件只负责「给定日期 + 覆盖表，定出这天怎么上课」这个纯函数。
 */

export type DayReason = 'normal' | 'holiday' | 'makeup' | 'user-off' | 'user-makeup';

export interface ResolvedDay {
  /** 这天要不要上课 */
  hasClass: boolean;
  /** 按哪天的课表（hasClass 为 false 时该值无意义） */
  weekday: Weekday;
  reason: DayReason;
  /** 界面上给用户看的说明，普通日子为 null */
  label: string | null;
  /**
   * 是调休上班日，但用户还没指定「按周几的课表」。
   * 界面应据此提示用户去选 —— 不然这天会按它自己的星期几排课
   * （周日上班时按周日的课表 → 通常一节都没有，等于漏了一天课）。
   */
  needsMakeupChoice: boolean;
}

/**
 * 定出某天到底怎么上课。
 *
 * 优先级：用户覆盖 > 内置节假日表 > 正常按星期几。
 */
export function resolveDay(
  dateKey: string,
  realWeekday: Weekday,
  overrides: DayOverride[] = [],
): ResolvedDay {
  const ov = overrides.find((o) => o.date === dateKey);
  if (ov) {
    if (ov.schedule === 'off') {
      return { hasClass: false, weekday: realWeekday, reason: 'user-off', label: ov.note ?? '已设为不上课', needsMakeupChoice: false };
    }
    return { hasClass: true, weekday: ov.schedule, reason: 'user-makeup', label: ov.note ?? null, needsMakeupChoice: false };
  }

  const h = holidayOf(dateKey);
  if (h?.kind === 'off') {
    return { hasClass: false, weekday: realWeekday, reason: 'holiday', label: h.name, needsMakeupChoice: false };
  }
  if (h?.kind === 'work') {
    return { hasClass: true, weekday: realWeekday, reason: 'makeup', label: h.name, needsMakeupChoice: true };
  }
  return { hasClass: true, weekday: realWeekday, reason: 'normal', label: null, needsMakeupChoice: false };
}

/**
 * 取某一天「真正生效的星期几」（'yyyy-MM-dd'）。
 *
 * **凡是按星期几取作息/目标的地方都要用它，不要直接用 `new Date().getDay()`。**
 * 原因：用户调课时（`DayOverride.schedule`），这一天按**调课后的课表星期几**上课，
 * `resolveDay` 返回的就是那个星期几。如果这些地方各写各的，
 * 调课日就会出现「窗口按周一的、每日目标按周日的」这种不同步 —— 很难发现。
 *
 * `useDayPlan()` 内部也是这么算的（都走 `resolveDay`），所以首页与设置页口径一致。
 */
export function effectiveWeekday(dateKey: string, overrides: DayOverride[] = []): Weekday {
  const d = new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10)));
  return resolveDay(dateKey, toWeekday(d.getDay()), overrides).weekday;
}
