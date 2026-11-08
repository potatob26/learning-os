import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert, Download } from 'lucide-react';

/**
 * 全局错误边界（要求四十二：不能白屏）
 * ──────────────────────────────────────────────
 * 任何渲染期异常都会被这里接住，并且：
 *   1. 告诉用户发生了什么，而不是留一个空白页
 *   2. 提供「重新加载」与「导出数据」两个出口，数据不会因为崩溃而丢
 *   3. 崩溃信息只留在本机控制台，不上传
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? null });
    // 只写本地控制台，方便用户自己排查；不上报任何服务器
    console.error('[学习 OS] 渲染异常：', error, info.componentStack);
  }

  private exportData = () => {
    try {
      const raw = localStorage.getItem('learning-os:v1:state');
      if (!raw) return;
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `学习OS-崩溃前数据-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      /* 隐私模式下可能失败，忽略 */
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page-x grid min-h-dvh place-items-center py-10">
        <div className="mica w-full max-w-md rounded-[var(--radius-card)] p-5">
          <div className="mb-3 flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--warn-soft)] text-[var(--warn-text)]">
              <TriangleAlert className="size-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">页面出了点问题</h1>
              <p className="mt-0.5 text-xs leading-relaxed text-secondary">
                你的学习数据仍然保存在本机，没有丢失。重新加载通常就能恢复。
              </p>
            </div>
          </div>

          <pre className="no-scrollbar mb-3 max-h-28 overflow-auto rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.7rem] leading-relaxed text-tertiary">
            {error.message}
          </pre>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--primary-bg)] font-medium text-[var(--on-accent)] active:scale-[0.98]"
            >
              <RefreshCw className="size-4" />
              重新加载
            </button>
            <button
              type="button"
              onClick={this.exportData}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-sunken)] font-medium active:scale-[0.98]"
            >
              <Download className="size-4" />
              导出数据
            </button>
          </div>
        </div>
      </div>
    );
  }
}
