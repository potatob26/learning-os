import { useEffect, useRef } from 'react';
import '../../vendor/liquid-glass.js';
import type { LiquidGlass } from '../../vendor/liquid-glass.js';
import { pickRenderableTargets, subscribeKeyGlass } from '../../glass/key-glass';
import { useStore } from '../../lib/store';
import { applyRefraction } from '../../glass/refract-settings';

/** 视口坐标直接跟随卡片；最多六块玻璃，离开视口或关闭效果时释放上下文。 */
export function LiquidGlassLayer({ enabled }: { enabled: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const active = useStore((s) => enabled && s.settings.perf !== 'saver' && s.settings.glassBlur);

  useEffect(() => {
    const layer = layerRef.current;
    if (!active || !layer) return;
    const instances = new Map<HTMLElement, LiquidGlass>();
    let raf = 0;
    const sync = () => {
      raf = 0;
      const source = document.querySelector<HTMLCanvasElement>('.bg-canvas');
      if (!source) return;
      const targets = pickRenderableTargets();
      const alive = new Set(targets.map((t) => t.el));
      // 先释放旧实例，再创建新实例，切页时也不瞬间突破预算。
      for (const [target, glass] of instances) {
        if (!alive.has(target)) { resize.unobserve(target); glass.remove(); instances.delete(target); }
      }
      for (const target of targets) {
        let glass = instances.get(target.el);
        if (!glass) {
          glass = document.createElement('liquid-glass') as LiquidGlass;
          glass.setAttribute('draggable', 'false');
          glass.setAttribute('data-unbounded', '');
          glass.setAttribute('shape', 'rounded');
          glass.tabIndex = -1;
          glass.setAttribute('aria-hidden', 'true');
          glass.style.pointerEvents = 'none';
          layer.appendChild(glass);
          instances.set(target.el, glass);
          resize.observe(target.el);
        }
        const r = target.rect;
        const attrs = { width: Math.round(r.width), height: Math.round(r.height), radius: target.radius };
        for (const [key, value] of Object.entries(attrs)) {
          if (glass.getAttribute(key) !== String(value)) glass.setAttribute(key, String(value));
        }
        applyRefraction(glass, useStore.getState().settings);
        glass.source = source;
        /*
         * 关键：绘制位置用**内容坐标**，采样原点用**视口坐标**。
         *
         * 玻璃层现在随内容滚动（absolute），所以「画在哪」要相对层自身算 ——
         * 这个差值在滚动中恒定不变，于是位置由**合成器**负责，滚动零延迟。
         * 而来源画布 .bg-canvas 固定在视口、不随内容滚动，所以「从背景哪里采样」
         * 必须用视口坐标（卡片当前的 getBoundingClientRect）。
         *
         * 之前两者混为一谈：层是 fixed、位置每帧在主线程追合成器的滚动，
         * 实测滚动那一帧卡片已移动 120px 而玻璃原地不动 —— 就是边框重影的成因。
         */
        const lr = layer.getBoundingClientRect();
        glass.setPlacement({
          x: Math.round(r.left - lr.left),
          y: Math.round(r.top - lr.top),
          sampleX: r.left,
          sampleY: r.top,
          sceneWidth: window.innerWidth,
          sceneHeight: window.innerHeight,
        });
      }
      // 只在入场动画期间逐帧跟随；动画结束后不维持空转的渲染循环。
      if (targets.some((target) => target.el.getAnimations().some((animation) => animation.playState === 'running'))) {
        raf = requestAnimationFrame(sync);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(sync); };
    const unsubscribe = subscribeKeyGlass(schedule);
    const unsubscribeSettings = useStore.subscribe((state, prev) => {
      if (state.settings.glass !== prev.settings.glass || state.settings.refract !== prev.settings.refract) schedule();
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('glass-background-change', schedule);
    document.addEventListener('animationend', schedule);
    schedule();
    return () => {
      unsubscribe(); unsubscribeSettings(); resize.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('glass-background-change', schedule);
      document.removeEventListener('animationend', schedule);
      for (const glass of instances.values()) glass.remove();
      instances.clear();
    };
  }, [active]);

  /*
   * 玻璃层用 absolute 而不是 fixed ── 这是「滚动时边框重影」的修复点。
   *
   * 层若是 fixed，它不随内容滚动，只能靠主线程 rAF 每帧去追卡片；
   * 而内容由合成器线程滚动，主线程追不上，实测滚动那一帧卡片已移动 120px、
   * 玻璃原地不动，下一帧才补上 —— 视觉上就是边框重影。
   *
   * 改成 absolute（随内容滚动）后，位置的跟随交给合成器，**零延迟**；
   * 采样原点仍用视口坐标，由 LiquidGlassLayer 通过 setPlacement 单独传入。
   */
  return active ? <div ref={layerRef} aria-hidden className="refract-layer pointer-events-none absolute inset-0 z-0 overflow-hidden" /> : null;
}
