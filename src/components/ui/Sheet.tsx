import { useLayoutEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../../lib/utils';
import { IconButton } from './Button';
import { GlassSurface } from './GlassSurface';
import { RefractPanel } from '../glass/RefractPanel';
import { useIsRefractTheme } from '../../lib/material';
import { mountModal } from '../../lib/modal-stack';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** 底部固定操作区 */
  footer?: ReactNode;
  /** 宽屏下居中显示为上浮卡片，手机上是底部弹层 */
  size?: 'auto' | 'tall';
}

/**
 * 底部弹层（移动端首选模态）
 * ──────────────────────────────────────────────────────────────
 * 必须用 Portal 挂到 document.body 下，**不能留在页面树里**。
 *
 * 原因（实测得到的教训）：弹层原先渲染在 <main> 内部，
 * 结果被底部导航（z-40）盖住 —— 取消/确认按钮点不到，点下去会跳到「目标」页。
 * 诡异的是：把导航的 z-index 改成 0 也依然被盖住，说明两者根本不在
 * 同一个层叠上下文里比较，单纯加 z-index 解决不了。
 * 排查过 transform / filter / isolation / will-change / contain /
 * container-type / opacity / mix-blend 全部为默认，仍未定位到具体是哪个祖先
 * 创建了层叠上下文。因此改用结构性方案：把弹层移出页面树，
 * 从根上不再依赖「祖先链干不干净」这件事。
 *
 * Portal 同时解决了另外几个隐患：
 *   · 弹层不再被祖先的 overflow: hidden 裁剪
 *   · 祖先若有 transform，fixed 定位不会被它改变参照系
 *   · 未来任何页面级布局改动都不会再影响弹层层级
 *
 * 其他要点：
 *   · 手机端从底部滑入，拇指可达
 *   · 内部滚动，不带着页面一起滚
 *   · 底部安全区域适配，安卓虚拟导航栏不遮挡按钮
 *   · ESC / 点击遮罩关闭
 */
export function Sheet({ open, onClose, title, description, children, footer, size = 'auto' }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const wasOpen = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  // 必须在新表单的 autoFocus 执行前记住入口按钮。
  if (open && !wasOpen.current) {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;
  // 液态玻璃主题下弹层要用自己的折射背板（见下面说明）
  const refract = useIsRefractTheme();

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !panelRef.current) return;
    return mountModal(rootRef.current, panelRef.current, () => closeRef.current(), triggerRef.current);
  }, [open, refract]);

  if (!open) return null;

  /**
   * 面板内容。抽成变量是因为要交给两种不同的材质容器：
   * 普通主题走 GlassSurface，液态玻璃主题走 RefractPanel。
   */
  const panelBody = (
    <div ref={panelRef} tabIndex={-1} className="flex max-h-[90dvh] flex-col outline-none sm:max-h-[86dvh]">
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--line-strong)] sm:hidden" />

      {(title || description) && (
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0">
            {title && <h2 id={titleId} className="truncate text-lg font-semibold tracking-tight">{title}</h2>}
            {description && (
              <p id={descId} className="mt-0.5 text-sm text-secondary">
                {description}
              </p>
            )}
          </div>
          <IconButton label="关闭" onClick={onClose} className="-mr-2 -mt-1">
            <X className="size-5" />
          </IconButton>
        </div>
      )}

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        {children}
      </div>

      {footer && (
        <div className="shrink-0 border-t border-[var(--line)] bg-[var(--surface-strong)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {footer}
        </div>
      )}
    </div>
  );

  const panelBox = cx(
    'anim-rise w-full',
    'rounded-t-[1.75rem] sm:max-w-lg sm:rounded-[1.75rem]',
    // 高度上限：留出顶部状态栏，且保证底部操作区永远在屏幕内
    'max-h-[90dvh] sm:max-h-[86dvh]',
    size === 'tall' && 'min-h-[62dvh]',
  );

  const node = (
    <div
      ref={rootRef}
      data-sheet
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
    >
      <button
        type="button"
        aria-label="关闭"
        className="sheet-backdrop anim-fade absolute inset-0 cursor-default"
        onClick={onClose}
      />
      {refract ? (
        /* 液态玻璃主题：弹层不能走页面那层玻璃 ——
           它在 z-0，会被弹层自己的遮罩盖住。
           所以用 RefractPanel 给弹层做一块自己的来源画布。 */
        <RefractPanel radius={28} className={panelBox} style={{ boxShadow: 'var(--shadow-lg)' }}>
          {panelBody}
        </RefractPanel>
      ) : (
        <GlassSurface radius={28} className={cx(panelBox, 'overflow-hidden')} style={{ boxShadow: 'var(--shadow-lg)', background: 'var(--surface-strong)' }}>
          {panelBody}
        </GlassSurface>
      )}
    </div>
  );

  // 挂到 body 下，彻底脱离页面树的层叠与裁剪
  return createPortal(node, document.body);
}

/** 二次确认（危险操作），手机上也用底部弹层 */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmText = '确认',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={message}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 flex-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-sunken)] font-medium active:scale-[0.98]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={cx(
              'min-h-12 flex-1 rounded-2xl font-medium active:scale-[0.98]',
              // 两种确认都走令牌：浅色主题压深底色 + 白字，深色主题浅底 + 深字，
              // 避免白字压浅色底只有 2.4:1
              danger
                ? 'bg-[var(--danger-bg)] text-[var(--on-danger)]'
                : 'bg-[var(--primary-bg)] text-[var(--on-accent)]',
            )}
          >
            {confirmText}
          </button>
        </div>
      }
    >
      <div className="h-2" />
    </Sheet>
  );
}
