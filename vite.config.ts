import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

/** 版本号唯一来源：package.json。构建期注入，避免代码里再手写一份。 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

/**
 * 安卓 `versionCode` —— 更新检测**只能比整数，不能比版本名字符串**。
 *
 * 单一来源是 `android/app/build.gradle`（`scripts/release.mjs` 发版时递增它），
 * 这里在构建期解析出来注入，避免代码里再手写一份（本项目因手写版本号导致过三次测试腐烂）。
 * 纯 Web 构建或文件缺失时回落到 0：**更新检测在 Web 上本来也不该提示装 APK**，
 * 回落到 0 只会让"服务器清单里的 code 更大"从而可能提示 —— 所以下面还会判断平台。
 */
function readAndroidVersionCode(): number {
  try {
    const gradle = readFileSync(
      new URL('./android/app/build.gradle', import.meta.url),
      'utf-8',
    );
    const m = gradle.match(/versionCode\s+(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/**
 * 是否在为安卓 APK 构建。
 * 用 `VITE_TARGET=android npm run build` 触发。
 *
 * 安卓包内的资源本来就随安装包一起分发、由本地服务提供，
 * Service Worker 不会带来任何离线收益，反而会让「升级后仍加载旧资源」，
 * 所以这个构建里直接关掉 PWA 插件。
 */
const isAndroid = process.env.VITE_TARGET === 'android';

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_VERSION_CODE__: JSON.stringify(readAndroidVersionCode()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    /*
     * 联网功能的端点地址：**构建期默认值**，运行时还能覆盖（见 lib/endpoints.ts）。
     * 为什么必须可注入：测试要指向本地 mock 服务器，否则用例依赖真网络、不可复现。
     * 留空（默认）时相关功能**静默禁用**，不报错。
     */
    __UPDATE_MANIFEST_URL__: JSON.stringify(process.env.VITE_UPDATE_MANIFEST_URL ?? ''),
    __FEEDBACK_URL__: JSON.stringify(process.env.VITE_FEEDBACK_URL ?? ''),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // 强制 React 只有一份实例。
    // 依赖里若有组件库自带 react 依赖，Vite 会为它单独预打包一份 React，
    // 运行时就会出现 "Invalid hook call / more than one copy of React"。
    dedupe: ['react', 'react-dom'],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 安卓包内不需要 Service Worker（理由见上方 isAndroid 注释）
      disable: isAndroid,
      registerType: 'autoUpdate',
      includeAssets: ['favicon-96.png', 'apple-touch-icon.png'],
      manifest: {
        name: '学习 OS',
        short_name: '学习 OS',
        description: '今天该做什么、还能学多久、实际学了多少、距离目标还有多远。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f7f9',
        theme_color: '#f6f7f9',
        categories: ['education', 'productivity'],
        icons: [
          // manifest 图标全部用 WebP：同尺寸下比 PNG 小约 19 倍，
          // 实测 512 PNG 362KB → WebP 18.7KB，对手机端的预缓存影响很大。
          // 本应用依赖 React 19 / WebGL / color-mix，能运行的浏览器必然支持 WebP。
          { src: 'icons/icon-192.webp', sizes: '192x192', type: 'image/webp' },
          { src: 'icons/icon-512.webp', sizes: '512x512', type: 'image/webp' },
          {
            src: 'icons/icon-maskable-512.webp',
            sizes: '512x512',
            type: 'image/webp',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2020',
    cssTarget: 'chrome80',
    reportCompressedSize: false,
  },
});
