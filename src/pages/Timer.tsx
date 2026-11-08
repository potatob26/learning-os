import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Pause, PenLine, Play, RotateCcw, Square, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { useElapsed } from '../hooks/useElapsed';
import { fmtClock, fmtDuration, dayKey, timeLabel } from '../lib/time';
import { pct, pickBySeed, cx } from '../lib/utils';
import { Progress, ProgressRing } from '../components/ui/Progress';
import { Button } from '../components/ui/Button';
import { Sheet, ConfirmSheet } from '../components/ui/Sheet';
import { StartStudySheet } from '../components/timer/StartStudySheet';
import { FocusMode } from '../components/timer/FocusMode';
import { ManualEntrySheet } from '../components/timer/ManualEntrySheet';
import type { Session } from '../lib/types';
import { hasPlannedMinutes } from '../lib/types';
import { GlassSurface } from '../components/ui/GlassSurface';

const FOCUS_QUOTES = [
  '只看这一件事，其他的等一下再说。',
  '遇到不会的先标记，别停下来。',
  '保持这个节奏就好。',
  '手机放远一点，效率会自己上来。',
  '慢一点没关系，别中断。',
  '这一段专注，就是今天的进度。',
];

export function Timer() {
  const navigate = useNavigate();
  const timer = useStore((s) => s.timer);
  const sessions = useStore((s) => s.sessions);
  const goals = useStore((s) => s.goals);
  const pause = useStore((s) => s.pauseTimer);
  const resume = useStore((s) => s.resumeTimer);
  const cancel = useStore((s) => s.cancelTimer);
  const finish = useStore((s) => s.finishTimer);
  const acknowledge = useStore((s) => s.acknowledgeResume);
  const removeSession = useStore((s) => s.removeSession);

  const ms = useElapsed(timer);
  const [startOpen, setStartOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [review, setReview] = useState('');
  const [focus, setFocus] = useState<number | undefined>(undefined);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Session | null>(null);

  const goal = useMemo(
    () => (timer?.goalId ? (goals.find((g) => g.id === timer.goalId) ?? null) : null),
    [timer?.goalId, goals],
  );

  const targetMs = timer?.targetMinutes ? timer.targetMinutes * 60000 : null;
  const targetPercent = targetMs ? pct(ms, targetMs) : 0;
  const over = targetMs !== null && ms >= targetMs;

  const todaySessions = useMemo(
    () => sessions.filter((s) => dayKey(s.startedAt) === dayKey(Date.now())),
    [sessions],
  );
  const todayMinutes = todaySessions.reduce((a, s) => a + s.durationSec, 0) / 60;

  /**
   * 专注模式。计时中默认进入（用户已确认这个交互）：
   * 只在"有计时且没主动退出"时接管整屏，退出后回到普通计时页。
   * 命名用 focusMode 而不是 focus —— focus 已被自评分（1~5）占用。
   */
  const [focusMode, setFocusMode] = useState(true);
  // 换了一段新计时就重新进入专注；上一段手动退出过不影响下一段
  useEffect(() => {
    if (timer) setFocusMode(true);
  }, [timer?.id]);

  // 到点提示（不强制停止）
  const [notified, setNotified] = useState(false);
  useEffect(() => {
    if (!over || notified) return;
    setNotified(true);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate?.([40, 60, 40]);
      } catch {
        /* 不支持就算了 */
      }
    }
  }, [over, notified]);

  useEffect(() => {
    setNotified(false);
  }, [timer?.id]);

  const focusQuote = pickBySeed(FOCUS_QUOTES, `${timer?.id ?? 'idle'}-${Math.floor(ms / 600000)}`);

  const doFinish = () => {
    finish({ review: review.trim() || undefined, focus });
    setFinishOpen(false);
    setReview('');
    setFocus(undefined);
  };

  // 计时中且未退出专注 → 以覆盖层接管整屏（见下面 return 的开头）
  const inFocus = Boolean(timer && focusMode);

  return (
    <>
      {/* 专注模式用覆盖层而不是「提前 return 另一套 JSX」：
          结束用的评价弹层、到点提示等都在这套 JSX 里，
          提前 return 就得把它们复制一份，日后必然漂移。 */}
      {inFocus && timer && (
        <FocusMode
          timer={timer}
          ms={ms}
          goalTitle={goal?.title ?? null}
          targetMinutes={timer.targetMinutes ?? null}
          onPause={pause}
          onResume={resume}
          onFinish={() => setFinishOpen(true)}
          onExit={() => setFocusMode(false)}
        />
      )}

    <div
      className="space-y-3.5"
      /* 专注时把底层内容真正屏蔽，而不是只靠视觉遮盖：
         否则 DOM 里会同时存在两个「暂停」按钮，屏幕阅读器会念两遍、
         自动化测试也会因为 strict mode 冲突而失败（E2E 就是这样发现的）。
         inert 同时阻断了交互与无障碍树。 */
      inert={inFocus}
      aria-hidden={inFocus || undefined}
    >
      <header className="flex items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">计时</h1>
          <p className="mt-0.5 text-xs text-secondary">
            今天已学习 {fmtDuration(Math.round(todayMinutes))} · {todaySessions.length} 段记录
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<PenLine />}
          onClick={() => setManualOpen(true)}
          className="shrink-0"
        >
          补录
        </Button>
      </header>

      {/* 主计时区 */}
      <GlassSurface radius={28} contentClassName="p-5">
        {!timer ? (
          <div className="flex flex-col items-center py-6 text-center">
            <span className="mb-4 grid size-16 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-on-soft)]">
              <Play className="size-7" />
            </span>
            <p className="text-[1.05rem] font-semibold">现在没有在计时</p>
            <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-secondary">
              选择科目开始，结束后会自动写入学习记录，并计入今天的进度。
            </p>
            <Button size="lg" icon={<Play />} onClick={() => setStartOpen(true)} className="mt-5">
              开始学习
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="mb-1 flex w-full items-center justify-between gap-2">
              <span className="pill pill-accent">{timer.subject}</span>
              <span
                role="status"
                aria-live="polite"
                className={cx('pill', timer.phase === 'running' ? 'pill-ok' : 'pill-warn')}
              >
                {timer.phase === 'running' ? '计时中' : '已暂停'}
              </span>
            </div>

            {/* 大数字：整页视觉焦点 */}
            <div className="relative my-2">
              {targetMs ? (
                <ProgressRing percent={targetPercent} size={228} stroke={12} celebrate={over}>
                  <Readout ms={ms} />
                </ProgressRing>
              ) : (
                <div className="grid size-[228px] place-items-center">
                  <Readout ms={ms} />
                </div>
              )}
            </div>

            <p className="mb-1 text-center text-[0.78rem] text-secondary">
              {goal ? (
                <>
                  目标：{goal.title}
                  {/*
                    只有**有预计时长**的目标才显示「· 20m 计划」。
                    两种没有计划的情况都要盖住：成果目标（不计时）与计时目标的「不限时长」——
                    否则会显示「0m 计划」或「计划 null」这种读数。统一走 hasPlannedMinutes。
                  */}
                  {hasPlannedMinutes(goal) && (
                    <span className="text-tertiary"> · {fmtDuration(goal.plannedMinutes ?? 0)} 计划</span>
                  )}
                </>
              ) : (
                '未关联目标'
              )}
            </p>

            {targetMs && (
              <div className="w-full max-w-xs">
                <Progress
                  value={Math.min(ms, targetMs)}
                  max={targetMs}
                  size="sm"
                  tone={over ? 'ok' : 'accent'}
                  label={over ? '已超过目标时长' : '目标进度'}
                  right={`${Math.round(targetPercent)}%`}
                />
              </div>
            )}

            {over && (
              <p className="mt-3 w-full rounded-xl bg-[var(--ok-soft)] px-3 py-2 text-center text-[0.75rem] font-medium text-[var(--ok-text)]">
                已经到达目标时长，可以收尾，也可以继续。
              </p>
            )}

            {timer.autoResumed && (
              <div className="mt-3 w-full rounded-xl bg-[var(--warn-soft)] px-3 py-2.5">
                <p className="text-[0.75rem] font-medium text-[var(--warn-text)]">
                  检测到上次计时仍在进行，已按真实时间恢复
                </p>
                <p className="mt-0.5 text-[0.7rem] leading-relaxed text-[var(--warn-text)] opacity-80">
                  开始于 {timeLabel(timer.startedAt)}
                  {timer.phase === 'paused' ? '，当前处于暂停状态' : ''}。这段时间已如实计入。
                </p>
                <button
                  type="button"
                  onClick={acknowledge}
                  className="mt-1.5 flex min-h-11 items-center text-[0.7rem] font-semibold text-[var(--warn-text)] underline"
                >
                  知道了
                </button>
              </div>
            )}

            <p className="mt-3 text-center text-[0.72rem] italic text-tertiary">{focusQuote}</p>

            <div className="mt-5 flex w-full gap-2">
              {timer.phase === 'running' ? (
                <Button
                  size="lg"
                  variant="secondary"
                  icon={<Pause />}
                  onClick={pause}
                  className="flex-1"
                >
                  暂停
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="secondary"
                  icon={<Play />}
                  onClick={resume}
                  className="flex-1"
                >
                  继续
                </Button>
              )}
              <Button size="lg" icon={<Square />} onClick={() => setFinishOpen(true)} className="flex-1">
                结束并保存
              </Button>
            </div>
            <div className="mt-2 flex w-full gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={<X />}
                onClick={() => setConfirmCancel(true)}
                className="flex-1"
              >
                取消这次计时
              </Button>
            </div>
          </div>
        )}
      </GlassSurface>

      {/* 今日记录 */}
      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">今日记录</h2>
          <button
            type="button"
            onClick={() => navigate('/stats')}
            className="flex min-h-11 min-w-11 items-center justify-center px-2 text-xs font-semibold text-[var(--accent-text)]"
          >
            统计
          </button>
        </div>

        {todaySessions.length === 0 ? (
          <div className="mica rounded-[var(--radius-card)] px-4 py-6 text-center text-xs text-secondary">
            今天还没有学习记录
          </div>
        ) : (
          <div className="space-y-2">
            {todaySessions.map((s) => (
              <div key={s.id} className="mica flex items-center gap-2 rounded-2xl p-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-on-soft)]">
                  <CheckCircle2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.88rem] font-medium">{s.subject}</p>
                  <p className="tnum text-[0.7rem] text-tertiary">
                    {timeLabel(s.startedAt)} – {timeLabel(s.endedAt)} ·{' '}
                    {s.source === 'timer' ? '计时' : '手动'}
                  </p>
                  {s.review && (
                    <p className="mt-0.5 truncate text-[0.7rem] text-secondary">{s.review}</p>
                  )}
                </div>
                <span className="tnum shrink-0 text-[0.85rem] font-semibold">
                  {fmtDuration(Math.round(s.durationSec / 60))}
                </span>
                <button
                  type="button"
                  aria-label="删除这条记录"
                  onClick={() => setConfirmDelete(s)}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-tertiary hover:text-[var(--bad-text)]"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <StartStudySheet open={startOpen} onClose={() => setStartOpen(false)} />
      <ManualEntrySheet open={manualOpen} onClose={() => setManualOpen(false)} />

      {/* 结束并保存：记录复盘 + 专注度 */}
      <Sheet
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title="结束这次学习"
        description={`本次 ${fmtClock(ms / 1000)}，保存后会写入学习记录`}
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="lg"
              icon={<RotateCcw />}
              onClick={() => {
                finish({ discard: true });
                setFinishOpen(false);
              }}
              className="flex-1 text-[var(--bad-text)]"
            >
              丢弃
            </Button>
            <Button size="lg" icon={<CheckCircle2 />} onClick={doFinish} className="flex-[2]">
              保存记录
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pb-1">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">
              这次学了什么（可选）
            </span>
            <textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              rows={2}
              placeholder="例如：函数单调性专项，第 12 题卡住了"
              className="field resize-none"
            />
          </label>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-secondary">专注程度（可选）</span>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setFocus(focus === n ? undefined : n)}
                  className={cx(
                    'min-h-11 flex-1 rounded-xl border text-[0.85rem] font-semibold transition-colors duration-200',
                    focus === n
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                      : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[0.7rem] text-tertiary">1 = 很散，5 = 很专注</p>
          </div>
          {goal && (
            <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
              这段时长会计入目标「{goal.title}」的实际用时。
            </p>
          )}
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmCancel}
        title="取消这次计时？"
        message="这段时间不会被记录。"
        confirmText="取消计时"
        danger
        onConfirm={cancel}
        onClose={() => setConfirmCancel(false)}
      />
      <ConfirmSheet
        open={confirmDelete !== null}
        title="删除这条学习记录？"
        message="删除后统计和进度会立即重新计算。"
        confirmText="删除"
        danger
        onConfirm={() => {
          if (confirmDelete) removeSession(confirmDelete.id);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
    </>
  );
}

/** 大数字读数：单独组件，只有它随毫秒刷新 */
function Readout({ ms }: { ms: number }) {
  return (
    <div className="text-center">
      <p className="num-hero tnum text-[3.4rem] leading-none tracking-tight">
        {fmtClock(ms / 1000)}
      </p>
      <p className="mt-1 text-[0.7rem] font-medium tracking-wide text-tertiary">已专注</p>
    </div>
  );
}
