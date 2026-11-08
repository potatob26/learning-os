import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../lib/utils';
import { GlassLiquidPanel } from './GlassLiquidPanel';
import { GlassGuard } from './GlassGuard';
import { useBaseTier, type MaterialTier } from '../../lib/material';
import { registerKeyGlass } from '../../glass/key-glass';
import { useStore } from '../../lib/store';
/**
 * 玻璃材质容器
 * ──────────────────────────────────────────────────────────────
 * 材质由主题决定（主题全权决定主材质）：
 *
 *   liquid  —— 透明玻璃，使用 liquid-glass-react。
 *              · 必须放在一个**定位容器**里（该库依赖 top/left:50% + translate(-50%,-50%)
 *                的居中惯用法，直接放文档流会跑到屏幕外，已实测）
 *              · 该库内部用 backdrop-filter 做模糊，所以会有一层磨砂
 *              · 圆角裁剪由外层容器负责
 *   refract —— 液态玻璃，WebGL 逐像素采样背景做真实折射。
 *              容器自身**不画任何材质**，只登记成一个「重点容器」，
 *              真正的玻璃由 LiquidGlassLayer 画在它下面（见该文件说明）。
 *   mica    —— 云母：模糊 + 内侧高光，成本低
 *   solid   —— 无模糊实底，最省电
 *
 * 内边距说明：玻璃类材质的 padding 必须加在**内容**上而不是外层容器上，
 * 因为玻璃本体是绝对定位、以容器的 padding box 为包含块，
 * 加在容器上会让玻璃盖住内边距区域。
 */
interface GlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  /** 不传则跟随当前主题 */
  tier?: MaterialTier;
  /** 圆角（px） */
  radius?: number;
  className?: string;
  style?: CSSProperties;
  /** 内容层类名（内边距放这里） */
  contentClassName?: string;
  as?: 'div' | 'nav' | 'section' | 'article' | 'header' | 'aside';
}

/**
 * 液态玻璃容器
 * ──────────────────────────────────────────────────────────────
 * 它自己什么都不画 —— 折射由 LiquidGlassLayer 用 WebGL 在**它下面**绘制。
 * 这里只做三件事：
 *   1. 把 DOM 节点登记进注册表，让玻璃层知道该往哪儿画、画多大
 *   2. 把内容抬到玻璃之上（z-index），保证文字永远清晰
 *   3. 保留一条极淡的描边，万一 WebGL 不可用也不至于完全没有边界
 */
function RefractSurface({
  children,
  radius,
  className,
  style,
  contentClassName,
  as: Tag,
  ...rest
}: Required<Pick<GlassSurfaceProps, 'radius' | 'as'>> &
  Omit<GlassSurfaceProps, 'tier' | 'radius' | 'as'>) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerKeyGlass(el, radius);
    // radius 变化时重新登记，让玻璃层的圆角跟上
  }, [radius]);

  return (
    <Tag
      ref={ref as never}
      data-key-glass
      className={cx('relative border border-[var(--line)]', className)}
      style={{ borderRadius: radius, background: 'transparent', ...style }}
      {...rest}
    >
      <div className={cx('relative z-[1]', contentClassName)}>{children}</div>
    </Tag>
  );
}

export function GlassSurface({
  children,
  tier,
  radius = 20,
  className,
  style,
  contentClassName,
  as: Tag = 'div',
  ...rest
}: GlassSurfaceProps) {
  const themeTier = useBaseTier();
  const reduceGlass = useStore((s) => s.settings.perf === 'saver' || !s.settings.glassBlur);
  // 旧主卡片的 liquid 表示「重点玻璃」，在折射主题里不能继续强制走磨砂库。
  const resolved = reduceGlass ? 'solid' : tier === 'liquid' && themeTier === 'refract' ? 'refract' : tier ?? themeTier;

  if (resolved === 'refract') {
    return (
      <RefractSurface
        radius={radius}
        as={Tag}
        className={className}
        style={style}
        contentClassName={contentClassName}
        {...rest}
      >
        {children}
      </RefractSurface>
    );
  }

  if (resolved === 'liquid') {
    // 注意：透明玻璃库把 children 渲染在**绝对定位的玻璃本体内部**，
    // 所以外层容器的布局类（flex 等）对 children 无效，
    // 布局类必须通过 contentClassName 落到玻璃内部的内容层上。
    // overLight 不再按主题自动推导：它会让库把玻璃压暗并强制白字，
    // 而我们的文字走设计令牌，所以交给用户在设置里显式控制。
    const inner = <div className={cx('w-full', contentClassName)}>{children}</div>;

    return (
      <GlassGuard
        // 降级：退回云母材质。用同一套圆角与类名，视觉上尽量接近。
        fallback={<Tag className={cx('mica relative', className)} style={style} {...rest}>{inner}</Tag>}
      >
        <GlassLiquidPanel radius={radius} className={className} style={style} {...rest}>
          {inner}
        </GlassLiquidPanel>
      </GlassGuard>
    );
  }

  return (
    <Tag
      className={cx(
        'relative',
        resolved === 'mica' && 'mica',
        resolved === 'solid' && 'border border-[var(--line)] bg-[var(--bg-elevated)]',
        className,
      )}
      style={{ borderRadius: radius, ...style }}
      {...rest}
    >
      <div className={cx('relative z-[2]', contentClassName)}>{children}</div>
    </Tag>
  );
}
