/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * 构建期注入的常量（见 vite.config.ts 的 define）。
 * 版本号唯一来源是 package.json / build.gradle，避免多处手写导致不一致。
 */
declare const __APP_VERSION__: string;
/** 安卓 versionCode（整数）。更新检测只比它，不比版本名字符串 */
declare const __APP_VERSION_CODE__: number;
declare const __BUILD_TIME__: string;
/** 联网端点地址：留空 = 对应功能静默禁用（见 lib/endpoints.ts） */
declare const __UPDATE_MANIFEST_URL__: string;
declare const __FEEDBACK_URL__: string;
