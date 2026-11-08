import { useNow } from '../hooks/useNow';

/** 页面占位：Phase 7 起逐个替换为完整实现 */
export function PagePlaceholder({ title, note }: { title: string; note: string }) {
  const ts = useNow();
  return (
    <div className="space-y-4 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mica rounded-[var(--radius-card)] p-6 text-center">
        <p className="text-sm text-secondary">{note}</p>
        <p className="tnum mt-2 text-xs text-tertiary">
          当前校准时间 {new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })}
        </p>
      </div>
    </div>
  );
}
