import { Check, Clock3, Flag, Target } from 'lucide-react';
import type { Goal } from '../../lib/types';
import { PRIORITY_LABEL, hasPlannedMinutes } from '../../lib/types';
import { cx } from '../../lib/utils';
import { fmtDuration } from '../../lib/time';
import { goalRatio, goalTimeDelta, isOverdue, outcomeLabel } from '../../lib/stats';

/** 单条目标（首页 / 目标页共用），触控友好，整行可点 */
export function GoalItem({
  goal,
  nowTs,
  onToggle,
  onOpen,
  compact,
}: {
  goal: Goal;
  nowTs: number;
  onToggle: () => void;
  onOpen?: () => void;
  compact?: boolean;
}) {
  const done = goal.status === 'done';
  const overdue = !done && isOverdue(goal.dueAt, nowTs);
  const delta = goalTimeDelta(goal);
  const ratio = goalRatio(goal);

  return (
    <div
      className={cx(
        'group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors duration-200',
        !done && 'hover:bg-[var(--surface-sunken)]',
      )}
    >
      {/* 勾选区域 ≥44px，避免误触 */}
      <button
        type="button"
        aria-label={done ? `将「${goal.title}」标记为未完成` : `完成「${goal.title}」`}
        onClick={onToggle}
        className="grid size-11 shrink-0 place-items-center"
      >
        <span
          className={cx(
            'grid size-[1.45rem] place-items-center rounded-full border-2 transition-all duration-200',
            done
              ? 'border-[var(--ok)] bg-[var(--ok)] text-white'
              : 'border-[var(--line-strong)] text-transparent active:border-[var(--ok)]',
          )}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </button>

      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="min-h-11 min-w-0 flex-1 py-2 text-left"
      >
        <p
          className={cx(
            'truncate text-[0.95rem] font-medium leading-snug',
            done && 'text-tertiary line-through',
          )}
        >
          {goal.title}
        </p>
        {!compact && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.7rem] text-tertiary">
            <span className="font-medium text-secondary">{goal.subject}</span>
            {/* 成果目标没有时长，显示数值进度而不是「计划 0m」 */}
            {goal.kind === 'outcome' ? (
              <span className="tnum inline-flex items-center gap-0.5">
                <Target className="size-3" />
                {outcomeLabel(goal) ?? '未设置进度'}
                {ratio !== null && `（${Math.round(ratio * 100)}%）`}
              </span>
            ) : (
              <span className="tnum inline-flex items-center gap-0.5">
                <Clock3 className="size-3" />
                {!hasPlannedMinutes(goal)
                  // 不限时长：没有"计划"可对比，只说已经学了多久（没学就直说是不限）
                  ? goal.actualMinutes > 0
                    ? `已学 ${fmtDuration(goal.actualMinutes)}`
                    : '不限时长'
                  : goal.actualMinutes > 0
                    ? `${fmtDuration(goal.actualMinutes)} / ${fmtDuration(goal.plannedMinutes ?? 0)}`
                    : `计划 ${fmtDuration(goal.plannedMinutes ?? 0)}`}
              </span>
            )}
            {goal.priority === 'high' && !done && (
              <span className="pill pill-warn">
                <Flag className="size-2.5" />
                {PRIORITY_LABEL.high}
              </span>
            )}
            {overdue && <span className="pill pill-bad">已逾期</span>}
            {delta !== null && (
              <span className={cx('pill', delta <= 0 ? 'pill-ok' : 'pill-warn')}>
                {delta <= 0 ? `提前 ${fmtDuration(-delta)}` : `超出 ${fmtDuration(delta)}`}
              </span>
            )}
          </div>
        )}
      </button>
    </div>
  );
}
