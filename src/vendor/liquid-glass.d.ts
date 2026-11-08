/**
 * `liquid-glass.js` 的类型声明
 * ──────────────────────────────────────────────────────────────
 * 该文件是 MIT 许可的零依赖 Web Component（用户提供），为保持原样未改成 TS，
 * 因此这里补一份声明供项目内引用。
 *
 * 用法要点（来自其实现）：
 *   · 宿主元素是 `position:absolute`，靠 translate3d 定位，
 *     所以**父容器必须是有定位的、且大小与 source 画布一致**
 *   · `.source` 必须是一张覆盖父容器区域的画布，否则退化成 CSS backdrop-filter
 *   · 每个实例会各自创建一个 WebGL 上下文，实例数量要克制
 */
export class LiquidGlass extends HTMLElement {
  /** 覆盖父容器的背景画布，用于做真实折射 */
  source: HTMLCanvasElement | undefined;
  /** 在父容器内定位（会被夹在父容器范围内） */
  setPosition(x: number, y: number): void;
  /**
   * 分别指定「绘制位置」与「采样原点」。
   *
   * 用于玻璃层随内容滚动（绝对定位）的场景：绘制位置用父容器（内容）坐标，
   * 交给合成器跟随滚动、零延迟；采样原点用来源画布的坐标（视口），
   * 因为背景画布是固定在视口的。
   *
   * 不调用时行为与 setPosition 完全一致。
   */
  setPlacement(p: {
    x: number;
    y: number;
    sampleX?: number;
    sampleY?: number;
    sceneWidth?: number;
    sceneHeight?: number;
  }): void;
  /** 回到「绘制位置即采样原点」的默认行为 */
  clearPlacement(): void;
  /** 同一帧更新位置与透镜尺寸，用于液态形变。 */
  setGeometry(x: number, y: number, width: number, height: number): void;
  /** 重新采样并绘制 */
  render(): void;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-glass': LiquidGlass;
  }
  // eslint-disable-next-line no-var
  var LiquidGlass: typeof LiquidGlass | undefined;
}
