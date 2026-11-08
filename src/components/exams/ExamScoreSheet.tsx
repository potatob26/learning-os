import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { cx } from '../../lib/utils';
import { dayKey } from '../../lib/time';
import { useStore } from '../../lib/store';
import { COMMON_FULL_SCORES } from '../../lib/examScores';
import type { ExamScore, SubjectScoreTarget } from '../../lib/types';

/**
 * 记录成绩 / 设置科目目标（同一个弹层两种模式）
 * ──────────────────────────────────────────────────────────────
 * 说明：
 *   · 分数留空 = 缺考（存 null），**不会**记成 0 分；
 *   · 满分制必须填，否则 100/150 分制混在一起没法比较；
 *   · 目标分按科目存一份长期目标（不挂在每次记录上）。
 */
export function ExamScoreSheet({
  open,
  onClose,
  editing,
  defaultSubject,
  subjects,
  targets,
}: {
  open: boolean;
  onClose: () => void;
  editing: ExamScore | null;
  defaultSubject: string;
  subjects: string[];
  targets: SubjectScoreTarget[];
}) {
  const addExamScore = useStore((s) => s.addExamScore);
  const updateExamScore = useStore((s) => s.updateExamScore);
  const removeExamScore = useStore((s) => s.removeExamScore);
  const setSubjectScoreTarget = useStore((s) => s.setSubjectScoreTarget);
  const removeSubjectScoreTarget = useStore((s) => s.removeSubjectScoreTarget);

  const [mode, setMode] = useState<'score' | 'target'>('score');
  const [subject, setSubject] = useState(defaultSubject);
  const [examName, setExamName] = useState('');
  const [date, setDate] = useState(dayKey(Date.now()));
  const [score, setScore] = useState('');
  const [fullScore, setFullScore] = useState('100');
  const [note, setNote] = useState('');
  const [targetScore, setTargetScore] = useState('');
  const [targetFullScore, setTargetFullScore] = useState('100');
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const existingTarget = useMemo(
    () => targets.find((t) => t.subject === subject.trim()) ?? null,
    [targets, subject],
  );

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setConfirmDelete(false);
    if (editing) {
      setMode('score');
      setSubject(editing.subject);
      setExamName(editing.examName);
      setDate(editing.date);
      setScore(editing.score === null ? '' : String(editing.score));
      setFullScore(String(editing.fullScore));
      setNote(editing.note ?? '');
    } else {
      setMode('score');
      setSubject(defaultSubject);
      setExamName('');
      setDate(dayKey(Date.now()));
      setScore('');
      setFullScore('100');
      setNote('');
    }
    setTargetScore(existingTarget ? String(existingTarget.targetScore) : '');
    setTargetFullScore(String(existingTarget?.fullScore ?? 100));
  }, [open, editing, defaultSubject, existingTarget]);

  useEffect(() => {
    if (!open) return;
    setTargetScore(existingTarget ? String(existingTarget.targetScore) : '');
    setTargetFullScore(String(existingTarget?.fullScore ?? 100));
  }, [open, existingTarget]);

  const saveScore = () => {
    const parsedFull = Number(fullScore);
    const parsedScore = score.trim() === '' ? null : Number(score);
    const payload = {
      subject: subject.trim(),
      examName: examName.trim(),
      date,
      score: parsedScore,
      fullScore: parsedFull,
      note: note.trim(),
    };
    if (!payload.subject) return setErr('先填科目');
    if (!payload.examName) return setErr('先填考试名称（如「期中」）');
    if (!Number.isFinite(parsedFull) || parsedFull <= 0) return setErr('满分要大于 0');
    if (parsedScore !== null && (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > parsedFull)) {
      return setErr(`分数要在 0 到 ${parsedFull} 之间（不想填就留空记缺考）`);
    }
    if (parsedScore === null && score.trim() !== '') return setErr('分数不是有效数字');
    if (editing) {
      if (!updateExamScore(editing.id, payload)) return setErr('保存失败，检查一下日期和分数');
    } else if (!addExamScore(payload)) {
      return setErr('保存失败，检查一下日期和分数');
    }
    onClose();
  };

  const saveTarget = () => {
    const parsedFull = Number(targetFullScore);
    const parsedTarget = Number(targetScore);
    if (!subject.trim()) return setErr('先填科目');
    if (!Number.isFinite(parsedFull) || parsedFull <= 0) return setErr('满分要大于 0');
    if (!Number.isFinite(parsedTarget) || parsedTarget < 0 || parsedTarget > parsedFull) {
      return setErr(`目标分要在 0 到 ${parsedFull} 之间`);
    }
    if (!setSubjectScoreTarget(subject.trim(), parsedTarget, parsedFull)) {
      return setErr('保存失败，检查一下目标分');
    }
    onClose();
  };

  const footer = (
    <div className="flex gap-2">
      {editing && mode === 'score' && (
        <Button
          variant="danger"
          size="lg"
          className="flex-1"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            removeExamScore(editing.id);
            onClose();
          }}
        >
          {confirmDelete ? '确认删除' : '删除'}
        </Button>
      )}
      <Button size="lg" className="flex-1" onClick={mode === 'score' ? saveScore : saveTarget}>
        {mode === 'score' ? (editing ? '保存修改' : '保存成绩') : '保存目标'}
      </Button>
    </div>
  );

  const input =
    'min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-[0.9rem] text-[var(--text)] outline-none focus:border-[var(--accent)]';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'score' ? (editing ? '修改成绩' : '记录成绩') : '科目目标'}
      description="成绩只是记录，不计入学习时长"
      footer={footer}
    >
      <div className="space-y-3 pt-1">
        <div className="stats-range flex gap-1" role="group" aria-label="记录类型">
          {(
            [
              { id: 'score' as const, label: '考试成绩' },
              { id: 'target' as const, label: '目标分' },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setMode(t.id);
                setErr(null);
              }}
              aria-pressed={mode === t.id}
              className={cx(
                'min-h-11 flex-1 rounded-full text-[0.82rem] font-semibold transition-colors',
                mode === t.id ? 'stats-tab-selected' : 'text-secondary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">科目</span>
          <input
            className={input}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="数学 / 英语 / 物理…"
          />
          {subjects.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {subjects.slice(0, 12).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSubject(s)}
                  className={cx(
                    'min-h-9 rounded-full border px-2.5 text-[0.72rem]',
                    subject.trim() === s
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                      : 'border-[var(--line)] text-secondary',
                  )}
                >
                  {s}
                </button>
              ))}
            </span>
          )}
        </label>

        {mode === 'score' ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-secondary">考试名称</span>
              <input
                className={input}
                value={examName}
                onChange={(e) => setExamName(e.target.value)}
                placeholder="期中 / 第一次月考 / 模考"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-secondary">日期</span>
              <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="mb-1.5 block text-xs font-medium text-secondary">得分（留空 = 缺考）</span>
                <input
                  type="number"
                  inputMode="decimal"
                  className={input}
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  placeholder="如 112"
                  min={0}
                />
              </label>
              <label className="block flex-1">
                <span className="mb-1.5 block text-xs font-medium text-secondary">满分</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className={input}
                  value={fullScore}
                  onChange={(e) => setFullScore(e.target.value)}
                  min={1}
                />
              </label>
            </div>
            <span className="flex gap-1.5">
              {COMMON_FULL_SCORES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFullScore(String(v))}
                  className={cx(
                    'min-h-9 rounded-full border px-3 text-[0.72rem]',
                    String(v) === fullScore
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                      : 'border-[var(--line)] text-secondary',
                  )}
                >
                  满分 {v}
                </button>
              ))}
            </span>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-secondary">备注（可选）</span>
              <input
                className={input}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="如「补考」「选择题失误」"
              />
            </label>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="mb-1.5 block text-xs font-medium text-secondary">目标分</span>
                <input
                  type="number"
                  inputMode="decimal"
                  className={input}
                  value={targetScore}
                  onChange={(e) => setTargetScore(e.target.value)}
                  placeholder="如 120"
                  min={0}
                />
              </label>
              <label className="block flex-1">
                <span className="mb-1.5 block text-xs font-medium text-secondary">满分</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className={input}
                  value={targetFullScore}
                  onChange={(e) => setTargetFullScore(e.target.value)}
                  min={1}
                />
              </label>
            </div>
            <span className="flex gap-1.5">
              {COMMON_FULL_SCORES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTargetFullScore(String(v))}
                  className={cx(
                    'min-h-9 rounded-full border px-3 text-[0.72rem]',
                    String(v) === targetFullScore
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                      : 'border-[var(--line)] text-secondary',
                  )}
                >
                  满分 {v}
                </button>
              ))}
            </span>
            {existingTarget && (
              <Button
                variant="secondary"
                block
                onClick={() => {
                  removeSubjectScoreTarget(existingTarget.subject);
                  onClose();
                }}
              >
                清除这科的目标分
              </Button>
            )}
            <p className="text-[0.7rem] leading-relaxed text-tertiary">
              目标分按科目存一份；趋势图上它会画成一条虚线。不同满分制之间按折合率比较。
            </p>
          </>
        )}

        {err && (
          <p className="rounded-xl bg-[var(--bad-soft)] px-3 py-2 text-[0.72rem] text-[var(--bad-text)]">{err}</p>
        )}
      </div>
    </Sheet>
  );
}
