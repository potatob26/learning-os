import appIcon from '../../assets/app-icon.webp';
import { cx } from '../../lib/utils';

/**
 * 应用标志
 * ──────────────────────────────────────────────────────────────
 * 直接使用与「桌面图标」同一张图（src/assets/app-icon.webp），
 * 保证软件内外视觉完全一致。
 *
 * 注意：**不要再加 CSS 圆角**。这张图本身的四角已经是透明的圆角形状，
 * 额外套一个 border-radius 会切进蓝色区域，反而把角削坏。
 * 需要更大/更小时通过 className 传尺寸。
 */
export function Logo({
  className,
  /** 旁白用的名称，默认装饰性（aria-hidden） */
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <img
      src={appIcon}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={cx('size-8 shrink-0 select-none object-contain', className)}
    />
  );
}
