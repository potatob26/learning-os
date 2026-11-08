import type { SceneName, ThemeId } from '../lib/types';
import { paintGlassFlow } from './flow-background';

/* ==========================================================================
   背景层（Background）—— 三层架构的最底层
   ──────────────────────────────────────────────────────────────────────────
   为什么背景必须画在 canvas 上，而不是用 CSS：

   玻璃着色器需要**读取背景像素**来按法线偏移采样。CSS 背景无法被 WebGL 读取，
   而 DOM 截图（html2canvas 之类）既慢又会丢失字体/伪元素/滤镜。
   所以按三层架构，背景必须先在 canvas 上完成绘制，再作为统一纹理源交给玻璃层。

   附带好处：背景与玻璃共用同一份像素，折射一定是准的，不会出现
   「玻璃内外颜色不一致」这种最刺眼的错误。

   代价（如实记录）：CSS 里那些缓慢动画（极光流动、雨丝、星点闪烁）
   在静态 canvas 上不会自动播放。要恢复动画需要按低帧率重绘整张背景并重新上传
   纹理，在中低端安卓上代价不低，因此默认不开启。
   ========================================================================== */

export interface BgInput {
  scene: SceneName | null;
  /** 已解码的自定义背景图（dataURL 形式传入时需先加载） */
  image: HTMLImageElement | null;
  dim: number;
  showVeil: boolean;
  /** 是否绘制微网格与细颗粒（用户可关） */
  grid: boolean;
  dark: boolean;
  theme: ThemeId;
  /**
   * 额外的暗化量（0~1）。
   * 弹层打开时，页面本身会被遮罩压暗；玻璃必须用**压暗后的**背景做折射，
   * 否则玻璃会比周围亮一截，一眼就能看出不对。
   */
  extraDim?: number;
  /**
   * 自定义背景图的**显示范围**（用户可调）。
   *   focusX/focusY：焦点 0..1，0=贴左/上、0.5=居中、1=贴右/下
   *   zoom：在 cover 基础上的额外放大倍数，≥1
   * 缺省（不传 / 0.5 / 1）与旧行为**逐像素一致**（居中 cover），确保零回归。
   */
  imageFocus?: { focusX?: number; focusY?: number; zoom?: number };
}

/** 把值收在 0..1：焦点参数来自用户拖动，必须夹住，否则会把图推出画布露出空白边 */
function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

/* ---------------- CSS 颜色解析 ---------------- */

/**
 * 把 CSS 颜色转成 canvas 能解析的形式。
 * 设计令牌里大量使用 `rgb(16 24 40 / 0.66)` 这种现代空格 + 斜杠写法，
 * 而 canvas 的 fillStyle 不认，需要转成 `rgba(16, 24, 40, 0.66)`。
 */
export function cssColor(value: string, fallback = 'rgba(0,0,0,0)'): string {
  const v = value.trim();
  if (!v) return fallback;

  // rgb(r g b / a) 或 rgb(r, g, b, a)
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return `rgba(${Math.round(+m[1])}, ${Math.round(+m[2])}, ${Math.round(+m[3])}, ${a})`;
  }
  return v;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 取出 CSS 变量的透明通道（用于按主题调整遮罩强度） */
function cssAlpha(name: string, fallback: number): number {
  const v = cssVar(name, '');
  const m = /\/\s*([\d.]+)\s*\)/.exec(v);
  if (m) return parseFloat(m[1]);
  return fallback;
}

/* ---------------- 主题色偏 ---------------- */

/**
 * 每套主题的背景气质。定义在这里而不是 CSS：
 * 背景只由这一处绘制，避免 CSS 与 canvas 两份定义漂移。
 * 数组元素为 [圆心x比例, 圆心y比例, 半径x比例, 半径y比例, 颜色, 透明度]
 */
const THEME_TINTS: Partial<
  Record<ThemeId, Array<[number, number, number, number, string, number]>>
> = {
  'liquid-glass-wc': [
    // 液态玻璃靠逐像素折射，背景需要更明确的色块与明暗过渡，
    // 这样玻璃边缘的弯折才看得出来
    [0.14, 0.04, 1.2, 0.75, '#4f7bff', 0.46],
    [0.88, 0.18, 1.0, 0.7, '#2ec4b6', 0.38],
    [0.5, 1.04, 1.3, 0.9, '#8b5cf6', 0.4],
  ],
  'liquid-glass': [
    [0.14, 0.04, 1.2, 0.75, '#5880ff', 0.4],
    [0.88, 0.18, 1.0, 0.7, '#40d2c8', 0.32],
    [0.5, 1.04, 1.3, 0.9, '#b07bff', 0.34],
  ],
  immersive: [
    [0.5, 0.06, 1.0, 0.7, '#386ac8', 0.34],
    [0.88, 0.92, 0.9, 0.6, '#8c5cdc', 0.28],
  ],
  soft: [
    [0.5, 1.0, 0.9, 0.7, '#ffe8d6', 0.55],
    [0.12, 0.08, 0.8, 0.6, '#cbd8ff', 0.5],
  ],
  'pure-dark': [[0.5, 0.0, 1.2, 0.8, '#506ebe', 0.1]],
  'pure-light': [],
};

/* ---------------- 场景 ---------------- */

function blob(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
): void {
  g.save();
  g.globalAlpha = alpha;
  g.translate(cx * w, cy * h);
  g.scale(Math.max(rx * w, 1), Math.max(ry * h, 1));
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  rg.addColorStop(0, color);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** 细颗粒 + 微网格：给折射提供可弯曲的高频内容 */
function detailLayer(g: CanvasRenderingContext2D, w: number, h: number, dark: boolean): void {
  const dotColor = dark ? 'rgba(255,255,255,0.5)' : 'rgba(20,32,60,0.5)';
  const lineColor = dark ? 'rgba(255,255,255,0.22)' : 'rgba(20,32,60,0.28)';

  // 微网格
  g.save();
  g.strokeStyle = lineColor;
  g.lineWidth = 1;
  const cell = 30;
  g.beginPath();
  for (let x = 0; x <= w; x += cell) {
    g.moveTo(Math.round(x) + 0.5, 0);
    g.lineTo(Math.round(x) + 0.5, h);
  }
  for (let y = 0; y <= h; y += cell) {
    g.moveTo(0, Math.round(y) + 0.5);
    g.lineTo(w, Math.round(y) + 0.5);
  }
  g.stroke();
  g.restore();

  // 细颗粒（周期性排布，保证任意屏幕尺寸下密度一致）
  g.save();
  g.fillStyle = dotColor;
  const tile = 180;
  const dots: Array<[number, number]> = [
    [18, 22],
    [96, 74],
    [148, 34],
    [58, 128],
  ];
  for (let ox = 0; ox < w; ox += tile) {
    for (let oy = 0; oy < h; oy += tile) {
      for (const [dx, dy] of dots) {
        g.beginPath();
        g.arc(ox + dx, oy + dy, 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.restore();
}

function paintScene(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: SceneName,
  dark: boolean,
  accent: string,
  okColor: string,
  warnColor: string,
): void {
  switch (scene) {
    case 'glass-flow':
      paintGlassFlow(g, w, h);
      break;
    case 'aurora':
      blob(g, w, h, 0.22, 0.26, 0.7, 0.55, accent, dark ? 0.5 : 0.42);
      blob(g, w, h, 0.78, 0.34, 0.6, 0.5, okColor, dark ? 0.36 : 0.28);
      blob(g, w, h, 0.52, 0.82, 0.8, 0.6, '#a78bfa', dark ? 0.42 : 0.3);
      break;
    case 'glow':
      blob(g, w, h, 0.5, -0.06, 0.6, 0.44, accent, dark ? 0.45 : 0.34);
      blob(g, w, h, 0.12, 0.96, 0.7, 0.5, okColor, dark ? 0.26 : 0.18);
      break;
    case 'dawn':
      blob(g, w, h, 0.08, 0.04, 1.2, 0.8, accent, 0.26);
      blob(g, w, h, 0.92, 0.12, 1.0, 0.7, warnColor, 0.22);
      blob(g, w, h, 0.5, 1.08, 1.2, 0.9, accent, 0.18);
      break;
    case 'dusk': {
      const lg = g.createLinearGradient(0, 0, w * 0.6, h);
      lg.addColorStop(0, accent);
      lg.addColorStop(0.42, '#f472b6');
      lg.addColorStop(0.78, 'rgba(0,0,0,0)');
      g.save();
      g.globalAlpha = 0.3;
      g.fillStyle = lg;
      g.fillRect(0, 0, w, h);
      g.restore();
      break;
    }
    case 'stars': {
      // 星点用固定分布的伪随机序列，保证每次绘制一致
      g.save();
      g.fillStyle = dark ? 'rgba(255,255,255,0.85)' : 'rgba(30,41,59,0.5)';
      const tile = 320;
      const pts: Array<[number, number, number]> = [
        [24, 38, 1.4],
        [132, 96, 1.1],
        [214, 186, 1.6],
        [62, 244, 1.0],
        [276, 58, 1.3],
        [172, 292, 1.0],
      ];
      for (let ox = -tile; ox < w + tile; ox += tile) {
        for (let oy = -tile; oy < h + tile; oy += tile) {
          for (const [dx, dy, r] of pts) {
            g.beginPath();
            g.arc(ox + dx, oy + dy, r, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      g.restore();
      blob(g, w, h, 0.8, 0.15, 0.6, 0.4, accent, dark ? 0.18 : 0.12);
      break;
    }
    case 'rain': {
      g.save();
      g.strokeStyle = dark ? 'rgba(255,255,255,0.22)' : 'rgba(20,32,60,0.16)';
      g.lineWidth = 1;
      const spacing = 22;
      for (let x = -h; x < w + h; x += spacing) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + h * 0.24, h);
        g.stroke();
      }
      g.restore();
      blob(g, w, h, 0.5, 0.1, 0.9, 0.5, accent, dark ? 0.22 : 0.14);
      break;
    }
    case 'grid':
      detailLayer(g, w, h, dark);
      break;
  }
}

/* ---------------- 主入口 ---------------- */

const imageCache = new Map<string, HTMLImageElement>();

/** 预加载自定义背景图（供玻璃纹理使用） */
export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached && cached.complete) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('背景图加载失败'));
    img.src = url;
  });
}

/**
 * 绘制完整背景。绘制顺序与 CSS 版本一致：
 *   底色 → 场景 → 自定义图片 → 主题色偏 → 细节层 → 遮罩 → 渐变保护层
 */
export function paintBackground(canvas: HTMLCanvasElement, input: BgInput): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pxW = Math.max(1, Math.round(w * dpr));
  const pxH = Math.max(1, Math.round(h * dpr));

  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }

  const g = canvas.getContext('2d', { alpha: false });
  if (!g) return;

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const base = cssColor(cssVar('--bg-base', input.dark ? '#0a0c11' : '#f6f7f9'));
  const accent = cssColor(cssVar('--accent', '#3b82f6'));
  const okColor = cssColor(cssVar('--ok', '#34c98a'));
  const warnColor = cssColor(cssVar('--warn', '#f2a83b'));

  // ① 底色
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // ② 场景
  if (input.scene && !input.image) {
    paintScene(g, w, h, input.scene, input.dark, accent, okColor, warnColor);
  }

  /*
   * ③ 自定义图片（用户上传）：cover 铺满 + 按焦点选择显示范围，并按亮度做明暗补偿
   *
   * 显示范围（用户可调，见设置→背景的预览调节）：
   *   scale 在 cover 基础上乘 zoom；绘制原点由 focus 决定：
   *     focusX=0 贴左、0.5 居中、1 贴右（纵向同理）。
   *   缺省 0.5/1 时 (w-dw)*0.5 就是原来的 (w-dw)/2 —— **与旧行为逐像素一致**，
   *   所以老用户不调就完全看不出变化（零回归）；一旦调过，用 clamp 收在 0..1，
   *   保证不会把图推出画布露出空白边。
   */
  if (input.image && input.image.complete && input.image.naturalWidth > 0) {
    const iw = input.image.naturalWidth;
    const ih = input.image.naturalHeight;
    const f = input.imageFocus ?? {};
    const focusX = clamp01(f.focusX ?? 0.5);
    const focusY = clamp01(f.focusY ?? 0.5);
    const zoom = Math.max(1, f.zoom ?? 1);
    const scale = Math.max(w / iw, h / ih) * zoom;
    const dw = iw * scale;
    const dh = ih * scale;
    g.drawImage(input.image, (w - dw) * focusX, (h - dh) * focusY, dw, dh);
    const veil = input.dark ? 1.25 : 1;
    g.fillStyle = `rgba(${input.dark ? '6, 8, 12' : '255, 255, 255'}, ${Math.min(
      0.9,
      Math.max(0, input.dim * veil),
    )})`;
    g.fillRect(0, 0, w, h);
  }

  // ④ 主题色偏
  const tints = input.scene === 'glass-flow' ? [] : THEME_TINTS[input.theme] ?? [];
  for (const [cx, cy, rx, ry, color, alpha] of tints) {
    blob(g, w, h, cx, cy, rx, ry, color, alpha);
  }

  // ⑤ 细节层：给折射提供可弯曲的高频内容。
  //    原来是「只要是透明玻璃主题就强制绘制」，用户无法关闭；
  //    现在改为完全由用户设置决定。
  if (input.grid) {
    g.save();
    g.globalAlpha = 0.5;
    detailLayer(g, w, h, input.dark);
    g.restore();
  }

  // ⑥ 归一化遮罩：保证任何背景下文字都可读
  if (input.showVeil) {
    const themeVeil = parseFloat(cssVar('--bg-veil', '0.42')) || 0.42;
    // 演示的高亮色带直接压在正文下会降低可读性。遮罩开启时保留足够明暗保护；
    // 关闭遮罩仍可查看原始流光色彩，不改变用户的网格与其他背景偏好。
    const veilAlpha = input.scene === 'glass-flow' ? Math.max(themeVeil, input.dark ? .56 : .7) : themeVeil;
    const veilRGB = cssVar('--bg-veil-color', input.dark ? '6 8 12' : '255 255 255')
      .split(/[\s,]+/)
      .slice(0, 3)
      .map((n) => Math.round(parseFloat(n)))
      .join(', ');
    g.fillStyle = `rgba(${veilRGB}, ${veilAlpha})`;
    g.fillRect(0, 0, w, h);
  }

  // ⑦ 渐变保护层：顶部与底部让内容更易读
  const topAlpha = cssAlpha('--bg-protect-top', 0.1);
  const topColor = cssColor(cssVar('--bg-protect-top', input.dark ? 'rgb(10 12 17 / 0.14)' : 'rgb(246 247 249 / 0.1)'));
  const bottomColor = cssColor(
    cssVar('--bg-protect-bottom', input.dark ? 'rgb(10 12 17 / 0.86)' : 'rgb(246 247 249 / 0.82)'),
  );
  void topAlpha;
  const lg = g.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, topColor);
  lg.addColorStop(0.22, 'rgba(0,0,0,0)');
  lg.addColorStop(0.58, 'rgba(0,0,0,0)');
  lg.addColorStop(1, bottomColor);
  g.fillStyle = lg;
  g.fillRect(0, 0, w, h);

  // ⑧ 弹层遮罩：与页面上的 sheet-backdrop 保持一致，
  //    这样玻璃折射到的背景与它周围看到的背景是同一份
  const extra = Math.min(Math.max(input.extraDim ?? 0, 0), 1);
  if (extra > 0.001) {
    g.fillStyle = `rgba(6, 8, 12, ${extra})`;
    g.fillRect(0, 0, w, h);
  }
}
