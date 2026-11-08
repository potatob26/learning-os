import type { ReactNode } from 'react';
import { useStore } from '../../lib/store';

/* ==========================================================================
   「重要日期」模块的独立背景
   ──────────────────────────────────────────────────────────────────────────
   只作用于这一个模块 —— 首页那块倒计时卡，以及设置里的重要日期区。
   与全局背景互不影响：模块用自己的图、自己的压暗程度。

   图片复用「设置 → 背景」里用户已经上传的图（background.custom），
   不额外占一份存储；用户没上传过就没得选，此时本组件直接透传 children，
   不产生任何多余 DOM。

   压暗层是必须的：模块上面压着大号倒计时数字和文字，
   背景图不压暗就会把字吃掉。压暗程度由用户调（0~0.8），
   默认 0.25 —— 既能看出图，也不影响读数。
   ========================================================================== */

export function DateModuleBackground({ children }: { children: ReactNode }) {
  const cfg = useStore((s) => s.settings.dateModuleBackground);
  const custom = useStore((s) => s.background.custom);

  const img = cfg?.imageId ? custom.find((c) => c.id === cfg.imageId) : null;
  // 没设背景、或选中的图已被用户删掉 → 原样透传，不套任何容器
  if (!img) return <>{children}</>;

  /*
   * 显示范围：模块自己的取景优先，否则沿用这张图在图库里的取景
   * （即「设置 → 背景 → 调整显示范围」里调的那组值）。都没有 = 居中 cover。
   * 语义与 BackgroundFocusEditor 的预览逐条一致，避免"预览一个样、真身另一个样"。
   */
  const focusX = cfg?.focusX ?? img.focusX ?? 0.5;
  const focusY = cfg?.focusY ?? img.focusY ?? 0.5;
  const zoom = cfg?.zoom ?? img.zoom ?? 1;

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-card)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover"
        style={{
          backgroundImage: `url(${img.dataUrl})`,
          backgroundPosition: `${focusX * 100}% ${focusY * 100}%`,
          transform: zoom !== 1 ? `scale(${zoom})` : undefined,
          transformOrigin: `${focusX * 100}% ${focusY * 100}%`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black"
        style={{ opacity: Math.min(0.8, Math.max(0, cfg?.dim ?? 0.25)) }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
