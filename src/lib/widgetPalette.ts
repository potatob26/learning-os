import { THEMES } from '../hooks/useTheme';
import { DARK_ONLY_THEMES, type ColorMode, type ThemeId } from './types';

/* ==========================================================================
   把「App 里的主题」翻译成小组件能用的调色板
   ──────────────────────────────────────────────────────────────────────────
   小组件是原生 RemoteViews，拿不到 CSS 变量，只能接收具体颜色值。
   所以要在 Web 侧把**每个主题**的令牌解析成 #RRGGBB 再推给原生 ——
   这样「每个小组件单独选主题」才能成立（原生侧按实例取对应那一套）。

   ⚠️ 两个必须知道的点：

   ① 主题选择器是 `:root[data-theme='x']`，**只匹配 <html>**。
      所以没法用一个沙箱 div 离线取任意主题的令牌 —— 必须把 data-theme
      依次挂到 <html> 上读完 6 套再还原。
      整段**刻意保持同步**（没有任何 await）：浏览器不会在同一个任务中间绘制，
      所以用户看不到主题闪烁。**不要在这里加 await**，加了就会闪。

   ② 令牌里不少是半透明（如 `--surface: rgb(255 255 255 / 0.78)`）或
      `color-mix(...)` 表达式。RemoteViews 只认 #AARRGGBB，
      所以统一**压到底色上合成**成不透明色 —— 小组件不透出壁纸，也更清楚。
   ========================================================================== */

export interface WidgetPalette {
  label: string;
  dark: boolean;
  bg: string;
  text: string;
  secondary: string;
  accent: string;
  line: string;
}

type Rgba = [number, number, number, number];

/** 把任意合法 CSS 颜色规范化成 rgba 分量；不合法返回 null */
function toRgba(value: string, probe: HTMLElement): Rgba | null {
  const v = value.trim();
  if (!v) return null;
  // 先验一次，避免非法值被浏览器忽略后读到上一次的残留颜色
  if (typeof CSS !== 'undefined' && !CSS.supports('color', v)) return null;
  probe.style.color = v;
  const computed = getComputedStyle(probe).color;
  const nums = computed.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;
  const a = nums.length >= 4 ? Number(nums[3]) : 1;
  return [Number(nums[0]), Number(nums[1]), Number(nums[2]), Number.isFinite(a) ? a : 1];
}

/** 把半透明色压到背景上 */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = Math.max(0, Math.min(1, fg[3]));
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
    1,
  ];
}

function hex(c: Rgba): string {
  const p = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${p(c[0])}${p(c[1])}${p(c[2])}`.toUpperCase();
}

export interface PaletteInput {
  colorMode: ColorMode;
  systemDark: boolean;
}

/**
 * 解析全部 6 套主题的调色板。
 * 全程同步执行，读完立刻还原现场（见文件头 ①）。
 */
export function readThemePalettes({ colorMode, systemDark }: PaletteInput): Record<string, WidgetPalette> {
  if (typeof document === 'undefined' || !document.body) return {};
  const root = document.documentElement;
  const prevTheme = root.dataset.theme;
  const prevDark = root.classList.contains('dark');
  const prevScheme = root.style.colorScheme;

  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;visibility:hidden';
  document.body.appendChild(probe);

  const out: Record<string, WidgetPalette> = {};
  try {
    for (const t of THEMES) {
      // 固定深色的主题（极简黑 / 液态玻璃）无论用户选什么明暗都按深色算，
      // 与 useThemeEngine 的判定保持一致，否则小组件配色会和 App 对不上
      const dark = DARK_ONLY_THEMES.includes(t.id) ? true : colorMode === 'system' ? systemDark : colorMode === 'dark';
      root.dataset.theme = t.id;
      root.classList.toggle('dark', dark);
      const cs = getComputedStyle(root);
      const raw = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;

      const bg = toRgba(raw('--bg-base', '#f6f7f9'), probe) ?? [246, 247, 249, 1];
      const pick = (name: string, fallback: string) => {
        const c = toRgba(raw(name, fallback), probe) ?? toRgba(fallback, probe) ?? bg;
        return hex(over(c, bg));
      };

      out[t.id] = {
        label: t.label,
        dark,
        bg: hex(bg),
        text: pick('--text', '#101828'),
        secondary: pick('--text-secondary', '#5a6270'),
        accent: pick('--accent', '#3f7df6'),
        line: pick('--line', '#e3e7ee'),
      };
    }
  } finally {
    if (prevTheme) root.dataset.theme = prevTheme;
    root.classList.toggle('dark', prevDark);
    root.style.colorScheme = prevScheme;
    probe.remove();
  }
  return out;
}

/** 主题顺序（原生侧「点一下换主题」按这个顺序轮换） */
export const WIDGET_THEME_ORDER: ThemeId[] = THEMES.map((t) => t.id);
