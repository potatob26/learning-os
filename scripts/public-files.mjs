/**
 * 公开仓库/发布包的统一文件白名单
 * ──────────────────────────────────────────────────────────────
 * `package-release.mjs`（打 zip）与 `export-public-repo.mjs`（导干净历史仓库）
 * 必须用同一份排除表，否则「zip 里干净、仓库里不干净」这种事故迟早发生。
 */
export const EXCLUDE_EXACT = new Set([
  // 内部交接与待办
  '交接文档.md',
  'docs/还有啥没做.md',
  'docs/开源发布清单.md',
  // 个人法务/上架材料（软著、应用商店流程）
  'scripts/make-ruanzhu-materials.py',
  'scripts/make-listing-guide.py',
  // 内部设计流水（含旧设备信息）
  'docs/透明玻璃重构方案.md',
  // 真机调试脚本（写死过设备序列号/本机 SDK 路径）
  'scripts/verify-glass-dual.ps1',
  'scripts/verify-device.mjs',
  'scripts/verify-device2.mjs',
  'scripts/verify-emulator.mjs',
  'scripts/verify-apk.mjs',
  'scripts/verify-new-on-device.mjs',
  'scripts/diag-glass-layers.mjs',
  'scripts/diag-glass-edges.py',
  // 实验/对比页面（不属于应用本体）
  'glass-versus.html',
  'src/glass-versus.tsx',
  'scripts/icon-size-compare.mjs',
]);

export const EXCLUDE_PREFIX = [
  // 个人法务材料目录
  'docs/软著材料/',
  // 智谱协作提示词/任务/报告、阿里云 OSS + 飞书部署指引
  'docs/智谱',
  'docs/部署指引',
  // 1.2.x 旧更新日志（开发流水账，含本机路径/旧设备信息）
  'docs/UPDATE-v1.2.',
  // 内部诊断/探针脚本（CDP、实验页面、本机端口）
  'scripts/diag-',
  'scripts/diagnose-',
  'scripts/probe-',
  // 构建产物与本机配置
  'release/',
  'Promo/',
  '.preview/',
  'node_modules/',
  'dist/',
  'android/build/',
  'android/app/build/',
  'android/.gradle/',
  'android/capacitor-cordova-android-plugins/',
  'android/app/src/main/assets/public/',
];

export const EXCLUDE_SUFFIX = ['.jks', '.keystore'];

export function isPublicFile(file) {
  return !(
    EXCLUDE_EXACT.has(file) ||
    EXCLUDE_PREFIX.some((prefix) => file.startsWith(prefix)) ||
    EXCLUDE_SUFFIX.some((suffix) => file.endsWith(suffix)) ||
    file === 'android/local.properties'
  );
}
