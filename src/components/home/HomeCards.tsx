import { useEffect, useMemo, useState } from 'react';
import { Check, Flame, Play, Plus, RefreshCw, Square, Target, TrendingUp } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import type { StreakState } from '../../lib/streak';
import { Progress, ProgressRing } from '../ui/Progress';
import { Button } from '../ui/Button';
import { GoalItem } from './GoalItem';
import { useStore } from '../../lib/store';
import type { ImportantDate, Settings } from '../../lib/types';
import { fmtClock, fmtDuration, dayKey, monthDayLabel, settingsForDay, weekdayLabel } from '../../lib/time';
import { effectiveWeekday } from '../../lib/holidays';
import { ratioPercent } from '../../lib/utils';
import { buildQuotePool, nextQuote, pickQuote } from '../../lib/quotes';
import { todayGoals } from '../../lib/stats';
import { cycleSuggestion, suggestNext } from '../../lib/suggest';
import type { DayPlan } from '../../lib/time';
import type { ScheduleToday } from '../../hooks/useSchedule';
import type { TodayProgress } from '../../lib/stats';
import type { StatsSummary } from '../../lib/stats';
import { cx } from '../../lib/utils';

/* ───────────────────────── 顶部：时间 + 鼓励 ───────────────────────── */

export function HomeHeader({
  nowTs,
  settings,
  streakState,
  onOpenStreak,
  onQuickAdd,
}: {
  nowTs: number;
  settings: Settings;
  streakState: StreakState;
  onOpenStreak: () => void;
  onQuickAdd: () => void;
}) {
  const d = new Date(nowTs);
  const { streak, phase, repairDone, repairNeed } = streakState;
  /*
   * 第一天（还没有任何学习记录）也要露出火花入口 ——
   * 之前 empty/broken 直接隐藏徽章，用户第一天根本找不到火花页。
   * 现在空状态显示「开始」，断开后显示「重新开始」，平时显示「N 天」。
   */
  const firstDay = phase === 'empty';
  const restart = phase === 'broken';
  const repairing = phase === 'repairing';
  const dot = phase === 'restorable' || phase === 'ready';

  return (
    <header className="anim-fade">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.8rem] font-medium text-secondary">
            {greeting(nowTs)}
            {settings.nickname ? `，${settings.nickname}` : ''}
          </p>
          <div className="mt-0.5 flex items-end gap-2">
            {/* 每秒变化的部分单独成节点，避免整页重渲染 */}
            <LiveClock />
            <span className="pb-1 text-[0.8rem] font-medium text-tertiary">
              {monthDayLabel(nowTs)} {weekdayLabel(d.getDay())}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenStreak}
            className="flex min-h-11 items-center gap-1 rounded-full bg-[var(--warn-soft)] px-3 text-xs font-semibold text-[var(--warn-text)]"
            title="连续学习天数，打开火花页面"
            aria-label={
              streak > 0
                ? `连续学习 ${streak} 天，打开火花页面`
                : firstDay
                  ? '开始记录火花，打开火花页面'
                  : '重新开始记录火花，打开火花页面'
            }
          >
            <Flame className={cx('size-4', phase === 'restorable' && 'text-[var(--text-tertiary)]')} />
            {streak > 0 && (
              <>
                <span className="tnum">{streak}</span>
                <span className="text-[0.62rem] font-medium opacity-80">天</span>
              </>
            )}
            {(firstDay || restart) && (
              <span className="text-[0.66rem] font-semibold">{restart ? '重新开始' : '开始'}</span>
            )}
            {repairing && (
              <span className="tnum text-[0.62rem]">
                {repairDone}/{repairNeed}
              </span>
            )}
            {dot && <span className="size-1.5 rounded-full bg-[var(--warn)]" aria-hidden />}
          </button>
          {/* 快速添加入口放在拇指可达的右上角，避免悬浮按钮遮挡内容 */}
          <button
            type="button"
            onClick={onQuickAdd}
            aria-label="快速添加"
            className="grid size-10 place-items-center rounded-full text-[var(--on-accent)] shadow-sm transition-transform duration-200 active:scale-95"
            style={{ background: 'linear-gradient(150deg, var(--accent), var(--accent-strong))' }}
          >
            <Plus className="size-5" strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * 每日一句。
 * 位置：紧跟「今日自学」之下（用户指定）。
 * 候选池 = 内置语句库（可在设置里关掉）+ 用户自定义语句。
 * 右侧「换一句」按钮按顺序取**下一条**而不是随机 ——
 * 随机换时连点两下很可能又抽回原来那条，看起来像按钮失灵。
 */
export function HomeQuote() {
  const custom = useStore((s) => s.settings.customQuotes);
  const useBuiltin = useStore((s) => s.settings.useBuiltinQuotes);

  const opts = useMemo(
    () => ({ custom, useBuiltin: useBuiltin !== false }),
    [custom, useBuiltin],
  );
  const [quote, setQuote] = useState(() => pickQuote(opts));

  // 设置里增删了自定义语句、或开关了内置库之后，池子变了要跟着刷新，
  // 否则刚加的句子在首页看不到，看起来像没生效
  useEffect(() => {
    setQuote(pickQuote(opts));
  }, [opts]);

  const pool = useMemo(() => buildQuotePool(opts), [opts]);

  return (
    <div className="anim-fade flex items-start gap-2.5 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-3.5 py-2.5">
      <Sparkle className="mt-0.5 size-4 shrink-0 text-tertiary" />
      <p className="min-w-0 flex-1 text-[0.82rem] leading-relaxed text-secondary">{quote.text}</p>
      {pool.length > 1 && (
        <button
          type="button"
          onClick={() => setQuote(nextQuote(opts))}
          aria-label="换一句"
          title="换一句"
          className="-mr-1 grid size-9 shrink-0 place-items-center rounded-full text-tertiary transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] active:scale-95"
        >
          <RefreshCw className="size-4" />
        </button>
      )}
    </div>
  );
}

function greeting(nowTs: number): string {
  const h = new Date(nowTs).getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  if (h < 23) return '晚上好';
  return '夜深了';
}

/** 只让时钟自己每秒渲染，页面其他部分不动 */
export function LiveClock() {
  const [label, setLabel] = useState(() => currentLabel());
  useEffect(() => {
    const id = setInterval(() => setLabel(currentLabel()), 1000);
    const onVis = () => setLabel(currentLabel());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return <span className="num-hero tnum text-[2rem] leading-none">{label}</span>;
}

function currentLabel(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx('mt-0.5 shrink-0 text-[var(--accent-text)]', className ?? 'size-3.5')}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 3.2l1.6 4.6 4.6 1.6-4.6 1.6L12 15.6l-1.6-4.6L5.8 9.4l4.6-1.6L12 3.2z" opacity=".85" />
    </svg>
  );
}

/* ───────────────────────── 今日自学进度 ───────────────────────── */

export function StudyProgressCard({
  progress,
  plan,
  nowTs,
  dailyGoalMinutes,
  onOpenStats,
  delay = 0,
}: {
  progress: TodayProgress;
  plan: DayPlan;
  nowTs: number;
  dailyGoalMinutes: number;
  onOpenStats?: () => void;
  delay?: number;
}) {
  /*
   * 距离睡觉还有多久。
   * 用 plan.sleepMin（= 当天生效作息里的「睡觉」时间），不再拿学习窗口终点冒充 ——
   * 窗口终点是「学到几点」，跟「几点睡」本来是两件事。
   * sleepMin 由 computeDayPlan 解析，没填睡觉时间时会回落到窗口终点。
   */
  const d = new Date(nowTs);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  /*
   * sleepMin 已经由 computeDayPlan 处理过「睡觉早于窗口起点 → 顺延到次日」的情况，
   * 这里不能再无脑 +1440：已经过了睡觉时间时应该老实显示「已过」，
   * 而不是把它算成「距离明天睡觉还有 22 小时」（实测晚上 21 点会这么显示）。
   */
  const toSleep = plan.sleepMin - nowMin;
  const studied = Math.round(progress.studiedMinutes);

  /*
   * 今日目标百分比：**不封顶**（学了 6h、目标 3h 就是 200%）。
   * 用 ratioPercent 而不是 pct —— pct 会压在 100，那样"超额"就被抹掉了。
   */
  const overall = dailyGoalMinutes > 0 ? ratioPercent(studied, dailyGoalMinutes) : 0;
  /* 进度环两个状态的颜色都可由用户在设置里换（缺省跟随强调色） */
  const ringOverflow = useStore((s) => s.settings.ringOverflow);
  const ringColor = useStore((s) => s.settings.ringColor);
  const remaining = plan.windowClosed ? 0 : plan.remainingAvailableMinutes;

  return (
    <Card tier="liquid" delay={delay} padding="lg">
      {/* 首页信息优先级：先回答「今天学了多少」，再回答「还能学多久」。
          三个数字刻意分开呈现、各带明确标签，避免把「上课时间」误读成「学习时间」。 */}
      <div className="flex items-center gap-4">
        <ProgressRing
          percent={overall}
          size={92}
          stroke={9}
          celebrate
          ringColor={ringColor ?? undefined}
          overflowColor={ringOverflow ?? undefined}
          className="shrink-0"
        >
          <div className="text-center">
            <p className="tnum text-[1.35rem] font-semibold leading-none">{Math.round(overall)}%</p>
            <p className="mt-0.5 text-[0.7rem] font-medium text-tertiary">今日目标</p>
          </div>
        </ProgressRing>

        <div className="min-w-0 flex-1">
          <p className="text-[0.8rem] font-medium text-secondary">今日自学</p>
          <p className="num-hero tnum mt-0.5 text-[1.9rem] leading-none">
            {studied >= 60 ? fmtDuration(studied, 'long') : `${studied} 分钟`}
          </p>
          {/* 副标题回答「离目标还差多少」，不重复环里已有的百分比 */}
          <p className="mt-1 text-[0.72rem] text-tertiary">
            {overall >= 100
              ? `目标 ${fmtDuration(dailyGoalMinutes)} · ${
                  overall > 100 ? `超额 ${fmtDuration(Math.max(0, studied - dailyGoalMinutes))}` : '已达成'
                }`
              : `目标 ${fmtDuration(dailyGoalMinutes)} · 还差 ${fmtDuration(Math.max(0, dailyGoalMinutes - studied))}`}
          </p>
        </div>
      </div>

      {/* 课后可支配 / 剩余：两者都只由「学习窗口 − 上课 − 固定活动」推导，
          与上面的学习时长严格分开。 */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-3">
        <Stat label="课后可支配" value={fmtDuration(plan.availableMinutes)} />
        <Stat
          label={plan.windowClosed ? '窗口已结束' : '剩余'}
          value={plan.windowClosed ? '0m' : fmtDuration(remaining)}
          tone={plan.windowClosed ? 'warn' : 'accent'}
        />
        <Stat label="距离睡觉" value={toSleep > 0 ? fmtDuration(toSleep) : '已过'} />
      </div>

      {plan.windowClosed && (
        <p className="mt-2 rounded-lg bg-[var(--warn-soft)] px-2.5 py-1.5 text-[0.7rem] text-[var(--warn-text)]">
          今天的学习窗口已经结束，记录照常保存。
        </p>
      )}

      {onOpenStats && (
        <button
          type="button"
          onClick={onOpenStats}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 py-1 text-xs font-semibold text-[var(--accent-text)]"
        >
          <TrendingUp className="size-3.5" />
          查看统计
        </button>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' | 'warn' }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.7rem] font-medium text-tertiary">{label}</p>
      <p
        className={cx(
          'tnum mt-0.5 truncate text-[0.95rem] font-semibold',
          tone === 'accent' && 'text-[var(--accent-text)]',
          tone === 'warn' && 'text-[var(--warn-text)]',
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* ───────────────────────── 今日目标 ───────────────────────── */

export function TodayGoalsCard({
  nowTs,
  onOpenGoals,
  delay = 0,
}: {
  nowTs: number;
  onOpenGoals: () => void;
  delay?: number;
}) {
  const goals = useStore((s) => s.goals);
  const setGoalStatus = useStore((s) => s.setGoalStatus);

  const list = todayGoals(goals, nowTs);
  const shown = list.slice(0, 4);
  const done = list.filter((g) => g.status === 'done').length;
  const percent = list.length > 0 ? (done / list.length) * 100 : 0;

  return (
    <Card delay={delay} padding="md">
      <CardTitle
        icon={<Check />}
        title="今天要做什么"
        subtitle={list.length > 0 ? `${done} / ${list.length} 已完成` : '还没有目标'}
        action={
          <button
            type="button"
            onClick={onOpenGoals}
            className="flex min-h-11 min-w-11 items-center justify-center px-1 text-xs font-semibold text-[var(--accent-text)]"
          >
            {list.length > 4 ? `全部 ${list.length}` : '管理'}
          </button>
        }
      />

      {list.length === 0 ? (
        <button
          type="button"
          onClick={onOpenGoals}
          className="w-full rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-4 text-center active:scale-[0.99]"
        >
          <p className="text-[0.9rem] font-medium">添加今天的目标</p>
          <p className="mt-0.5 text-xs text-tertiary">例如「数学 · 完成一套试卷 · 计划 60 分钟」</p>
        </button>
      ) : (
        <>
          <div className="mb-1 -mx-1.5">
            {shown.map((g) => (
              <GoalItem
                key={g.id}
                goal={g}
                nowTs={nowTs}
                compact
                onToggle={() => setGoalStatus(g.id, g.status === 'done' ? 'todo' : 'done')}
                onOpen={onOpenGoals}
              />
            ))}
          </div>
          {list.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <Progress value={percent} size="sm" tone={percent >= 100 ? 'ok' : 'accent'} />
              <span className="tnum shrink-0 text-[0.7rem] font-semibold text-secondary">
                {Math.round(percent)}%
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ───────────────────────── 学习计时迷你条 ───────────────────────── */

export function TimerMini({
  nowTs,
  onOpenTimer,
  onStart,
  remainingMinutes,
  delay = 0,
}: {
  nowTs: number;
  onOpenTimer: () => void;
  /** 「自己选」：打开科目选择弹层（原有流程，未改动） */
  onStart: () => void;
  /** 今天还可支配的分钟数，用于判断建议的时长是否现实 */
  remainingMinutes: number;
  delay?: number;
}) {
  const timer = useStore((s) => s.timer);
  const pause = useStore((s) => s.pauseTimer);
  const resume = useStore((s) => s.resumeTimer);
  const finish = useStore((s) => s.finishTimer);
  const goals = useStore((s) => s.goals);
  const sessions = useStore((s) => s.sessions);
  /*
   * 每日目标要取「今天真正生效」的那个 —— 它能按星期几单独设（见 settingsForDay）。
   * weekday 走 effectiveWeekday 而不是 new Date().getDay()：
   * 调课日按调课后的课表星期几，和窗口、课表保持同一口径。
   */
  const settings = useStore((s) => s.settings);
  const dayOverrides = useStore((s) => s.dayOverrides);
  const dailyGoalMinutes = useMemo(
    () => settingsForDay(settings, effectiveWeekday(dayKey(nowTs), dayOverrides)).dailyGoalMinutes,
    [settings, dayOverrides, nowTs],
  );
  const startTimer = useStore((s) => s.startTimer);
  const setGoalStatus = useStore((s) => s.setGoalStatus);
  const [pick, setPick] = useState(0);

  /* 「现在该做什么」的规则推荐。纯确定性，同样数据永远同样结果。 */
  const suggestions = useMemo(() => {
    const todayKey = dayKey(nowTs);
    const todaySessions = sessions.filter((s) => dayKey(s.startedAt) === todayKey);
    const todayMinutes = todaySessions.reduce((a, s) => a + s.durationSec / 60, 0);
    return suggestNext({
      goals,
      todaySessions,
      todayMinutes,
      remainingMinutes,
      dailyGoalMinutes,
      nowTs,
    });
  }, [goals, sessions, nowTs, remainingMinutes, dailyGoalMinutes]);

  // 候选变化时回到第一条，避免索引越界指向已消失的项
  useEffect(() => {
    setPick(0);
  }, [suggestions.length]);

  if (!timer) {
    const s = suggestions[Math.min(pick, Math.max(0, suggestions.length - 1))];

    // 没有可推荐的（例如今天目标已达成且没有待办目标）：给一句诚实的收尾，不硬凑
    if (!s) {
      return (
        <Card delay={delay} padding="md">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--ok-soft)] text-[var(--ok-text)]">
              <Check className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.95rem] font-semibold">{remainingMinutes < 1 ? '今天的可用学习时间已结束' : '今天的目标已达成'}</p>
              <p className="text-xs text-secondary">想继续学也可以，随时点下面自己选</p>
            </div>
            <Button size="sm" variant="secondary" onClick={onStart} className="shrink-0">
              自己选
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <Card delay={delay} padding="md">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-on-soft)]">
            {s.kind === 'outcome' ? <Target className="size-5" /> : <Play className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            {/* 用 secondary 而不是 tertiary：tertiary 在 11px 上浅色主题只有约 4.0:1，
                低于 4.5 的下限。首页已有一批同类临界项，不该再往上加。 */}
            <p className="text-[0.72rem] text-secondary">现在该做什么</p>
            <p className="mt-0.5 truncate text-[0.95rem] font-semibold">{s.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-secondary">{s.reason}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {s.kind === 'outcome' ? (
            /* 成果目标不计时，所以这里不能是「开始 N 分钟」——
               点一下就是把这件事打卡完成。 */
            <Button
              className="flex-1"
              icon={<Check className="size-4" />}
              disabled={!s.goalId}
              onClick={() => {
                if (s.goalId) setGoalStatus(s.goalId, 'done');
              }}
            >
              完成打卡
            </Button>
          ) : (
            <Button
              className="flex-1"
              onClick={() => startTimer(s.subject || '自习', s.goalId, s.minutes)}
            >
              开始 {s.minutes} 分钟
            </Button>
          )}
          {suggestions.length > 1 && (
            <Button
              variant="secondary"
              onClick={() => setPick((p) => cycleSuggestion(suggestions, p))}
              icon={<RefreshCw className="size-4" />}
            >
              换一个
            </Button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <p className="text-[0.7rem] text-secondary">
            {suggestions.length > 1 ? `共 ${suggestions.length} 项可选` : '按今天的目标与时间推荐'}
          </p>
          <button
            type="button"
            onClick={onStart}
            className="min-h-11 text-[0.72rem] font-medium text-[var(--text-secondary)] underline-offset-2 hover:underline"
          >
            自己选科目与目标
          </button>
        </div>
      </Card>
    );
  }

  const running = timer.phase === 'running';
  const ms = elapsedMsLocal(timer, nowTs);

  return (
    <Card delay={delay} padding="md" className="!border-[var(--accent-ring)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenTimer}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className={cx(
              'grid size-11 shrink-0 place-items-center rounded-full',
              running ? 'bg-[var(--primary-bg)] text-[var(--on-accent)]' : 'bg-[var(--warn-soft)] text-[var(--warn-text)]',
            )}
          >
            {running ? (
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-60" />
                <span className="relative inline-flex size-3 rounded-full bg-white" />
              </span>
            ) : (
              <Square className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.85rem] font-semibold">{timer.subject}</p>
            <p className="tnum text-[1.5rem] font-semibold leading-tight">{fmtClock(ms / 1000)}</p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={running ? pause : resume}
          >
            {running ? '暂停' : '继续'}
          </Button>
          <Button size="sm" onClick={() => finish()}>
            结束
          </Button>
        </div>
      </div>
      {timer.autoResumed && (
        <p className="mt-2 rounded-lg bg-[var(--warn-soft)] px-2.5 py-1.5 text-[0.7rem] text-[var(--warn-text)]">
          检测到上次计时仍在进行，已按真实时间恢复
        </p>
      )}
    </Card>
  );
}

function elapsedMsLocal(
  timer: { startedAt: number; pausedMs: number; pausedAt: number | null },
  nowTs: number,
): number {
  const end = timer.pausedAt ?? nowTs;
  return Math.max(0, end - timer.startedAt - timer.pausedMs);
}

/* ───────────────────────── 小工具 ───────────────────────── */

export function useTodaySummary(nowTs: number): StatsSummary | null {
  void nowTs;
  return null;
}

export type { ImportantDate, ScheduleToday };
