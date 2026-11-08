import { cx } from '../../lib/utils';
import { Logo } from '../ui/Logo';

/** 首次加载 / 数据恢复中的占位，避免白屏（要求四十二） */
export function Splash({ message }: { message?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-8">
      <div className="flex flex-col items-center gap-4">
        <Logo className="size-14 anim-pop" />
        <div className={cx('w-40')}>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <div
              className="h-full w-1/2 rounded-full"
              style={{
                background: 'var(--accent)',
                animation: 'sheen 1.1s linear infinite',
                backgroundSize: '200% 100%',
              }}
            />
          </div>
          <p className="mt-3 text-center text-sm text-secondary">{message ?? '正在读取本地数据…'}</p>
        </div>
      </div>
    </div>
  );
}
