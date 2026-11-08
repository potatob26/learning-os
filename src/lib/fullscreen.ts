/* ==========================================================================
   全屏与屏幕方向
   ──────────────────────────────────────────────────────────────────────────
   两条铁律：
     1. **不假装成功**。浏览器拒绝时如实返回失败与原因，界面据此给提示，
        绝不写一个"看起来切了全屏其实没有"的按钮。
     2. **失败也要能用**。这两个 API 在部分环境（iOS Safari、桌面某些浏览器、
        非全屏状态下的方向锁）本来就不可用；专注模式必须能在没有它们的情况下
        照常工作，所以这里返回的是结果对象而不是抛异常。
   ========================================================================== */

export interface AttemptResult {
  ok: boolean;
  /** 失败原因，用于界面如实提示 */
  reason?: string;
}

/** 把浏览器的 DOMException 翻成人话，便于如实告诉用户 */
function explain(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
      return '浏览器要求由点击直接触发，或当前不允许全屏';
    case 'NotSupportedError':
      return '当前浏览器不支持这个操作';
    case 'InvalidStateError':
      return '需要先进入全屏才能锁定方向';
    case 'TypeError':
      return '当前环境不支持';
    default:
      return (err as { message?: string })?.message?.slice(0, 60) ?? '未知原因';
  }
}

/* ---------------- 全屏 ---------------- */

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as FsElement;
  return Boolean(document.fullscreenEnabled || el.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.fullscreenElement ?? (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
}

/**
 * 进入全屏。失败时返回原因，不抛异常。
 *
 * ⚠️ **必须校验调用后的真实状态**。
 * Android WebView 上实测：`requestFullscreen()` 会**正常 resolve 但并没有真的进入全屏**
 * （fullscreenElement 仍为 null、视口高度不变）。若只凭「没抛错」就返回成功，
 * 界面就不会给出任何提示 —— 那正是"假全屏"。
 * 所以这里以 isFullscreen() 的实际结果为准。
 */
export async function enterFullscreen(target?: HTMLElement): Promise<AttemptResult> {
  const el = (target ?? document.documentElement) as FsElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return { ok: false, reason: '当前浏览器不支持全屏' };

    // 给宿主一点时间完成切换再判定
    if (!isFullscreen()) await new Promise((r) => setTimeout(r, 120));
    if (!isFullscreen()) {
      return { ok: false, reason: '当前环境未能真正进入全屏（应用外壳可能未实现全屏宿主）' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: explain(err) };
  }
}

/** 退出全屏。失败时忽略 —— 退出失败不影响继续使用。 */
export async function exitFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch {
    /* 退出失败无需打扰用户 */
  }
}

/* ---------------- 屏幕方向 ---------------- */

interface OrientationApi {
  lock?: (o: string) => Promise<void>;
  unlock?: () => void;
}

function orientationApi(): OrientationApi | null {
  if (typeof screen === 'undefined') return null;
  return (screen as unknown as { orientation?: OrientationApi }).orientation ?? null;
}

/**
 * 是否**有机会**锁定方向。
 * 注意这只是能力探测：能否成功还取决于是否处于全屏、以及设备是否允许。
 * 所以界面上的横屏按钮不能因为这里返回 true 就当作一定成功。
 */
export function orientationLockSupported(): boolean {
  return typeof orientationApi()?.lock === 'function';
}

/** 尝试锁定横屏。同样以**实际方向**为准，而不是"没抛错就算成功"。 */
export async function lockLandscape(): Promise<AttemptResult> {
  const api = orientationApi();
  if (!api?.lock) return { ok: false, reason: '当前浏览器不支持锁定屏幕方向' };
  try {
    await api.lock('landscape');
    // 方向切换需要一点时间；给宿主 250ms 再判定
    await new Promise((r) => setTimeout(r, 250));
    const type = screen.orientation?.type ?? '';
    if (!type.startsWith('landscape')) {
      return { ok: false, reason: '系统未接受方向锁定（可能已关闭自动旋转，或设备不支持）' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: explain(err) };
  }
}

/** 解除方向锁定；失败忽略（例如本来就没锁） */
export async function unlockOrientation(): Promise<void> {
  try {
    orientationApi()?.unlock?.();
  } catch {
    /* 忽略 */
  }
}
