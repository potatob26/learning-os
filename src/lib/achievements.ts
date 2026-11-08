import type {
  AchievementId,
  AchievementUnlock,
  Goal,
  Session,
  StreakRescue,
} from './types';
import { dayKey, parseDateInput } from './time';
import { computeStreakState, STREAK_MIN_MINUTES } from './streak';

/* ==========================================================================
   成就 / 里程碑
   ──────────────────────────────────────────────────────────────────────────
   · 全部由**真实记录**派生：累计时长、学习日、历史最长连续、完成目标、单次时长。
   · 不做排行榜、不做竞争、不设「领取」按钮（没有奖励，领取是空按钮）。
   · 解锁写账本（achievements：解锁时间 + 证据值），只追加、不删除：
     目标被改回 todo 之后，已获得的成就也不会消失（成就是历史事件）。
   · 无法回溯的数据不做成就不做假：例如「连续 N 天达成每日目标」——
     项目里没有历史每日目标数据，硬做就是编数字。
   ========================================================================== */

export interface AchievementDef {
  id: AchievementId;
  name: string;
  /** 一句话说明判定口径（展示在锁定态下） */
  description: string;
  kind: 'minutes' | 'days' | 'streak' | 'goals' | 'session';
  /** 阈值（分钟 / 天 / 次） */
  target: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'total-10h',
    name: '累计学习 10 小时',
    description: '所有学习记录加起来满 10 小时',
    kind: 'minutes',
    target: 600,
  },
  {
    id: 'total-50h',
    name: '累计学习 50 小时',
    description: '所有学习记录加起来满 50 小时',
    kind: 'minutes',
    target: 3000,
  },
  {
    id: 'total-100h',
    name: '累计学习 100 小时',
    description: '所有学习记录加起来满 100 小时',
    kind: 'minutes',
    target: 6000,
  },
  {
    id: 'days-30',
    name: '学习日 30 天',
    description: `每天学满 ${STREAK_MIN_MINUTES} 分钟算一个学习日`,
    kind: 'days',
    target: 30,
  },
  {
    id: 'days-100',
    name: '学习日 100 天',
    description: `每天学满 ${STREAK_MIN_MINUTES} 分钟算一个学习日`,
    kind: 'days',
    target: 100,
  },
  {
    id: 'streak-7',
    name: '最长连续 7 天',
    description: '历史上最长的一段连续学习达到 7 天',
    kind: 'streak',
    target: 7,
  },
  {
    id: 'streak-30',
    name: '最长连续 30 天',
    description: '历史上最长的一段连续学习达到 30 天',
    kind: 'streak',
    target: 30,
  },
  {
    id: 'first-goal',
    name: '第一个完成的目标',
    description: '勾选完成第一个目标',
    kind: 'goals',
    target: 1,
  },
  {
    id: 'goals-10',
    name: '完成 10 个目标',
    description: '累计完成 10 个目标',
    kind: 'goals',
    target: 10,
  },
  {
    id: 'session-90m',
    name: '单次学习 90 分钟',
    description: '有一段学习记录连续学了 90 分钟',
    kind: 'session',
    target: 90,
  },
];

const DEF_MAP = new Map<AchievementId, AchievementDef>(ACHIEVEMENTS.map((a) => [a.id, a]));
const ID_SET = new Set<string>(ACHIEVEMENTS.map((a) => a.id));

/* ---------------- 指标 ---------------- */

interface DayAgg {
  minutes: number;
  lastEndedAt: number;
}

export interface AchievementMetrics {
  totalMinutes: number;
  activeDayKeys: string[];
  longest: number;
  completedGoalTimes: number[];
  maxSessionMinutes: number;
}

function aggregateDays(sessions: Session[], todayKey: string): Map<string, DayAgg> {
  const map = new Map<string, DayAgg>();
  for (const s of sessions) {
    if (!s || !Number.isFinite(s.startedAt)) continue;
    const k = dayKey(s.startedAt);
    if (k > todayKey) continue;
    const minutes = (Number(s.durationSec) || 0) / 60;
    if (minutes <= 0) continue;
    const cur = map.get(k) ?? { minutes: 0, lastEndedAt: 0 };
    cur.minutes += minutes;
    cur.lastEndedAt = Math.max(
      cur.lastEndedAt,
      Number.isFinite(s.endedAt) ? s.endedAt : s.startedAt,
    );
    map.set(k, cur);
  }
  return map;
}

export function computeAchievementMetrics(
  sessions: Session[],
  goals: Goal[],
  rescues: StreakRescue[],
  nowTs: number,
): AchievementMetrics {
  const todayKey = dayKey(nowTs);
  const dayAgg = aggregateDays(sessions, todayKey);
  const activeDayKeys = [...dayAgg.entries()]
    .filter(([, v]) => v.minutes >= STREAK_MIN_MINUTES)
    .map(([k]) => k)
    .sort();
  const longest = computeStreakState(sessions, rescues, nowTs).longest;
  const completedGoalTimes = goals
    .filter((g) => g && g.completedAt != null && Number.isFinite(g.completedAt))
    .map((g) => Number(g.completedAt))
    .sort((a, b) => a - b);
  let maxSessionMinutes = 0;
  let totalMinutes = 0;
  for (const s of sessions) {
    const m = (Number(s.durationSec) || 0) / 60;
    if (!Number.isFinite(m) || m <= 0) continue;
    totalMinutes += m;
    if (m > maxSessionMinutes) maxSessionMinutes = m;
  }
  return {
    totalMinutes,
    activeDayKeys,
    longest,
    completedGoalTimes,
    maxSessionMinutes,
  };
}

/* ---------------- 派生解锁时刻（能推算就推算，不拿「现在」冒充历史） ---------------- */

function sortedSessions(sessions: Session[]): Session[] {
  return [...sessions]
    .filter((s) => Number.isFinite(s.startedAt) && (Number(s.durationSec) || 0) > 0)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function deriveUnlockedAt(
  def: AchievementDef,
  sessions: Session[],
  metrics: AchievementMetrics,
  nowTs: number,
): number {
  const endedAt = (s: Session) => (Number.isFinite(s.endedAt) ? s.endedAt : s.startedAt);
  if (def.kind === 'minutes') {
    let acc = 0;
    for (const s of sortedSessions(sessions)) {
      acc += (Number(s.durationSec) || 0) / 60;
      if (acc >= def.target) return endedAt(s);
    }
    return nowTs;
  }
  if (def.kind === 'days') {
    const todayKey = dayKey(nowTs);
    const agg = aggregateDays(sessions, todayKey);
    const key = metrics.activeDayKeys[def.target - 1];
    if (key && agg.get(key)?.lastEndedAt) return agg.get(key)!.lastEndedAt;
    return nowTs;
  }
  if (def.kind === 'streak') {
    // 找到第一段长度 ≥ target 的连续学习日，取它最后一天的记录结束时间
    const todayKey = dayKey(nowTs);
    const agg = aggregateDays(sessions, todayKey);
    let run = 0;
    let prev: number | null = null;
    for (let i = 0; i < metrics.activeDayKeys.length; i++) {
      const key = metrics.activeDayKeys[i];
      const ts = parseDateInput(key);
      if (ts === null) continue;
      run = prev !== null && ts - prev === 86400000 ? run + 1 : 1;
      if (run >= def.target) {
        const last = agg.get(key)?.lastEndedAt;
        if (last) return last;
      }
      prev = ts;
    }
    return nowTs;
  }
  if (def.kind === 'goals') {
    const t = metrics.completedGoalTimes[def.target - 1];
    if (t != null) return t;
    return nowTs;
  }
  if (def.kind === 'session') {
    for (const s of sortedSessions(sessions)) {
      if ((Number(s.durationSec) || 0) / 60 >= def.target) return endedAt(s);
    }
    return nowTs;
  }
  return nowTs;
}

/* ---------------- 校验 / 补记 / 对账 ---------------- */

function validDate(ts: unknown): number | null {
  return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts : null;
}

export function normalizeAchievements(raw: unknown): AchievementUnlock[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<AchievementId, AchievementUnlock>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Partial<AchievementUnlock>;
    if (typeof a.id !== 'string' || !ID_SET.has(a.id)) continue;
    const unlockedAt = validDate(a.unlockedAt);
    if (unlockedAt === null) continue;
    if (a.ruleVersion !== 1) continue;
    const evidence = Number.isFinite(a.evidence) ? Number(a.evidence) : 0;
    const prev = seen.get(a.id as AchievementId);
    // 同一个成就只保留最早那次（幂等、不因重复对账改时间）
    if (!prev || unlockedAt < prev.unlockedAt) {
      seen.set(a.id as AchievementId, {
        id: a.id as AchievementId,
        unlockedAt,
        evidence,
        ...(a.backfilled ? { backfilled: true } : {}),
        ruleVersion: 1,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.unlockedAt - b.unlockedAt).slice(-100);
}

/** 用现有记录补记应得的成就（首次升级 / 导入旧备份时用），全部标 backfilled */
export function backfillAchievements(
  sessions: Session[],
  goals: Goal[],
  rescues: StreakRescue[],
  nowTs: number,
): AchievementUnlock[] {
  const metrics = computeAchievementMetrics(sessions, goals, rescues, nowTs);
  const out: AchievementUnlock[] = [];
  for (const def of ACHIEVEMENTS) {
    const value = metricValue(def, metrics);
    if (value < def.target) continue;
    out.push({
      id: def.id,
      unlockedAt: deriveUnlockedAt(def, sessions, metrics, nowTs),
      evidence: Math.round(value),
      backfilled: true,
      ruleVersion: 1,
    });
  }
  return normalizeAchievements(out);
}

/**
 * 对账：把「现在已经达成但账本里没有」的成就补进去。
 * 幂等：没有新增时**返回原数组引用**，调用方可以据此跳过 commit。
 */
export function reconcileAchievements(
  current: AchievementUnlock[],
  sessions: Session[],
  goals: Goal[],
  rescues: StreakRescue[],
  nowTs: number,
  mode: 'live' | 'hydrate' = 'live',
): AchievementUnlock[] {
  const normalized = normalizeAchievements(current);
  const have = new Set(normalized.map((a) => a.id));
  const metrics = computeAchievementMetrics(sessions, goals, rescues, nowTs);
  const added: AchievementUnlock[] = [];
  for (const def of ACHIEVEMENTS) {
    if (have.has(def.id)) continue;
    const value = metricValue(def, metrics);
    if (value < def.target) continue;
    added.push({
      id: def.id,
      unlockedAt: deriveUnlockedAt(def, sessions, metrics, nowTs),
      evidence: Math.round(value),
      ...(mode === 'hydrate' ? { backfilled: true } : {}),
      ruleVersion: 1,
    });
  }
  if (added.length === 0) return current;
  return normalizeAchievements([...normalized, ...added]);
}

export function metricValue(def: AchievementDef, m: AchievementMetrics): number {
  switch (def.kind) {
    case 'minutes':
      return m.totalMinutes;
    case 'days':
      return m.activeDayKeys.length;
    case 'streak':
      return m.longest;
    case 'goals':
      return m.completedGoalTimes.length;
    case 'session':
      return m.maxSessionMinutes;
  }
}

/* ---------------- 给 UI 的进度视图 ---------------- */

export interface AchievementProgress {
  def: AchievementDef;
  /** 当前值（分钟 / 天 / 次） */
  value: number;
  /** 目标值（分钟 / 天 / 次） */
  target: number;
  /** 是否已达成（不看账本） */
  achieved: boolean;
  /** 账本里的解锁记录；null = 还没获得 */
  unlock: AchievementUnlock | null;
  /** 0..1，用于进度条 */
  ratio: number;
}

export function achievementProgressList(
  sessions: Session[],
  goals: Goal[],
  rescues: StreakRescue[],
  unlocks: AchievementUnlock[],
  nowTs: number,
): AchievementProgress[] {
  const metrics = computeAchievementMetrics(sessions, goals, rescues, nowTs);
  const byId = new Map(unlocks.map((u) => [u.id, u]));
  return ACHIEVEMENTS.map((def) => {
    const value = metricValue(def, metrics);
    const unlock = byId.get(def.id) ?? null;
    return {
      def,
      value,
      target: def.target,
      achieved: value >= def.target,
      unlock,
      ratio: def.target > 0 ? Math.min(1, value / def.target) : 0,
    };
  });
}

/** 给「已获得 N / 总数」用的数字 */
export function unlockedCount(unlocks: AchievementUnlock[]): number {
  return new Set(unlocks.map((u) => u.id)).size;
}

export function achievementDef(id: AchievementId): AchievementDef | undefined {
  return DEF_MAP.get(id);
}
