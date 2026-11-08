import { useEffect, useRef } from 'react';

/**
 * 逐字打出来的文本（点一下可立刻显示完整）
 * ──────────────────────────────────────────────────────────────────────────────
 * 「一个字一个字打出来的感觉」最容易踩的坑：**每打一个字就重排一次布局** ——
 * 文字变长 → 卡片高度跟着变 → 浏览器每帧重新排版整个卡片，看起来就是"卡"。
 * 加上玻璃/云母层更明显。所以这里用两层，把重排彻底消掉：
 *
 *   ① 占位层：**完整文字**以 `invisible` 渲染，先把最终高度占住
 *      → 逐字过程中容器尺寸**从头到尾不变**，浏览器不需要重新布局
 *   ② 显示层：绝对定位在占位层之上，只改 `textContent`
 *      → 它的增长只影响自己这一小块的重绘，不牵动任何布局
 *
 * 另外两条也是"不卡"的一部分：
 *   · **不经过 React state**：逐字不触发组件重渲染，只在一个 rAF 循环里改文本节点；
 *     父组件（评价卡订阅了每秒跳动的时钟）重渲染时也不会打断它，因为 React
 *     从不接管这个 span 的子节点（它是非受控的）。
 *   · **一行一行来**：调用方按段落给 `delayMs` 做串行，同一时刻只有一条 rAF 在跑。
 *
 * 无障碍：占位层对读屏隐藏（aria-hidden），真正被读的是显示层；
 * 动画结束时它正好等于完整文字。系统"减少动画"或应用里关了动效时直接完整显示。
 */
export function TypedText({
  text,
  enabled,
  stepMs = 24,
  delayMs = 0,
  runKey,
  className,
}: {
  text: string;
  /** false = 不做动画，直接完整显示（减少动画 / 关了动效 / 省电） */
  enabled: boolean;
  /** 每个字之间的毫秒数（由调用方按总字数算，避免长文本打太久） */
  stepMs?: number;
  /** 延迟多久开始（用于让几段文字依次打） */
  delayMs?: number;
  /** 变化时重新打一遍（例如点了「重新生成」） */
  runKey: number | string;
  className?: string;
}) {
  const typedRef = useRef<HTMLSpanElement>(null);
  const skipRef = useRef(false);

  useEffect(() => {
    const el = typedRef.current;
    if (!el) return;

    if (!enabled) {
      el.textContent = text;
      return;
    }

    let raf = 0;
    let timer = 0;
    let i = 0;
    let last = 0;
    skipRef.current = false;
    el.textContent = '';

    const tick = (t: number) => {
      if (skipRef.current) {
        el.textContent = text; // 点一下就立刻显示完整
        return;
      }
      if (last === 0) last = t;
      if (t - last >= stepMs) {
        i = Math.min(text.length, i + 1);
        el.textContent = text.slice(0, i);
        last = t;
      }
      if (i < text.length) raf = requestAnimationFrame(tick);
    };

    timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [text, enabled, stepMs, delayMs, runKey]);

  return (
    <span className="relative block">
      {/* ① 占位层：完整文字、不可见，负责把最终高度占住（逐字过程零重排） */}
      <span aria-hidden className={`invisible block ${className ?? ''}`}>
        {text}
      </span>
      {/* ② 显示层：叠在占位层上，只改 textContent，不参与布局 */}
      <span
        ref={typedRef}
        className={`absolute inset-0 block ${className ?? ''}`}
        onPointerDown={() => {
          skipRef.current = true;
        }}
      />
    </span>
  );
}
