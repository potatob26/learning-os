import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import type { SceneName } from '../../lib/types';
import { DARK_ONLY_THEMES } from '../../lib/types';
import { hashString } from '../../lib/utils';
import { dayKey } from '../../lib/time';
import { loadImage, setBackgroundCanvas, configureBackground } from '../../glass';
import { useSystemDark } from '../../hooks/useTheme';

const SCENES: SceneName[] = ['aurora', 'dawn', 'dusk', 'stars', 'rain', 'grid', 'glow', 'glass-flow'];

/**
 * 背景层（三层架构的最底层）
 * ──────────────────────────────────────────────────────────
 * 背景由 canvas 绘制，而不是 CSS。
 *
 * 原因：玻璃着色器必须**读取背景像素**来按 SDF 法线偏移采样；
 * CSS 背景无法被 WebGL 读取，而 DOM 截图既慢又会丢失字体与滤镜。
 * 背景与玻璃共用同一份像素，折射才一定是准的，也不会出现
 * 「玻璃内外颜色不一致」这种最刺眼的错误。
 *
 * 代价（如实记录）：CSS 里那些缓慢动画（极光流动、雨丝、星点闪烁）
 * 在静态 canvas 上不会自动播放。恢复动画需要按低帧率重绘整张背景
 * 并重新上传纹理，在中低端安卓上代价不低，因此默认不开。
 */
export function BackgroundLayer() {
  const bg = useStore((s) => s.background);
  const theme = useStore((s) => s.settings.theme);
  const colorMode = useStore((s) => s.settings.colorMode);
  const systemDark = useSystemDark();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  // 每次打开 / 每日更换 / 定时切换
  useEffect(() => {
    if (bg.mode === 'fixed') return;
    const pool = bg.enabledIds.filter(Boolean);
    if (pool.length === 0) return;
    const pick = () => {
      const seed =
        bg.mode === 'daily'
          ? `daily-${dayKey(Date.now())}`
          : bg.mode === 'each-open'
            ? `open-${Date.now()}-${Math.random()}`
            : `rotate-${Math.floor(Date.now() / (Math.max(1, bg.rotateMinutes) * 60000))}`;
      setRotated(pool[hashString(seed) % pool.length]);
    };
    pick();
    if (bg.mode !== 'random') return;
    const id = setInterval(pick, Math.max(1, bg.rotateMinutes) * 60000);
    return () => clearInterval(id);
  }, [bg.mode, bg.enabledIds, bg.rotateMinutes]);

  const current = bg.mode !== 'fixed' && rotated ? rotated : bg.current;

  const isImage = current.startsWith('img:');
  const imageId = isImage ? current.slice(4) : null;
  const custom = imageId ? bg.custom.find((c) => c.id === imageId) : null;
  /**
   * 由 current 解析出场景。
   * 注意 'none' 必须解析成 null —— 原来的写法是
   * `current.startsWith('scene:') ? ... : 'aurora'`，
   * 于是用户选择「无背景」时会被回落到极光，等于「无背景」这个选项根本没生效；
   * 实测「无背景」与「极光」的背景像素哈希完全相同，就是这个原因。
   */
  const scene: SceneName | null = (() => {
    if (isImage) return null;
    if (current === 'none') return null; // 明确选择无背景
    if (current.startsWith('scene:')) {
      const name = current.slice(6) as SceneName;
      return SCENES.includes(name) ? name : 'aurora'; // 非法场景名回落默认
    }
    return 'aurora'; // 未知取值（含历史数据）回落默认
  })();

  // 加载自定义图片
  useEffect(() => {
    if (!custom) {
      setImage(null);
      return;
    }
    let alive = true;
    void loadImage(custom.dataUrl)
      .then((img) => {
        if (alive) setImage(img);
      })
      .catch(() => {
        if (alive) setImage(null);
      });
    return () => {
      alive = false;
    };
    /*
     * 只依赖图片本身（id + dataUrl），**不要依赖整个 custom 对象** ——
     * 用户拖动"显示范围"时 custom 每帧都变，那样会不停重新解码图片（闪 + 白做功）。
     * 拖动引起的重画由下面那个 configureBackground effect 负责。
     */
  }, [custom?.id, custom?.dataUrl]);

  // 注册画布 + 下发绘制参数。实际绘制由 glass-manager 统一完成，
  // 因为它还要处理「弹层遮罩」这类额外暗化。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBackgroundCanvas(canvas);
    return () => setBackgroundCanvas(null);
  }, []);

  useEffect(() => {
    configureBackground({
      scene,
      image,
      dim: bg.dim,
      showVeil: bg.showVeil,
      grid: bg.grid,
      dark: DARK_ONLY_THEMES.includes(theme) || (colorMode === 'system' ? systemDark : colorMode === 'dark'),
      theme,
      // 自定义背景图的显示范围（设置→背景 里可拖动/缩放调节）；缺省即居中 cover
      imageFocus: custom ? { focusX: custom.focusX, focusY: custom.focusY, zoom: custom.zoom } : undefined,
    });
    // 视口尺寸变化会让画布需要重画，交由 manager 在 resize 时统一处理
  }, [scene, image, bg.dim, bg.showVeil, bg.grid, theme, systemDark, colorMode, custom]);

  return (
    <canvas
      ref={canvasRef}
      className="bg-canvas"
      aria-hidden
      style={{ pointerEvents: 'none' }}
    />
  );
}
