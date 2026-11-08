import { useCallback, useRef, useState } from 'react';
import { RotateCcw, Move } from 'lucide-react';
import { cx } from '../../lib/utils';
import { useStore } from '../../lib/store';
import type { CustomBackground } from '../../lib/types';

/**
 * 自定义背景图的「显示范围」调节器
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求：「加自定义图片位置可预览调节（调整显示范围）」。
 *
 * 设计要点：
 *  1. **真背景就是预览** —— 拖动时直接改 store，页面背景（canvas）立刻重画，
 *     所以用户看到的是最终效果，不是一个近似的示意图。这个小方框只是"看得更清楚"的辅助。
 *  2. 语义与 canvas 完全一致，避免"预览对、真机不对"：
 *       焦点 0..1：0=贴左/上、0.5=居中、1=贴右/下     → 对应 CSS `object-position: X% Y%`
 *       zoom：在 cover 基础上的额外放大，≥1
 *  3. 缺省（0.5/0.5/1）= 加这个功能之前的居中 cover，**逐像素一致**（零回归）。
 *  4. 拖动用 rAF 合并：pointermove 比帧快得多，不合并会每像素重画一次整张背景。
 */
export function BackgroundFocusEditor({ item }: { item: CustomBackground }) {
  const patchBackground = useStore((s) => s.patchBackground);
  const current = useStore((s) => s.background.current);
  const isActive = current === `img:${item.id}`;

  const focusX = item.focusX ?? 0.5;
  const focusY = item.focusY ?? 0.5;
  const zoom = item.zoom ?? 1;

  const [dragging, setDragging] = useState(false);
  /*
   * ⚠️ 拖动标志必须用 ref，**不能用 state 判逻辑**。
   * 踩过的坑：原来 `if (!dragging) return` 读的是 state，而 setDragging(true) 在同一任务里
   * 不会立刻生效 —— 于是紧跟着的 pointermove 全被拦掉，拖不动。
   * 真实手指拖动时事件间隔稍大、碰巧能过一两帧，但快速拖动（尤其 Playwright 的
   * 连续 mouse.move、真机上的一次滑动）会整段丢失。state 只留给鼠标样式。
   */
  const draggingRef = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const commit = useCallback(
    (nextX: number, nextY: number) => {
      const custom = useStore.getState().background.custom.map((c) =>
        c.id === item.id ? { ...c, focusX: nextX, focusY: nextY } : c,
      );
      patchBackground({ custom });
    },
    [item.id, patchBackground],
  );

  const flush = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) commit(p.x, p.y);
  }, [commit]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    lastRef.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const last = lastRef.current;
    if (!last) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    /*
     * 拖动方向与"图跟着手走"一致：
     * 手往右拖 → 露出图的左边部分 → focusX 变小（贴左）。
     * 所以增量取负。可视区域按预览框尺寸换算成 0..1。
     */
    const dx = -(e.clientX - last.x) / box.width;
    const dy = -(e.clientY - last.y) / box.height;
    lastRef.current = { x: e.clientX, y: e.clientY };

    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    pendingRef.current = {
      x: clamp((pendingRef.current?.x ?? focusX) + dx),
      y: clamp((pendingRef.current?.y ?? focusY) + dy),
    };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush);
  };

  const onPointerUp = () => {
    draggingRef.current = false;
    setDragging(false);
    lastRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    flush();
  };

  const setZoom = (next: number) => {
    const custom = useStore.getState().background.custom.map((c) =>
      c.id === item.id ? { ...c, zoom: next } : c,
    );
    patchBackground({ custom });
  };

  const reset = () => {
    const custom = useStore.getState().background.custom.map((c) =>
      c.id === item.id ? { ...c, focusX: 0.5, focusY: 0.5, zoom: 1 } : c,
    );
    patchBackground({ custom });
  };

  const moved = focusX !== 0.5 || focusY !== 0.5 || zoom !== 1;

  return (
    <div className="mt-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-sunken)] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[0.72rem] font-medium text-secondary">
          <Move className="size-3.5" />
          显示范围
        </span>
        <button
          type="button"
          onClick={reset}
          disabled={!moved}
          className={cx(
            'flex min-h-9 items-center gap-1 rounded-lg px-2 text-[0.7rem] transition-colors',
            moved ? 'text-secondary hover:text-[var(--text)]' : 'text-tertiary opacity-50',
          )}
        >
          <RotateCcw className="size-3.5" />
          复位
        </button>
      </div>

      <div
        ref={boxRef}
        role="application"
        aria-label={`调整 ${item.name} 的显示范围（拖动）`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cx(
          'relative h-24 w-full touch-none overflow-hidden rounded-lg border border-[var(--line)]',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        style={{ background: 'var(--bg-base)' }}
      >
        <img
          src={item.dataUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full select-none"
          style={{
            objectFit: 'cover',
            // 与 canvas 的 (w-dw)*focus 同源：0% 贴左、50% 居中、100% 贴右
            objectPosition: `${focusX * 100}% ${focusY * 100}%`,
            transform: `scale(${zoom})`,
            transformOrigin: `${focusX * 100}% ${focusY * 100}%`,
          }}
        />
        {isActive && (
          <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[0.62rem] text-white">
            正在使用
          </span>
        )}
      </div>

      <label className="mt-2 flex min-h-11 items-center gap-2.5">
        <span className="shrink-0 text-[0.72rem] text-secondary">放大</span>
        <input
          type="range"
          min={1}
          max={2.5}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label={`${item.name} 放大倍数`}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--line)]"
        />
        <span className="tnum w-10 shrink-0 text-right text-[0.7rem] text-tertiary">{zoom.toFixed(1)}×</span>
      </label>

      <p className="mt-1 text-[0.7rem] leading-relaxed text-tertiary">
        拖动小图选择要露出的部分，页面背景会**同时**变化 —— 这里看到的就是最终效果。
      </p>
    </div>
  );
}
