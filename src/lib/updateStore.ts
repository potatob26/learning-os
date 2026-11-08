/**
 * 「发现新版本」的临时状态
 * ──────────────────────────────────────────────────────────────────────────────
 * 为什么不放进主存档（`lib/store.ts`）：这不是用户数据，而是**本次运行期**的一件临时事。
 * 放进存档会被导出/导入带走、还会被"清空数据"牵连，都不对。
 * 已提醒过的版本号记在 localStorage（见 updateCheck.markSeen），那才是需要跨启动记住的。
 *
 * 用 zustand 而不是 React state：检测在 App 的 effect 里发起、弹层在树的另一处渲染，
 * 两者之间需要一个共享的地方，而不是层层传 props。
 */

import { create } from 'zustand';
import type { UpdateManifest } from './updateCheck';

interface UpdateState {
  /** 有值得提醒的新版本；null = 不提醒 */
  pending: UpdateManifest | null;
  /** 是否属于"低于最低支持版本"（文案会更强，但**仍然只是引导**，装不了就是装不了） */
  required: boolean;
  setPending: (manifest: UpdateManifest | null, required?: boolean) => void;
  clear: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  pending: null,
  required: false,
  setPending: (manifest, required = false) => set({ pending: manifest, required }),
  clear: () => set({ pending: null, required: false }),
}));
