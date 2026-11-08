import { Component, type ReactNode } from 'react';

/**
 * 透明玻璃的局部错误边界
 * ══════════════════════════════════════════════════════════════
 * liquid-glass-react 在个别参数/尺寸组合下会抛异常
 * （已实测：`shader` 模式会调用 createImageData 并抛
 *  "Failed to execute 'createImageData'"）。
 *
 * 这类异常发生在渲染提交阶段，会被 React 冒泡到最近的错误边界。
 * 如果没有局部边界，就会一路冒到全局 ErrorBoundary，
 * 结果是**整页变成错误提示** —— 对用户来说太严重了。
 *
 * 所以这里在玻璃外层加一道边界：库一旦出错，只把这块降级成云母材质，
 * 页面其余部分照常可用。
 */
interface Props {
  children: ReactNode;
  /** 出错时的降级渲染 */
  fallback: ReactNode;
  /** 出错时的回调，便于把该材质的自动降级记录下来 */
  onError?: () => void;
}

interface State {
  failed: boolean;
}

export class GlassGuard extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.warn('[学习 OS] 透明玻璃渲染失败，已降级为云母材质：', error.message);
    this.props.onError?.();
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
