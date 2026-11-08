/**
 * 应用版本信息
 * ──────────────────────────────────────────────────────────────
 * 版本号的唯一来源是 package.json，由 vite.config.ts 在构建期注入，
 * 避免代码里再手写一份导致两处不一致。
 */

/** 语义化版本，例如 "1.0.0" */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/**
 * 安卓 versionCode（整数）。
 * 更新检测**只比这个整数**，不比 `APP_VERSION` 字符串 ——
 * 字符串比较会遇到 "1.10.0" < "1.9.0" 这种荒谬结果。
 * 来源是 `android/app/build.gradle`，同样由构建期注入。
 */
export const APP_VERSION_CODE: number =
  typeof __APP_VERSION_CODE__ === 'number' ? __APP_VERSION_CODE__ : 0;

/** 构建时间（ISO 字符串） */
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

/** 展示用版本号，例如 "v1.0.0" */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

/** 构建时间的中文短格式，例如 "2026/9/12 18:02" */
export function formatBuildTime(iso: string = BUILD_TIME): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
