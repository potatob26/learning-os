import { useEffect, useRef, useState } from 'react';
import type { ActiveTimer } from '../lib/types';

/**
 * 计时显示：用 requestAnimationFrame 局部刷新。
 * 关键：时间来自「真实时间戳差值」，不是每秒累加，
 * 所以切后台 / 锁屏 / 刷新 / 休眠回来之后数字依然正确（要求十二）。
 */
export function useElapsed(timer: ActiveTimer | null): number {
  const [ms, setMs] = useState(() => (timer ? compute(timer) : 0));
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!timer) {
      setMs(0);
      return;
    }
    let last = 0;
    const loop = (t: number) => {
      // 每 250ms 更新一次即可，足够顺滑又省电
      if (t - last > 250) {
        last = t;
        setMs(compute(timer));
      }
      raf.current = requestAnimationFrame(loop);
    };
    setMs(compute(timer));
    raf.current = requestAnimationFrame(loop);

    // 从后台回到前台时立刻纠正一次
    const onVis = () => setMs(compute(timer));
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [timer]);

  return ms;
}

/**
 * 计算已计时毫秒数。
 *
 * ⚠️ 必须用**原始时间** `Date.now()`，不能用校准时间 `nowExact()`。
 *
 * 为什么：时钟校准是**异步**完成的。应用刚启动时 offset 还是 0，
 * 计时器可能已经启动（startedAt 按当时的 offset 记录）；随后校时完成，
 * offset 变成真实偏移，nowExact() 会整体前跳 —— 于是
 * `nowExact() - startedAt` 凭空多出「整个偏移量」。
 * 实测本机时钟慢 60 秒时，刚开始的计时器会直接显示 01:05。
 *
 * 而**时长本身就是差值**，设备时钟哪怕整体偏了 60 秒，
 * 两个 Date.now() 的差依然准确 —— 校准是为了让「墙上时间」对，
 * 与「经过了多久」无关。所以这里用原始时间才是正确的。
 */
function compute(timer: ActiveTimer): number {
  const end = timer.pausedAt ?? Date.now();
  return Math.max(0, end - timer.startedAt - timer.pausedMs);
}
