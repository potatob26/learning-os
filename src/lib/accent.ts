/* ==========================================================================
   自定义强调色 → 可读的按钮配色
   ──────────────────────────────────────────────────────────────────────────
   用户挑的是「按钮颜色」，但那一个颜色要同时承担好几件事：
     · 主按钮的底色（上面还要压文字）
     · 选中态文字的颜色（压在 12%~18% 的同色浅底上）
     · 进度环、图表、链接
   而用户可能挑任何颜色 —— 包括明黄、浅粉这类**压白字或压深字都会读不清**的颜色。

   所以不能直接把颜色塞给 `--accent` 就完事，必须**按对比度反算**：
     浅色主题（按钮上压白字）→ 把底色往黑里压，直到白字 ≥4.5:1
     深色主题（按钮上压深字）→ 把底色往白里提，直到深字 ≥4.5:1

   这里只处理按钮底色这一个最危险的地方；其余派生令牌
   （--accent-on-soft / --heat-*）在 CSS 里已有各自的封顶，
   换任何颜色都不会出问题。
   ========================================================================== */

/** #rrggbb → [r,g,b]，非法输入返回 null */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** WCAG 相对亮度（0~1） */
function relLum(rgb: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function contrast(l1: number, l2: number): number {
  const a = Math.max(l1, l2);
  const b = Math.min(l1, l2);
  return (a + 0.05) / (b + 0.05);
}

/** 把颜色与黑或白按比例混合；ratio 是「原色占多少」（0~1） */
function mixWith(rgb: [number, number, number], target: 0 | 255, ratio: number): [number, number, number] {
  return [
    rgb[0] * ratio + target * (1 - ratio),
    rgb[1] * ratio + target * (1 - ratio),
    rgb[2] * ratio + target * (1 - ratio),
  ];
}

/**
 * 反算出一个「按钮底色」：在保持用户所选色相的前提下，
 * 把它压暗或提亮到与指定前景色达到 4.5:1。
 *
 * 用二分找最小改动量 —— 改得越少，越接近用户挑的那个颜色。
 *
 * @param hex 用户选的颜色
 * @param fg 按钮上的文字色（浅色主题是白，深色主题是深色）
 * @returns 合规的按钮底色（十六进制）
 */
export function readableButtonBg(hex: string, fg: 'light' | 'dark'): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;

  const fgLum = fg === 'light' ? 1 : relLum([18, 21, 31]);
  // 往哪个方向调：压白字就压暗（向黑），压深字就提亮（向白）
  const target: 0 | 255 = fg === 'light' ? 0 : 255;

  const lumAt = (ratio: number) => relLum(mixWith(rgb, target, ratio));

  // 原色本身就达标 → 原样用
  if (contrast(fgLum, lumAt(1)) >= 4.5) return toHex(rgb);

  // 二分找满足对比度的最大 ratio（改动最小）
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(fgLum, lumAt(mid)) >= 4.5) lo = mid;
    else hi = mid;
  }
  // 取 lo 并留一点点余量，避免边界抖动
  return toHex(mixWith(rgb, target, Math.max(0, lo - 0.02)));
}

/** 悬停态：比常态再深/浅一档，幅度很小 */
export function hoverOf(hex: string, fg: 'light' | 'dark'): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const target: 0 | 255 = fg === 'light' ? 0 : 255;
  return toHex(mixWith(rgb, target, 0.86));
}
