import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/utils';
import { GlassSurface } from './GlassSurface';
import type { MaterialTier } from '../../lib/material';

/**
 * 卡片：在 GlassSurface 之上加内边距与进入动画。
 * 材质默认跟随当前主题，可显式覆盖。
 *
 * 内边距加在内容层（contentClassName）而不是外层容器上 ——
 * 透明玻璃本体是绝对定位的，内边距加在容器上会被玻璃盖住。
 */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tier?: MaterialTier;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  delay?: number;
  interactive?: boolean;
  /** 圆角（px）。需与玻璃的 SDF 圆角一致 */
  glassRadius?: number;
  children: ReactNode;
}

const PADDING = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
} as const;

export function Card({
  tier,
  padding = 'md',
  delay,
  interactive,
  glassRadius = 20,
  className,
  style,
  children,
  ...rest
}: CardProps) {
  return (
    <GlassSurface
      tier={tier}
      radius={glassRadius}
      className={cx(
        'rounded-[var(--radius-card)]',
        interactive && 'transition-transform duration-200 active:scale-[0.985]',
        'anim-rise',
        className,
      )}
      contentClassName={PADDING[padding]}
      style={{ animationDelay: delay ? `${delay}s` : undefined, ...style }}
      {...rest}
    >
      {children}
    </GlassSurface>
  );
}

/** 卡片内的小节标题 */
export function CardTitle({
  icon,
  title,
  action,
  subtitle,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && <span className="text-[var(--text-tertiary)] [&>svg]:size-4">{icon}</span>}
          <h2 className="truncate text-[0.95rem] font-semibold tracking-tight">{title}</h2>
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-tertiary">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </div>
  );
}
