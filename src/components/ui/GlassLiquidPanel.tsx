import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/utils';

/**
 * 透明玻璃（liquid 档）新渲染底层 —— 独立模糊背景层实现
 * ══════════════════════════════════════════════════════════════════════════
 * 为什么要有这个文件（问题机理，实测+代码双重确认）：
 *
 * 旧的 liquid 档玻璃 = `backdrop-filter: blur()` + `liquid-glass-react` 的 SVG 位移滤镜。
 * 两者都要求浏览器在**合成阶段回头采样/重算**背后的内容：
 *
 *   1) backdrop-filter 需要 GPU 合成器实时采样"已经画在它背后的内容"。
 *      鸿蒙 4.2 的 WebView 在这条路径上采样时机不稳定 —— 首帧拿到空/旧内容，
 *      于是**第一次进入边框与内容错位**，离开再回来（重新合成）反而正常；
 *      同样导致**模糊实际没生效**（看起来不像玻璃）。
 *
 *   2) SVG 滤镜（feDisplacementMap + 逐通道偏移）的像素换算依赖 devicePixelRatio，
 *      而项目只在折射（WebGL）那一路封顶了 DPR（src/vendor/liquid-glass.js 里
 *      `Math.min(devicePixelRatio || 1, 2)`）—— SVG 这一路没封顶，
 *      在鸿蒙（DPR 3.3125）上色散/位移被放大 → **粗彩虹边 + 角上彩点 + 整层错位**。
 *
 * 新实现的核心思路：**完全不依赖合成阶段**。
 * 模糊不是"回头采样"，而是**预先绘制在一层独立的背景图上**（CSS filter 的绘制阶段行为）。
 *
 * 结构（四层，全部由同一个容器几何决定）：
 *
 *   GlassLiquidPanel   position:relative; border-radius; overflow:hidden; box-sizing:border-box
 *   ├── BlurBackground  absolute; inset:-24px（外扩，避免边缘出现透明空洞）; filter: blur(…)
 *   ├── GlassTint       absolute; inset:0; 半透明浅色染色
 *   ├── Border          画在容器自身（inset box-shadow），与容器**同尺寸、同圆角**
 *   └── Content         相对定位，正常文档流
 *
 * 这样做的三个直接好处：
 *   · **第一次进入就正常**：边框和背景都是容器自己的几何，不存在"等背景就绪"的时序依赖，
 *     也**不需要任何测量**（本文件没有 ResizeObserver / rAF / useEffect）。
 *   · **两端一致**：Android 16 与 HarmonyOS 4.2 跑**同一套**代码，不靠 @supports 降级。
 *   · **零偏移**：不用 transform / translate / scale / 固定 left-top 修边框（用户明确禁止）。
 *
 * ⚠️ 本文件**不碰折射档（液态玻璃）**。液态玻璃由 RefractPanel / LiquidGlassLayer 负责，
 *    与这里完全无关。
 *
 * ⚠️ 目前**尚未接线**（没有任何组件 import 它）—— 这是刻意的：
 *    先落地实现并让构建保持绿色，接线与双机验收作为下一步单独进行。
 */

export interface GlassLiquidPanelProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style'> {
  children: ReactNode;
  /** 圆角（px）。默认取全局设置里的玻璃圆角（--glass-radius） */
  radius?: number;
  className?: string;
  style?: CSSProperties;
  /** 玻璃后是浅色背景。不传则按全局设置（auto 时跟随主题深浅） */
  dark?: boolean;
  /**
   * 用于模糊层的背景图（与页面壁纸**同一张**）。
   * 不传则用 CSS 变量 `--glass-bg-image`（由应用在设壁纸时写入）；
   * 两者都没有时，模糊层退化为纯 tint（**仍然有圆角/边框/半透明，不会变成白实心卡片**）。
   */
  bgSrc?: string;
  /**
   * 背景图的绘制方式，默认 'viewport'：
   *   'viewport' —— 用 background-attachment: fixed 让模糊图与**视口**对齐，
   *                 这样它与页面壁纸逐像素对齐，且与滚动无关（因此没有时序依赖）。
   *   'cover'    —— 退化为普通 cover（个别 WebView 忽略 fixed 时可由调用方切换）。
   */
  bgMode?: 'viewport' | 'cover';
}

export function GlassLiquidPanel({
  children,
  radius,
  className,
  style,
  dark,
  bgSrc,
  bgMode = 'viewport',
  ...rest
}: GlassLiquidPanelProps) {
  const r = radius !== undefined ? `${radius}px` : 'var(--glass-radius, 20px)';

  return (
    <div
      {...rest}
      className={cx('glass-liquid', 'glass-liquid-no-backdrop', dark && 'glass-liquid--dark', className)}
      style={{ ...style, borderRadius: r }}
    >
      {/* ① 独立模糊背景层：真正的模糊发生在这一层自身（绘制阶段，不采样背后） */}
      <div
        aria-hidden
        className="glass-liquid__blur"
        style={{
          ...(bgSrc ? { backgroundImage: `url("${bgSrc}")` } : null),
          ...(bgMode === 'viewport'
            ? { backgroundAttachment: 'fixed' as const, backgroundSize: 'cover' }
            : { backgroundSize: 'cover' }),
        }}
      />
      {/* ② 半透明染色层：沿用现有 token，观感与旧版一致 */}
      <div aria-hidden className="glass-liquid__tint" />
      {/* ③ 边框：容器自身的 inset 描边（同尺寸同圆角，不做任何位移补偿） */}
      <div aria-hidden className="glass-liquid__border" style={{ borderRadius: r }} />
      {/* ④ 内容 */}
      <div className="glass-liquid__content">{children}</div>
    </div>
  );
}

export default GlassLiquidPanel;
