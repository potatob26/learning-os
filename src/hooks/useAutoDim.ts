import { useEffect } from 'react';
import { useStore } from '../lib/store';
import { useSystemDark } from './useTheme';
import { analyzeImage, recommendDim } from '../lib/background';
import { DARK_ONLY_THEMES } from '../lib/types';

/**
 * 背景暗化强度的自动重算
 * ──────────────────────────────────────────────────────────────
 * `dim` 原本只在**上传图片那一刻**算一次。但推荐值依赖「当前是深色还是浅色」：
 * 传图时是深色、之后切到浅色，旧值就不再合适 —— 而这恰恰会让文字变得难读，
 * 正是这个功能要防的事。
 *
 * 规则（用户已确认）：
 *   · 用户没手动调过滑块（dimAuto 仍为 true）→ 切换浅色/深色、重选背景时自动重算
 *   · 用户一旦手动拖过滑块（dimAuto 置 false）→ 完全以用户为准，不再覆盖
 *
 * 只对**自定义图片**生效：程序生成的场景背景没有"最坏像素"问题，
 * 它们的强度由主题令牌控制。
 */
export function useAutoDim(): void {
  const bg = useStore((s) => s.background);
  const patchBackground = useStore((s) => s.patchBackground);
  const colorMode = useStore((s) => s.settings.colorMode);
  const theme = useStore((s) => s.settings.theme);
  const systemDark = useSystemDark();

  const dark = DARK_ONLY_THEMES.includes(theme) || (colorMode === 'system' ? systemDark : colorMode === 'dark');

  const imageId = bg.current.startsWith('img:') ? bg.current.slice(4) : null;
  const image = imageId ? bg.custom.find((c) => c.id === imageId) : null;

  useEffect(() => {
    if (!image) return;
    // 只有明确标记为"由系统推荐"时才自动重算。
    // 用严格判断：老用户存档里没有这个字段（undefined），
    // 那种情况必须当作"手动"，否则会悄悄改掉他们已经调好的值。
    if (bg.dimAuto !== true) return;

    let alive = true;
    void analyzeImage(image.dataUrl).then((tone) => {
      if (!alive) return;
      const next = recommendDim(tone, dark);
      // 差异很小时不写回，避免无意义的状态更新
      if (Math.abs(next - bg.dim) > 0.01) patchBackground({ dim: next });
    });
    return () => {
      alive = false;
    };
    // 刻意不把 bg.dim 放进依赖：否则写回后会再次触发，形成循环。
    // 这里只关心「图片换了」或「明暗变了」或「用户重新交回自动」这三件事。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id, image?.dataUrl, dark, bg.dimAuto]);
}
