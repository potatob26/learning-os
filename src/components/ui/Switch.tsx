import { cx } from '../../lib/utils';

/** 触控友好的开关 */
export function Switch({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-opacity duration-200',
        disabled && 'opacity-45',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[0.88rem] font-medium">{label}</span>
        {desc && <span className="block text-[0.7rem] leading-snug text-tertiary">{desc}</span>}
      </span>
      <span
        className={cx(
          'relative inline-block h-[1.65rem] w-[2.85rem] shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)]',
        )}
      >
        <span
          className="absolute top-[0.15rem] size-[1.35rem] rounded-full bg-white shadow-sm transition-[left] duration-200 ease-[var(--ease-soft)]"
          style={{ left: checked ? '1.35rem' : '0.15rem' }}
        />
      </span>
    </button>
  );
}
