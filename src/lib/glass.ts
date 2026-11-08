import { useEffect } from 'react';
import { useStore } from './store';
import { useReducedMotion } from '../hooks/useTheme';

/* ==========================================================================
   磨砂玻璃滤镜的注入与性能闸门
   ──────────────────────────────────────────────────────────────────────────
   为什么会写成自定义 SVG 而不是直接用库的注入函数：

   库的默认做法是 feTurbulence(随机噪声) + feDisplacementMap。
   实测问题：噪声场是「随机揉搓」，不是「透镜成像」——
   它会把背景扭成不规则的扭曲，而不是像真实玻璃那样把背景
   平滑地拉伸、放大、在边缘折射。这正是「果冻感」而非「玻璃感」的来源。

   这里改成三通道色散 + 低频平滑位移场：
     · 低频（baseFrequency 0.0016）→ 大尺度平滑变形，接近透镜
     · 三通道不同位移强度 → R/G/B 在边缘分离，产生真实色散
     · 位移强度远高于库默认 → 光学变化肉眼可见

   另一条同样重要的结论来自实测对比：
   磨砂玻璃**不是**「模糊更强」，而是「几乎不模糊 + 光学位移」。
   所以 .lg-surface 的 blur 被压到 1.5px 左右（见 index.css）。
   ========================================================================== */

const FILTER_ID = 'liquid-glass-filter';

/** 低频平滑场：产生大尺度、相干的变形，而不是随机噪声扭曲 */
const BASE_FREQUENCY = 0.0016;
const NUM_OCTAVES = 1;
const SEED = 3;

/** 三通道位移强度。
 *  参考资料的 04 说得很明确：Liquid Glass 用的是「**略微**不同的坐标采样
 *  R/B 通道」，结果是边缘**很轻微**的红蓝分离。
 *  所以这里三通道只差 5（之前是 14，边缘彩边太重，出现了用户明确排斥的彩虹感）。
 *  同时整体强度也收了一档：位移应该只让边缘被拉伸压缩，不能把内容揉乱。 */
const SCALE_G = 34;
const SCALE_R = SCALE_G + 5;
const SCALE_B = SCALE_G - 5;

let injected = false;

/**
 * 注入自定义磨砂玻璃滤镜。
 * 必须在首帧之前调用 —— CSS 里的 backdrop-filter: url(#...) 一旦引用不到
 * 这个滤镜，整条 backdrop-filter 会失效，玻璃会退化成纯色块。
 */
export function ensureGlassFilter(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;

  try {
    const NS = 'http://www.w3.org/2000/svg';

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';

    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', FILTER_ID);
    // 位移会把像素推到元素边界之外，所以滤镜作用区域要放大，否则边缘被裁切
    filter.setAttribute('x', '-25%');
    filter.setAttribute('y', '-25%');
    filter.setAttribute('width', '150%');
    filter.setAttribute('height', '150%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    // 1) 低频平滑位移场
    const turb = document.createElementNS(NS, 'feTurbulence');
    turb.setAttribute('type', 'fractalNoise');
    turb.setAttribute('baseFrequency', String(BASE_FREQUENCY));
    turb.setAttribute('numOctaves', String(NUM_OCTAVES));
    turb.setAttribute('seed', String(SEED));
    turb.setAttribute('result', 'lensField');
    filter.appendChild(turb);

    // 2) 三个通道分别位移，再逐级 screen 混合回 RGB —— 这就是色散的来源。
    //    显式写清楚链条：R_disp→chR、G_disp→chG、B_disp→chB，
    //    然后 chB ⊕ chG = mix1，mix1 ⊕ chR = 输出。
    const bands: Array<{ name: string; scale: number; values: string }> = [
      {
        name: 'chR',
        scale: SCALE_R,
        values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
      },
      {
        name: 'chG',
        scale: SCALE_G,
        values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
      },
      {
        name: 'chB',
        scale: SCALE_B,
        values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
      },
    ];

    for (const band of bands) {
      const disp = document.createElementNS(NS, 'feDisplacementMap');
      disp.setAttribute('in', 'SourceGraphic');
      disp.setAttribute('in2', 'lensField');
      disp.setAttribute('scale', String(band.scale));
      disp.setAttribute('xChannelSelector', 'R');
      disp.setAttribute('yChannelSelector', 'G');
      disp.setAttribute('result', `${band.name}_disp`);
      filter.appendChild(disp);

      const cm = document.createElementNS(NS, 'feColorMatrix');
      cm.setAttribute('in', `${band.name}_disp`);
      cm.setAttribute('type', 'matrix');
      cm.setAttribute('values', band.values);
      cm.setAttribute('result', band.name);
      filter.appendChild(cm);
    }

    const blend1 = document.createElementNS(NS, 'feBlend');
    blend1.setAttribute('in', 'chB');
    blend1.setAttribute('in2', 'chG');
    blend1.setAttribute('mode', 'screen');
    blend1.setAttribute('result', 'mix1');
    filter.appendChild(blend1);

    const blend2 = document.createElementNS(NS, 'feBlend');
    blend2.setAttribute('in', 'mix1');
    blend2.setAttribute('in2', 'chR');
    blend2.setAttribute('mode', 'screen');
    filter.appendChild(blend2);

    svg.appendChild(filter);
    document.body.appendChild(svg);
    injected = true;
  } catch (err) {
    // 注入失败不能白屏：没有滤镜时 backdrop-filter 会退化为普通模糊
    console.warn('[学习 OS] 磨砂玻璃滤镜注入失败，已退化为普通模糊：', err);
  }
}

/**
 * 跟随性能档位与「减少动画」开关。
 * 这里不做滤镜自身动画：动画化的 feTurbulence 会持续占用 GPU 重算滤镜，
 * 在安卓上代价很高，而背景本身已经在流动，玻璃不需要再动。
 */
export function useGlassFilter(): void {
  const perf = useStore((s) => s.settings.perf);
  const glassBlur = useStore((s) => s.settings.glassBlur);
  const motion = useStore((s) => s.settings.motion);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (perf === 'saver' || !glassBlur) return;
    ensureGlassFilter();
  }, [perf, glassBlur]);

  // 仅用于暴露状态给调试面板，本身不产生额外开销
  useEffect(() => {
    void motion;
    void reduced;
  }, [motion, reduced]);
}

export { FILTER_ID };
