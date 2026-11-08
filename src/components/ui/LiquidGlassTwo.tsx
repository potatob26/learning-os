import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import LiquidGlass from 'liquid-glass-react';
import { cx } from '../../lib/utils';
import { useStore } from '../../lib/store';
import type { GlassMode } from '../../lib/types';
import { sanitizeGlassMode } from '../../lib/types';

/**
 * liquid-glass-react 适配层
 * ══════════════════════════════════════════════════════════════
 * 这个库不能直接使用，有两处必须由调用方补上（都实测确认过）：
 *
 * ① 它依赖一套「绝对居中」的定位惯用法，直接放进文档流会跑到屏幕外。
 *    看 dist/index.esm.js:407：
 *      transformStyle = `translate(calc(-50% + Xpx), calc(-50% + Ypx)) ...`
 *      positionStyles = { position: style.position || 'relative',
 *                         top: style.top || '50%', left: style.left || '50%' }
 *    它返回的是 Fragment，里面若干图层全部靠 top/left:50% + translate(-50%,-50%)
 *    居中。普通流下 left:50% 会把元素右推父容器一半宽度，而 translate(-50%)
 *    只按**自身**宽度的一半回拉 —— 自身比父容器窄时无法抵消，
 *    实测被推到 @-174，整块玻璃看不见。
 *    解法：给它一个定位容器，并显式传
 *    `position:absolute; top:50%; left:50%; width:100%`，让 50% 与 -50% 抵消。
 *
 * ② 包里**不含任何 CSS 文件**，`.glass` 这些类名需要调用方提供样式。
 *    否则内层 inline-flex 不会撑开，实测尺寸为 0×0。
 *    排版必须由外部定义，已写在 index.css 的 `.lg2` 作用域下。
 *
 * ③ 因为玻璃本体是绝对定位、脱离文档流，外层容器需要自己撑出高度，
 *    否则高度为 0。这里用 ResizeObserver 量出玻璃的实际高度再回填给外层。
 */

export interface LiquidGlassTwoProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style'> {
  children: ReactNode;
  /** 圆角（px）。默认取全局设置里的玻璃圆角 */
  radius?: number;
  className?: string;
  style?: CSSProperties;
  /** 玻璃后是浅色背景。不传则按全局设置（auto 时跟随主题深浅） */
  overLight?: boolean;
  /** 以下参数不传则使用设置页里的全局值 */
  blurAmount?: number;
  displacementScale?: number;
  saturation?: number;
  aberrationIntensity?: number;
  elasticity?: number;
  mode?: GlassMode;
}

export function LiquidGlassTwo({
  children,
  radius,
  className,
  style,
  overLight,
  blurAmount,
  displacementScale,
  saturation,
  aberrationIntensity,
  elasticity,
  mode,
  ...rest
}: LiquidGlassTwoProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  // 参数来源：全局设置（用户可在设置页调），单个实例仍可显式覆盖
  const glass = useStore((s) => s.settings.glass);

  const cfg = {
    radius: radius ?? glass.cornerRadius,
    blurAmount: blurAmount ?? glass.blurAmount,
    displacementScale: displacementScale ?? glass.displacementScale,
    saturation: saturation ?? glass.saturation,
    aberrationIntensity: aberrationIntensity ?? glass.aberrationIntensity,
    elasticity: elasticity ?? glass.elasticity,
    mode: sanitizeGlassMode(mode ?? glass.mode),
    overLight: overLight ?? glass.overLight,
  };

  /* ---------------------------------------------------------------------
     指针位置：由我们接管，而不是交给库自己管理。
     ─────────────────────────────────────────────────────────────────────
     库自己的实现有一个真实缺陷（dist/index.esm.js:301/329）：
       · globalMousePos 初值 {x:0,y:0}
       · mousemove 只挂在玻璃元素自己身上，且**没有任何 mouseleave 复位**
     于是指针一旦移出元素，位移就永久留在最后一个值上，
     表现为「鼠标往下挪出去后，框子歪着不回正」。
     库提供了受控接口（同时传 globalMousePos 与 mouseOffset 即可跳过它的监听），
     因此这里自己跟踪指针，并在移出时把位置复位到玻璃中心，
     让位移随 transition 平滑归零。
     --------------------------------------------------------------------- */
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  /**
   * 只有真正开启了弹性才跟踪指针。
   * 否则每次 pointermove / 触摸滑动都会触发一次状态更新与重渲染 ——
   * 页面上有六七个玻璃容器时，安卓上滚动会明显掉帧。
   * 弹性为 0 时位移恒等于 0，本就不需要这些更新。
   */
  const trackPointer = cfg.elasticity > 0;

  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackPointer) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    setPointer({ x: e.clientX, y: e.clientY });
    setOffset({
      x: ((e.clientX - (rect.left + rect.width / 2)) / rect.width) * 100,
      y: ((e.clientY - (rect.top + rect.height / 2)) / rect.height) * 100,
    });
  };

  /** 复位到中心：位移归零，高光方向回到中性 */
  const resetPointer = () => {
    if (!trackPointer) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPointer({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    setOffset({ x: 0, y: 0 });
  };

  // 玻璃本体绝对定位，不参与外层高度计算，所以要量出来回填
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const glass = wrap.querySelector<HTMLElement>('.glass');
    if (!glass) return;

    const measure = () => {
      const r = glass.getBoundingClientRect();
      if (r.height > 0.5) setHeight(Math.ceil(r.height));
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(glass);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className={cx('lg2 relative', className)}
      style={{ height: height ?? undefined, borderRadius: cfg.radius, ...style }}
      /* 外来的 DOM 属性（onClick / role / aria-*）放在前面：
         下面几个指针回调是这个组件自己的弹性跟踪所必需的，不能被覆盖。 */
      {...rest}
      onPointerMove={trackPointer ? handlePointer : undefined}
      onPointerDown={trackPointer ? handlePointer : undefined}
      onPointerLeave={trackPointer ? resetPointer : undefined}
      onPointerCancel={trackPointer ? resetPointer : undefined}
    >
      <LiquidGlass
        // 关键：绝对定位 + 50% 居中，才能与库内部的 -50% 位移抵消。
        // 不设 height：高度由内容决定，再由上面的 ResizeObserver 回填外层。
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: '100%',
        }}
        // 同时传这两个受控属性，库就会跳过它自己的 mousemove 监听，
        // 改由我们（含 mouseleave 复位）来驱动，从而修掉「不回正」的问题。
        // 静止时传 {0,0}：库内部对 falsy 坐标会直接返回 fade=0，即完全无位移。
        globalMousePos={trackPointer ? (pointer ?? { x: 0, y: 0 }) : { x: 0, y: 0 }}
        mouseOffset={offset}
        cornerRadius={cfg.radius}
        blurAmount={cfg.blurAmount}
        displacementScale={cfg.displacementScale}
        saturation={cfg.saturation}
        aberrationIntensity={cfg.aberrationIntensity}
        elasticity={cfg.elasticity}
        mode={cfg.mode}
        overLight={cfg.overLight}
        padding="0px"
      >
        {children}
      </LiquidGlass>
    </div>
  );
}
