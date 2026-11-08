import { useStore } from '../../lib/store';
import { RefractSettings } from './RefractSettings';

/* ==========================================================================
   玻璃参数面板
   ──────────────────────────────────────────────────────────────────────────
   只有「透明玻璃」主题需要暴露可调参数（见 RefractSettings）。

   「磨砂玻璃」主题这一整块面板已按用户要求**移除**。它原先有 5 块内容：
     · 实时预览（高对比图案 + 那块 2h 18m 的示例玻璃）
     · 折射模式（标准 / 极坐标 / 强化）
     · 光学参数（边缘位移强度 / 模糊量 / 饱和度 / 边缘色散 / 指针弹性 / 玻璃圆角）
     · 深色玻璃（对应库里的 Over Light）
     · 底部提示文字
   这些都属于调试性质的旋钮 —— 对齐官方 demo、用来调库参数，
   不该出现在学生日常使用的界面里，所以整体撤掉。

   ★ 重要：`settings.glass` 这份数据**保留不动**。
     磨砂玻璃的渲染仍然读它（LiquidGlassTwo 需要 cornerRadius / mode /
     blurAmount 等），只是不再提供界面去改，因此会一直使用
     DEFAULT_GLASS_SETTINGS 里的那套取值（已针对本项目调好：
     位移偏强以看清边缘弯折、模糊压到很低以保留通透感）。
     旧存档里用户自己调过的值同样继续生效，不会被重置。
   ========================================================================== */

export function GlassSection() {
  const theme = useStore((s) => s.settings.theme);
  return theme === 'liquid-glass-wc' ? <RefractSettings /> : null;
}
