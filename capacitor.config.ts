import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置：把已有的 Web 应用包成安卓 APK
 * ──────────────────────────────────────────────────────────────
 * 用 Capacitor 而不是重写原生应用的原因：
 * 这个应用本身已是完整的响应式 Web 应用（含 PWA、离线、本地存储），
 * Capacitor 只是把它装进一个原生 WebView 外壳，代码零改动，
 * 后续 Web 与安卓可以同步维护。
 *
 * 关于 Service Worker：Web 端用它做离线缓存，但在 APK 里资源本来就
 * 打包在安装包内、由本地服务提供，SW 只会带来「更新后仍旧资源」的风险，
 * 因此在安卓构建里关掉注册（见 vite.config.ts 的 VITE_TARGET=android）。
 */
const config: CapacitorConfig = {
  appId: 'com.learningos.app',
  appName: '学习 OS',
  webDir: 'dist',
  // 应用完全离线可用，不需要允许混合内容
  android: {
    allowMixedContent: false,
    // 背景色与主题一致，避免启动瞬间白屏
    backgroundColor: '#151b30',
  },
  server: {
    // 使用 https://localhost 作为源：
    // localStorage / IndexedDB 需要稳定的源，否则升级后会丢数据
    androidScheme: 'https',
  },
  /*
   * ⚠️ 必须显式启用，否则 netHttp.ts 里那条"原生通道"是不存在的。
   *
   * 2026-10-05 真机发现：没启用时，CapacitorHttp.get/post 拿不到原生实现，
   * 三方域名请求（时间校准 / 版本清单 / 意见箱）在 https://localhost 下被 CORS 拦掉 ——
   * 设置页永远显示「时间未校准」，版本检测与意见箱静默失败。
   * 而浏览器里跑的是普通 fetch 分支，所以 netHttp 三个测试全绿也发现不了。
   * 这就是 netHttp.ts 文件头那句「这条路径只能在真机/模拟器里验」的代价。
   */
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
