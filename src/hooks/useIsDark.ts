import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';

/** 当前实际是否为深色（考虑「跟随系统」） */
export function useIsDark(): boolean {
  const colorMode = useStore((s) => s.settings.colorMode);
  const [sysDark, setSysDark] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (colorMode === 'dark') return true;
  if (colorMode === 'light') return false;
  return sysDark;
}
