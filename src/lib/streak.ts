import type { Session, StreakRescue } from './types';
import { addDaysTs, dayKey, parseDateInput } from './time';

/* ==========================================================================
   火花（连续学习天数）与断签挽救
   ──────────────────────────────────────────────────────────────────────────
   · 基线口径与 computeStreaks（stats.ts）保持一致：每天学习 ≥10 分钟算一个学习日；
     今天还没学不算断。
   · 挽救规则（用户拍板「两日修复 + 显式确认」）：
       只救恰好缺一天；缺口前至少连续 3 天；
       缺口后 3 天内连续 2 天各 ≥20 分钟；用户手动确认才生效；
       两次接回间隔 ≥14 天；同一个缺口只能救一次。
   · 铁律：接回**不生成 Session、不增加任何学习时长**；缺口日仍然不是学习日，
     只在计算连续天数时当作「桥接日」。账本里的记录每次读取都会重新校验：
     - 缺口日后来被手动补录了真实记录 → 账本失效（防双算）；
     - 补学日的记录被删掉/改短 → 账本失效。
   ========================================================================== */

/** 与 computeStreaks 的默认阈值同源 */
export const STREAK_MIN_MINUTES = 10;
/** 补学日每天至少要学多少分钟 */
export const STREAK_RESCUE_MIN_MINUTES = 20;
/** 需要连续补学几天 */
export const STREAK_RESCUE_DAYS = 2;
/** 缺口后多少天内完成补学有效 */
export const STREAK_RESCUE_WINDOW_DAYS = 3;
/** 两次接回的最小间隔 */
export const STREAK_RESCUE_COOLDOWN_DAYS = 14;
/** 缺口前至少要连续多少天，才值得救 */
export const STREAK_RESCUE_MIN_RUN = 3;

export type StreakPhase =
  /** 从没有学习日 */
  | 'empty'
  /** 今天已经学满阈值 */
  | 'active'
  /** 今天还没学，但昨天学了（连续还在） */
  | 'pending'
  /** 只缺昨天，今天还来得及开始补学 */
  | 'restorable'
  /** 补学中（已满足 1 天） */
  | 'repairing'
  /** 两天都满足，等用户点「接回」 */
  | 'ready'
  /** 断了两天以上 / 冷却中 / 缺口前不足 3 天 / 补学链断了 */
  | 'broken';

export interface StreakState {
  /** 展示用连续天数（原始学习日 + 已验证的接回桥接日） */
  streak: number;
  /** 历史最长（同样把已验证的接回算进去） */
  longest: number;
  /** 原始「≥10 分钟」学习日，按 yyyy-MM-dd 升序 */
  activeDayKeys: string[];
  /** 已被有效账本桥接的缺口日（这些天仍然不算学习日） */
  repairedGapDays: string[];
  phase: StreakPhase;
  /** 当前候选缺口（没有则为 null） */
  gapDay: string | null;
  /** 缺口前连续了几天 */
  preGapRun: number;
  /** 补学进度：已满足几天 */
  repairDone: number;
  /** 需要几天 */
  repairNeed: number;
  /** 实际参与补学的连续学习日（从缺口后第 1 天开始） */
  repairDays: string[];
  /** 今天已学分钟数（按 startedAt 归日，可能是 0） */
  todayMinutes: number;
  /** 冷却截止时间戳；null = 没有冷却 */
  cooldownUntil: number | null;
  /** 最近一次接回时间戳；null = 从没接回过 */
  lastRescuedAt: number | null;
  /** 是否有过任何学习记录 */
  hasAnyStudy: boolean;
}

/* ---------------- 日期工具（按本地自然日，不依赖 86400000） ---------------- */

/** 在 yyyy-MM-dd 上加减天数；坏日期原样返回 */
export function dayKeyShift(key: string, days: number): string {
  const ts = parseDateInput(key);
  if (ts === null) return key;
  return dayKey(addDaysTs(ts, days));
}

function dayDiff(fromKey: string, toKey: string): number | null {
  const a = parseDateInput(fromKey);
  const b = parseDateInput(toKey);
  if (a === null || b === null) return null;
  // 本地午夜之差；夏令时 23/25 小时的日子 round 后仍是正确天数
  return Math.round((b - a) / 86400000);
}

/** 日期 → 当天学习分钟（只统计 ≤ 今天的日子；未来脏数据不参与） */
export function minutesPerDay(sessions: Session[], nowTs: number): Map<string, number> {
  const todayKey = dayKey(nowTs);
  const map = new Map<string, number>();
  for (const s of sessions) {
    if (!s || !Number.isFinite(s.startedAt)) continue;
    const k = dayKey(s.startedAt);
    if (k > todayKey) continue;
    const min = (Number(s.durationSec) || 0) / 60;
    if (min <= 0) continue;
    map.set(k, (map.get(k) ?? 0) + min);
  }
  return map;
}

function runEndingAt(active: Set<string>, endKey: string): number {
  let n = 0;
  let cursor = endKey;
  while (active.has(cursor)) {
    n += 1;
    cursor = dayKeyShift(cursor, -1);
  }
  return n;
}

/**
 * 展示用连续天数 = 连续段里的**学习日个数**（缺口日只搭桥、不计数）。
 * 两个学习日相邻（差 1 天）正常连；差 2 天且中间那天是已验证的接回缺口，也连。
 */
function displayStreak(active: Set<string>, gaps: Set<string>, todayKey: string): number {
  let cursor = active.has(todayKey) ? todayKey : dayKeyShift(todayKey, -1);
  if (!active.has(cursor)) return 0;
  let count = 0;
  let day = cursor;
  for (let guard = 0; guard < 4000; guard++) {
    count += 1;
    const prev1 = dayKeyShift(day, -1);
    if (active.has(prev1)) {
      day = prev1;
      continue;
    }
    const prev2 = dayKeyShift(day, -2);
    if (gaps.has(prev1) && active.has(prev2)) {
      day = prev2;
      continue;
    }
    break;
  }
  return count;
}

/** 展示用历史最长连续（同样按学习日计数，接回缺口作为桥） */
function displayLongest(activeDayKeys: string[], gaps: Set<string>): number {
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of activeDayKeys) {
    if (prev === null) {
      run = 1;
    } else {
      const d = dayDiff(prev, k);
      if (d === 1) run += 1;
      else if (d === 2 && gaps.has(dayKeyShift(prev, 1))) run += 1;
      else run = 1;
    }
    longest = Math.max(longest, run);
    prev = k;
  }
  return longest;
}

/* ---------------- 账本校验 ---------------- */

interface ValidRescue {
  gapDay: string;
  repairDays: string[];
  rescuedAt: number;
}

/**
 * 校验接回账本里哪些记录**现在仍然成立**。
 * 不成立的一律忽略（不改账本本身）：这样「先接回、后补录」不会双算，
 * 删掉补学记录也不会凭空多出连续天数。
 */
function validateRescues(
  perDay: Map<string, number>,
  active: Set<string>,
  rescues: StreakRescue[],
  nowTs: number,
): ValidRescue[] {
  const todayKey = dayKey(nowTs);
  const out: ValidRescue[] = [];
  const usedGaps = new Set<string>();
  const sorted = [...rescues].sort((a, b) => String(a?.gapDay).localeCompare(String(b?.gapDay)));

  for (const r of sorted) {
    if (!r || typeof r.gapDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.gapDay)) continue;
    if (r.ruleVersion !== 1) continue;
    if (r.gapDay > todayKey) continue;
    if (usedGaps.has(r.gapDay)) continue;
    // 缺口日后来被补录成真实学习日 → 账本失效
    if (active.has(r.gapDay)) continue;
    // 缺口前那段必须仍然成立
    const before = dayKeyShift(r.gapDay, -1);
    if (r.beforeGapDay !== before || !active.has(before)) continue;
    // 补学日：必须紧接缺口、连续、每天 ≥ 阈值、都在窗口内
    if (!Array.isArray(r.repairDays)) continue;
    const days = [...new Set(r.repairDays.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    let ok = true;
    for (let i = 0; i < STREAK_RESCUE_DAYS; i++) {
      const expect = dayKeyShift(r.gapDay, 1 + i);
      if (days[i] !== expect || expect > todayKey || (perDay.get(expect) ?? 0) < STREAK_RESCUE_MIN_MINUTES) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const lastDay = days[STREAK_RESCUE_DAYS - 1];
    const span = dayDiff(r.gapDay, lastDay);
    if (span === null || span > STREAK_RESCUE_WINDOW_DAYS) continue;
    usedGaps.add(r.gapDay);
    out.push({ gapDay: r.gapDay, repairDays: days.slice(0, STREAK_RESCUE_DAYS), rescuedAt: r.rescuedAt });
  }
  return out;
}

/* ---------------- 对外主函数 ---------------- */

export function computeStreakState(
  sessions: Session[],
  rescues: StreakRescue[],
  nowTs: number,
  minMinutes = STREAK_MIN_MINUTES,
): StreakState {
  const todayKey = dayKey(nowTs);
  const perDay = minutesPerDay(sessions, nowTs);
  const activeDayKeys = [...perDay.entries()]
    .filter(([, m]) => m >= minMinutes)
    .map(([k]) => k)
    .sort();
  const active = new Set(activeDayKeys);
  const valid = validateRescues(perDay, active, rescues, nowTs);
  const repairedGapDays = valid.map((v) => v.gapDay);
  const repairedSet = new Set(repairedGapDays);
  const longest = displayLongest(activeDayKeys, repairedSet);
  const todayMinutes = Math.round(perDay.get(todayKey) ?? 0);

  // 当前连续：从今天往回数；今天还没学就从昨天开始（今天没学不算断）。
  // 缺口日只搭桥、不计入天数（12 天 + 补学 2 天 = 14 天）。
  const streak = displayStreak(active, repairedSet, todayKey);

  const lastRescuedAt = rescues.reduce<number | null>((max, r) => {
    const t = typeof r?.rescuedAt === 'number' && Number.isFinite(r.rescuedAt) ? r.rescuedAt : null;
    if (t === null) return max;
    return max === null ? t : Math.max(max, t);
  }, null);
  const cooldownUntil =
    lastRescuedAt === null ? null : lastRescuedAt + STREAK_RESCUE_COOLDOWN_DAYS * 86400000;

  const yesterdayKey = dayKeyShift(todayKey, -1);

  /*
   * 候选缺口只可能是「昨天」或「前天」：
   *   · 缺昨天 → 补学从今天开始，最快明天才能接回（今天先进入 repairing/restorable）；
   *   · 缺前天 → 补学是昨天 + 今天，今天就能 ready。
   * 缺两天及以上不可救。
   */
  interface Candidate {
    gapDay: string;
    preGapRun: number;
    repairDays: string[];
  }
  const candidates: Candidate[] = [];
  for (const gap of [yesterdayKey, dayKeyShift(todayKey, -2)]) {
    if (active.has(gap) || repairedSet.has(gap)) continue;
    const afterGap = dayDiff(gap, todayKey);
    if (afterGap === null || afterGap < 1 || afterGap > STREAK_RESCUE_WINDOW_DAYS) continue;
    const preRun = runEndingAt(active, dayKeyShift(gap, -1));
    if (preRun < STREAK_RESCUE_MIN_RUN) continue;
    // 从缺口后第 1 天开始，连续满足 ≥20 分钟的天数
    const days: string[] = [];
    let c = dayKeyShift(gap, 1);
    for (let i = 0; i < STREAK_RESCUE_DAYS; i++) {
      const diff = dayDiff(c, todayKey);
      if (diff === null || diff < 0) break; // 还没到那天
      if ((perDay.get(c) ?? 0) < STREAK_RESCUE_MIN_MINUTES) break;
      days.push(c);
      c = dayKeyShift(c, 1);
    }
    // 缺口后第 1 天已经过去却没学够 → 补学链断了，这个候选没救
    const firstDay = dayKeyShift(gap, 1);
    if (days.length === 0 && firstDay !== todayKey) continue;
    candidates.push({ gapDay: gap, preGapRun: preRun, repairDays: days });
  }

  const cooled = cooldownUntil === null || nowTs >= cooldownUntil;
  const readyC = cooled
    ? candidates.find((c) => c.repairDays.length >= STREAK_RESCUE_DAYS)
    : undefined;
  const repairingC = cooled ? candidates.find((c) => c.repairDays.length === 1) : undefined;
  const restorableC = cooled
    ? candidates.find((c) => c.repairDays.length === 0 && dayKeyShift(c.gapDay, 1) === todayKey)
    : undefined;

  let phase: StreakPhase;
  let gapDay: string | null = null;
  let preGapRun = 0;
  let repairDone = 0;
  let repairDays: string[] = [];

  if (readyC) {
    phase = 'ready';
    gapDay = readyC.gapDay;
    preGapRun = readyC.preGapRun;
    repairDone = STREAK_RESCUE_DAYS;
    repairDays = readyC.repairDays.slice(0, STREAK_RESCUE_DAYS);
  } else if (repairingC) {
    phase = 'repairing';
    gapDay = repairingC.gapDay;
    preGapRun = repairingC.preGapRun;
    repairDone = repairingC.repairDays.length;
    repairDays = repairingC.repairDays.slice(0, repairingC.repairDays.length);
  } else if (restorableC) {
    phase = 'restorable';
    gapDay = restorableC.gapDay;
    preGapRun = restorableC.preGapRun;
    repairDone = 0;
    repairDays = [];
  } else if (active.has(todayKey)) {
    phase = 'active';
  } else if (active.has(yesterdayKey)) {
    phase = 'pending';
  } else if (active.size === 0 && repairedGapDays.length === 0) {
    phase = 'empty';
  } else {
    phase = 'broken';
  }

  return {
    streak,
    longest,
    activeDayKeys,
    repairedGapDays,
    phase,
    gapDay,
    preGapRun,
    repairDone,
    repairNeed: STREAK_RESCUE_DAYS,
    repairDays,
    todayMinutes,
    cooldownUntil,
    lastRescuedAt,
    hasAnyStudy: active.size > 0 || repairedGapDays.length > 0 || sessions.length > 0,
  };
}

/**
 * 生成一条待写入的接回账本记录（**只创建对象，不写 store**）。
 * 条件由调用方先通过 computeStreakState 的 phase === 'ready' 校验。
 */
export function makeStreakRescue(
  state: StreakState,
  id: string,
  rescuedAt = Date.now(),
): StreakRescue | null {
  if (state.phase !== 'ready' || !state.gapDay) return null;
  if (state.repairDays.length < STREAK_RESCUE_DAYS) return null;
  return {
    id,
    gapDay: state.gapDay,
    beforeGapDay: dayKeyShift(state.gapDay, -1),
    repairDays: state.repairDays.slice(0, STREAK_RESCUE_DAYS),
    restoredFrom: state.preGapRun,
    rescuedAt,
    ruleVersion: 1,
  };
}
