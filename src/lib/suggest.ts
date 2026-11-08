import { hasPlannedMinutes, isOutcomeGoal, type Goal, type Session } from './types';
import { fmtDuration } from './time';
import { goalRatio, isDueToday, isOverdue } from './stats';

/* ==========================================================================
   「现在该做什么」推荐引擎
   ──────────────────────────────────────────────────────────────────────────
   纯规则、纯确定性：同样的数据永远给出同样的结果。
   没有 AI、没有随机数、没有任何硬编码的假条目 ——
   推荐的每一条都能追溯到某个真实目标或某段真实记录。

   设计原则
     · 宁可少推，也不要推一条用户做不了的
     · 每条都必须给出**理由**，让用户知道凭什么推它，而不是黑箱
     · 「换一个」只是按顺序看下一条候选，不是重新随机 —— 否则点几次会重复
   ========================================================================== */

export interface Suggestion {
  /** 稳定标识：换一个时用它去重 */
  id: string;
  /** 关联的目标；自由学习时为 null */
  goalId: string | null;
  title: string;
  subject: string;
  /** 为什么推荐它（必须能说清） */
  reason: string;
  /** 建议这一段学多久（分钟）。成果目标恒为 0 —— 它不计时 */
  minutes: number;
  /**
   * 目标类型。首页据此决定卡片的动作：
   *   `'time'`    → 「开始 N 分钟」
   *   `'outcome'` → 「完成打卡」（这类目标没有时长，不能给时长按钮）
   */
  kind: 'time' | 'outcome';
  /** 排序用，不展示 */
  score: number;
}

export interface SuggestInput {
  goals: Goal[];
  /** 今天的记录 */
  todaySessions: Session[];
  /** 今天已学分钟 */
  todayMinutes: number;
  /** 今天还能支配多少分钟（已扣除上课等） */
  remainingMinutes: number;
  dailyGoalMinutes: number;
  nowTs: number;
}

/** 单段建议的上下限：太短没意义，太长不现实 */
const MAX_CHUNK = 90;

/**
 * 把「还差多少」压到一段可执行的时长。
 * 既要尊重目标剩余量，也不能超过今天真正还剩的时间。
 */
function planChunk(remainingForGoal: number, timeLeft: number): number {
  const cap = Math.min(remainingForGoal > 0 ? remainingForGoal : MAX_CHUNK, timeLeft, MAX_CHUNK);
  // 向下取整，绝不能为了凑整而超出可用时间；不足 5 分钟保留整分钟。
  return cap < 5 ? Math.floor(cap) : Math.floor(cap / 5) * 5;
}

export function suggestNext(input: SuggestInput): Suggestion[] {
  const { goals, todaySessions, todayMinutes, remainingMinutes, dailyGoalMinutes, nowTs } = input;

  // 今天各科目已学多少 —— 用来做「均衡」判断
  const subjectToday = new Map<string, number>();
  for (const s of todaySessions) {
    subjectToday.set(s.subject, (subjectToday.get(s.subject) ?? 0) + s.durationSec / 60);
  }

  // 今天已经彻底没有可支配时间了：不硬推，交给上层显示"今天先到这"
  const timeLeft = Math.max(0, remainingMinutes);
  if (!Number.isFinite(timeLeft) || timeLeft < 1) return [];

  const out: Suggestion[] = [];

  for (const g of goals) {
    if (g.status === 'done' || g.status === 'dropped') continue;

    /*
     * 成果目标（不计时）与计时目标的推荐逻辑分开走：
     * 它没有「剩余时长」这个概念，所以不能经过 planChunk ——
     * 否则 remainingForGoal = 0 → minutes = 0 → 被下面的 `minutes < 1` 静默丢掉，
     * 用户永远看不到这个目标被推荐（这正是加这个功能前实测到的行为）。
     */
    const outcome = isOutcomeGoal(g);

    /*
     * 「目标剩余」这一项只对**有预计时长**的目标有意义。
     * 不限时长（plannedMinutes = null）的目标没有"还差多久"可算，这一项按 0 处理——
     * 推荐时长会自然落到「今天剩余 / 90 分钟上限」上。
     * 关键是**不能**把它当成"已超额完成"：那样会被下面第 ⑥ 条减 60 分直接排除，
     * 等于这类目标永远不会被推荐 —— 而不限时长恰恰是"愿意做但说不准多久"的那类事。
     */
    const planned = hasPlannedMinutes(g);
    const remainingForGoal = planned ? Math.max(0, (g.plannedMinutes ?? 0) - g.actualMinutes) : 0;
    let score = 0;
    const reasons: string[] = [];

    /* ① 截止压力：逾期 > 今天到期 > 无截止 */
    if (isOverdue(g.dueAt, nowTs)) {
      score += 100;
      reasons.push('已经逾期');
    } else if (isDueToday(g.dueAt, nowTs)) {
      score += 80;
      reasons.push('今天到期');
    }

    /* ② 已经开了头的最容易接着做，优先于完全没动的 */
    if (outcome) {
      // 成果目标没有「学了多久」，但进度动过了也算开了头
      const ratio = goalRatio(g) ?? 0;
      if (ratio > 0) {
        score += 45;
        reasons.push(`进度已到 ${Math.round(ratio * 100)}%`);
      }
    } else if (g.status === 'doing' && g.actualMinutes > 0) {
      score += 45;
      reasons.push(`已进行 ${fmtDuration(Math.round(g.actualMinutes))}`);
    } else if (g.actualMinutes > 0) {
      score += 25;
      reasons.push(`已进行 ${fmtDuration(Math.round(g.actualMinutes))}`);
    }

    /* ③ 优先级 */
    if (g.priority === 'high') score += 20;
    else if (g.priority === 'low') score -= 5;

    /* ④ 均衡：这门科目今天还没碰过就加权，已经学过很多就降权
          —— 目的是避免一天只刷一科 */
    const doneToday = subjectToday.get(g.subject) ?? 0;
    if (doneToday === 0) {
      score += 18;
      if (todayMinutes > 0) reasons.push(`${g.subject}今天还没学`);
    } else if (doneToday > 60) {
      score -= 15;
    }

    /* ⑤ 今天剩余时间根本做不完的，往后排，但仍留在候选里
          （用户可能就想学一会儿，不该被直接藏掉）。
          成果目标没有时长，这一条不适用。 */
    if (!outcome && timeLeft > 0 && remainingForGoal > timeLeft) {
      score -= 25;
      reasons.push(`还差 ${fmtDuration(Math.round(remainingForGoal))}，今天时间可能不够`);
    }

    /* ⑥ 已经超额完成的，不再是「现在该做」 */
    if (planned && remainingForGoal === 0) {
      score -= 60;
      reasons.push('计划时长已完成');
    }

    if (outcome) {
      const p = g.progress;
      // 没有数值进度就无从推荐（表单会保证有，这里是防御）
      if (!p) continue;
      const ratio = goalRatio(g) ?? 0;
      reasons.unshift(
        ratio >= 1
          ? '已达到目标值，等你确认完成'
          : `距目标还差 ${fmtNum(Math.abs(p.target - p.current))}${p.unit ? ` ${p.unit}` : ''}`,
      );
      out.push({
        id: `goal:${g.id}`,
        goalId: g.id,
        title: g.title,
        subject: g.subject,
        reason: reasons.join(' · '),
        minutes: 0,
        kind: 'outcome',
        score,
      });
      continue;
    }

    const minutes = planChunk(remainingForGoal, timeLeft);
    if (minutes < 1) continue;

    out.push({
      id: `goal:${g.id}`,
      goalId: g.id,
      title: g.title,
      subject: g.subject,
      // 没有特别理由时给一句朴实的
      reason: reasons.length > 0 ? reasons.join(' · ') : '今天的计划里还没做的一项',
      minutes,
      kind: 'time',
      score,
    });
  }

  out.sort((a, b) => b.score - a.score);

  /* ⑦ 兜底：没有任何待办目标时，不显示空卡片，而是建议一段自由学习。
        科目优先选「今天还没学」的，没有历史就留空让用户自己选。 */
  if (out.length === 0) {
    if (dailyGoalMinutes > 0 && todayMinutes >= dailyGoalMinutes) {
      return []; // 今天目标已达成，不硬推
    }
    const minutes = planChunk(0, timeLeft);
    out.push({
      id: 'free',
      goalId: null,
      title: '开始一段自由学习',
      subject: '',
      reason:
        dailyGoalMinutes > 0
          ? `今天还差 ${fmtDuration(Math.max(0, Math.round(dailyGoalMinutes - todayMinutes)))} 达成目标`
          : '还没有今天的目标，先学一段也算数',
      minutes,
      kind: 'time',
      score: 0,
    });
  }

  return out;
}

/** 数值展示：整数不带小数点，小数最多留一位（「还差 4」而不是「还差 4.0」） */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/* ==========================================================================
   完成度文案
   ──────────────────────────────────────────────────────────────────────────
   首页第一屏要能回答「今天学了多少 / 还能学多久 / 现在该做什么」。
   这里负责最后一句的措辞，都基于真实数字。
   ========================================================================== */

export function todayVerdict(todayMinutes: number, dailyGoalMinutes: number): string {
  if (dailyGoalMinutes <= 0) {
    return todayMinutes > 0 ? `今天已经学了 ${fmtDuration(Math.round(todayMinutes))}` : '今天还没有记录';
  }
  const left = dailyGoalMinutes - todayMinutes;
  if (left <= 0) return '今天的目标已达成';
  if (todayMinutes <= 0) return `还差 ${fmtDuration(Math.round(left))} 达成今天的目标`;
  return `已完成 ${Math.round((todayMinutes / dailyGoalMinutes) * 100)}%，还差 ${fmtDuration(Math.round(left))}`;
}

/** 供「换一个」使用：按顺序取下一条，越界回到第一条 */
export function cycleSuggestion(list: Suggestion[], current: number): number {
  if (list.length <= 1) return 0;
  return (current + 1) % list.length;
}
