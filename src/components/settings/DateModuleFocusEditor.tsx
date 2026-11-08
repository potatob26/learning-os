import { useCallback, useRef, useState } from 'react';
import { Move, RotateCcw } from 'lucide-react';
import { cx } from '../../lib/utils';
import { useStore } from '../../lib/store';
import { useNow } from '../../hooks/useNow';
import { DateModuleBackground } from '../home/DateModuleBackground';
import { CountdownCard } from '../home/CountdownCard';
import type { CustomBackground } from '../../lib/types';

/* ==========================================================================
   「重要日期」模块背景的「显示范围」调节器
   ──────────────────────────────────────────────────────────────────────────
   用户要求：「加重要日期自定义图片位置可预览调节」。

   为什么要有这个文件（而不是直接用「设置 → 背景」里那个调节器）：
   BackgroundFocusEditor 改的是**图库级**的 CustomBackground.focusX/focusY/zoom，
   那组值同时也是**全局背景**（canvas 逐像素绘制、折射主题还要读它）的取景 ——
   在这个模块里改它，会顺手把整个 App 的背景一起改掉。
   而 types.ts 里的 settings.dateModuleBackground 早就留了模块自己的
   focusX/focusY/zoom，DateModuleBackground 也一直在读 ——
   但**全仓库没有任何地方写这三个值**，所以"只调重要日期这一块"根本做不到。
   这个组件补的就是那个缺口。

   两个硬约束：
   1. **预览必须就是真身**：预览框里直接渲染
      <DateModuleBackground> + 真正的 <CountdownCard>，
      取景数学与首页那块卡完全同源，不可能出现"预览一个样、真身另一个样"。
      （内容用 pointer-events-none 关掉交互，否则卡片会抢走拖动手势。）
   2. 缺省时**继续沿用图库那张图的取景**（不写死 0.5/0.5），
      所以第一次拖动要从"当前生效值"续上，避免一碰就跳。
   ========================================================================== */

export function DateModuleFocusEditor({ item }: { item: CustomBackground }) {
  const settings = useStore((s) => s.settings);
  const patchSettings = useStore((s) => s.patchSettings);
  const dates = useStore((s) => s.dates);
  const ts = useNow();

  const cfg = settings.dateModuleBackground ?? { imageId: null, dim: 0.25 };
  const setCfg = (patchCfg: Partial<typeof cfg>) =>
    patchSettings({ dateModuleBackground: { ...cfg, ...patchCfg } });

  // 与 DateModuleBackground 完全一致的取值顺序：模块自己的 → 图库那张的 → 居中 cover
  const focusX = cfg.focusX ?? item.focusX ?? 0.5;
  const focusY = cfg.focusY ?? item.focusY ?? 0.5;
  const zoom = cfg.zoom ?? item.zoom ?? 1;

  const [dragging, setDragging] = useState(false);
  /* 拖动标志用 ref，不能用 state 判逻辑 —— 与 BackgroundFocusEditor 同一个坑：
     setDragging(true) 在同一任务里不生效，紧跟的 pointermove 会被整段拦掉。 */
  const draggingRef = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) {
      const cur = useStore.getState().settings.dateModuleBackground ?? { imageId: null, dim: 0.25 };
      patchSettings({ dateModuleBackground: { ...cur, focusX: p.x, focusY: p.y } });
    }
  }, [patchSettings]);

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
    /* 与 BackgroundFocusEditor 同一套语义：手往右拖 → 露出图的左边 → focusX 变小，
       所以增量取负；换算用预览框尺寸。 */
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

  const moved = focusX !== 0.5 || focusY !== 0.5 || zoom !== 1;

  return (
    <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-sunken)] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[0.72rem] font-medium text-secondary">
          <Move className="size-3.5" />
          显示范围（只调这块卡片）
        </span>
        <button
          type="button"
          onClick={() => setCfg({ focusX: 0.5, focusY: 0.5, zoom: 1 })}
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

      {/* 预览 = 真身：同一个 DateModuleBackground + 同一个 CountdownCard。
          内容层关掉指针事件，拖动手势才不会被卡片吃掉。 */}
      <div
        ref={boxRef}
        role="application"
        aria-label="拖动调整「重要日期」模块背景的显示范围"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cx(
          'relative touch-none overflow-hidden rounded-lg border border-[var(--line)]',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div className="pointer-events-none select-none">
          <DateModuleBackground>
            <CountdownCard items={dates} nowTs={ts} />
          </DateModuleBackground>
        </div>
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[0.62rem] text-white">
          预览
        </span>
      </div>

      <label className="mt-2 flex min-h-11 items-center gap-2.5">
        <span className="shrink-0 text-[0.72rem] text-secondary">放大</span>
        <input
          type="range"
          min={1}
          max={2.5}
          step={0.01}
          value={zoom}
          onChange={(e) => setCfg({ zoom: Number(e.target.value) })}
          aria-label="重要日期模块背景放大倍数"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--line)]"
        />
        <span className="tnum w-10 shrink-0 text-right text-[0.7rem] text-tertiary">
          {zoom.toFixed(1)}×
        </span>
      </label>

      <p className="mt-1 text-[0.7rem] leading-relaxed text-tertiary">
        拖动上面这块预览选要露出的部分，你看到的就是首页那张卡的样子。
        没调过时沿用「设置 → 背景」里给这张图设的显示范围；这里调完只影响「重要日期」模块。
      </p>
    </div>
  );
}
