import type { ReactNode } from 'react';
import { Sheet } from './Sheet';

/* ==========================================================================
   图片放大查看
   ──────────────────────────────────────────────────────────────────────────
   设置里的缩略图只有 100 出头像素，选图前想先看清原图；首页套了背景图的
   「重要日期」模块，也想点一下看大图。两处共用这一个组件。

   为什么复用 Sheet 而不是另写一个全屏遮罩：
   弹层最难的部分（焦点陷阱、ESC/遮罩关闭、打开时底层 inert、底部安全区、
   液态玻璃主题下的折射背板）Sheet 都已经处理好并且有测试覆盖
   （test-sheets / test-focus / test-dialog-hit）。另起一套只会重复踩坑。

   图片用 object-contain + max-h 约束：只按比例放大到装得下，
   不裁切、不拉伸 —— 用户要看的是原图，不是被裁过的图。
   ========================================================================== */

export function ImageViewer({
  open,
  onClose,
  src,
  title,
  caption,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  /** 图片地址；为空时不渲染任何东西（避免弹出一个空壳） */
  src: string | null;
  title?: string;
  caption?: string;
  /** 底部操作区，例如「使用这张」「设置重要日期」 */
  actions?: ReactNode;
}) {
  if (!open || !src) return null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={title ?? '查看图片'}
      description={caption}
      size="tall"
      footer={actions}
    >
      <img
        src={src}
        alt={title ? `${title} 大图` : '背景图大图'}
        className="mx-auto block max-h-[58dvh] w-auto max-w-full rounded-2xl object-contain"
      />
    </Sheet>
  );
}
