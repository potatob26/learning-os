import type { Settings } from '../lib/types';
import type { LiquidGlass } from '../vendor/liquid-glass.js';

export const DEFAULT_REFRACT = { strength: 55, blur: 1, chromatic: true, elasticity: 1 };
export function refractSettings(settings: Settings) {
  const v = settings.refract;
  const clamp = (value: unknown, fallback: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
  return {
    strength: clamp(v?.strength, 55, 100), blur: clamp(v?.blur, 1, 8),
    chromatic: typeof v?.chromatic === 'boolean' ? v.chromatic : true,
    elasticity: clamp(v?.elasticity, 1, 1.5),
  };
}
export function applyRefraction(glass: LiquidGlass, settings: Settings) {
  const value = refractSettings(settings);
  for (const [key, v] of Object.entries({ refraction: value.strength, blur: value.blur })) {
    if (glass.getAttribute(key) !== String(v)) glass.setAttribute(key, String(v));
  }
  if (glass.hasAttribute('chromatic') !== value.chromatic) glass.toggleAttribute('chromatic', value.chromatic);
}
