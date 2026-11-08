/** 轻量 className 合并（避免额外依赖） */
export type ClassValue = string | number | null | false | undefined | ClassValue[];

export function cx(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v && v !== 0) continue;
    if (Array.isArray(v)) {
      const nested = cx(...v);
      if (nested) out.push(nested);
    } else {
      out.push(String(v));
    }
  }
  return out.join(' ');
}

/** 稳定 id（不需要加密强度，只需要不重复） */
export function uid(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return clamp((part / whole) * 100, 0, 100);
}

/**
 * 同 `pct`，但**不封顶**（可以超过 100）—— 用于「超额完成也值得看到」的进度。
 *
 * 为什么单独一个函数，而不是给 `pct` 加个 `clamp = true` 参数：
 * 加了默认参数之后，每个调用点到底封不封顶取决于默认值，读代码时看不出来；
 * 而"这个数字能不能超过 100%"是**业务语义**，必须一眼可辨。
 *
 * 首页「今日目标」用它：学了 6 小时、目标 3 小时就该显示 200%，
 * 而不是一律压成 100%（那样"超额"这件事就被抹掉了）。
 */
export function ratioPercent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, (part / whole) * 100);
}

/** 数字滚动用的缓动 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 稳定伪随机：同一个 seed 永远得到同一个结果（每日鼓励用） */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickBySeed<T>(list: readonly T[], seed: string): T | null {
  if (list.length === 0) return null;
  return list[hashString(seed) % list.length];
}

/** 相对亮度（0=黑 1=白），用于背景自动明暗补偿 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}
