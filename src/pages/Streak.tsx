import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronLeft, Flame, History, Timer } from 'lucide-react';
import { useStore } from '../lib/store';
import { useNow } from '../hooks/useNow';
import { Card, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { SparkReviveOverlay } from '../components/home/SparkReviveOverlay';
import { cx } from '../lib/utils';
import { addDaysTs, dayKey, startOfDayTs } from '../lib/time';
import {
  STREAK_MIN_MINUTES,
  STREAK_RESCUE_MIN_MINUTES,
  STREAK_RESCUE_COOLDOWN_DAYS,
  computeStreakState,
  type StreakState,
} from '../lib/streak';

/**
 * 火花（连续学习天数）独立页面
 * ──────────────────────────────────────────────────────────────
 * 从首页火焰徽章进入。这里承载火花相关的一切：当前/最长、近 30 天、
 * 断签挽救、接回记录 —— 不再塞进设置，也不再挤在底部弹层里。
 *
 * 口径（与 lib/streak.ts 一致）：
 *   · 每天学满 10 分钟算一个学习日；今天还没学不算断；
 *   · 断签「两日修复」：缺口后 3 天内连续 2 天各 ≥20 分钟，手动接回；
 *   · 接回只补连续天数，缺口日仍然不算学习日，也不增加任何学习时长。
 */
export function Streak() {
  const navigate = useNavigate();
  const sessions = useStore((s) => s.sessions);
  const rescues = useStore((s) => s.streakRescues);
  const confirmStreakRescue = useStore((s) => s.confirmStreakRescue);
  const ts = useNow();
  const todayKey = dayKey(ts);

  const state = useMemo(() => computeStreakState(sessions, rescues, ts), [sessions, rescues, ts]);

  const repaired = useMemo(() => new Set(state.repairedGapDays), [state.repairedGapDays]);
  const active = useMemo(() => new Set(state.activeDayKeys), [state.activeDayKeys]);

  const cells = useMemo(() => {
    const base = startOfDayTs(ts);
    const out: Array<{ key: string; studied: boolean; repaired: boolean; today: boolean }> = [];
    for (let i = 29; i >= 0; i--) {
      const k = dayKey(addDaysTs(base, -i));
      out.push({ key: k, studied: active.has(k), repaired: repaired.has(k), today: k === todayKey });
    }
    return out;
  }, [ts, active, repaired, todayKey]);

  const [revive, setRevive] = useState<{ from: number; to: number } | null>(null);
  /*
   * onDone 必须是稳定引用：页面会因为 useNow 每秒重渲染，
   * 如果传内联箭头函数，复燃动画的 effect 会每秒被清理重建，
   * 2.2s 的自动收起永远等不到（踩过）。
   */
  const closeRevive = useCallback(() => setRevive(null), []);
  const copy = phaseCopy(state, ts);
  const canConfirm = state.phase === 'ready' && state.gapDay !== null;
  const rescueTarget = state.preGapRun + state.repairDone;

  const handleConfirm = () => {
    if (!state.gapDay) return;
    const from = state.streak;
    const to = rescueTarget;
    if (confirmStreakRescue(state.gapDay, state.repairDays)) setRevive({ from, to });
  };

  return (
    <div className="space-y-3.5">
      <header className="flex items-center gap-2 px-1 pt-1">
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate(-1)}
          className="grid size-11 shrink-0 place-items-center rounded-full text-secondary transition-colors hover:text-[var(--text)] active:scale-95"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">火花</h1>
          <p className="mt-0.5 text-xs text-secondary">连续学习天数 · 和昨天的自己比</p>
        </div>
      </header>

      {/* 当前连续 + 最长 */}
      <Card padding="md" delay={0.04}>
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-end gap-2">
            <span className="num-hero text-[3.4rem] leading-none">{state.streak}</span>
            <span className="pb-1.5 text-sm font-medium text-secondary">天</span>
          </div>
          <div className="text-right">
            <p className="text-[0.7rem] font-medium text-tertiary">最长连续</p>
            <p className="tnum text-lg font-semibold">{state.longest} 天</p>
          </div>
        </div>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-secondary">
          {state.todayMinutes > 0
            ? `今天已经学了 ${state.todayMinutes} 分钟。明天同一时间再来一下，连续就接上了。`
            : `今天还没有记录；学满 ${STREAK_MIN_MINUTES} 分钟就算今天。`}
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" icon={<Timer />} onClick={() => navigate('/timer')}>
            去学一段
          </Button>
        </div>
      </Card>

      {/* 状态说明：连续中的说明和上面重复，只在需要「挽救/重新开始」时出现 */}
      {state.phase !== 'active' && state.phase !== 'pending' && (
        <Card padding="md" delay={0.08}>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--warn-soft)] text-[var(--warn-text)]">
              <Flame className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.92rem] font-semibold">{copy.title}</p>
              <p className="mt-0.5 text-[0.78rem] leading-relaxed text-secondary">{copy.body}</p>
            </div>
          </div>
        </Card>
      )}

      {/* 近 30 天 */}
      <Card padding="md" delay={0.12}>
        <CardTitle icon={<CalendarDays />} title="近 30 天" subtitle="每天学满 10 分钟算一天" />
        <div className="grid grid-cols-10 gap-1">
          {cells.map((c) => (
            <span
              key={c.key}
              title={`${Number(c.key.slice(5, 7))} 月 ${Number(c.key.slice(8, 10))} 日${
                c.repaired ? ' · 缺口已接回' : c.studied ? ' · 学过' : ''
              }`}
              className={cx(
                'aspect-square rounded-[4px]',
                c.studied
                  ? 'bg-[var(--accent)]'
                  : c.repaired
                    ? 'border border-dashed border-[var(--warn)] bg-[var(--warn-soft)]'
                    : 'bg-[var(--surface-sunken)]',
                c.today && 'ring-1 ring-[var(--text-tertiary)]',
              )}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.66rem] text-tertiary">
          <span className="flex items-center gap-1">
            <i className="size-2 rounded-[2px] bg-[var(--accent)]" aria-hidden />
            学过
          </span>
          <span className="flex items-center gap-1">
            <i
              className="size-2 rounded-[2px] border border-dashed border-[var(--warn)] bg-[var(--warn-soft)]"
              aria-hidden
            />
            已接回缺口
          </span>
          <span className="flex items-center gap-1">
            <i className="size-2 rounded-[2px] bg-[var(--surface-sunken)]" aria-hidden />
            没学
          </span>
        </div>
      </Card>

      {/* 断签挽救：连续正常时不摆一块没用的「还不能接回」按钮 */}
      {(state.phase === 'restorable' ||
        state.phase === 'repairing' ||
        state.phase === 'ready' ||
        state.phase === 'broken') && (
        <Card padding="md" delay={0.16}>
          <CardTitle icon={<Flame />} title="断签挽救" subtitle="只救一天；连续学习换回来" />
          {(state.phase === 'repairing' || state.phase === 'ready') && (
            <div className="mb-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-secondary">接回进度</span>
                <span className="tnum text-xs font-semibold text-secondary">
                  {state.repairDone} / {state.repairNeed} 天
                </span>
              </div>
              <Progress
                percent={(state.repairDone / Math.max(1, state.repairNeed)) * 100}
                size="sm"
                tone="warn"
              />
            </div>
          )}
          <p className="text-[0.76rem] leading-relaxed text-secondary">{rescueHint(state, ts)}</p>
          {state.phase !== 'broken' && (
            <div className="mt-3">
              <Button block size="md" disabled={!canConfirm} onClick={handleConfirm}>
                {canConfirm ? `接回 ${rescueTarget} 天` : '还不能接回'}
              </Button>
            </div>
          )}
          <p className="mt-2 text-[0.7rem] leading-relaxed text-tertiary">
            接回只补连续天数：缺口那天不算学习时间，也不会产生任何学习记录。
          </p>
        </Card>
      )}

      {/* 接回记录 */}
      {rescues.length > 0 && (
        <Card padding="md" delay={0.2}>
          <CardTitle icon={<History />} title="接回记录" subtitle={`共 ${rescues.length} 次`} />
          <ul className="space-y-2">
            {[...rescues]
              .sort((a, b) => b.rescuedAt - a.rescuedAt)
              .map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-2 text-[0.76rem]">
                  <span className="text-secondary">
                    {monthDay(r.rescuedAt)} 接回 · 缺口 {keyLabel(r.gapDay)}
                  </span>
                  <span className="tnum shrink-0 text-tertiary">保存了 {r.restoredFrom} 天</span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <p className="px-1 pb-2 text-center text-[0.7rem] leading-relaxed text-tertiary">
        火花只记录连续学习天数，不增加学习时长；数据只保存在这台设备上。
      </p>

      {revive && <SparkReviveOverlay from={revive.from} to={revive.to} onDone={closeRevive} />}
    </div>
  );
}

/* ---------------- 文案（不说教、不喊口号、不用感叹号） ---------------- */

function phaseCopy(state: StreakState, nowTs: number): { title: string; body: string } {
  const { phase, streak, preGapRun, repairDone, repairDays, cooldownUntil } = state;
  switch (phase) {
    case 'empty':
      return {
        title: '还没有第一天',
        body: `今天学满 ${STREAK_MIN_MINUTES} 分钟，就有了第一天。`,
      };
    case 'active':
      return {
        title: `连续 ${streak} 天`,
        body: '今天已经记上了。明天同一时间来一下，连续就接上了。',
      };
    case 'pending':
      return {
        title: '连续还在',
        body: `今天还没记录；昨天学过，所以连续 ${streak} 天没有断。`,
      };
    case 'restorable':
      return {
        title: '昨天断了一天',
        body: `在那之前连续了 ${preGapRun} 天。今天学满 ${STREAK_RESCUE_MIN_MINUTES} 分钟、明天再学满 ${STREAK_RESCUE_MIN_MINUTES} 分钟，可以接回。`,
      };
    case 'repairing': {
      const firstIsToday = repairDays[0] === dayKey(nowTs);
      return {
        title: `接回中 ${repairDone}/${state.repairNeed}`,
        body: firstIsToday
          ? `今天这 ${STREAK_RESCUE_MIN_MINUTES} 分钟够了。明天再学满 ${STREAK_RESCUE_MIN_MINUTES} 分钟就能接回。`
          : `还差今天这 ${STREAK_RESCUE_MIN_MINUTES} 分钟，学满就能接回。`,
      };
    }
    case 'ready':
      return {
        title: '两天都够了',
        body: `接回后是 ${preGapRun + repairDone} 天。缺口那天仍然不算学习时间。`,
      };
    case 'broken':
    default: {
      if (cooldownUntil !== null && cooldownUntil > nowTs && state.lastRescuedAt !== null) {
        return {
          title: '这次接不回来了',
          body: `上次接回是 ${monthDay(state.lastRescuedAt)}。${monthDay(cooldownUntil)} 之后可以再救一次。`,
        };
      }
      return {
        title: '这次接不回来了',
        body: `缺了两天以上，或者缺口前没连续够 3 天。今天学满 ${STREAK_MIN_MINUTES} 分钟，重新开始。`,
      };
    }
  }
}

function rescueHint(state: StreakState, nowTs: number): string {
  switch (state.phase) {
    case 'restorable':
      return `只缺昨天。今天学满 ${STREAK_RESCUE_MIN_MINUTES} 分钟，明天再学满 ${STREAK_RESCUE_MIN_MINUTES} 分钟，就能把之前的连续接回来。`;
    case 'repairing':
      return `补学进行中：缺口后第 ${state.repairDone + 1} 天也要学满 ${STREAK_RESCUE_MIN_MINUTES} 分钟。`;
    case 'ready':
      return '两天的补学都够了，可以接回。缺口日只搭桥，不计入学习日，也不会算进学习时长。';
    case 'broken': {
      if (state.cooldownUntil !== null && state.cooldownUntil > nowTs) {
        return `冷却中：两次接回至少隔 ${STREAK_RESCUE_COOLDOWN_DAYS} 天，${monthDay(state.cooldownUntil)} 之后可以再救。`;
      }
      return '这次断的时间超过一天，接不回来了。今天学满 10 分钟就从第一天重新开始。';
    }
    default:
      return '只有「只缺一天、且缺口前连续够 3 天」才可挽救；缺口后 3 天内连续 2 天各学满 20 分钟即可。';
  }
}

function monthDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function keyLabel(key: string): string {
  return `${Number(key.slice(5, 7))} 月 ${Number(key.slice(8, 10))} 日`;
}
