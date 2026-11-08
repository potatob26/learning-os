import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { useStore } from '../../lib/store';
import { cx } from '../../lib/utils';
import { fmtDuration } from '../../lib/time';
import { hasPlannedMinutes } from '../../lib/types';

const COMMON = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];

/**
 * 开始学习
 * 科目 / 目标 / 目标时长，一步开始。
 * 科目来源：用户已有课程与目标的科目优先，其余用常见科目。
 */
export function StartStudySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const courses = useStore((s) => s.courses);
  const goals = useStore((s) => s.goals);
  const startTimer = useStore((s) => s.startTimer);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const c of courses) if (c.subject) set.add(c.subject);
    for (const g of goals) if (g.status !== 'done' && g.subject) set.add(g.subject);
    const mine = [...set];
    const rest = COMMON.filter((s) => !set.has(s));
    return [...mine, ...rest].slice(0, 12);
  }, [courses, goals]);

  const [subject, setSubject] = useState(subjects[0] ?? '数学');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(45);

  /*
   * 成果目标（不计时）不出现在这里：它没有「学多久」的概念，
   * 关联上去也只会让计时器给它加上实际时长，与「不参与计时」的定义冲突。
   * 它的入口在目标页和首页的「现在该做什么」卡片里（完成打卡）。
   */
  const openGoals = goals.filter((g) => g.status !== 'done' && g.kind !== 'outcome');

  const begin = () => {
    startTimer(subject, goalId, target);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="开始学习"
      description="结束时会自动写入学习记录"
      footer={
        <Button block size="lg" icon={<Play />} onClick={begin}>
          开始计时
        </Button>
      }
    >
      <div className="space-y-4 pb-1">
        <div>
          <span className="mb-2 block text-xs font-medium text-secondary">科目</span>
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSubject(s)}
                className={cx(
                  'min-h-10 rounded-full border px-3.5 text-[0.85rem] font-medium transition-colors duration-200',
                  subject === s
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {openGoals.length > 0 && (
          <div>
            <span className="mb-2 block text-xs font-medium text-secondary">关联目标（可选）</span>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setGoalId(null)}
                className={cx(
                  'flex min-h-11 w-full items-center rounded-xl border px-3 text-left text-[0.85rem] transition-colors duration-200',
                  goalId === null
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                不关联
              </button>
              {openGoals.slice(0, 6).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setGoalId(g.id);
                    setSubject(g.subject);
                  }}
                  className={cx(
                    'flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left transition-colors duration-200',
                    goalId === g.id
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] bg-[var(--surface-sunken)]',
                  )}
                >
                  <span
                    className={cx(
                      'min-w-0 flex-1 truncate text-[0.85rem] font-medium',
                      goalId === g.id ? 'text-[var(--accent-text)]' : 'text-[var(--text)]',
                    )}
                  >
                    {g.title}
                  </span>
                  <span className="tnum shrink-0 text-[0.7rem] text-tertiary">
                    {hasPlannedMinutes(g) ? fmtDuration(g.plannedMinutes ?? 0) : '不限'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className="mb-2 block text-xs font-medium text-secondary">目标时长（只做提醒，不会强制停止）</span>
          <div className="flex flex-wrap gap-1.5">
            {[null, 15, 25, 30, 45, 60, 90].map((m) => (
              <button
                key={String(m)}
                type="button"
                onClick={() => setTarget(m)}
                className={cx(
                  'min-h-10 rounded-full border px-3.5 text-[0.85rem] font-medium transition-colors duration-200',
                  target === m
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {m === null ? '不限' : m >= 60 ? `${m / 60}h` : `${m}m`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[0.7rem] text-tertiary">
            默认参考你设置的单次专注时长，可随时改。
          </p>
        </div>
      </div>
    </Sheet>
  );
}
