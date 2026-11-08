import { useMemo, useState } from 'react';
import { CalendarDays, Plus, Target, Trophy } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { useNow } from '../../hooks/useNow';
import { useStore } from '../../lib/store';
import { dayKey } from '../../lib/time';
import { allSubjects, subjectSummaries, trendSeries } from '../../lib/examScores';
import { ScoreBars, TrendChart } from '../charts/TrendChart';
import { ExamScoreSheet } from '../exams/ExamScoreSheet';
import type { ExamScore } from '../../lib/types';

/**
 * 统计页「成绩」标签
 * ──────────────────────────────────────────────────────────────
 * 把「分数」和「学习时长」彻底分开：
 *   · 这里所有数字都来自 examScores，**不改任何学习记录、不计入学习时长**；
 *   · 目标分按科目存一份长期目标，趋势图上画成一条横线；
 *   · 不做排名、不比较他人。
 */
export function ExamScoresCard() {
  const courses = useStore((s) => s.courses);
  const goals = useStore((s) => s.goals);
  const examScores = useStore((s) => s.examScores);
  const targets = useStore((s) => s.subjectScoreTargets);
  const ts = useNow();
  const todayKey = dayKey(ts);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ExamScore | null>(null);
  const [selected, setSelected] = useState('');

  const subjects = useMemo(() => {
    const fromData = allSubjects(examScores, targets);
    const fromCourses = courses.map((c) => c.subject).filter(Boolean);
    const fromGoals = goals.map((g) => g.subject).filter(Boolean);
    return [...new Set([...fromData, ...fromCourses, ...fromGoals])];
  }, [examScores, targets, courses, goals]);

  const summaries = useMemo(
    () => subjectSummaries(examScores, targets, todayKey),
    [examScores, targets, todayKey],
  );
  const current = selected || summaries[0]?.subject || '';
  const series = useMemo(
    () => trendSeries(examScores, current, targets.find((t) => t.subject === current) ?? null, todayKey),
    [examScores, current, targets, todayKey],
  );
  // 列表里要能看到缺考，所以这里不剔除 score=null；只按科目 + 日期过滤
  const records = useMemo(
    () =>
      examScores
        .filter((e) => e.subject === current && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date <= todayKey)
        .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)))
        .slice(0, 6),
    [examScores, current, todayKey],
  );

  const openNew = (subject?: string) => {
    setEditing(null);
    setSelected(subject ?? current);
    setSheetOpen(true);
  };

  return (
    <div className="space-y-3">
      <Card padding="md">
        <CardTitle
          icon={<Trophy />}
          title="考试成绩"
          subtitle="只跟自己比 · 不计入学习时长"
          action={
            <Button size="sm" icon={<Plus />} onClick={() => openNew()}>
              记录成绩
            </Button>
          }
        />
        {summaries.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[0.9rem] font-medium">还没有成绩记录</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-secondary">
              记一次考试，就能看到「这次 vs 目标」和每次的变化。缺考可以留空。
            </p>
            <Button className="mx-auto mt-4" size="sm" onClick={() => openNew()}>
              记录第一次考试
            </Button>
          </div>
        ) : (
          <ScoreBars rows={summaries} selected={current} onPick={setSelected} />
        )}
        <p className="mt-3 text-[0.7rem] leading-relaxed text-tertiary">
          成绩只是记录。录入分数不会产生学习记录，也不会计入任何学习时长。
        </p>
      </Card>

      {current && summaries.length > 0 && (
        <Card padding="md">
          <CardTitle
            icon={<CalendarDays />}
            title={`${current} 趋势`}
            subtitle={series.points.length > 0 ? `${series.points.length} 次有效成绩` : '还没有有效成绩'}
            action={
              <Button size="sm" variant="secondary" icon={<Target />} onClick={() => openNew(current)}>
                记录
              </Button>
            }
          />
          <TrendChart points={series.points} targetRate={series.targetRate} targetLabel={series.targetLabel} />

          {records.length > 0 && (
            <div className="mt-3 border-t border-[var(--line)] pt-2.5">
              <p className="mb-1 text-xs font-medium text-secondary">最近的记录</p>
              <ul className="space-y-1">
                {records.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(r);
                        setSheetOpen(true);
                      }}
                      className="flex min-h-11 w-full items-baseline justify-between gap-2 rounded-lg px-1.5 text-left active:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 truncate text-[0.8rem]">
                        <span className="text-tertiary">{r.date.slice(5).replace('-', '/')}</span>{' '}
                        {r.examName}
                      </span>
                      <span className="tnum shrink-0 text-[0.8rem] font-medium">
                        {r.score === null
                          ? '缺考'
                          : `${r.score} / ${r.fullScore} · ${Math.round((r.score / r.fullScore) * 100)}%`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <ExamScoreSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setEditing(null);
        }}
        editing={editing}
        defaultSubject={current}
        subjects={subjects}
        targets={targets}
      />
    </div>
  );
}
