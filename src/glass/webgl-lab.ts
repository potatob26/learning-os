/**
 * 实验台：把背景画进一张离屏画布，再用它的像素作为玻璃着色器的输入。
 * ──────────────────────────────────────────────────────────
 * 为什么用画布而不是 html2canvas 之类抓 DOM：
 *   抓 DOM 只能得到「重绘」的结果，遇到跨域图片、字体、伪元素就会失真。
 *   而本项目的背景完全由 CSS 渐变与程序化图案构成 —— 可以精确地在画布上
 *   重绘一遍，得到像素级一致、且不含任何跨域内容的纹理源。
 *
 * 在正式应用里，这个「背景画布」会成为背景层的实现本身：
 *   背景层 = canvas（画渐变与图案）
 *   玻璃面板 = 采样这张 canvas 的 WebGL 画布
 * 两者共用同一份像素，因此折射一定是准的。
 */
import { createGlassRenderer, DEFAULT_GLASS, type GlassRenderer } from './webgl-glass';

export interface LabConfig {
  el: HTMLElement | null;
  thickness?: number;
  ior?: number;
  dispersionIor?: number;
  specular?: number;
  tint?: number;
}

export interface LabResult {
  ok: boolean;
  renderer: string | null;
}

/** 把页面背景重绘到画布上（与 CSS 里的场景保持一致） */
function paintBackground(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  // 底色
  const base = g.createLinearGradient(0, 0, w * 0.9, h);
  base.addColorStop(0, '#0f1731');
  base.addColorStop(0.52, '#141d3d');
  base.addColorStop(1, '#0a0f22');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  const blob = (x: number, y: number, rx: number, ry: number, color: string) => {
    g.save();
    g.translate(x, y);
    g.scale(rx, ry);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    rg.addColorStop(0, color);
    rg.addColorStop(1, 'transparent');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };

  blob(w * 0.14, h * 0.12, w * 0.44, h * 0.32, '#3565ee');
  blob(w * 0.88, h * 0.2, w * 0.4, h * 0.3, '#16bcb4');
  blob(w * 0.54, h, w * 0.52, h * 0.42, '#9146ee');

  // 网格
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 1;
  for (let x = 0; x <= w; x += 26) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, h);
    g.stroke();
  }
  for (let y = 0; y <= h; y += 26) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(w, y + 0.5);
    g.stroke();
  }

  // 斜向光带：折射的判据
  const beam = g.createLinearGradient(0, 0, w, h * 0.55);
  beam.addColorStop(0, 'transparent');
  beam.addColorStop(0.24, 'transparent');
  beam.addColorStop(0.33, 'rgba(150,195,255,0.55)');
  beam.addColorStop(0.36, 'rgba(255,255,255,0.9)');
  beam.addColorStop(0.39, 'rgba(120,170,255,0.5)');
  beam.addColorStop(0.47, 'transparent');
  beam.addColorStop(1, 'transparent');
  g.fillStyle = beam;
  g.fillRect(0, 0, w, h);
}

export function initGlassLab(configs: LabConfig[]): LabResult {
  const valid = configs.filter((c) => c.el);
  if (valid.length === 0) return { ok: false, renderer: null };

  // 用于采样与显示背景的画布
  let source = document.getElementById('glass-bg-canvas') as HTMLCanvasElement | null;
  if (!source) {
    source = document.createElement('canvas');
    source.id = 'glass-bg-canvas';
    source.style.cssText =
      'position:fixed;inset:0;z-index:0;width:100%;height:100%;display:block;';
    document.body.insertBefore(source, document.body.firstChild);
  }
  paintBackground(source);

  // 隐藏 CSS 绘制的背景，避免与画布叠加
  for (const sel of ['.scene', '.grid', '.beam']) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      el.style.display = 'none';
    }
  }

  const panels = valid.map((c) => {
    const canvas = c.el!.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('每个玻璃面板需要一个 canvas 子元素');
    return {
      canvas,
      options: {
        ...DEFAULT_GLASS,
        thickness: c.thickness ?? DEFAULT_GLASS.thickness,
        ior: c.ior ?? DEFAULT_GLASS.ior,
        dispersionIor: c.dispersionIor ?? DEFAULT_GLASS.dispersionIor,
        specular: c.specular ?? DEFAULT_GLASS.specular,
        tint: c.tint ?? DEFAULT_GLASS.tint,
      },
    };
  });

  const renderer: GlassRenderer = createGlassRenderer(source, panels);

  // 静态场景只需要画一次；尺寸变化时重画
  let t: number | undefined;
  const onResize = () => {
    window.clearTimeout(t);
    t = window.setTimeout(() => {
      paintBackground(source!);
      renderer.refresh();
    }, 120);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  return { ok: renderer.ok, renderer: renderer.renderer };
}
