import { useEffect, useState } from 'react';
import { HardDrive, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import { hasLocalStorage } from '../../lib/storage';
import { IconButton } from '../ui/Button';

/**
 * 存储降级提示（要求四十二）
 * 隐私模式 / 存储配额用尽 / 写入被拒绝时，用户必须知道
 * 「现在记的东西可能保不住」，而不是等到下次打开才发现全没了。
 */
export function StorageNotice() {
  const health = useStore((s) => s.storageHealth);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    if (!hasLocalStorage || health === 'memory') {
      const t = setTimeout(() => setVisible(true), 900);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [health, dismissed]);

  if (!visible || dismissed) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md anim-rise lg:bottom-6"
      role="status"
    >
      <div className="lg-surface liquid-glass liquid-glass--static flex items-start gap-3 rounded-2xl p-3">
        <span className="mt-0.5 grid size-11 shrink-0 place-items-center rounded-full bg-[var(--warn-soft)] text-[var(--warn-text)]">
          <HardDrive className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.85rem] font-medium leading-snug">浏览器不允许保存数据</p>
          <p className="mt-0.5 text-xs leading-relaxed text-secondary">
            可能处于无痕/隐私模式，或存储空间已满。这次填写的内容在关闭页面后会丢失。
          </p>
        </div>
        <IconButton label="知道了" size="sm" onClick={() => setDismissed(true)} className="-mr-1 -mt-1">
          <X className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
