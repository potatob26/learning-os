import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import '../../vendor/liquid-glass.js';
import type { LiquidGlass } from '../../vendor/liquid-glass.js';
import { cx } from '../../lib/utils';
import { useStore } from '../../lib/store';
import { applyRefraction } from '../../glass/refract-settings';

/**
 * 弹层的液态玻璃背板
 * ──────────────────────────────────────────────────────────────
 * 为什么弹层不能直接用页面那层玻璃：
 *   弹层是 Portal 到 body 的（z-50），而页面玻璃层固定在 z-0。
 *   玻璃的折射要求 source 画布**覆盖它的父容器**，而页面那层画布覆盖的是
 *   整个视口 —— 直接把弹层挂上去，采样坐标会对不上。
 *
 * 这里的做法：给弹层自己做一块**与弹层等大**的来源画布，
 * 内容是「弹层背后那一片背景」，于是：
 *   u_scene = 弹层尺寸 · 画布 = 弹层区域  →  两者天然对齐
 * 弹层是固定的、贴在视口底部的，所以它的区域随时可算，同步成本很低。
 *
 * 代价：每个打开的弹层多占一个 WebGL 上下文。弹层是模态的，
 * 正常情况下同时只有一个，7 个实例仍在浏览器预算（约 8~16）之内。
 */

interface Props {
  children?: ReactNode;
  /** 圆角（px），需与弹层自身一致 */
  radius?: number;
  className?: string;
  style?: CSSProperties;
  /** 内容层类名 */
  contentClassName?: string;
}

export function RefractPanel({ children, radius = 28, className, style, contentClassName }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glassRef = useRef<LiquidGlass | null>(null);
  const active = useStore((s) => s.settings.perf !== 'saver' && s.settings.glassBlur);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!active || !root || !canvas) return;

    const source = document.querySelector<HTMLCanvasElement>('.bg-canvas');
    if (!source) return;

    // 创建玻璃实例，插在画布之后、内容之前
    const glass = document.createElement('liquid-glass') as LiquidGlass;
    glass.setAttribute('draggable', 'false');
    glass.setAttribute('shape', 'rounded');
    glass.setAttribute('data-unbounded', '');
    glass.tabIndex = -1;
    glass.setAttribute('aria-hidden', 'true');
    glass.style.pointerEvents = 'none';
    glass.style.position = 'absolute';
    glass.style.left = '0';
    glass.style.top = '0';
    root.insertBefore(glass, root.firstChild);
    glassRef.current = glass;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const sync = () => {
      const r = root.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w < 4 || h < 4) return;

      // 1. 把背景画布上「弹层所在的那一片」复制进本弹层的来源画布
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, cw, ch);
      // 背景画布是视口大小（内部按 dpr 放大），弹层坐标同为视口坐标，
      // 所以按 dpr 换算即可直接对应
      const scaleX = source.width / window.innerWidth;
      const scaleY = source.height / window.innerHeight;
      ctx.drawImage(
        source,
        Math.round(r.left * scaleX),
        Math.round(r.top * scaleY),
        Math.round(w * scaleX),
        Math.round(h * scaleY),
        0,
        0,
        cw,
        ch,
      );

      // 2. 把这块画布交给玻璃做折射
      glass.setAttribute('width', String(w));
      glass.setAttribute('height', String(h));
      glass.setAttribute('radius', String(Math.round(radius)));
      applyRefraction(glass, useStore.getState().settings);
      glass.source = canvas;
      glass.setPosition(0, 0);
    };

    // 弹层有入场动画，位置要等布局稳定；头几帧多同步几次
    let frames = 0;
    let raf = 0;
    const tick = () => {
      sync();
      frames += 1;
      if (frames < 12) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(sync);
    ro.observe(root);
    window.addEventListener('resize', sync);
    window.addEventListener('glass-background-change', sync);
    root.addEventListener('animationend', sync);
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.settings.refract !== prev.settings.refract) sync();
    });

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      ro.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('glass-background-change', sync);
      root.removeEventListener('animationend', sync);
      glass.remove();
      glassRef.current = null;
    };
  }, [radius, active]);

  return (
    <div
      ref={rootRef}
      // 保留一条极淡的描边，与其他主题下的弹层保持同一套边界语言
      className={cx('relative overflow-hidden border border-[var(--line)]', className)}
      style={{ borderRadius: radius, background: 'var(--bg-elevated)', ...style }}
    >
      {/* 来源画布：只给玻璃采样用，不直接显示 */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full opacity-0" aria-hidden />
      <div className={cx('relative z-[1] max-h-[inherit]', contentClassName)}>{children}</div>
    </div>
  );
}
