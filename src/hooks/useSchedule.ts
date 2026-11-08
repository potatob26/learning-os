import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { useNow } from './useNow';
import { blocksForDay, computeDayPlan, dayKey, parseHM, toWeekday, type DayPlan } from '../lib/time';
import type {
  Course,
  CourseStatus,
  CourseStatusMap,
  DayOverride,
  Period,
  Settings,
  TimeBlock,
  Weekday,
} from '../lib/types';
import { isCancelled } from '../lib/types';
import { resolveDay, type ResolvedDay } from '../lib/holidays';

/* ==========================================================================
   课表派生数据
   ──────────────────────────────────────────────────────────────────────────
   铁律：课程表只描述「学校安排了什么课」，它**永远不产生学习记录**。
   学习时长只来自计时器与手动补录。课程状态只用于：
     1. 首页显示今天有哪些课
     2. 当前 / 下一节课程提示
     3. 用户确认是否上完（用于课程完成情况统计）
     4. 为日程提供时间占用信息（请假与调课会把这节课的时间还回来）
   ========================================================================== */

export interface CourseInstance {
  key: string;
  course: Course;
  startMin: number;
  endMin: number;
  startLabel: string;
  endLabel: string;
  location?: string;
  /** 相对现在：已结束 / 进行中 / 即将开始 / 稍后 */
  relation: 'past' | 'now' | 'next' | 'later';
  minutesUntil: number;
  minutesLeft: number;
  /** 课程完成状态（含「结束后自动视为已上完」的推导） */
  status: CourseStatus;
  /** 是否由用户显式设置过（用于 UI 区分「自动」与「手动」） */
  explicit: boolean;
  /** 请假 / 调课：这节课没有占用你的时间 */
  cancelled: boolean;
}

function clampLabel(min: number): string {
  const total = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 推导某节课在某一天的实际状态。
 * 规则（已与用户确认）：课程结束后**自动视为已上完**，用户可随时手动改。
 * 只有用户显式设置过的状态才写进 courseStatus，自动推导的不落盘 ——
 * 这样时间往前走时状态会自然推移，不需要定时任务去刷。
 */
export function effectiveCourseStatus(
  courseId: string,
  endMin: number,
  nowMin: number,
  map: CourseStatusMap,
  dateKeyStr: string,
): { status: CourseStatus; explicit: boolean } {
  const explicit = map[dateKeyStr]?.[courseId];
  if (explicit) return { status: explicit, explicit: true };
  return { status: nowMin >= endMin ? 'attended' : 'unconfirmed', explicit: false };
}

export function buildDayCourses(
  courses: Course[],
  periods: Period[],
  weekday: Weekday,
  nowMin: number,
  statusMap: CourseStatusMap,
  dateKeyStr: string,
): CourseInstance[] {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const out: CourseInstance[] = [];

  for (const c of courses) {
    if (c.weekday !== weekday) continue;
    const p = c.periodId ? byId.get(c.periodId) : null;
    const startMin = parseHM(c.start ?? p?.start);
    let endMin = parseHM(c.end ?? p?.end);
    // 时间无法解析时必须跳过，否则零时长区间会被日程计算当成
    // 「占满整个学习窗口」，把可支配时间错误地算成 0。
    if (startMin === null || endMin === null) continue;
    if (endMin <= startMin) endMin += 1440;
    if (endMin - startMin <= 0) continue;

    const { status, explicit } = effectiveCourseStatus(c.id, endMin, nowMin, statusMap, dateKeyStr);

    out.push({
      key: c.id,
      course: c,
      startMin,
      endMin,
      startLabel: clampLabel(startMin),
      endLabel: clampLabel(endMin),
      location: c.location,
      relation: 'later',
      minutesUntil: Math.max(0, startMin - nowMin),
      minutesLeft: Math.max(0, endMin - nowMin),
      status,
      explicit,
      cancelled: isCancelled(status),
    });
  }

  out.sort((a, b) => a.startMin - b.startMin);

  // 标注相对关系
  for (const inst of out) {
    if (nowMin >= inst.endMin) inst.relation = 'past';
    else if (nowMin >= inst.startMin) inst.relation = 'now';
  }
  const firstUpcoming = out.find((i) => i.relation === 'later');
  if (firstUpcoming) firstUpcoming.relation = 'next';

  return out;
}

/**
 * 一天的**上课占用**（分钟）。
 *
 * 与「自学时长」是两回事：
 *   · 上课占用 = 课表安排的时间，从可支配时间里扣，**不计入学习时长**
 *   · 自学时长 = 自己计时学出来的，来自 sessions，才是统计里的「学习时长」
 * 用户明确要求两者分开，所以统计页要各算各的。
 *
 * 计算时会正确处理：放假（没课）、调休（按指定星期几排课）、请假与调课（不占用时间）。
 */
export function classMinutesOn(
  dateKey: string,
  courses: Course[],
  periods: Period[],
  statusMap: CourseStatusMap,
  overrides: DayOverride[],
): number {
  const d = new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10)));
  const day = resolveDay(dateKey, toWeekday(d.getDay()), overrides);
  if (!day.hasClass) return 0;
  return buildDayCourses(courses, periods, day.weekday, 0, statusMap, dateKey)
    .filter((i) => !i.cancelled && i.endMin - i.startMin > 0)
    .reduce((sum, i) => sum + (i.endMin - i.startMin), 0);
}

/** 一段日期区间（含首尾）内的上课占用合计（分钟） */
export function classMinutesInRange(
  fromKey: string,
  toKey: string,
  courses: Course[],
  periods: Period[],
  statusMap: CourseStatusMap,
  overrides: DayOverride[],
): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  let total = 0;
  for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86400000) {
    const d = new Date(t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    total += classMinutesOn(key, courses, periods, statusMap, overrides);
  }
  return total;
}

export interface ScheduleToday {
  instances: CourseInstance[];
  current: CourseInstance | null;
  next: CourseInstance | null;
  hasClassToday: boolean;
  allDone: boolean;
  /** 今天的日期键，供状态写入使用 */
  dateKey: string;
  /**
   * 今天怎么上课（放假 / 补课 / 正常）。
   * 界面据此显示「放假」「调休：按周一的课表」等信息，
   * 并在调休日还没指定按周几时提示用户去选。
   */
  day: ResolvedDay;
  /** 今天的上课时长（分钟）。与「自己额外学的时间」分开，不计入学习时长 */
  classMinutes: number;
  /** 课程完成情况（不计请假与调课为「已完成」，单独计数） */
  summary: {
    total: number;
    attended: number;
    unconfirmed: number;
    cancelled: number;
    /** 已完成比例，只统计需要上的课 */
    rate: number;
  };
}

export function useScheduleToday(): ScheduleToday {
  const courses = useStore((s) => s.courses);
  const periods = useStore((s) => s.periods);
  const statusMap = useStore((s) => s.courseStatus);
  const overrides = useStore((s) => s.dayOverrides);
  const ts = useNow();

  return useMemo(() => {
    const d = new Date(ts);
    const realWeekday = toWeekday(d.getDay());
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const key = dayKey(ts);

    /*
     * 先定出「今天怎么上课」，再据此排课。
     * 这一步同时处理三件事：
     *   · 法定放假日 → 不上课
     *   · 调休上班日（周末要上课）→ 按用户指定的星期几排课
     *   · 普通日子 → 按真实星期几
     * 详见 lib/holidays 的 resolveDay。
     */
    const day = resolveDay(key, realWeekday, overrides);
    const weekday = day.weekday;

    const instances = day.hasClass
      ? buildDayCourses(courses, periods, weekday, nowMin, statusMap, key)
      : [];
    const current = instances.find((i) => i.relation === 'now' && !i.cancelled) ?? null;
    const next = instances.find((i) => i.relation === 'next') ?? null;

    const attended = instances.filter((i) => i.status === 'attended').length;
    const cancelled = instances.filter((i) => i.cancelled).length;
    const unconfirmed = instances.filter((i) => i.status === 'unconfirmed').length;
    const required = instances.length - cancelled;

    // 今天的上课时长（分钟）—— 与「自己额外学的时间」是两回事：
    // 这里只是课表占用的时间，不计入学习时长
    const classMinutes = day.hasClass
      ? instances
          .filter((i) => !i.cancelled && i.endMin - i.startMin > 0)
          .reduce((sum, i) => sum + (i.endMin - i.startMin), 0)
      : 0;

    return {
      instances,
      current,
      next,
      hasClassToday: instances.length > 0,
      allDone: instances.length > 0 && instances.every((i) => i.relation === 'past'),
      dateKey: key,
      day,
      classMinutes,
      summary: {
        total: instances.length,
        attended,
        unconfirmed,
        cancelled,
        rate: required > 0 ? (attended / required) * 100 : 0,
      },
    };
  }, [courses, periods, statusMap, overrides, ts]);
}

/**
 * 今天的可支配时间。
 * 关键：**上课占用只扣除真正要上的课** —— 请假与调课的时间会还回来，
 * 因为那段时间学生确实空出来了。
 */
export function useDayPlan(): { plan: DayPlan; weekday: Weekday; nowMin: number; blocks: TimeBlock[]; day: ResolvedDay } {
  const settings = useStore((s) => s.settings);
  const courses = useStore((s) => s.courses);
  const periods = useStore((s) => s.periods);
  const statusMap = useStore((s) => s.courseStatus);
  const overrides = useStore((s) => s.dayOverrides);
  const ts = useNow();

  return useMemo(() => {
    const d = new Date(ts);
    const realWeekday = toWeekday(d.getDay());
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const key = dayKey(ts);

    // 与 useScheduleToday 同一套解析：放假就没有课，补课就按指定的星期几
    const day = resolveDay(key, realWeekday, overrides);
    const weekday = day.weekday;

    const classInstances = day.hasClass
      ? buildDayCourses(courses, periods, weekday, nowMin, statusMap, key)
          // 请假 / 调课的课不占用时间
          .filter((i) => !i.cancelled)
          // 只把时长有效的课程计入上课占用，异常数据不参与计算
          .filter((i) => i.endMin - i.startMin > 0)
          .map((i) => ({ startMin: i.startMin, endMin: i.endMin }))
      : [];

    const plan = computeDayPlan(ts, settings as Settings, weekday, classInstances);
    return { plan, weekday, nowMin, blocks: blocksForDay(settings.blocks, weekday).map((b) => b.block), day };
  }, [settings, courses, periods, statusMap, overrides, ts]);
}
