import type { Session, Settings, TimeBlock, Weekday } from './types';
import { DAY_SCHEDULE_NUMBER_KEYS, DAY_SCHEDULE_TIME_KEYS } from './types';

/* ==========================================================================
   时间工具
   ──────────────────────────────────────────────────────────────────────────
   所有「今天」的判断都必须走这里，而不是直接 new Date()，
   因为系统时间可能不准（要求十九）。
   ========================================================================== */

/**
 * 取「某一天真正生效的作息」：把该天的按星期几覆盖盖到全局设置上。
 *
 * **所有要读作息字段的地方都必须先过这个函数**，否则按星期几配置就只在设置页生效、
 * 计算和首页仍然用全局值（这类"改了不生效"最难发现）。
 *
 * 回落是**字段级**的：某天只覆盖了窗口，那么这天的上学/睡觉仍然跟随默认值。
 * 空字符串视为「没填」，同样回落 —— 因为时间输入框被清空时会给出空串。
 *
 * 时间字段与数字字段分开处理：判据不同，混着写只能靠 `typeof` 分支，容易漏。
 */
export function settingsForDay(settings: Settings, weekday: Weekday): Settings {
  const per = settings.byWeekday?.[weekday];
  if (!per) return settings;
  const merged: Settings = { ...settings };
  for (const key of DAY_SCHEDULE_TIME_KEYS) {
    const value = per[key];
    if (typeof value === 'string' && value.trim() !== '') merged[key] = value;
  }
  for (const key of DAY_SCHEDULE_NUMBER_KEYS) {
    const value = per[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      merged[key] = Math.round(value);
    }
  }
  return merged;
}

const WEEKDAY_LOCALE: Record<number, string> = {
  0: '周日',
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
};

/** JS 的 getDay(): 0=周日 … 6=周六 → 本项目的 0=周一 … 6=周日 */
export function toWeekday(jsDay: number): Weekday {
  return ((jsDay + 6) % 7) as Weekday;
}

export function weekdayLabel(jsDay: number): string {
  return WEEKDAY_LOCALE[jsDay] ?? '';
}

/* ---------------- 'HH:mm' <-> 分钟 ---------------- */

export function parseHM(hm: string | undefined | null): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function toHM(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 跨零点安全：结束时间小于开始时间时视为跨天 */
export function spanMinutes(start: number, end: number): number {
  return end >= start ? end - start : 1440 - start + end;
}

/* ---------------- 时长格式化 ---------------- */

export function fmtDuration(minutes: number, style: 'short' | 'long' | 'clock' = 'short'): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (style === 'clock') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (style === 'long') {
    if (h === 0) return `${m} 分钟`;
    if (m === 0) return `${h} 小时`;
    return `${h} 小时 ${m} 分`;
  }
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/* ---------------- 本地日期键（不受时区/夏令时影响） ---------------- */

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function monthDayLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function fullDateLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 某天 00:00 的本地时间戳 */
export function startOfDayTs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDaysTs(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** 两个时间戳相差的自然天数（按本地日期算，忽略时分秒） */
export function diffDays(fromTs: number, toTs: number): number {
  const a = startOfDayTs(fromTs);
  const b = startOfDayTs(toTs);
  return Math.round((b - a) / 86400000);
}

/** 本周一 00:00 */
export function startOfWeekTs(ts: number): number {
  const d = new Date(startOfDayTs(ts));
  const wd = toWeekday(d.getDay());
  d.setDate(d.getDate() - wd);
  return d.getTime();
}

export function startOfMonthTs(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 解析 'yyyy-MM-dd' 或 'yyyy-MM-dd HH:mm' */
export function parseDateInput(value: string): number | null {
  if (!value) return null;
  const norm = value.trim().replace(' ', 'T');
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(norm);
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    m[4] ? Number(m[4]) : 0,
    m[5] ? Number(m[5]) : 0,
    0,
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/* ---------------- 固定活动 / 可支配时间 ---------------- */

export interface BlockInstance {
  block: TimeBlock;
  startMin: number;
  endMin: number;
}

/** 落在某一天的固定活动（考虑跨天） */
export function blocksForDay(blocks: TimeBlock[], weekday: Weekday): BlockInstance[] {
  const out: BlockInstance[] = [];
  for (const b of blocks) {
    if (b.weekdays && b.weekdays.length > 0 && !b.weekdays.includes(weekday)) continue;
    const s = parseHM(b.start);
    const e = parseHM(b.end);
    if (s === null || e === null) continue;
    out.push({ block: b, startMin: s, endMin: e });
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}

export interface Interval {
  start: number;
  end: number;
}

function mergeIntervals(list: Interval[]): Interval[] {
  if (list.length === 0) return [];
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

function totalLen(list: Interval[]): number {
  return list.reduce((acc, i) => acc + Math.max(0, i.end - i.start), 0);
}

export interface DayPlan {
  /** 学习窗口（分钟，自 00:00 起算） */
  fromMin: number;
  toMin: number;
  /** 睡觉时间（分钟，自 00:00 起算，跨零点会 +1440）。取自当天生效的作息 */
  sleepMin: number;
  /** 窗口内的固定活动 */
  blocks: BlockInstance[];
  /** 上课占用（分钟） */
  classMinutes: number;
  /** 固定活动总时长（分钟） */
  blockMinutes: number;
  /** 理论可支配时间（分钟） */
  availableMinutes: number;
  /** 已经过去的那部分可支配时间（分钟） */
  elapsedAvailableMinutes: number;
  /** 剩余可支配时间（分钟） */
  remainingAvailableMinutes: number;
  /** 超出窗口的剩余时间（窗口已结束） */
  windowClosed: boolean;
}

export interface ClassInstance {
  startMin: number;
  endMin: number;
}

/**
 * 计算一天的可支配时间。
 * 可支配 = 学习窗口 − 上课 − 固定活动（重叠部分只扣一次）
 */
export function computeDayPlan(
  nowTs: number,
  settingsRaw: Settings,
  weekday: Weekday,
  classInstances: ClassInstance[],
): DayPlan {
  // 先取「这一天真正生效的作息」：按星期几单独配过的窗口在这里生效
  const settings = settingsForDay(settingsRaw, weekday);
  const fromMin = parseHM(settings.studyFrom) ?? 17 * 60 + 20;
  let toMin = parseHM(settings.studyTo) ?? 22 * 60 + 30;
  if (toMin <= fromMin) toMin += 1440;

  const winStart = fromMin;
  const winEnd = toMin;

  const clampedClasses = classInstances
    .map((c) => {
      let s = c.startMin;
      let e = c.endMin;
      if (e <= s) e += 1440;
      return { start: s, end: e };
    })
    // 防御：起止相同的区间（多半来自数据异常，例如课程引用了不存在的节次）
    // 是零长度，不能当成「占满整个窗口」来扣除，否则可支配时间会被算成 0。
    .filter((c) => c.end - c.start > 0)
    .filter((c) => c.end > winStart && c.start < winEnd)
    .map((c) => ({ start: Math.max(c.start, winStart), end: Math.min(c.end, winEnd) }));

  const classMinutes = totalLen(mergeIntervals(clampedClasses));

  const blocks = blocksForDay(settings.blocks, weekday);
  const clampedBlocks = blocks
    .map((b) => {
      let s = b.startMin;
      let e = b.endMin;
      if (e <= s) e += 1440;
      return { start: s, end: e, inst: b };
    })
    .filter((b) => b.end > winStart && b.start < winEnd)
    .map((b) => ({ start: Math.max(b.start, winStart), end: Math.min(b.end, winEnd), inst: b.inst }));

  const blockMinutes = totalLen(mergeIntervals(clampedBlocks.map((b) => ({ start: b.start, end: b.end }))));

  const busy = mergeIntervals([
    ...clampedClasses,
    ...clampedBlocks.map((b) => ({ start: b.start, end: b.end })),
  ]);
  const availableMinutes = Math.max(0, winEnd - winStart - totalLen(busy));

  // 现在这一刻（当天分钟数）
  const d = new Date(nowTs);
  let nowMin = d.getHours() * 60 + d.getMinutes();
  if (nowMin < winStart && winEnd > 1440) nowMin += 1440;

  const elapsedEnd = Math.min(Math.max(nowMin, winStart), winEnd);
  const elapsedBusy = mergeIntervals(
    busy.map((b) => ({ start: b.start, end: Math.min(b.end, elapsedEnd) })).filter((b) => b.end > b.start),
  );
  const elapsedAvailableMinutes = Math.max(
    0,
    elapsedEnd - winStart - totalLen(elapsedBusy),
  );

  const remainingAvailableMinutes = Math.max(0, availableMinutes - elapsedAvailableMinutes);
  const windowClosed = nowMin >= winEnd;

  /*
   * 睡觉时间（当天生效的作息）。
   * 原来首页那句「距离睡觉」用的是**学习窗口终点** —— 也就是把「学完了」当成「该睡了」，
   * 而设置里那个「睡觉」其实谁都没读（存了但不生效）。现在真的接上：
   * 填了就用填的，没填或格式不对就回落到窗口终点，行为与以前一致。
   */
  const sleepParsed = parseHM(settings.sleepTime);
  const sleepMin = sleepParsed === null ? toMin : sleepParsed > 0 && sleepParsed < fromMin ? sleepParsed + 1440 : sleepParsed;

  return {
    fromMin,
    toMin,
    sleepMin,
    blocks,
    classMinutes,
    blockMinutes,
    availableMinutes,
    elapsedAvailableMinutes,
    remainingAvailableMinutes,
    windowClosed,
  };
}

/* ---------------- 学习记录聚合 ---------------- */

export function sessionsForDay(sessions: Session[], ts: number): Session[] {
  const key = dayKey(ts);
  return sessions.filter((s) => dayKey(s.startedAt) === key);
}

export function totalMinutes(sessions: Session[]): number {
  return sessions.reduce((acc, s) => acc + s.durationSec, 0) / 60;
}

export function minutesBySubject(sessions: Session[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) {
    map.set(s.subject, (map.get(s.subject) ?? 0) + s.durationSec / 60);
  }
  return map;
}

/** 一天的有效学习分钟数（去掉极短的误触记录 < 60 秒） */
export function effectiveMinutes(sessions: Session[]): number {
  return sessions.filter((s) => s.durationSec >= 60).reduce((a, s) => a + s.durationSec, 0) / 60;
}

/**
 * 重算一次进行中的计时器的真实经过时间。
 * 关键点：永远基于时间戳差值，而不是每秒累加 —— 这样
 * 切后台、锁屏、刷新、休眠之后回来数字依然正确（要求十二）。
 */
export function elapsedMs(timer: {
  startedAt: number;
  pausedMs: number;
  pausedAt: number | null;
  phase: string;
}, nowTs: number): number {
  const end = timer.pausedAt ?? nowTs;
  const raw = end - timer.startedAt - timer.pausedMs;
  return Math.max(0, raw);
}
