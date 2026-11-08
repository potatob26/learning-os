import { useEffect, useRef, useState } from 'react';
import { createGlassRenderer, DEFAULT_GLASS, type GlassOptions, type GlassRenderer } from './webgl-glass';
import { paintBackground, type BgInput } from './background-canvas';
import { useStore } from '../lib/store';
import { baseTierForTheme } from '../lib/material';

/* ==========================================================================
   玻璃管理器
   ──────────────────────────────────────────────────────────────────────────
   职责：
     1. 持有背景画布（三层架构的 Background 层，同时是着色器的纹理源）
     2. 持有唯一的 WebGL 渲染器实例
     3. 维护「面板注册表」——哪些 DOM 元素需要渲染透明玻璃
     4. 在合适的时机统一重绘（尺寸变化、主题变化、背景变化、面板增减）

   为什么要注册表 + 统一重绘：
     每个面板各建 WebGL 上下文会撞上浏览器约 8~16 个的上限（实测过），
     所以全应用共用一个渲染器、一个上下文，由这里集中调度。
   ========================================================================== */

type PanelOpts = Partial<GlassOptions> & { radius?: number };

interface Registry {
  bgCanvas: HTMLCanvasElement | null;
  bgInput: BgInput | null;
  backdropDim: number;
  renderer: GlassRenderer | null;
  panels: Map<HTMLCanvasElement, PanelOpts>;
  raf: number | null;
  supported: boolean | null;
}

const reg: Registry = {
  bgCanvas: null,
  bgInput: null,
  backdropDim: 0,
  renderer: null,
  panels: new Map(),
  raf: null,
  supported: null,
};

/** 背景画布由 BackgroundLayer 注册进来 */
export function setBackgroundCanvas(canvas: HTMLCanvasElement | null): void {
  reg.bgCanvas = canvas;
  reg.renderer?.dispose();
  reg.renderer = null; // 背景换了需要重建纹理源
  repaintBackground();
}

/** 背景绘制参数（场景、图片、主题…）变化时调用 */
export function configureBackground(input: BgInput): void {
  reg.bgInput = input;
  repaintBackground();
}

/**
 * 设置弹层遮罩量。弹层打开时页面会被压暗，
 * 玻璃必须折射**压暗后**的背景，否则会比周围亮一截。
 */
export function setGlassBackdropDim(alpha: number): void {
  if (Math.abs(reg.backdropDim - alpha) < 0.01) return;
  reg.backdropDim = alpha;
  repaintBackground();
}

function repaintBackground(): void {
  if (!reg.bgCanvas || !reg.bgInput) return;
  paintBackground(reg.bgCanvas, { ...reg.bgInput, extraDim: reg.backdropDim });
  window.dispatchEvent(new Event('glass-background-change'));
  refreshNow();
}

/**
 * 申请重绘。合并到下一帧，避免一次交互里多次注册导致重复绘制。
 */
export function scheduleRefresh(): void {
  if (typeof window === 'undefined') return;
  if (reg.raf !== null) return;
  reg.raf = window.requestAnimationFrame(() => {
    reg.raf = null;
    refreshNow();
  });
}

function ensureRenderer(): GlassRenderer | null {
  if (!reg.bgCanvas) return null;
  if (reg.renderer) return reg.renderer;
  const panels = Array.from(reg.panels.entries()).map(([canvas, options]) => ({ canvas, options }));
  if (panels.length === 0) return null;
  reg.renderer = createGlassRenderer(reg.bgCanvas, panels);
  reg.supported = reg.renderer.ok;
  if (!reg.renderer.ok) {
    // 降级：告诉 CSS 层不要再走透明玻璃，改用 mica 材质
    document.documentElement.dataset.glass = 'off';
  } else {
    document.documentElement.dataset.glass = 'on';
  }
  return reg.renderer;
}

/** 立即重绘所有面板 */
export function refreshNow(): void {
  // 面板集合变化时重建渲染器（它按创建时的面板列表工作）
  if (reg.renderer && reg.panels.size > 0) {
    const current = reg.renderer as GlassRenderer & { panelCount?: number };
    void current;
  }
  const r = ensureRenderer();
  r?.refresh();
}

/** 面板增删后需要重建渲染器，让它知道最新的面板列表 */
function rebuild(): void {
  reg.renderer?.dispose();
  reg.renderer = null;
  refreshNow();
}

/**
 * 一个需要透明玻璃的容器。
 * 返回 { ref, canvasRef }：ref 挂到容器上，canvasRef 挂到容器内的 <canvas> 上。
 */
export function useGlassSurface(options: PanelOpts = {}): {
  ref: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  active: boolean;
} {
  const theme = useStore((s) => s.settings.theme);
  const perf = useStore((s) => s.settings.perf);
  const glassBlur = useStore((s) => s.settings.glassBlur);

  const ref = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 省电档位或用户关闭模糊时不做 WebGL 玻璃，直接走 CSS 材质
  const active = perf !== 'saver' && glassBlur;

  const optKey = JSON.stringify({ ...options, theme, active });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    reg.panels.set(canvas, { ...DEFAULT_GLASS, ...options });
    reg.renderer?.dispose();
    reg.renderer = null;
    scheduleRefresh();

    return () => {
      reg.panels.delete(canvas);
      rebuild();
    };
    // optKey 已经承载了所有会影响渲染的参数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optKey, active]);

  return { ref, canvasRef, active };
}

/** 供设置页显示当前玻璃渲染是否可用 */
export function useGlassSupport(): boolean | null {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => force((n) => n + 1), 600);
    return () => window.clearTimeout(id);
  }, []);
  return reg.supported;
}

/** 当前主题下，普通卡片是否应该使用透明玻璃材质 */
export function useLiquidCards(): boolean {
  const theme = useStore((s) => s.settings.theme);
  const perf = useStore((s) => s.settings.perf);
  const glassBlur = useStore((s) => s.settings.glassBlur);
  return baseTierForTheme(theme) === 'liquid' && perf !== 'saver' && glassBlur;
}

/* ---------------- 全局重绘触发 ---------------- */

if (typeof window !== 'undefined') {
  // 视口尺寸变化时背景画布必须重画（尺寸变了），再重绘玻璃
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => repaintBackground(), 140);
  };
  let resizeTimer: number | undefined;
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  // 字体加载完成后布局会变化，需要重绘
  if ('fonts' in document) {
    void (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => repaintBackground());
  }
}
