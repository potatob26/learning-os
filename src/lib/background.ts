import type { SceneName } from './types';

/* ==========================================================================
   背景素材：全部由 CSS/SVG 程序生成，零图片下载
   ──────────────────────────────────────────────────────────
   为什么不用真实照片：
     1. 体积 —— 一张合适的壁纸 ≈ 300KB–2MB，而程序化背景 ≈ 0KB
     2. 清晰度 —— 任意 DPI / 任意屏幕比例都不会模糊
     3. 深浅色 —— 可以随主题实时变化，照片做不到
     4. 性能与耗电 —— 静态渐变几乎零成本，照片要解码 + 常驻内存
   用户仍然可以上传自己的照片（见 downscaleImage）。
   ========================================================================== */

export interface SceneDef {
  id: SceneName;
  label: string;
  desc: string;
  /** 是否带持续动画（省电档位会关掉） */
  animated: boolean;
}

export const SCENES: SceneDef[] = [
  { id: 'glass-flow', label: '流光', desc: '液态玻璃演示的青蓝与琥珀色带', animated: false },
  { id: 'aurora', label: '极光', desc: '缓慢流动的柔光，最耐看', animated: true },
  { id: 'glow', label: '柔光', desc: '顶部一片光晕，安静', animated: true },
  { id: 'stars', label: '星空', desc: '轻微闪烁，适合夜间', animated: true },
  { id: 'rain', label: '雨夜', desc: '细雨斜落，克制', animated: true },
  { id: 'dawn', label: '晨光', desc: '暖色渐变，早上提神', animated: false },
  { id: 'dusk', label: '暮色', desc: '黄昏色调，傍晚舒适', animated: false },
  { id: 'grid', label: '网格', desc: '极简秩序感，接近纯色', animated: false },
];

const IMG_MAX_EDGE = 1600;

export interface DownscaleResult {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * 把用户上传的图片压缩到适合网页的尺寸。
 * 手机直出照片动辄 4000×3000 / 5MB，直接当背景会导致：
 *   · 内存暴涨（解码后 ≈ 宽×高×4 字节 ≈ 48MB）
 *   · 首屏卡顿、滚动掉帧
 * 所以统一限制最长边并转成 JPEG。
 */
export async function downscaleImage(
  file: File,
  maxEdge = IMG_MAX_EDGE,
  quality = 0.82,
): Promise<DownscaleResult> {
  const bitmap = await loadBitmap(file);
  const { width, height } = fitInside(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap.source, 0, 0, width, height);
  if ('close' in bitmap.source && typeof bitmap.source.close === 'function') {
    bitmap.source.close();
  }
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, width, height, bytes: Math.round((dataUrl.length - 22) * 0.75) };
}

function fitInside(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: Math.round(w), height: Math.round(h) };
  const ratio = maxEdge / longest;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

async function loadBitmap(
  file: File,
): Promise<{ source: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height };
    } catch {
      /* 某些浏览器对 HEIC 等格式会失败，走 <img> 兜底 */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片解码失败，可能格式不受支持'));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** 背景图的亮度分布（不只是平均值） */
export interface ImageTone {
  /** 中位数亮度 0~1 */
  median: number;
  /**
   * 最暗的一格。
   * 注意用的是**极值**而不是分位数：实测夜景照里一块只占约 6% 面积的亮招牌
   * 会被 p90 完全漏掉（p90 仍为 0），导致浅色文字压上去只有 2.1:1。
   * 这里是 32×32 降采样后的极值，每一格本身已经是一个区域的平均，
   * 所以极值稳定、不会被孤立噪点带偏。
   */
  darkest: number;
  /** 最亮的一格 */
  brightest: number;
  /** 极差 = brightest - darkest，越大说明背景越"花" */
  spread: number;
}

function loadBitmapFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('加载失败'));
    el.src = url;
  });
}

/**
 * 分析背景图的亮度**分布**，而不只是平均值。
 * ──────────────────────────────────────────────────────────────
 * 只用平均值会漏掉最危险的情况：
 *   夜景照里有一块亮招牌、动漫图有纯白底与深色线稿 ——
 *   平均值看着正常，但压在亮部（或暗部）上的文字根本读不出来。
 * 因此这里取 10/50/90 三个分位与离散度，供 recommendDim 判断最坏区域。
 */
export async function analyzeImage(dataUrl: string): Promise<ImageTone> {
  const fallback: ImageTone = { median: 0.5, darkest: 0.5, brightest: 0.5, spread: 0 };
  try {
    const img = await loadBitmapFromUrl(dataUrl);
    const canvas = document.createElement('canvas');
    // 32×32 足够估计分布，且几乎不耗时
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;
    ctx.drawImage(img, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);

    // 用 WCAG 的相对亮度口径，和对比度计算保持一致
    const lums: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      lums.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
    }
    lums.sort((a, b) => a - b);
    const at = (q: number) => lums[Math.min(lums.length - 1, Math.max(0, Math.round(q * (lums.length - 1))))];
    const median = at(0.5);
    const darkest = lums[0];
    const brightest = lums[lums.length - 1];
    return { median, darkest, brightest, spread: brightest - darkest };
  } catch {
    return fallback;
  }
}

/** 兼容旧调用：只取中位数亮度 */
export async function measureLuminance(dataUrl: string): Promise<number> {
  return (await analyzeImage(dataUrl)).median;
}

/**
 * 依据亮度分布推荐暗化/亮化强度。
 * ──────────────────────────────────────────────────────────────
 * 关键：**看最坏区域，不看平均**
 *   深色模式（文字是浅色）怕的是**亮部** → 参考 p90，并混入中位数
 *     避免一小块极亮就过度压暗整张图
 *   浅色模式（文字是深色）怕的是**暗部** → 参考 p10，同理混入中位数
 *   背景越"花"（spread 大）说明局部越可能出现压不住的地方，再补一点
 */
export function recommendDim(tone: ImageTone | number, dark: boolean): number {
  const t: ImageTone =
    typeof tone === 'number'
      ? { median: tone, darkest: tone, brightest: tone, spread: 0 }
      : tone;

  if (dark) {
    // 0.85 权重给**最亮的一格**，0.15 给中位数：
    // 既保证局部高光不会吃掉浅色文字，又不至于因为一小块高光把整图压死。
    const risky = 0.85 * t.brightest + 0.15 * t.median;
    const base = Math.min(0.85, Math.max(0.15, risky * 0.92));
    const extra = Math.min(0.12, t.spread * 0.25);
    return Math.round(Math.min(0.9, base + extra) * 100) / 100;
  }
  const risky = 0.85 * t.darkest + 0.15 * t.median;
  const base = Math.min(0.8, Math.max(0.08, (1 - risky) * 0.85));
  const extra = Math.min(0.12, t.spread * 0.25);
  return Math.round(Math.min(0.85, base + extra) * 100) / 100;
}
