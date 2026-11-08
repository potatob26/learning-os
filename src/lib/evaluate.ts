import type { DayOverride, Goal, Session, Settings, Task } from './types';
import { dayKey, settingsForDay } from './time';
import { effectiveWeekday } from './holidays';
import { computeStreaks } from './stats';

/* ==========================================================================
   学习评价 · 规则引擎
   ──────────────────────────────────────────────────────────────────────────
   规格书（用户给的 docx）要求，逐条落在这里：
     · 不使用任何 AI 模型或云端 API —— 纯规则 + 模板（本文件只做规则）
     · **规则引擎与语言模板相互独立** —— 本文件不出一个字，文字在 evaluateText.ts
     · **阈值集中配置，避免散落在代码中** —— 见下面的 EVAL
     · 计算过程可预测、可测试 —— 纯函数，输入相同输出必然相同
     · 不改变现有数据存储格式 —— 只读 sessions/goals/tasks/settings
     · 不影响现有计时、任务、统计、日历 —— 纯新增模块

   几条"不许越界"的硬约束（规格书原文，直接决定下面的 if）：
     · 没有计划或没有记录 → 不进行无依据的评价
     · 任务数量较少时，不要过度解读百分比
     · 只有存在足够的历史数据时才做趋势判断
     · 不能因为单日学习时长较少就认定用户懒惰
     · 不要假设每门学科都必须平均分配时间
     · 数据不足时跳过该项，不得强行制造进步或退步结论
   ========================================================================== */

/** 阈值与门槛 —— 集中一处，改口径只改这里 */
export const EVAL = {
  /** 学习时长：≥ 计划的 1.25 倍算"超额" */
  overRatio: 1.25,
  /** ≥ 计划本身算"达成" */
  metRatio: 1.0,
  /** ≥ 计划的 0.8 算"接近" */
  nearRatio: 0.8,

  /** 任务：完成率 ≥ 0.6 算"大部分完成" */
  taskMostRatio: 0.6,
  /** 任务数少于这个值时，不拿百分比说事（规格书：任务数量较少时不要过度解读） */
  taskCountMeaningful: 3,

  /** 做趋势判断所需的最少"有记录的天数" */
  minHistoryDays: 4,
  /** 连续学习达到这个天数才提"坚持" */
  streakWorthMentioning: 3,
  /** 近 7 天时长的变异系数 ≤ 这个值算"稳定" */
  stableCvMax: 0.35,
  /** 变异系数 ≥ 这个值算"明显波动" */
  volatileCvMin: 0.7,

  /** 某学科占比 ≥ 这个值 → 报告"集中在某科"（只陈述事实，不评判该不该） */
  subjectConcentratedShare: 0.5,
  /** 与用户自己历史比，占比变化 ≥ 这个幅度才算"明显变化" */
  subjectShift: 0.15,

  /** 与均值比，差异小于这个分钟数视为"基本持平" */
  flatMinutes: 5,
} as const;

export type DurationLevel = 'over' | 'met' | 'near' | 'below' | 'no-plan' | 'no-record';
export type TaskLevel = 'all' | 'most' | 'few' | 'none';
export type HabitLevel = 'steady' | 'streak' | 'fluctuating' | 'sparse' | 'unknown';
export type ProgressLevel = 'up' | 'down' | 'flat' | 'unknown';

export interface EvalFacts {
  dateKey: string;
  /** 当天计划（分钟）—— 来自按星期几的作息，未设天数目标时为 0 */
  planned: number;
  /** 当天实际（分钟） */
  actual: number;
  /** 实际 / 计划；没有计划时为 null（不编造分母） */
  ratio: number | null;
  durationLevel: DurationLevel;

  taskTotal: number;
  taskDone: number;
  taskLevel: TaskLevel;
  /** 任务数是否多到足以解读百分比 */
  taskCountMeaningful: boolean;

  streak: number;
  longest: number;
  /** 近 7 天里有记录的天数 */
  activeDays7: number;
  /** 近 7 天时长的变异系数（0 = 完全稳定）；数据不足为 null */
  fluctuation: number | null;
  habitLevel: HabitLevel;

  /** 今天投入最多的科目（没有记录则 null） */
  subjectTop: { subject: string; minutes: number; share: number } | null;
  subjectCount: number;
  /** 与"用户自己近 30 天"比，某科占比是否明显变化 */
  subjectShift: { subject: string; delta: number } | null;

  /** 今天 − 昨天（分钟）；昨天没记录为 null */
  vsYesterday: number | null;
  /** 今天 − 近 7 天均值（分钟） */
  vsAvg7: number | null;
  /** 本周合计 − 上周合计（分钟）；上周没数据为 null */
  vsLastWeek: number | null;
  progressLevel: ProgressLevel;

  /** 历史数据是否足以支撑趋势结论 */
  hasHistory: boolean;
  /** 关键表现标签（短词，用于界面上的小标签） */
  tags: string[];
}

export interface EvalInput {
  sessions: Session[];
  goals: Goal[];
  tasks: Task[];
  settings: Settings;
  dayOverrides?: DayOverride[];
  nowTs: number;
}

const MIN = 60;

function minutesOn(sessions: Session[], key: string): number {
  let sec = 0;
  for (const s of sessions) {
    if (dayKey(s.startedAt) === key) sec += s.durationSec;
  }
  return Math.round(sec / MIN);
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function computeEvalFacts(input: EvalInput): EvalFacts {
  const { sessions, tasks, settings, dayOverrides = [], nowTs } = input;
  const todayKey = dayKey(nowTs);

  /* ---------- 今日学习时长 ---------- */
  const actual = minutesOn(sessions, todayKey);
  /*
   * 计划取"当天"的口径：必须用 effectiveWeekday 解析调课日，再取按星期几合并后的作息。
   * 直接 new Date().getDay() 会在调课日算错 —— 这是本项目已有的坑。
   */
  const wd = effectiveWeekday(todayKey, dayOverrides);
  const daySettings = settingsForDay(settings, wd);
  const planned = Math.max(0, Math.round(daySettings.dailyGoalMinutes ?? 0));

  const ratio = planned > 0 ? actual / planned : null;
  let durationLevel: DurationLevel;
  if (actual === 0) {
    durationLevel = 'no-record'; // 规格书：没有记录 → 不做无依据的评价
  } else if (planned === 0) {
    durationLevel = 'no-plan'; // 规格书：没有计划 → 不评价"达没达成"
  } else if ((ratio ?? 0) >= EVAL.overRatio) {
    durationLevel = 'over';
  } else if ((ratio ?? 0) >= EVAL.metRatio) {
    durationLevel = 'met';
  } else if ((ratio ?? 0) >= EVAL.nearRatio) {
    durationLevel = 'near';
  } else {
    durationLevel = 'below';
  }

  /* ---------- 今日任务 ---------- */
  const todaysTasks = tasks.filter((t) => dayKey(t.createdAt) === todayKey || (t.doneAt ? dayKey(t.doneAt) === todayKey : false));
  const taskTotal = todaysTasks.length;
  const taskDone = todaysTasks.filter((t) => t.done).length;
  const taskCountMeaningful = taskTotal >= EVAL.taskCountMeaningful;
  let taskLevel: TaskLevel;
  if (taskTotal === 0) taskLevel = 'none'; // 规格书：没有任务 → 不评价任务完成
  else if (taskDone === taskTotal) taskLevel = 'all';
  else if (taskDone / taskTotal >= EVAL.taskMostRatio) taskLevel = 'most';
  else taskLevel = 'few';

  /* ---------- 学习习惯（需要足够历史） ---------- */
  const { streak, longest, activeDayKeys } = computeStreaks(sessions, nowTs);
  const last7: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowTs - i * 86400000);
    last7.push(dayKey(d.getTime()));
  }
  const perDay7 = last7.map((k) => minutesOn(sessions, k));
  const activeDays7 = perDay7.filter((m) => m > 0).length;
  const hasHistory = activeDays7 >= EVAL.minHistoryDays;
  const m7 = mean(perDay7.filter((m) => m > 0));
  const fluctuation = hasHistory && m7 > 0 ? stdev(perDay7.filter((m) => m > 0)) / m7 : null;

  let habitLevel: HabitLevel;
  if (!hasHistory) {
    habitLevel = 'unknown'; // 规格书：数据不足时跳过趋势判断
  } else if ((fluctuation ?? 0) >= EVAL.volatileCvMin) {
    habitLevel = 'fluctuating';
  } else if (streak >= EVAL.streakWorthMentioning) {
    habitLevel = 'streak';
  } else if ((fluctuation ?? 1) <= EVAL.stableCvMax) {
    habitLevel = 'steady';
  } else {
    habitLevel = 'sparse';
  }

  /* ---------- 学科分布 ---------- */
  const bySubject = new Map<string, number>();
  for (const s of sessions) {
    if (dayKey(s.startedAt) !== todayKey) continue;
    const sub = (s.subject || '').trim() || '其他';
    bySubject.set(sub, (bySubject.get(sub) ?? 0) + Math.round(s.durationSec / MIN));
  }
  const subjectCount = bySubject.size;
  let subjectTop: EvalFacts['subjectTop'] = null;
  if (actual > 0 && bySubject.size > 0) {
    const [subject, minutes] = [...bySubject.entries()].sort((a, b) => b[1] - a[1])[0];
    subjectTop = { subject, minutes, share: minutes / actual };
  }

  /*
   * 与"用户自己近 30 天"比占比变化 —— 只在有足够历史时给结论。
   * 规格书：不要假设每门学科都必须平均分配时间；没有明确计划时不得判断某科投入不足。
   * 所以这里只报告"和你自己比变了多少"，绝不说"哪科不足"。
   */
  let subjectShift: EvalFacts['subjectShift'] = null;
  if (hasHistory && subjectTop) {
    const recentKeys = new Set(activeDayKeys.slice(-30));
    const histBySubject = new Map<string, number>();
    let histTotal = 0;
    for (const s of sessions) {
      if (!recentKeys.has(dayKey(s.startedAt))) continue;
      if (dayKey(s.startedAt) === todayKey) continue; // 只跟历史比
      const sub = (s.subject || '').trim() || '其他';
      const mins = Math.round(s.durationSec / MIN);
      histBySubject.set(sub, (histBySubject.get(sub) ?? 0) + mins);
      histTotal += mins;
    }
    if (histTotal > 0) {
      const histShare = (histBySubject.get(subjectTop.subject) ?? 0) / histTotal;
      const delta = subjectTop.share - histShare;
      if (Math.abs(delta) >= EVAL.subjectShift) subjectShift = { subject: subjectTop.subject, delta };
    }
  }

  /* ---------- 进步 ---------- */
  const yesterdayKey = dayKey(nowTs - 86400000);
  const yesterday = minutesOn(sessions, yesterdayKey);
  const vsYesterday = yesterday > 0 ? actual - yesterday : null;
  const vsAvg7 = activeDays7 >= 2 ? Math.round(actual - m7) : null;

  // 本周 / 上周（按自然周 7 天窗口）
  const sumRange = (fromOffset: number, toOffset: number): number => {
    let total = 0;
    for (let i = fromOffset; i <= toOffset; i++) total += minutesOn(sessions, dayKey(nowTs - i * 86400000));
    return total;
  };
  const thisWeek = sumRange(0, 6);
  const lastWeek = sumRange(7, 13);
  const hasLastWeek = sumRange(7, 13) > 0;
  const vsLastWeek = hasLastWeek ? thisWeek - lastWeek : null;

  let progressLevel: ProgressLevel = 'unknown';
  if (hasHistory && vsAvg7 !== null) {
    if (vsAvg7 >= EVAL.flatMinutes) progressLevel = 'up';
    else if (vsAvg7 <= -EVAL.flatMinutes) progressLevel = 'down';
    else progressLevel = 'flat';
  }

  /* ---------- 关键表现标签 ---------- */
  const tags: string[] = [];
  if (durationLevel === 'over') tags.push('超额完成');
  if (durationLevel === 'met') tags.push('目标已完成');
  if (durationLevel === 'near') tags.push('接近目标');
  if (taskLevel === 'all' && taskTotal > 0) tags.push('任务全部完成');
  if (taskLevel === 'most' && taskCountMeaningful) tags.push('任务大部分完成');
  if (habitLevel === 'streak') tags.push(`连续 ${streak} 天`);
  if (habitLevel === 'steady') tags.push('节奏稳定');
  if (habitLevel === 'fluctuating') tags.push('时长波动');
  if (progressLevel === 'up') tags.push('持续进步');
  if (subjectTop && subjectTop.share >= EVAL.subjectConcentratedShare) tags.push(`集中在${subjectTop.subject}`);

  return {
    dateKey: todayKey,
    planned,
    actual,
    ratio,
    durationLevel,
    taskTotal,
    taskDone,
    taskLevel,
    taskCountMeaningful,
    streak,
    longest,
    activeDays7,
    fluctuation,
    habitLevel,
    subjectTop,
    subjectCount,
    subjectShift,
    vsYesterday,
    vsAvg7,
    vsLastWeek,
    progressLevel,
    hasHistory,
    tags,
  };
}

/**
 * 数据是否足以生成一条评价。
 * 规格书：没有计划或没有记录 → 不进行无依据的评价。
 * 所以"今天完全没数据、也没有计划"时返回 false，界面应显示引导而不是硬编一句评价。
 */
export function canEvaluate(f: EvalFacts): boolean {
  return f.actual > 0 || f.planned > 0 || f.taskTotal > 0 || f.hasHistory;
}
