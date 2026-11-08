/**
 * 重点容器注册表
 * ──────────────────────────────────────────────────────────────
 * 「液态玻璃」主题用的是 WebGL 逐像素折射的实现（见 vendor/liquid-glass.js），
 * 它有几个硬约束，决定了不能像普通材质那样随手套在任意元素上：
 *
 *   1. 每个实例各自创建一个 WebGL 上下文，浏览器上限约 8~16 个
 *      → 只能给少数「重点容器」用，不能每张卡都套
 *   2. 它的 source 必须是一张**覆盖父容器**的背景画布
 *      → 所以父容器得是覆盖整个视口的定位层（背景画布正是视口大小）
 *   3. 玻璃靠 translate3d 在父容器内定位
 *      → 需要把目标元素的视口坐标持续同步给它
 *
 * 因此这里只登记「哪些元素需要强玻璃」，由 LiquidGlassLayer 统一渲染与管理。
 * 这也正好符合设计意图：重点容器强玻璃，普通列表与文本保持朴素。
 */

export interface KeyGlassTarget {
  el: HTMLElement;
  /** 圆角（px），需与目标元素自身的圆角一致 */
  radius: number;
}

const targets = new Map<HTMLElement, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** 登记一个需要强玻璃的元素，返回取消登记的清理函数 */
export function registerKeyGlass(el: HTMLElement, radius: number): () => void {
  targets.set(el, radius);
  emit();
  return () => {
    targets.delete(el);
    emit();
  };
}

export function subscribeKeyGlass(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function listKeyGlassTargets(): KeyGlassTarget[] {
  return [...targets.entries()].map(([el, radius]) => ({ el, radius }));
}

/** 实例数量上限：WebGL 上下文有限，超过会整块不渲染 */
export const KEY_GLASS_LIMIT = 6;

/**
 * 按「在视口内 + 面积大」排序后取前 N 个。
 * 视口外的元素没必要渲染（用户看不见），面积大的通常是主容器，优先保证。
 */
export function pickRenderableTargets(): Array<KeyGlassTarget & { rect: DOMRect }> {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  return listKeyGlassTargets()
    .map((t) => ({ ...t, rect: t.el.getBoundingClientRect() }))
    // 与视口有交集才值得渲染
    .filter((t) => t.el.isConnected && t.rect.width > 0 && t.rect.height > 0 && t.rect.bottom > 0 && t.rect.top < vh && t.rect.right > 0 && t.rect.left < vw)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
    .slice(0, Math.max(0, KEY_GLASS_LIMIT - document.querySelectorAll('.nav-glass-stage liquid-glass').length));
}
