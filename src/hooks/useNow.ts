import { useTimeStore } from '../lib/netTime';

/** 校准后的当前时间戳（每秒更新一次） */
export function useNow(): number {
  return useTimeStore((s) => s.ts);
}
