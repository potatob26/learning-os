import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock3,
  ListChecks,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useNow } from '../hooks/useNow';
import { cx } from '../lib/utils';
import { fmtDuration } from '../lib/time';
import { isOverdue, goalRatio, outcomeBreakdown, outcomeLabel } from '../lib/stats';
import { GoalItem } from '../components/home/GoalItem';
import { GoalSheet } from '../components/goals/GoalSheet';
import { Button } from '../components/ui/Button';
import type { Goal } from '../lib/types';
import { hasPlannedMinutes } from '../lib/types';
import { todayTabGoals } from '../lib/goals';
import { Progress } from '../components/ui/Progress';

type Tab = 'today' | 'active' | 'done' | 'all';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'active', label: '进行中' },
  { id: 'done', label: '已完成' },
  { id: 'all', label: '全部' },
];

export function Goals() {
  const navigate = useNavigate();
  const goals = useStore((s) => s.goals);
  const ts = useNow();
  const setGoalStatus = useStore((s) => s.setGoalStatus);

  const [tab, setTab] = useState<Tab>('today');
  const [editing, setEditing] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let list = goals;
    if (tab === 'today') {
      // 与作业清单页共用同一口径（单一来源，见 lib/goals.ts 的 todayTabGoals）
      list = todayTabGoals(list, ts);
    } else if (tab === 'active') {
      list = list.filter((g) => g.status === 'todo' || g.status === 'doing');
    } else if (tab === 'done') {
      list = list.filter((g) => g.status === 'done');
    }
    return [...list].sort((a, b) => {
      if (a.status === 'done' && b.status !== 'done') return 1;
      if (b.status === 'done' && a.status !== 'done') return -1;
      return (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || b.createdAt - a.createdAt;
    });
  }, [goals, tab, ts]);

  const stats = useMemo(() => {
    const active = goals.filter((g) => g.status !== 'dropped');
    const done = active.filter((g) => g.status === 'done');
    /*
     * 时长汇总只统计**计时目标**。成果目标的 plannedMinutes/actualMinutes 恒为 0，
     * 若把它算进来，当用户只有成果目标时头部会显示「计划 0m · 实际 0m」——
     * 那等于声称一个根本不存在的时长计划。没有计时目标时干脆不提这一句。
     *
     * 「不限时长」的目标同理：它没有计划值可加，但**实际学习时间是真实的**，
     * 所以 hasPlan 单独判一次 —— 否则一批不限时长的目标会让头部显示「计划 0m · 实际 2h」。
     */
    const timeGoals = active.filter((g) => g.kind !== 'outcome');
    const planned = timeGoals.reduce((a, g) => a + (g.plannedMinutes ?? 0), 0);
    const actual = timeGoals.reduce((a, g) => a + g.actualMinutes, 0);
    return {
      total: active.length,
      done: done.length,
      percent: active.length > 0 ? (done.length / active.length) * 100 : 0,
      planned,
      actual,
      hasTime: timeGoals.length > 0,
      hasPlan: timeGoals.some(hasPlannedMinutes),
    };
  }, [goals]);

  return (
    <div className="space-y-3.5">
      <header className="flex items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">目标</h1>
          <p className="mt-0.5 text-xs text-secondary">
            {stats.total > 0
              ? `${stats.done} / ${stats.total} 已完成${
                  stats.hasTime
                    ? ` · ${stats.hasPlan ? `计划 ${fmtDuration(stats.planned)} · ` : ''}实际 ${fmtDuration(stats.actual)}`
                    : ''
                }`
              : '还没有目标'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* 作业清单：按科目分组的勾选视图（复用同一批目标，不另存一份数据） */}
          <Button size="sm" variant="secondary" icon={<ListChecks />} onClick={() => navigate('/checklist')}>
            清单
          </Button>
          <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
            新建
          </Button>
        </div>
      </header>

      {stats.total > 0 && (
        <div className="mica rounded-[var(--radius-card)] p-3.5">
          <Progress
            label="总体完成率"
            right={`${Math.round(stats.percent)}%`}
            percent={stats.percent}
            tone={stats.percent >= 100 ? 'ok' : 'accent'}
          />
        </div>
      )}

      {/* 状态筛选 */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              'min-h-11 shrink-0 rounded-full border px-3.5 text-[0.8rem] font-medium transition-colors duration-200',
              tab === t.id
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/*
        ⚠️ 这里原来有一排「全部科目 / 其他 / 英语 / 语文」筛选按钮，用户明确要求**去掉**：
        「目标栏不该出现全部科目和其他和英语和语文按钮」。
        同时它带来的一块玻璃底也让用户以为是"不该出现的错位元素"——
        去掉后那两块一起消失。
        注意：`subjectFilter` 状态与过滤逻辑**一并删掉**，不留"设置了却没人用"的死状态。
      */}

      {filtered.length === 0 ? (
        <div className="mica rounded-[var(--radius-card)] px-5 py-10 text-center">
          <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-tertiary)]">
            <Circle className="size-5" />
          </span>
          <p className="text-[0.95rem] font-medium">
            {tab === 'today' ? '今天还没有要做的目标' : '这里还是空的'}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-secondary">
            目标可以是「完成一套数学试卷 · 计划 60 分钟」这样具体的一件事。
          </p>
          <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)} className="mx-auto mt-4">
            新建目标
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((g, i) => (
            <GoalCard
              key={g.id}
              goal={g}
              nowTs={ts}
              index={i}
              onToggle={() => setGoalStatus(g.id, g.status === 'done' ? 'todo' : 'done')}
              onEdit={() => setEditing(g)}
            />
          ))}
        </div>
      )}

      <GoalSheet open={creating} onClose={() => setCreating(false)} />
      <GoalSheet
        open={editing !== null}
        goal={editing ?? undefined}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function GoalCard({
  goal,
  nowTs,
  index,
  onToggle,
  onEdit,
}: {
  goal: Goal;
  nowTs: number;
  index: number;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const done = goal.status === 'done';
  const overdue = !done && isOverdue(goal.dueAt, nowTs);
  const outcome = goal.kind === 'outcome';
  // 两类目标统一走 goalRatio：计时目标算 实际/计划，成果目标算 (当前−起始)/(目标−起始)。
  // 之前这里是 `plannedMinutes > 0 ? pct(actual, planned) : 0`，
  // 成果目标的计划时长为 0，会永远显示 0%。
  const ratio = goalRatio(goal);
  const progress = ratio === null ? 0 : Math.round(ratio * 100);
  // 成果目标的进度推导（起始/已前进/还差），用于把百分比讲清楚；计时目标为 null
  const breakdown = outcomeBreakdown(goal);
  const unitSuffix = breakdown?.unit ? ` ${breakdown.unit}` : '';

  return (
    <div
      className="mica anim-rise rounded-[var(--radius-card)] p-3.5"
      style={{ animationDelay: `${Math.min(index, 8) * 0.03}s` }}
    >
      <GoalItem goal={goal} nowTs={nowTs} onToggle={onToggle} onOpen={onEdit} />

      <div className="mt-2.5 space-y-2 px-2.5">
        {goal.description && (
          <p className="text-[0.78rem] leading-relaxed text-secondary">{goal.description}</p>
        )}

        {/* 只放 GoalItem 副标题没有出现过的信息，避免同一事实在卡内出现两次 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {overdue && (
            <span className="pill pill-bad">
              <TriangleAlert className="size-2.5" />
              已逾期
            </span>
          )}
          {done && goal.completedAt && (
            <span className="pill pill-ok">
              <CheckCircle2 className="size-2.5" />
              {new Date(goal.completedAt).toLocaleDateString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
              })}
            </span>
          )}
          {goal.dueAt && (
            <span className="pill pill-muted">
              <Clock3 className="size-2.5" />
              截止 {goal.dueAt}
            </span>
          )}
        </div>

        {ratio !== null && (
          <div className="flex items-center gap-2">
            <Progress
              percent={progress}
              size="sm"
              tone={done ? 'ok' : progress > 100 ? 'warn' : 'accent'}
            />
            <span className="tnum shrink-0 text-[0.7rem] font-semibold text-secondary">
              {outcome
                ? `${outcomeLabel(goal)}（${progress}%）`
                : !hasPlannedMinutes(goal)
                  // 不限时长：没有分母可比，只报已经学了多久
                  ? `已学 ${fmtDuration(goal.actualMinutes)}`
                  : `${fmtDuration(goal.actualMinutes)} / ${fmtDuration(goal.plannedMinutes ?? 0)}`}
            </span>
          </div>
        )}
        {/*
          成果目标的进度**推导过程**（1.3.0 修「80% 看不懂」）：
          把起点、已前进、还差写出来，百分比就不再是个"凭空来的数字"。
          另一层作用：如果起始值本身记错了，这里会直接把它显示出来（比如写着"从 21 起步"
          而实际应该是 30），比事后追查可靠。起始值可在编辑表单里改。
        */}
        {outcome && breakdown && (
          <p className="tnum text-[0.7rem] leading-relaxed text-tertiary">
            {`从 ${breakdown.start}${unitSuffix}起步 · 已前进 ${breakdown.advanced}${unitSuffix}`}
            {breakdown.remaining > 0
              ? ` · 还差 ${breakdown.remaining}${unitSuffix}`
              : ' · 已达目标'}
          </p>
        )}
      </div>
    </div>
  );
}
