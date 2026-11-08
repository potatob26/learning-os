import { useStore } from './store';
import type { ThemeId } from './types';

/* ==========================================================================
   材质决策
   ──────────────────────────────────────────────────────────────────────────
   规则（按用户定案）：
     · 主题全权决定主材质 —— 选「透明玻璃」主题时，所有卡片都是真折射玻璃
     · 但底部导航、主计时卡、弹层这类关键容器，在任何主题下都保留透明玻璃，
       因为它们本身就是"玻璃"语义最强的表面（悬浮在内容之上）
     · 其余卡片用云母（mica）：只有模糊，没有位移折射
   ========================================================================== */

export type MaterialTier =
  /** 透明玻璃：SVG 位移 + backdrop 模糊（liquid-glass-react） */
  | 'liquid'
  /** 液态玻璃：WebGL 逐像素采样背景做真实折射（vendor/liquid-glass.js） */
  | 'refract'
  | 'mica'
  | 'solid';

/** 关键容器：无论什么主题都用透明玻璃 */
export const KEY_SURFACE: MaterialTier = 'liquid';

/** 该主题下普通卡片用什么材质（主题全权决定） */
export function baseTierForTheme(theme: ThemeId): MaterialTier {
  // 液态玻璃主题：整页交给 WebGL 折射层，卡片自身不画材质
  if (theme === 'liquid-glass-wc') return 'refract';
  if (theme === 'liquid-glass') return 'liquid';
  return 'mica';
}

/** React 侧：拿到当前主题下的普通卡片材质 */
export function useBaseTier(): MaterialTier {
  return useStore((s) => baseTierForTheme(s.settings.theme));
}

/** React 侧：当前主题是否是透明玻璃主题 */
export function useIsLiquidTheme(): boolean {
  return useStore((s) => s.settings.theme === 'liquid-glass');
}

/** React 侧：当前主题是否使用 WebGL 折射层（液态玻璃） */
export function useIsRefractTheme(): boolean {
  return useStore((s) => s.settings.theme === 'liquid-glass-wc');
}
