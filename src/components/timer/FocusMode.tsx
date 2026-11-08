import { useCallback, useEffect, useRef, useState } from 'react';
import { Expand, Minimize, Pause, Play, Smartphone, Square, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { cx } from '../../lib/utils';
import { fmtClock, fmtDuration, timeLabel } from '../../lib/time';
import type { ActiveTimer } from '../../lib/types';
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenSupported,
  isFullscreen,
  lockLandscape,
  orientationLockSupported,
  unlockOrientation,
} from '../../lib/fullscreen';

/**
 * 专注模式
 * ──────────────────────────────────────────────────────────────
 * 计时进行中的全屏界面：只留科目 / 任务 / 巨号时间 / 暂停 / 结束，
 * 以及两个真实可用的能力开关（全屏、横屏）。
 *
 * 层级用 z-45：盖住底部导航（z-40），但在弹层（z-50）之下 ——
 * 这样「结束」弹出的评价弹层仍然能正常盖在专注界面之上。
 *
 * 横屏适配：不依赖方向锁成功与否。锁是"锦上添花"，布局本身必须
 * 在横屏下就能用（landscape: 变体做左右分栏），否则在 iOS 这类
 * 无法锁定方向的平台上会很难看。
 */

interface Props {
  timer: ActiveTimer;
  /** 已计时的毫秒数。由父级的 useElapsed 统一提供，
   *  这里不自己再算一遍 —— 两个时间源很容易算出不一致的数字。 */
  ms: number;
  goalTitle: string | null;
  targetMinutes: number | null;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onExit: () => void;
}

export function FocusMode({
  timer,
  ms,
  goalTitle,
  targetMinutes,
  onPause,
  onResume,
  onFinish,
  onExit,
}: Props) {
  const [full, setFull] = useState(() => isFullscreen());
  const [locked, setLocked] = useState(false);
  // 操作失败时如实提示，不假装成功
  const [notice, setNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * 专注模式是一个模态界面：进入时把焦点移进来，退出时还原到原来的按钮。
   * 否则键盘用户 Tab 一圈还在后面的页面上，读屏也不知道已经进了新界面。
   */
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, []);

  const running = timer.phase === 'running';
  const targetMs = targetMinutes ? targetMinutes * 60000 : 0;
  const targetPercent = targetMs > 0 ? Math.min(100, (ms / targetMs) * 100) : 0;
  const over = targetMs > 0 && ms >= targetMs;

  // 全屏状态可能被系统或浏览器自身改变（例如按 Esc），必须跟着同步
  useEffect(() => {
    const sync = () => setFull(isFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  // 离开专注界面时解除方向锁，避免把用户"锁"在横屏里
  useEffect(
    () => () => {
      void unlockOrientation();
    },
    [],
  );

  const toggleFullscreen = useCallback(async () => {
    setNotice(null);
    if (isFullscreen()) {
      await exitFullscreen();
      setFull(isFullscreen());
      return;
    }
    const r = await enterFullscreen();
    setFull(isFullscreen());
    if (!r.ok) setNotice(`无法进入全屏：${r.reason}`);
  }, []);

  const toggleLandscape = useCallback(async () => {
    setNotice(null);
    if (locked) {
      await unlockOrientation();
      setLocked(false);
      return;
    }
    // 方向锁在多数实现里要求先进入全屏，这里先确保全屏再锁
    if (!isFullscreen()) {
      const f = await enterFullscreen();
      setFull(isFullscreen());
      if (!f.ok) {
        setNotice(`锁定横屏需要先进入全屏，而全屏失败了：${f.reason}`);
        return;
      }
    }
    const r = await lockLandscape();
    if (r.ok) {
      setLocked(true);
    } else {
      setLocked(false);
      setNotice(`无法锁定横屏：${r.reason}。可以把手机横过来，界面会自动适配。`);
    }
  }, [locked]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className={cx(
        // z-[45] 是刻意选的：盖住底部导航（z-40），但在弹层（z-50）之下，
        // 这样「结束」弹出的评价弹层仍能盖在专注界面之上。
        'fixed inset-0 z-[45] flex flex-col outline-none',
        // 专注模式刻意用最深的底色：这是"只剩这一件事"的场景
        'bg-[var(--bg-base)]',
      )}
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-modal="true"
      aria-label="专注计时"
    >
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="pill pill-accent">{timer.subject}</span>
        <span className={cx('pill', running ? 'pill-ok' : 'pill-warn')}>{running ? '计时中' : '已暂停'}</span>
        <span className="flex-1" />
        {fullscreenSupported() && (
          <button
            type="button"
            aria-label={full ? '退出全屏' : '进入全屏'}
            onClick={() => void toggleFullscreen()}
            className="grid size-11 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
          >
            {full ? <Minimize className="size-5" /> : <Expand className="size-5" />}
          </button>
        )}
        {orientationLockSupported() && (
          <button
            type="button"
            aria-label={locked ? '解除横屏锁定' : '锁定横屏'}
            onClick={() => void toggleLandscape()}
            className={cx(
              'grid size-11 place-items-center rounded-full transition-colors',
              locked
                ? 'bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                : 'text-secondary hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]',
            )}
          >
            <Smartphone className="size-5" />
          </button>
        )}
        <button
          type="button"
          aria-label="退出专注模式"
          onClick={onExit}
          className="grid size-11 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* 主体。横屏时左右分栏：左边时间、右边信息与控制 */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 landscape:flex-row landscape:gap-10">
        <div className="flex flex-col items-center">
          <p
            data-testid="focus-clock"
            className={cx(
              'tnum font-[650] leading-none tracking-tight',
              // 竖屏给到很大；横屏高度有限，收一档
              'text-[clamp(3.5rem,22vw,7rem)] landscape:text-[clamp(3rem,14vw,5.5rem)]',
              over ? 'text-[var(--ok-text)]' : 'text-[var(--text)]',
            )}
          >
            {fmtClock(Math.floor(ms / 1000))}
          </p>

          {targetMs > 0 && (
            <div className="mt-4 w-[min(20rem,72vw)]">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${targetPercent}%`,
                    background: over ? 'var(--ok)' : 'var(--accent)',
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[0.7rem] text-secondary">
                <span>{over ? '已超过目标' : `目标 ${fmtDuration(targetMinutes ?? 0)}`}</span>
                <span className="tnum">{Math.round(targetPercent)}%</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex w-full max-w-sm flex-col items-center landscape:w-64">
          <p className="mb-4 text-center text-[0.85rem] leading-relaxed text-secondary">
            {goalTitle ?? '未关联目标'}
          </p>

          <div className="flex w-full gap-2">
            {running ? (
              <Button size="lg" variant="secondary" icon={<Pause />} onClick={onPause} className="flex-1">
                暂停
              </Button>
            ) : (
              <Button size="lg" icon={<Play />} onClick={onResume} className="flex-1">
                继续
              </Button>
            )}
            <Button size="lg" variant="secondary" icon={<Square />} onClick={onFinish} className="flex-1">
              结束
            </Button>
          </div>

          <p className="mt-3 text-center text-[0.7rem] leading-relaxed text-secondary">
            {/* 必须用 timeLabel 而不是自己拿 startedAt % 86400000 去格式化 ——
                后者得到的是 UTC 时刻，在东八区会整整差 8 小时（我第一版就是这么错的）。 */}
            开始于 {timeLabel(timer.startedAt)}
            {timer.phase === 'paused' ? ' · 暂停中，这段时间不计入' : ' · 锁屏或切后台也会如实计时'}
          </p>

          {notice && (
            <p className="mt-3 w-full rounded-xl bg-[var(--warn-soft)] px-3 py-2 text-center text-[0.72rem] leading-relaxed text-[var(--warn-text)]">
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
