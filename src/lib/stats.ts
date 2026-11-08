import type { Goal, Session, Settings } from './types';
import { hasPlannedMinutes } from './types';
import {
  addDaysTs,
  dayKey,
  diffDays,
  parseHM,
  spanMinutes,
  startOfDayTs,
  startOfMonthTs,
  startOfWeekTs,
  toWeekday,
} from './time';

/* ==========================================================================
   统计引擎
   ──────────────────────────────────────────────────────────────────────────
   铁律：所有数字都由 sessions / goals 真实计算，没有任何硬编码的假数据。
   ========================================================================== */

export interface SubjectStat {
  subject: string;
  minutes: number;
  sessions: number;
  share: number;
}

export interface StatsSummary {
  totalMinutes: number;
  todayMinutes: number;
  /** 有学习记录的天数 */
  activeDays: number;
  /** 区间内的平均每日学习时长（按区间天数算，不是按活跃天数） */
  averageMinutesPerDay: number;
  /** 区间内活跃日的平均时长 */
  averageMinutesPerActiveDay: number;
  sessionCount: number;
  longestSessionMinutes: number;
  longestSessionAt: number | null;
  subjects: SubjectStat[];
  topSubject: SubjectStat | null;
  /** 连续学习天数（截至今天/昨天） */
  streak: number;
  longestStreak: number;
  /** 目标完成率 */
  goalsTotal: number;
  goalsDone: number;
  goalCompletionRate: number;
  /** 计划 vs 实际 */
  plannedMinutes: number;
  actualMinutes: number;
  /** 计划偏差（正数=超出） */
  planDriftMinutes: number;
}

export interface RangeBounds {
  start: number;
  end: number;
  label: string;
  days: number;
}

export type RangeKey = 'today' | 'week' | 'month';

export function rangeBounds(key: RangeKey, nowTs: number): RangeBounds {
  if (key === 'today') {
    const start = startOfDayTs(nowTs);
    return { start, end: start + 86400000, label: '今日', days: 1 };
  }
  if (key === 'week') {
    const start = startOfWeekTs(nowTs);
    return { start, end: start + 7 * 86400000, label: '本周', days: 7 };
  }
  const start = startOfMonthTs(nowTs);
  const next = new Date(start);
  next.setMonth(next.getMonth() + 1);
  const end = next.getTime();
  return { start, end, label: '本月', days: Math.round((end - start) / 86400000) };
}

function inRange(ts: number, b: RangeBounds): boolean {
  return ts >= b.start && ts < b.end;
}

/* ---------------- 连续学习天数 ---------------- */

export function computeStreaks(
  sessions: Session[],
  nowTs: number,
  minMinutesPerDay = 10,
): { streak: number; longest: number; activeDayKeys: string[] } {
  const perDay = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    perDay.set(k, (perDay.get(k) ?? 0) + s.durationSec / 60);
  }

  const active = new Set<string>();
  for (const [k, mins] of perDay) {
    if (mins >= minMinutesPerDay) active.add(k);
  }

  const activeDays = [...active].sort();

  // 最长连续
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of activeDays) {
    if (prev) {
      const d = diffDays(new Date(prev).getTime(), new Date(k).getTime());
      run = d === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = k;
  }

  // 当前连续：从今天往回数；今天还没学不算断（延续昨天的连续）
  // 用 addDaysTs 而不是 cursor -= 86400000：后者依赖「每天正好 24 小时」，
  // 在夏令时时区会把日期算错一天（中国无 DST，但桌面用户可能在别的时区）。
  let streak = 0;
  let cursor = startOfDayTs(nowTs);
  if (!active.has(dayKey(cursor))) {
    cursor = addDaysTs(cursor, -1);
    if (!active.has(dayKey(cursor))) return { streak: 0, longest, activeDayKeys: activeDays };
  }
  while (active.has(dayKey(cursor))) {
    streak += 1;
    cursor = addDaysTs(cursor, -1);
  }

  return { streak, longest, activeDayKeys: activeDays };
}

/* ---------------- 汇总 ---------------- */

export function computeStats(
  sessions: Session[],
  goals: Goal[],
  bounds: RangeBounds,
  nowTs: number,
): StatsSummary {
  const scoped = sessions.filter((s) => inRange(s.startedAt, bounds));
  const totalMinutes = scoped.reduce((a, s) => a + s.durationSec, 0) / 60;

  const todayBounds = rangeBounds('today', nowTs);
  const todayMinutes =
    sessions.filter((s) => inRange(s.startedAt, todayBounds)).reduce((a, s) => a + s.durationSec, 0) / 60;

  const perDayCount = new Set(scoped.map((s) => dayKey(s.startedAt)));

  const bySubject = new Map<string, { minutes: number; sessions: number }>();
  for (const s of scoped) {
    const cur = bySubject.get(s.subject) ?? { minutes: 0, sessions: 0 };
    cur.minutes += s.durationSec / 60;
    cur.sessions += 1;
    bySubject.set(s.subject, cur);
  }
  const subjects: SubjectStat[] = [...bySubject.entries()]
    .map(([subject, v]) => ({
      subject,
      minutes: v.minutes,
      sessions: v.sessions,
      share: totalMinutes > 0 ? (v.minutes / totalMinutes) * 100 : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  let longestSessionMinutes = 0;
  let longestSessionAt: number | null = null;
  for (const s of scoped) {
    const m = s.durationSec / 60;
    if (m > longestSessionMinutes) {
      longestSessionMinutes = m;
      longestSessionAt = s.startedAt;
    }
  }

  const streaks = computeStreaks(sessions, nowTs);

  // 目标：按创建时间落在区间内统计
  const scopedGoals = goals.filter((g) => inRange(g.createdAt, bounds));
  const goalsDone = scopedGoals.filter((g) => g.status === 'done').length;
  // 不限时长的目标（plannedMinutes = null）没有计划值可加，按 0 计
  const plannedMinutes = scopedGoals.reduce((a, g) => a + (g.plannedMinutes ?? 0), 0);
  // 实际时间：优先用目标累计的实际时间；没有绑定目标的记录按科目归集不好算，直接用目标数据
  const actualMinutes = scopedGoals.reduce((a, g) => a + g.actualMinutes, 0);

  return {
    totalMinutes,
    todayMinutes,
    activeDays: perDayCount.size,
    averageMinutesPerDay: bounds.days > 0 ? totalMinutes / bounds.days : 0,
    averageMinutesPerActiveDay: perDayCount.size > 0 ? totalMinutes / perDayCount.size : 0,
    sessionCount: scoped.length,
    longestSessionMinutes,
    longestSessionAt,
    subjects,
    topSubject: subjects[0] ?? null,
    streak: streaks.streak,
    longestStreak: streaks.longest,
    goalsTotal: scopedGoals.length,
    goalsDone,
    goalCompletionRate: scopedGoals.length > 0 ? (goalsDone / scopedGoals.length) * 100 : 0,
    plannedMinutes,
    actualMinutes,
    planDriftMinutes: actualMinutes - plannedMinutes,
  };
}

/* ---------------- 图表数据 ---------------- */

export interface BarDatum {
  key: string;
  label: string;
  sublabel?: string;
  minutes: number;
  plannedMinutes?: number;
  isToday?: boolean;
  isFuture?: boolean;
}

/** 最近 N 天，每天一个柱子（没有记录的天也是真实的 0） */
export function dailyBars(sessions: Session[], nowTs: number, days: number): BarDatum[] {
  const out: BarDatum[] = [];
  const todayStart = startOfDayTs(nowTs);
  const perDay = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    perDay.set(k, (perDay.get(k) ?? 0) + s.durationSec / 60);
  }
  for (let i = days - 1; i >= 0; i--) {
    const ts = todayStart - i * 86400000;
    const k = dayKey(ts);
    const d = new Date(ts);
    out.push({
      key: k,
      label: days <= 7 ? ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] : `${d.getDate()}`,
      sublabel: `${d.getMonth() + 1}/${d.getDate()}`,
      minutes: Math.round(perDay.get(k) ?? 0),
      isToday: i === 0,
    });
  }
  return out;
}

/** 本周一~周日（未来的天标记出来，不假装有数据） */
export function weekBars(sessions: Session[], nowTs: number): BarDatum[] {
  const weekStart = startOfWeekTs(nowTs);
  const todayStart = startOfDayTs(nowTs);
  const perDay = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    perDay.set(k, (perDay.get(k) ?? 0) + s.durationSec / 60);
  }
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  return labels.map((lb, i) => {
    const ts = weekStart + i * 86400000;
    const k = dayKey(ts);
    const d = new Date(ts);
    return {
      key: k,
      label: `周${lb}`,
      sublabel: `${d.getMonth() + 1}/${d.getDate()}`,
      minutes: Math.round(perDay.get(k) ?? 0),
      isToday: ts === todayStart,
      isFuture: ts > todayStart,
    };
  });
}

/** 本月每天一个柱子 */
export function monthBars(sessions: Session[], nowTs: number): BarDatum[] {
  const bounds = rangeBounds('month', nowTs);
  const todayStart = startOfDayTs(nowTs);
  const perDay = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    perDay.set(k, (perDay.get(k) ?? 0) + s.durationSec / 60);
  }
  const out: BarDatum[] = [];
  for (let i = 0; i < bounds.days; i++) {
    const ts = bounds.start + i * 86400000;
    const k = dayKey(ts);
    const d = new Date(ts);
    out.push({
      key: k,
      label: `${d.getDate()}`,
      sublabel: `${d.getMonth() + 1}/${d.getDate()}`,
      minutes: Math.round(perDay.get(k) ?? 0),
      isToday: ts === todayStart,
      isFuture: ts > todayStart,
    });
  }
  return out;
}

/** 计划 vs 实际：按目标截止/创建日归集 */
export function planVsActual(goals: Goal[], nowTs: number, days: number): BarDatum[] {
  const todayStart = startOfDayTs(nowTs);
  const out: BarDatum[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = todayStart - i * 86400000;
    const dayEnd = dayStart + 86400000;
    // 显式排除成果目标：它是「计划 vs 实际（时长）」这张图，
    // 而不计时的目标没有时长可言。数值上本来就是 0/0，但写出来免得后人误解。
    const scoped = goals.filter(
      (g) => g.kind !== 'outcome' && g.createdAt >= dayStart && g.createdAt < dayEnd,
    );
    const d = new Date(dayStart);
    out.push({
      key: dayKey(dayStart),
      label: days <= 7 ? ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] : `${d.getDate()}`,
      sublabel: `${d.getMonth() + 1}/${d.getDate()}`,
      minutes: Math.round(scoped.reduce((a, g) => a + g.actualMinutes, 0)),
      plannedMinutes: Math.round(scoped.reduce((a, g) => a + (g.plannedMinutes ?? 0), 0)),
      isToday: i === 0,
    });
  }
  return out;
}

/* ---------------- 今日学习进度 ---------------- */

export interface TodayProgress {
  studiedMinutes: number;
  goalMinutes: number;
  percent: number;
  /** 可支配时间内已用比例 */
  availabilityPercent: number;
  remainingAvailableMinutes: number;
  availableMinutes: number;
}

export function todayProgress(
  sessions: Session[],
  settings: Settings,
  nowTs: number,
  availableMinutes: number,
  remainingAvailableMinutes: number,
): TodayProgress {
  const todaySessions = sessions.filter((s) => dayKey(s.startedAt) === dayKey(nowTs));
  const studiedMinutes = todaySessions.reduce((a, s) => a + s.durationSec, 0) / 60;
  const goalMinutes = settings.dailyGoalMinutes;
  return {
    studiedMinutes,
    goalMinutes,
    /*
     * 今日目标百分比**不封顶**：学了 6 小时、目标 3 小时就是 200%。
     * 以前这里和 `pct()` 都封在 100，于是"超额完成"这件事在界面上被抹掉了。
     * ⚠️ 首页、小组件载荷、统计三处都读这个值，所以**必须一起改** ——
     * test-widget-payload 里有一条断言专门要求小组件与首页显示的数字一致。
     */
    percent: goalMinutes > 0 ? (studiedMinutes / goalMinutes) * 100 : 0,
    /* 「课后可支配」是另一回事：它衡量"用掉了多少可用时间"，到 100% 就是满了 */
    availabilityPercent:
      availableMinutes > 0
        ? Math.min(100, (studiedMinutes / availableMinutes) * 100)
        : 0,
    remainingAvailableMinutes,
    availableMinutes,
  };
}

/* ---------------- 今日目标 / 任务 ---------------- */

export function isDueToday(dueAt: string | null | undefined, nowTs: number): boolean {
  if (!dueAt) return false;
  const t = new Date(dueAt.replace(' ', 'T')).getTime();
  if (!Number.isFinite(t)) return false;
  return dayKey(t) === dayKey(nowTs);
}

export function isOverdue(dueAt: string | null | undefined, nowTs: number): boolean {
  if (!dueAt) return false;
  const t = new Date(dueAt.replace(' ', 'T')).getTime();
  if (!Number.isFinite(t)) return false;
  return t < nowTs;
}

/** 首页「今天要做什么」的排序：逾期 > 今日到期 > 进行中 > 重要 > 新建 */
export function todayGoals(goals: Goal[], nowTs: number): Goal[] {
  const wd = toWeekday(new Date(nowTs).getDay());
  void wd;
  return goals
    .filter((g) => g.status !== 'dropped')
    .filter((g) => {
      if (g.status === 'done') return isDueToday(g.dueAt, nowTs) || dayKey(g.completedAt ?? 0) === dayKey(nowTs);
      if (g.status === 'doing') return true;
      return isDueToday(g.dueAt, nowTs) || isOverdue(g.dueAt, nowTs) || !g.dueAt;
    })
    .sort((a, b) => score(a, nowTs) - score(b, nowTs));
}

function score(g: Goal, nowTs: number): number {
  let s = 0;
  if (g.status === 'done') s += 1000;
  if (isOverdue(g.dueAt, nowTs) && g.status !== 'done') s -= 100;
  if (isDueToday(g.dueAt, nowTs)) s -= 50;
  if (g.status === 'doing') s -= 30;
  if (g.priority === 'high') s -= 20;
  else if (g.priority === 'low') s += 10;
  s -= Math.min(9, Math.max(0, (nowTs - g.createdAt) / 86400000));
  return s;
}

/** 目标完成时间偏差（分钟）：正数=超时，负数=提前。成果目标或「不限时长」的目标没有时间维度，返回 null */
export function goalTimeDelta(g: Goal): number | null {
  if (g.status !== 'done') return null;
  if (!hasPlannedMinutes(g)) return null;
  return Math.round(g.actualMinutes - (g.plannedMinutes ?? 0));
}

/* ---------------- 目标进度 ---------------- */

/**
 * 目标进度 0..1。两类目标统一走这一个函数，避免各处各算一套。
 *
 * · 计时目标：实际 / 计划（计划为 0 时返回 null，表示「没有进度可言」）
 * · 成果目标：(当前 − 起始) / (目标 − 起始)
 *
 * 成果目标为什么要减起始值：否则「名次 25 → 目标 10」一建出来就是
 * 10/25 = 40%，看起来什么都没干就完成了四成。减掉起始值后从 0% 起算，
 * 而且**方向自动成立** —— 目标比起始小就是「越小越好」，
 * 名次从 25 走到 18 得 (18−25)/(10−25) = 47%，不需要额外的方向开关。
 *
 * 返回值做了 clamp：超额完成不显示 >100%，反向倒退不显示负数。
 */
export function goalRatio(g: Goal): number | null {
  if (g.kind === 'outcome') {
    const p = g.progress;
    if (!p) return null;
    const span = p.target - p.start;
    // 目标值等于起始值：没有可度量的过程，不给进度（表单那边也会拦住）
    if (span === 0) return null;
    return Math.max(0, Math.min(1, (p.current - p.start) / span));
  }
  // 「不限时长」的计时目标没有分母，不给进度（不是 0%，是"没有这个维度"）
  if (!hasPlannedMinutes(g)) return null;
  return Math.max(0, Math.min(1, g.actualMinutes / (g.plannedMinutes ?? 0)));
}

/**
 * 成果目标进度的**推导过程**：把「百分比是怎么来的」拆成人能读的几个数。
 *
 * 为什么要做这个（1.3.0 · 用户报的 Bug ②）：
 * 用户看到名次目标显示 80%，第一反应是"不对"。但公式本身没错 ——
 * `(当前 − 起始) / (目标 − 起始)`，80% 只可能来自「起始记成了 21」这种情况。
 * 问题在于**界面上看不出起点在哪**，所以数字无法自证。
 *
 * 把起点、已前进、还差写出来之后：
 *   ① 数字不再误导（能看出 80% 是"从 21 名走到 5 名"）；
 *   ② 如果起始值本身记错了（比如应该是 30），这句话会**立刻暴露它** ——
 *      比事后追查可靠得多。
 *
 * 方向（越小越好 / 越大越好）**由起始值与目标值的大小决定**，与表单里
 * 「目标值 < 当前值 → 越小越好」的判据一致（创建时 当前值 === 起始值）。
 * 不引入方向开关：少一个选错的机会。
 */
export interface OutcomeBreakdown {
  start: number;
  current: number;
  target: number;
  unit: string;
  /** 越小越好（名次类） */
  lowerIsBetter: boolean;
  /** 已经朝目标方向前进了多少 */
  advanced: number;
  /** 还差多少到目标 */
  remaining: number;
  /** 跨度 = |目标 − 起始|，为 0 时算不出进度 */
  span: number;
}

export function outcomeBreakdown(g: Goal): OutcomeBreakdown | null {
  const p = g.progress;
  if (g.kind !== 'outcome' || !p) return null;
  const lowerIsBetter = p.target < p.start;
  const delta = lowerIsBetter ? p.start - p.current : p.current - p.start;
  const remaining = lowerIsBetter ? p.current - p.target : p.target - p.current;
  return {
    start: p.start,
    current: p.current,
    target: p.target,
    unit: p.unit ?? '',
    lowerIsBetter,
    advanced: Math.max(0, delta),
    remaining: Math.max(0, remaining),
    span: Math.abs(p.target - p.start),
  };
}

/**
 * 成果目标的进度文案，例如「18 / 10 名」或「已完成 47%」的原始数据。
 * 放进 lib 是为了首页和目标页显示同一套，不会两处漂移。
 */
export function outcomeLabel(g: Goal): string | null {
  const p = g.progress;
  if (g.kind !== 'outcome' || !p) return null;
  const unit = p.unit ? ` ${p.unit}` : '';
  return `${p.current} / ${p.target}${unit}`;
}


/* ---------------- 固定活动时长 ---------------- */

export function blockDuration(b: { start: string; end: string }): number {
  const s = parseHM(b.start);
  const e = parseHM(b.end);
  if (s === null || e === null) return 0;
  return spanMinutes(s, e);
}

/* ==========================================================================
   逐日学习量（学习日历与热力图共用）
   ──────────────────────────────────────────────────────────────────────────
   铁律同上：每天的数字都由 sessions 真实计算，没有记录就是 0，
   绝不用随机数或占位值填充。
   ========================================================================== */

export interface DayCell {
  /** YYYY-MM-DD */
  key: string;
  /** 当天 0 点的时间戳 */
  ts: number;
  /** 当天学习分钟数 */
  minutes: number;
  /** 当天记录段数 */
  segments: number;
  /** 当天涉及的科目（去重，保持首次出现顺序） */
  subjects: string[];
}

/**
 * 把 sessions 聚合成「每天一格」的索引。
 *
 * 刻意做成索引而不是「逐天过滤」：日历要铺 42 格、热力图要铺 180 格以上，
 * 若每格都扫一遍全部记录就是 O(格子数 × 记录数)，记录攒到几千条时会明显卡。
 * 这里只遍历一次 sessions，之后按 key 取即可。
 *
 * 归日口径与既有统计一致：按**开始时间**所在的那天算。
 */
export function indexByDay(sessions: Session[]): Map<string, DayCell> {
  const map = new Map<string, DayCell>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    let cell = map.get(key);
    if (!cell) {
      cell = { key, ts: startOfDayTs(s.startedAt), minutes: 0, segments: 0, subjects: [] };
      map.set(key, cell);
    }
    cell.minutes += s.durationSec / 60;
    cell.segments += 1;
    if (s.subject && !cell.subjects.includes(s.subject)) cell.subjects.push(s.subject);
  }
  for (const cell of map.values()) cell.minutes = Math.round(cell.minutes);
  return map;
}

/** 连续 days 天的格子（截至 endTs 当天），没有记录的天也返回，值为 0 */
export function dayCells(index: Map<string, DayCell>, endTs: number, days: number): DayCell[] {
  const end = startOfDayTs(endTs);
  const out: DayCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = addDaysTs(end, -i);
    const key = dayKey(ts);
    out.push(index.get(key) ?? { key, ts, minutes: 0, segments: 0, subjects: [] });
  }
  return out;
}

export interface MonthGrid {
  year: number;
  /** 0-11 */
  month: number;
  /** 1 号是周几（0=周日 … 6=周六） */
  firstWeekday: number;
  /** 该月每一天（1 号到最后一天） */
  cells: DayCell[];
  /** 本月合计分钟 */
  totalMinutes: number;
  /** 本月有记录的天数 */
  activeDays: number;
  /** 本月记录段数 */
  segments: number;
}

/** 取某个自然月的逐日数据，供日历铺格子 */
export function monthGrid(index: Map<string, DayCell>, year: number, month: number): MonthGrid {
  const first = new Date(year, month, 1);
  // 下个月 0 号 = 本月最后一天
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cells: DayCell[] = [];
  let totalMinutes = 0;
  let activeDays = 0;
  let segments = 0;

  for (let d = 1; d <= lastDay; d++) {
    const ts = new Date(year, month, d).getTime();
    const key = dayKey(ts);
    const cell = index.get(key) ?? { key, ts, minutes: 0, segments: 0, subjects: [] };
    cells.push(cell);
    totalMinutes += cell.minutes;
    segments += cell.segments;
    if (cell.minutes > 0) activeDays += 1;
  }

  return {
    year,
    month,
    firstWeekday: first.getDay(),
    cells,
    totalMinutes,
    activeDays,
    segments,
  };
}

/**
 * 热力分档的参考值：取所有「有记录的天」的 90 分位。
 * 用分位而不是最大值 —— 否则某天突击学了 8 小时，会把其余所有天都压成最浅一档。
 */
export function heatScale(cells: DayCell[]): number {
  const vals = cells.filter((c) => c.minutes > 0).map((c) => c.minutes).sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
}

/** 把分钟数映射到 0~4 档（0 = 无记录） */
export function heatLevel(minutes: number, scale: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (scale <= 0) return 1;
  const r = minutes / scale;
  if (r < 0.25) return 1;
  if (r < 0.5) return 2;
  if (r < 0.75) return 3;
  return 4;
}
