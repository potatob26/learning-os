import { cx, pct as toPct } from '../../lib/utils';

interface ProgressProps {
  /** 当前值；只给 percent 时可以省略 */
  value?: number;
  max?: number;
  /** 直接指定比例（优先于 value/max） */
  percent?: number;
  label?: string;
  right?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'accent' | 'ok' | 'warn';
  showTrack?: boolean;
  className?: string;
}

const H = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' } as const;

/**
 * 进度条
 * 宽度用 transform 而不是 width 变化，避免每帧触发布局（安卓性能）
 */
export function Progress({
  value = 0,
  max = 100,
  percent,
  label,
  right,
  size = 'md',
  tone = 'accent',
  showTrack = true,
  className,
}: ProgressProps) {
  const p = percent ?? toPct(value, max);
  const color =
    tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)';

  return (
    <div className={cx('w-full', className)}>
      {(label || right) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label && <span className="text-xs font-medium text-secondary">{label}</span>}
          {right && <span className="tnum text-xs font-semibold text-secondary">{right}</span>}
        </div>
      )}
      <div
        className={cx('w-full overflow-hidden rounded-full', H[size], showTrack && 'bg-[var(--surface-sunken)]')}
        role="progressbar"
        aria-valuenow={Math.round(p)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? '进度'}
      >
        <div
          className="h-full origin-left rounded-full transition-transform duration-500 ease-[var(--ease-soft)]"
          style={{
            background: color,
            transform: `scaleX(${Math.min(1, Math.max(0, p / 100))})`,
          }}
        />
      </div>
    </div>
  );
}

interface ProgressRingProps {
  /** 百分比。**可以超过 100** —— 超出部分画成里面第二圈 */
  percent: number;
  size?: number;
  stroke?: number;
  className?: string;
  trackColor?: string;
  color?: string;
  /** 正常那一圈（0–100%）的颜色；设了就恒用它，达成时也不再被成功色盖掉 */
  ringColor?: string;
  /** 超过 100% 的那一圈用什么颜色（默认跟随强调色） */
  overflowColor?: string;
  children?: React.ReactNode;
  /** 达到/超过 100% 时外圈用成功色 */
  celebrate?: boolean;
}

/**
 * 环形进度：用 SVG stroke-dasharray，几乎零成本。
 *
 * **超过 100% 的画法**（1.3.0 用户要求「百分比可超百分百，第二圈颜色不一样」）：
 *   外圈永远是 0–100%（满圈就停住），超出部分画成**里面一圈**，用另一种颜色。
 *   这样 200% 就是"外圈满 + 内圈也满"，150% 是"外圈满 + 内圈半圈"，
 *   一眼能分出"刚好完成"和"超额完成"。数字照实显示（可以是 200%）。
 *
 * 为什么不把外圈画成"绕两圈"：`stroke-dasharray` 绕两圈在视觉上只是同一条线
 * 又走了一遍，看不出两段；而且 200% 与 100% 会几乎无法区分。
 *
 * 内圈半径比外圈小 `stroke`，所以两圈不会叠在一起；内圈线宽略细，
 * 视觉上是"里面还有一层"，不会抢外圈。
 */
export function ProgressRing({
  percent,
  size = 96,
  stroke = 8,
  className,
  trackColor = 'var(--surface-sunken)',
  color,
  ringColor,
  overflowColor,
  children,
  celebrate,
}: ProgressRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = c * (1 - clamped / 100);
  /*
   * 外圈（0–100% 那一段）的颜色优先级：
   *   color（显式指定，内部覆盖用）
   *   > ringColor（用户在设置里选的"正常进度色"）
   *   > celebrate 达成时的成功色
   *   > 强调色
   *
   * 为什么 ringColor 要压在 celebrate 前面：用户一旦自己选了颜色，
   * 达成时被系统偷偷换成绿色会显得"我的设置没生效"。
   * 没设的时候行为与以前完全一致（达成转绿），不会造成视觉回归。
   */
  const strokeColor =
    color ?? ringColor ?? (celebrate && clamped >= 100 ? 'var(--ok)' : 'var(--accent)');

  /*
   * 第二圈（超额部分）。最多再画满一圈 —— 也就是到 200% 为止；
   * 超过 200% 时两圈都满，靠中间的数字继续表达（不至于画出第三圈把环塞爆）。
   */
  const overPercent = Math.max(0, percent - 100);
  const overStroke = Math.max(2, stroke * 0.68);
  const r2 = r - stroke;
  const showOver = overPercent > 0 && r2 > overStroke;
  const c2 = 2 * Math.PI * r2;
  const overRatio = Math.min(1, overPercent / 100);
  const overColor = overflowColor ?? 'var(--accent)';

  return (
    <div className={cx('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        {showOver && (
          <>
            {/* 内圈的底槽：没有它，超额那一圈会像是"浮"在卡片背景上 */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r2}
              fill="none"
              stroke={trackColor}
              strokeWidth={overStroke}
              opacity={0.6}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r2}
              fill="none"
              stroke={overColor}
              strokeWidth={overStroke}
              strokeLinecap="round"
              strokeDasharray={c2}
              strokeDashoffset={c2 * (1 - overRatio)}
              style={{ transition: 'stroke-dashoffset 700ms var(--ease-soft), stroke 300ms linear' }}
            />
          </>
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms var(--ease-soft), stroke 300ms linear' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
