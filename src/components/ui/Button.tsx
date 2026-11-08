import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'glass' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
}

/**
 * 触控优先按钮。
 * Android 硬指标：任何尺寸的点击区域都 ≥ 44×44 CSS px，
 * 所以连 sm 也保持 44px 高度，只缩小左右内边距与字号。
 */
const SIZES: Record<Size, string> = {
  sm: 'min-h-11 px-3.5 text-sm rounded-xl gap-1.5',
  md: 'min-h-12 px-4 text-[0.95rem] rounded-2xl gap-2',
  lg: 'min-h-14 px-5 text-base rounded-2xl gap-2.5',
};

const VARIANTS: Record<Variant, string> = {
  // 主按钮的底色与文字色都走令牌：
  // 浅色主题用更深的 accent 底 + 白字，深色主题用浅 accent 底 + 深字。
  // 直接用 text-white + bg-[var(--accent)] 在深色主题下只有 2.1:1。
  primary:
    'text-[var(--on-accent)] shadow-sm active:scale-[0.98] disabled:opacity-40 ' +
    'bg-[var(--primary-bg)] hover:bg-[var(--primary-bg-hover)]',
  secondary:
    'bg-[var(--surface-sunken)] text-[var(--text)] border border-[var(--line)] active:scale-[0.98]',
  ghost:
    'text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)] active:scale-[0.98]',
  glass: 'mica text-[var(--text)] active:scale-[0.98]',
  danger:
    'bg-[var(--danger-bg)] text-[var(--on-danger)] active:scale-[0.98] ' +
    'hover:bg-[var(--danger-bg-hover)]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  icon,
  trailing,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center font-medium',
        'transition-[transform,background-color,opacity,box-shadow] duration-200 ease-[var(--ease-soft)]',
        'disabled:pointer-events-none',
        SIZES[size],
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : (
        icon && <span className="shrink-0 [&>svg]:size-[1.15em]">{icon}</span>
      )}
      {children != null && <span className="truncate">{children}</span>}
      {trailing && <span className="ml-auto shrink-0 [&>svg]:size-[1.15em]">{trailing}</span>}
    </button>
  );
}

/** 圆形图标按钮：两种尺寸都保证 44px 命中区 */
export function IconButton({
  label,
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full',
        'text-[var(--text-secondary)] transition-colors duration-200',
        'hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] active:scale-95',
        size === 'sm' && '[&>svg]:size-4',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
