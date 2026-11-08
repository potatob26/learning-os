import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { readableButtonBg, hoverOf } from '../lib/accent';
import type { ColorMode, PerfLevel, ThemeId } from '../lib/types';
import { DARK_ONLY_THEMES } from '../lib/types';

/* ==========================================================================
   主题引擎
   ──────────────────────────────────────────────────────────────────────────
   1. 主题（5 套） + 深浅模式（浅/深/跟随系统）叠加
   2. 跟随系统时监听 matchMedia，安卓切换系统深色后网站同步响应
   3. 性能档位 / 减少动画 / 关闭模糊 → 全部落到 <html> 的 data-* 上，由 CSS 响应
   4. 同步 <meta name="theme-color">，让安卓状态栏颜色跟随
   ========================================================================== */

export interface ThemeDef {
  id: ThemeId;
  label: string;
  desc: string;
  /** 预览用的三个色块 */
  swatch: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  {
    id: 'liquid-glass-wc',
    label: '液态玻璃',
    desc: '逐像素折射，背景真实弯折',
    swatch: ['#0e1730', '#6ea8ff', '#4fd1c5'],
  },
  {
    id: 'liquid-glass',
    label: '透明玻璃',
    desc: '磨砂质感、环境色、边缘高光',
    swatch: ['#0e1730', '#7aa8ff', '#42d6c8'],
  },
  {
    id: 'pure-light',
    label: '极简白',
    desc: '纯净、留白、高级',
    swatch: ['#ffffff', '#f6f7f9', '#3f7df6'],
  },
  {
    id: 'pure-dark',
    label: '极简黑',
    desc: '沉浸、安静',
    swatch: ['#08090c', '#15181f', '#8fb4ff'],
  },
  {
    id: 'soft',
    label: '柔和浅色',
    desc: '米白、浅蓝、淡紫',
    swatch: ['#f7f4ef', '#fffdfa', '#8b7bd8'],
  },
  {
    id: 'immersive',
    label: '沉浸式',
    desc: '以背景为主视觉',
    swatch: ['#0b1220', '#1b2333', '#7aa8ff'],
  },
];

export const COLOR_MODES: { id: ColorMode; label: string; icon: string }[] = [
  { id: 'light', label: '浅色', icon: 'sun' },
  { id: 'dark', label: '深色', icon: 'moon' },
  { id: 'system', label: '跟随系统', icon: 'monitor' },
];

export const PERF_LEVELS: { id: PerfLevel; label: string; desc: string }[] = [
  { id: 'high', label: '高质量', desc: '完整模糊、全动画、动态背景' },
  { id: 'balanced', label: '平衡', desc: '推荐。自适应降级' },
  { id: 'saver', label: '省电', desc: '关闭动态背景与模糊，最省电' },
];

/* ---------------- 系统偏好 ---------------- */

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return dark;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** 判断当前是不是「弱机」，用于首次启动时推荐性能档位 */
export function detectLowEnd(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  return cores <= 4 || mem <= 3;
}

/* ---------------- 应用到 DOM ---------------- */

interface ResolvedTheme {
  theme: ThemeId;
  dark: boolean;
  perf: PerfLevel;
  motionOn: boolean;
  blurOn: boolean;
  dynamicBg: boolean;
}

export function useThemeEngine(): ResolvedTheme {
  const theme = useStore((s) => s.settings.theme);
  const colorMode = useStore((s) => s.settings.colorMode);
  const perf = useStore((s) => s.settings.perf);
  const motion = useStore((s) => s.settings.motion);
  const glassBlur = useStore((s) => s.settings.glassBlur);
  const dynamicBackground = useStore((s) => s.settings.dynamicBackground);
  const accent = useStore((s) => s.settings.accent);

  const systemDark = useSystemDark();
  const reducedMotion = useReducedMotion();
  const previousTheme = useRef(theme);

  useEffect(() => {
    const root = document.documentElement;
    if (previousTheme.current !== theme && motion && !reducedMotion && perf !== 'saver') {
      root.dataset.themeTransition = 'on';
    }
    previousTheme.current = theme;
    const timeout = window.setTimeout(() => delete root.dataset.themeTransition, 320);
    return () => { clearTimeout(timeout); delete root.dataset.themeTransition; };
  }, [theme, motion, reducedMotion, perf]);

  /**
   * 实际是否为深色。
   * 不能只看 colorMode —— 像「极简黑」这种只有深色变体的主题，
   * 若用户把明暗设为「浅色」，背景会被画成浅色而文字仍是近白色，
   * 结果白字压浅背景几乎看不见（已实测复现）。
   * 所以固定深色的主题要强制按深色处理。
   */
  const dark = DARK_ONLY_THEMES.includes(theme)
    ? true
    : colorMode === 'system'
      ? systemDark
      : colorMode === 'dark';

  const resolved = useMemo<ResolvedTheme>(() => {
    // 省电档位强制关闭高开销效果；跟随系统「减少动画」也一并尊重
    const motionOn = motion && !reducedMotion && perf !== 'saver';
    const blurOn = glassBlur && perf !== 'saver';
    const dynamicBg = dynamicBackground && perf !== 'saver' && !reducedMotion;
    return { theme, dark, perf, motionOn, blurOn, dynamicBg };
  }, [theme, dark, perf, motion, glassBlur, dynamicBackground, reducedMotion]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved.theme;
    root.dataset.perf = resolved.perf;
    root.dataset.motion = resolved.motionOn ? 'on' : 'off';
    root.dataset.blur = resolved.blurOn ? 'on' : 'off';
    root.classList.toggle('dark', resolved.dark);
    root.style.colorScheme = resolved.dark ? 'dark' : 'light';

    // 安卓状态栏 / 地址栏配色
    const bg = getComputedStyle(root).getPropertyValue('--bg-base').trim();
    if (bg) {
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((m) => m.setAttribute('content', bg));
    }
  }, [resolved]);

  /**
   * 自定义强调色
   * ──────────────────────────────────────────────────────────────
   * 覆盖 `--accent` 之后，派生令牌会自动跟上：
   *   --accent-soft / --accent-ring / --accent-on-soft / --heat-1..4
   * 它们都是 CSS 里用 color-mix 从 --accent 算出来的，各自有封顶，
   * 换任何颜色都不会出现字压不住底。
   *
   * 但**按钮底色不能只靠 CSS 派生**：浅色主题的按钮压白字，若用户挑了
   * 明黄或浅粉，派生出来的底色仍然压不住白字。所以这里按对比度反算
   * （见 lib/accent.ts），只把按钮底色与悬停色显式覆盖掉。
   *
   * 透明玻璃主题不适用：那个主题的观感由玻璃折射主导，再叠自定义色会打架。
   */
  useLayoutEffect(() => {
    const root = document.documentElement;
    const usable = Boolean(accent) && resolved.theme !== 'liquid-glass-wc';

    if (usable && accent) {
      // 浅色主题按钮压白字；深色主题按下压深字
      const fg: 'light' | 'dark' = resolved.dark ? 'dark' : 'light';
      const bg = readableButtonBg(accent, fg);
      root.style.setProperty('--accent', accent);
      root.style.setProperty('--primary-bg', bg);
      root.style.setProperty('--primary-bg-hover', hoverOf(bg, fg));
    } else {
      // 移除后自动回落到各主题自带的取值
      root.style.removeProperty('--accent');
      root.style.removeProperty('--primary-bg');
      root.style.removeProperty('--primary-bg-hover');
    }
  }, [accent, resolved.theme, resolved.dark]);

  return resolved;
}

/** 过渡期间避免「白闪」：在 React 挂载前先按缓存设置一次 */
export function applyThemeEarly(): void {
  try {
    const raw = localStorage.getItem('learning-os:v1:state');
    if (!raw) return;
    const parsed = JSON.parse(raw) as { settings?: { theme?: string; colorMode?: string; perf?: string } };
    const root = document.documentElement;
    const theme = parsed.settings?.theme ?? 'liquid-glass';
    const mode = parsed.settings?.colorMode ?? 'system';
    const perf = parsed.settings?.perf ?? 'balanced';
    const sysDark =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
    const dark = DARK_ONLY_THEMES.includes(theme as ThemeId) || (mode === 'system' ? sysDark : mode === 'dark');
    root.dataset.theme = theme;
    root.dataset.perf = perf;
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch {
    /* ignore */
  }
}
