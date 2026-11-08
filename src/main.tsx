import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import './styles/index.css';
import { applyThemeEarly } from './hooks/useTheme';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { ensureGlassFilter } from './lib/glass';
import { useStore } from './lib/store';
import { useTimeStore } from './lib/netTime';

// 在 React 挂载前先把主题打到 <html>，避免首帧白闪
applyThemeEarly();

// 注入透明玻璃的 SVG 位移滤镜。
// 必须尽早执行：CSS 里的 backdrop-filter: url(#liquid-glass-filter)
// 一旦引用不到这个滤镜，整个 backdrop-filter 会失效并退回纯色底。
ensureGlassFilter();

// 开发期调试入口：方便在 DevTools / 自动化测试里读取真实状态
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__LOS__ = { useStore, useTimeStore };
}

const rootEl = document.getElementById('root');

if (!rootEl) {
  // 连挂载点都没有时也不能白屏，直接给出可读提示
  document.body.innerHTML =
    '<div style="padding:24px;font-family:system-ui,sans-serif;line-height:1.6">' +
    '<h1 style="font-size:18px;margin:0 0 8px">页面结构异常</h1>' +
    '<p style="color:#666;font-size:14px">缺少 #root 容器，请重新加载页面。</p>' +
    '</div>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <App />
        </HashRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}

// 兜底：未捕获的 Promise 异常不会让页面白屏，但要留下可查的痕迹
window.addEventListener('unhandledrejection', (e) => {
  console.error('[学习 OS] 未处理的异步异常：', e.reason);
});
