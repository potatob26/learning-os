import type { ExamScore, SubjectScoreTarget } from './types';

/* ==========================================================================
   各科考试成绩 vs 目标分
   ──────────────────────────────────────────────────────────────────────────
   口径（与铁律对齐）：
   · 分数只是**记录**：录入成绩不产生 Session、不改任何学习时长；
   · 比较一律折成百分制比率（`score / fullScore`），原始分只用于展示；
   · 缺考（score = null）不进均值、不当「最近一次」、不判达标；
   · 不做排名、不比较他人，只跟自己的目标比；
   · 未来日期的记录可以保存，但不抢「最近一次」。
   ========================================================================== */

export const DEFAULT_FULL_SCORE = 100;
/** 允许的满分制（展示成快捷选项；用户也可自填 1~1000 的整数） */
export const COMMON_FULL_SCORES = [100, 120, 150] as const;

export interface ExamTrendPoint {
  /** 唯一 key（date + id） */
  key: string;
  label: string;
  /** 0..1 */
  rate: number;
  rawScore: number;
  fullScore: number;
}

export interface ExamTrendSeries {
  subject: string;
  points: ExamTrendPoint[];
  /** 目标折合比率 0..1；null = 未设目标（不画目标线） */
  targetRate: number | null;
  targetLabel: string | null;
}

export interface SubjectScoreSummary {
  subject: string;
  latest: ExamScore | null;
  /** 折合比率 0..1 */
  rate: number | null;
  target: SubjectScoreTarget | null;
  /** 目标折合比率 0..1 */
  targetRate: number | null;
  /** 距目标还差多少分（只在同一满分制时给出，负数 = 已超出） */
  gapScore: number | null;
  /** 是否达标；任一侧为空时 null（不显示「未达标」） */
  met: boolean | null;
  /** 有效成绩的折合均值 0..1（缺考不算） */
  avgRate: number | null;
  /** 参与统计的有效记录数 */
  count: number;
  /** 最近一次 − 上一次（折合比率）；不足两条 = null */
  trendDeltaRate: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 折合比率 0..1；缺考或满分非法 = null */
export function examRate(e: Pick<ExamScore, 'score' | 'fullScore'>): number | null {
  if (e.score === null || e.score === undefined) return null;
  const score = Number(e.score);
  const full = Number(e.fullScore);
  if (!Number.isFinite(score) || !Number.isFinite(full) || full <= 0) return null;
  return clamp(score / full, 0, 1);
}

/** 某科的记录（已剔除缺考与坏日期），按 date 升序；同一天按 createdAt 稳定排序 */
export function sortedValidScores(scores: ExamScore[], subject: string): ExamScore[] {
  return scores
    .filter(
      (e) =>
        e &&
        e.subject === subject &&
        e.score !== null &&
        DATE_RE.test(e.date) &&
        Number.isFinite(e.score) &&
        Number.isFinite(e.fullScore) &&
        e.fullScore > 0,
    )
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date.localeCompare(b.date)));
}

/** 某科「最近一次」有效成绩（只看 ≤ 今天的日期，未来记录不抢最近一次） */
export function latestScoreOf(
  scores: ExamScore[],
  subject: string,
  todayKey: string,
): ExamScore | null {
  const list = sortedValidScores(scores, subject).filter((e) => e.date <= todayKey);
  return list.length > 0 ? list[list.length - 1] : null;
}

export function allSubjects(scores: ExamScore[], targets: SubjectScoreTarget[]): string[] {
  const set = new Set<string>();
  for (const e of scores) if (e?.subject) set.add(e.subject);
  for (const t of targets) if (t?.subject) set.add(t.subject);
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function subjectSummaries(
  scores: ExamScore[],
  targets: SubjectScoreTarget[],
  todayKey: string,
): SubjectScoreSummary[] {
  return allSubjects(scores, targets).map((subject) => {
    const valid = sortedValidScores(scores, subject).filter((e) => e.date <= todayKey);
    const latest = valid.length > 0 ? valid[valid.length - 1] : null;
    const prev = valid.length > 1 ? valid[valid.length - 2] : null;
    const rate = latest ? examRate(latest) : null;
    const target = targets.find((t) => t.subject === subject) ?? null;
    const targetRate =
      target && target.fullScore > 0
        ? clamp(target.targetScore / target.fullScore, 0, 1)
        : null;
    // 只有同一满分制时「差几分」才有意义；不同制式只比折合比率
    const gapScore =
      latest && target && latest.fullScore === target.fullScore && latest.score !== null
        ? Math.round((target.targetScore - latest.score) * 10) / 10
        : null;
    const met =
      rate !== null && targetRate !== null ? rate + 1e-9 >= targetRate : null;
    const rates = valid.map((e) => examRate(e)).filter((r): r is number => r !== null);
    const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    const latestRate = latest ? examRate(latest) : null;
    const prevRate = prev ? examRate(prev) : null;
    return {
      subject,
      latest,
      rate,
      target,
      targetRate,
      gapScore,
      met,
      avgRate,
      count: valid.length,
      trendDeltaRate:
        latestRate !== null && prevRate !== null ? latestRate - prevRate : null,
    };
  });
}

export function trendSeries(
  scores: ExamScore[],
  subject: string,
  target: SubjectScoreTarget | null,
  todayKey: string,
): ExamTrendSeries {
  const valid = sortedValidScores(scores, subject).filter((e) => e.date <= todayKey);
  const points: ExamTrendPoint[] = valid.map((e) => {
    const rate = examRate(e) ?? 0;
    const d = new Date(`${e.date}T00:00:00`);
    return {
      key: `${e.date}-${e.id}`,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      rate,
      rawScore: Number(e.score),
      fullScore: e.fullScore,
    };
  });
  const targetRate =
    target && target.fullScore > 0 ? clamp(target.targetScore / target.fullScore, 0, 1) : null;
  const targetLabel =
    target && targetRate !== null
      ? `目标 ${target.targetScore} / ${target.fullScore}（${Math.round(targetRate * 100)}%）`
      : null;
  return { subject, points, targetRate, targetLabel };
}

/* ---------------- 读盘校验（坏数据只丢坏条目，不整包失败） ---------------- */

export function sanitizeExamScores(raw: unknown): ExamScore[] {
  if (!Array.isArray(raw)) return [];
  const out: ExamScore[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Partial<ExamScore>;
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
    const subject = typeof r.subject === 'string' ? r.subject.trim() : '';
    const examName = typeof r.examName === 'string' ? r.examName.trim() : '';
    if (!subject || !examName) continue;
    const date = typeof r.date === 'string' ? r.date.trim() : '';
    if (!DATE_RE.test(date)) continue;
    const fullScore = Number(r.fullScore);
    if (!Number.isFinite(fullScore) || fullScore <= 0 || fullScore > 1000) continue;
    let score: number | null = null;
    if (r.score !== null && r.score !== undefined) {
      const v = Number(r.score);
      // 越界分数直接丢这一条：静默 clamp 会「伪造一个分数」
      if (!Number.isFinite(v) || v < 0 || v > fullScore) continue;
      score = v;
    }
    const createdAt = Number.isFinite(r.createdAt) ? Number(r.createdAt) : Date.now();
    seen.add(r.id);
    out.push({
      id: r.id,
      subject,
      examName,
      date,
      score,
      fullScore,
      ...(typeof r.note === 'string' && r.note.trim() ? { note: r.note.trim() } : {}),
      createdAt,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date.localeCompare(b.date)));
}

export function sanitizeSubjectTargets(raw: unknown): SubjectScoreTarget[] {
  if (!Array.isArray(raw)) return [];
  const bySubject = new Map<string, SubjectScoreTarget>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Partial<SubjectScoreTarget>;
    const subject = typeof r.subject === 'string' ? r.subject.trim() : '';
    if (!subject) continue;
    const fullScore = Number(r.fullScore);
    const targetScore = Number(r.targetScore);
    if (!Number.isFinite(fullScore) || fullScore <= 0 || fullScore > 1000) continue;
    // 目标 = 满分是合法的（目标就是满分），不要当成除零
    if (!Number.isFinite(targetScore) || targetScore < 0 || targetScore > fullScore) continue;
    const updatedAt = Number.isFinite(r.updatedAt) ? Number(r.updatedAt) : Date.now();
    bySubject.set(subject, { subject, targetScore, fullScore, updatedAt });
  }
  return [...bySubject.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'zh-Hans-CN'));
}

/** 把一条表单输入规整成可写入的记录；返回 null = 数据不合法 */
export function normalizeExamScoreInput(input: {
  subject: string;
  examName: string;
  date: string;
  score: number | null;
  fullScore: number;
  note?: string;
}): Omit<ExamScore, 'id' | 'createdAt'> | null {
  const subject = input.subject.trim();
  const examName = input.examName.trim();
  const date = input.date.trim();
  const fullScore = Number(input.fullScore);
  if (!subject || !examName || !DATE_RE.test(date)) return null;
  if (!Number.isFinite(fullScore) || fullScore <= 0 || fullScore > 1000) return null;
  let score: number | null = null;
  if (input.score !== null && input.score !== undefined && String(input.score) !== '') {
    const v = Number(input.score);
    if (!Number.isFinite(v) || v < 0 || v > fullScore) return null;
    score = v;
  }
  return {
    subject,
    examName,
    date,
    score,
    fullScore,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
}
