import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Flame } from 'lucide-react';
import { useReducedMotion } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';

/**
 * 复燃动画（接回成功时）
 * ──────────────────────────────────────────────────────────────
 * 克制版：一点余烬 → 火焰长起来，一圈很淡的光晕，十几颗火星向上散；
 * 数字从旧值滚到新值，然后整层自动消失（约 2.2s）。
 *
 * 动效约定（与项目一致）：
 *   · 设置里关掉动画（settings.motion=false）或系统减少动效 → 直接显示最终值，
 *     不动画、不撒火星，约 1.1s 后收起；
 *   · 颜色全部走语义令牌（--warn / --surface-strong / --scrim），不写死色值；
 *   · 纯 CSS 动画，不用 canvas，省电模式下也不会跑帧循环。
 */
export function SparkReviveOverlay({
  from,
  to,
  onDone,
}: {
  /** 接回前的连续天数 */
  from: number;
  /** 接回后的连续天数 */
  to: number;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const motion = useStore((s) => s.settings.motion);
  const animate = motion !== false && !reduced;
  const [count, setCount] = useState(animate ? from : to);

  useEffect(() => {
    if (!animate) {
      setCount(to);
      const t = window.setTimeout(onDone, 1100);
      return () => window.clearTimeout(t);
    }
    let raf = 0;
    const started = performance.now();
    const dur = 860;
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const end = window.setTimeout(onDone, 2200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(end);
    };
  }, [animate, from, to, onDone]);

  /** 火星：向上扇形散开，距离/延迟错开，避免像烟花 */
  const embers = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const angle = Math.PI * (0.12 + (i / 13) * 0.76);
        const dist = 52 + (i % 4) * 16;
        const size = i % 3 === 0 ? 5 : 4;
        return {
          dx: Math.round(Math.cos(angle) * dist),
          dy: Math.round(Math.sin(angle) * dist),
          delay: (i % 5) * 70,
          size,
        };
      }),
    [],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-[var(--scrim)] px-5"
      role="status"
      aria-live="polite"
      aria-label="火花已经接回"
    >
      {/* 面板：必须有不透明底，否则文字会叠在下面的卡片上（踩过） */}
      <div className="spark-fade-in w-[min(100%,20rem)] rounded-[26px] border border-[var(--line)] bg-[var(--bg-elevated)] px-6 pb-7 pt-8 text-center shadow-[var(--shadow-lg)]">
        <div className="relative mx-auto grid size-32 place-items-center">
          {/* 光晕 */}
          <div
            aria-hidden
            className="spark-glow absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle, color-mix(in srgb, var(--warn) 34%, transparent) 0%, transparent 70%)',
            }}
          />
          {/* 火焰本体 */}
          <div className="spark-ignite relative grid size-20 place-items-center rounded-full bg-[var(--warn-soft)] text-[var(--warn-text)]">
            <Flame className="size-10" strokeWidth={1.7} />
          </div>
          {/* 火星 */}
          {animate &&
            embers.map((p, i) => (
              <span
                key={i}
                aria-hidden
                className="spark-ember absolute left-1/2 top-1/2 rounded-full bg-[var(--warn)]"
                style={
                  {
                    width: p.size,
                    height: p.size,
                    marginLeft: -p.size / 2,
                    marginTop: -p.size / 2,
                    '--dx': `${p.dx}px`,
                    '--dy': `${p.dy}px`,
                    animationDelay: `${p.delay}ms`,
                  } as CSSProperties
                }
              />
            ))}
        </div>

        <p className="spark-fade-in mt-5 text-sm font-medium text-secondary">火花接上了</p>
        <p
          className="spark-fade-in tnum mt-1.5 text-[2.8rem] font-semibold leading-none"
          style={{ animationDelay: '120ms' }}
        >
          {count}
          <span className="ml-1 align-baseline text-base font-medium text-secondary">天</span>
        </p>
        <p
          className="spark-fade-in mt-2 text-[0.72rem] text-tertiary"
          style={{ animationDelay: '240ms' }}
        >
          缺口那天仍然不算学习时间
        </p>
      </div>
    </div>,
    document.body,
  );
}
