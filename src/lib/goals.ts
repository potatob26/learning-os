import type { Goal } from './types';
import { dayKey } from './time';
import { isDueToday, isOverdue } from './stats';

/**
 * 目标页「今天」页签该列的目标 —— **这个口径的单一来源**。
 *
 * ⚠️ 不要和 stats.ts 的 todayGoals 混用，两者语义不同：
 *     · stats.todayGoals    = 首页「今天要做什么」：doing 一律算进来，并且按优先级排序
 *     · todayTabGoals(本文件) = 目标页「今天」页签：doing 只在到期/逾期/无截止时才算，不排序
 *   同名不同义正是本项目反复踩的坑，所以这里刻意不叫 todayGoals。
 *
 * 原来这段判定内联在 Goals 页的 useMemo 里；作业清单页要按同一口径列"剩余待做"，
 * 如果各抄一份，两边迟早会不一致（本项目已经栽过这类"两处规则不同"的坑）。
 * 所以抽到这里，两个页面共用。
 *
 * 口径：
 *   · 已完成的：只有**今天完成的**才算今天的（不然昨天做完的会一直挂在今天）
 *   · 已放弃的（dropped）：不出现
 *   · 未完成的：今天到期的、已逾期的、以及没有截止时间的都算今天该看的
 */
export function isInTodayTab(g: Goal, ts: number): boolean {
  if (g.status === 'done') {
    return g.completedAt ? dayKey(g.completedAt) === dayKey(ts) : isDueToday(g.dueAt, ts);
  }
  if (g.status === 'dropped') return false;
  return isDueToday(g.dueAt, ts) || isOverdue(g.dueAt, ts) || !g.dueAt;
}

export function todayTabGoals(goals: Goal[], ts: number): Goal[] {
  return goals.filter((g) => isInTodayTab(g, ts));
}

/** 按科目分组（科目名保持出现顺序稳定：先按名称排，空科目归到「其他」） */
export function groupBySubject(goals: Goal[]): { subject: string; items: Goal[] }[] {
  const map = new Map<string, Goal[]>();
  for (const g of goals) {
    const key = (g.subject || '').trim() || '其他';
    const list = map.get(key);
    if (list) list.push(g);
    else map.set(key, [g]);
  }
  return [...map.entries()]
    .map(([subject, items]) => ({ subject, items }))
    .sort((a, b) => (a.subject === '其他' ? 1 : b.subject === '其他' ? -1 : a.subject.localeCompare(b.subject)));
}
