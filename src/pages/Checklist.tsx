import { useMemo, useState } from 'react';
import { Check, ChevronLeft, CircleCheckBig, ListChecks, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useNow } from '../hooks/useNow';
import { cx } from '../lib/utils';
import { groupBySubject, todayTabGoals } from '../lib/goals';
import { Progress } from '../components/ui/Progress';
import { Button } from '../components/ui/Button';
import type { Goal } from '../lib/types';

/**
 * 作业清单
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要的是「按科目分组勾选 + 进度条」。这里**复用现有 Goal 数据**
 * （`subject` 分组、`setGoalStatus` 勾选），不新建一套"作业"模型 ——
 * 否则同一件事会在目标页和清单页各存一份，迟早对不上。
 *
 * 口径与目标页「今天」页签完全一致（见 lib/goals.ts 的 isTodayGoal，单一来源）。
 *
 * 勾选语义：
 *   · 勾上   → status = 'done'（会记 completedAt，统计/首页进度都会跟着算）
 *   · 取消   → status = 'todo'
 * 所以这个清单**不是**一个孤立的复选框列表，勾完就是真的完成了目标 —— 首页百分比、
 * 统计、连续天数都会动。这是刻意的：两套进度会互相打架。
 */
export function Checklist() {
  const navigate = useNavigate();
  const goals = useStore((s) => s.goals);
  const setGoalStatus = useStore((s) => s.setGoalStatus);
  const ts = useNow();
  const [confirmReset, setConfirmReset] = useState(false);

  const list = useMemo(() => todayTabGoals(goals, ts), [goals, ts]);
  const groups = useMemo(() => groupBySubject(list), [list]);

  const done = list.filter((g) => g.status === 'done').length;
  const total = list.length;
  const percent = total === 0 ? 0 : (done / total) * 100;

  const toggle = (g: Goal) => {
    setGoalStatus(g.id, g.status === 'done' ? 'todo' : 'done');
  };

  const resetToday = () => {
    for (const g of list) {
      if (g.status === 'done') setGoalStatus(g.id, 'todo');
    }
    setConfirmReset(false);
  };

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="返回目标"
              onClick={() => navigate('/goals')}
              className="grid size-11 shrink-0 place-items-center rounded-full text-secondary transition-colors hover:text-[var(--text)]"
            >
              <ChevronLeft className="size-5" />
            </button>
            <h1 className="truncate text-2xl font-semibold tracking-tight">作业清单</h1>
          </div>
          <p className="mt-0.5 pl-[3.25rem] text-xs text-secondary">勾选完成项，进度条会自动更新</p>
        </div>
      </header>

      {/* 整体完成进度 */}
      <section className="mica rounded-[var(--radius-card)] p-4" data-testid="checklist-progress">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-secondary">整体完成进度</span>
          <span className="tnum text-2xl font-semibold text-[var(--ok-text)]">{Math.round(percent)}%</span>
        </div>
        <Progress value={percent} className="mt-3" />
        <p className="mt-2 text-xs text-secondary">
          已完成 <span className="tnum font-medium text-[var(--text)]">{done}</span> / {total} 项
        </p>
      </section>

      {total === 0 ? (
        <section className="mica mt-4 rounded-[var(--radius-card)] px-5 py-10 text-center">
          <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-tertiary)]">
            <ListChecks className="size-5" />
          </span>
          <p className="text-sm font-medium">今天还没有要做的作业</p>
          <p className="mx-auto mt-1.5 max-w-[16rem] text-xs leading-relaxed text-secondary">
            在「目标」里新建一条，写上科目，它就会自动出现在这份清单里。
          </p>
          <Button className="mt-4" onClick={() => navigate('/goals')}>
            去目标里新建
          </Button>
        </section>
      ) : (
        <>
          {groups.map((group) => {
            const gDone = group.items.filter((g) => g.status === 'done').length;
            return (
              <section key={group.subject} className="mica mt-4 rounded-[var(--radius-card)] p-4">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-semibold">{group.subject}</h2>
                  <span className="tnum text-xs text-tertiary">
                    {gDone}/{group.items.length}
                  </span>
                </div>
                <ul>
                  {group.items.map((g) => {
                    const isDone = g.status === 'done';
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isDone}
                          aria-label={`${g.title}（${group.subject}）`}
                          onClick={() => toggle(g)}
                          className="flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-1 text-left transition-colors active:bg-[var(--surface-sunken)]"
                        >
                          <span
                            className={cx(
                              'grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
                              isDone
                                ? 'border-[var(--ok)] bg-[var(--ok)] text-[var(--on-accent)]'
                                : 'border-[var(--line-strong)] text-transparent',
                            )}
                          >
                            <Check className="size-3.5" strokeWidth={3} />
                          </span>
                          <span
                            className={cx(
                              'min-w-0 flex-1 text-sm',
                              isDone ? 'text-tertiary line-through' : 'text-[var(--text)]',
                            )}
                          >
                            {g.title}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {/* 重置：与参考图一致，但它会真的改状态，所以先问一句 */}
          <div className="mt-4 flex items-center justify-between gap-3">
            {confirmReset ? (
              <>
                <span className="text-xs text-secondary">把今天已勾选的 {done} 项改回未完成？</span>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setConfirmReset(false)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={resetToday}>
                    确定重置
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5 text-xs text-tertiary">
                  <CircleCheckBig className="size-3.5" />
                  勾选会记入今天的学习进度
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={done === 0}
                  onClick={() => setConfirmReset(true)}
                >
                  <RotateCcw className="size-3.5" />
                  重置勾选
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
