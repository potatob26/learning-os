/**
 * 对比度令牌审计（确定性门禁）
 * ──────────────────────────────────────────────────────────────────────────────
 * audit-quality 是「真实像素」审计，受抗锯齿/背景图影响会有噪声；
 * 这个脚本只算**令牌与表面**的组合，结果完全确定，适合做「只许升不许降」的基线。
 *
 * 覆盖：6 主题 × 2 模式（纯深色主题按引擎规则强制 dark）× 6 个文字令牌 × 3 个表面
 *  文字令牌：--accent-text / --ok-text / --warn-text / --bad-text / --info-text / --text-tertiary
 *  表面：--bg-base / --bg-elevated / --surface-soft（半透明时按 bg-base 合成）
 *
 * 判定：
 *   · 任何组合 < 4.5:1 → 失败（WCAG AA 正文）
 *   · 与 `.preview/contrast-tokens.json` 基线相比，下降超过 0.05 → 失败（回归）
 *   · 首次运行会写基线；之后只许升不许降
 *
 * 用法：node scripts/audit-contrast-tokens.mjs [--update]   # --update 重写基线（仅在确认是有意改动时）
 */
import { chromium } from './browser.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5188/';
const OUT = '.preview/contrast-tokens.json';
const UPDATE = process.argv.includes('--update');
mkdirSync('.preview', { recursive: true });

const THEMES = ['liquid-glass', 'liquid-glass-wc', 'pure-light', 'pure-dark', 'soft', 'immersive'];
const MODES = ['light', 'dark'];
const DARK_ONLY = new Set(['pure-dark', 'liquid-glass-wc']);
const TOKENS = ['--accent-text', '--ok-text', '--warn-text', '--bad-text', '--info-text', '--text-tertiary'];
const SURFACES = ['--bg-base', '--bg-elevated', '--surface-soft'];
const MIN_RATIO = 4.5;
const TOLERANCE = 0.05;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const rows = await page.evaluate(
  ({ themes, modes, darkOnly, tokens, surfaces }) => {
    /**
     * 把任意 CSS 颜色解析成 [r,g,b,a]（0-255 / 0-1）。
     * 用 canvas 的 fillStyle 归一化，能吃掉 color-mix 解析后的 rgb()/rgba()。
     */
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const c = canvas.getContext('2d');
    const parse = (value) => {
      c.clearRect(0, 0, 1, 1);
      c.fillStyle = '#000';
      c.fillStyle = value;
      const normalized = c.fillStyle;
      if (normalized.startsWith('#')) {
        const n = parseInt(normalized.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
      }
      /*
       * Chrome 会把 color-mix 的结果算成 `color(srgb r g b / a)`，
       * 分量是 0..1；而 rgb()/rgba() 是 0..255。
       * 之前统一按 0..255 读，0.70 被当成 0-1 的「1/255」，对比度全成了 1.0x（踩过）。
       */
      if (normalized.startsWith('color(')) {
        const nums = normalized.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
        return [nums[0] * 255, nums[1] * 255, nums[2] * 255, nums[3] ?? 1];
      }
      const m = normalized.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
      return [m[0], m[1], m[2], m[3] ?? 1];
    };
    /** 半透明表面叠在底色上（与浏览器合成一致的 source-over） */
    const over = (fg, bg) => {
      const a = fg[3];
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
    };
    /** 相对亮度（sRGB 线性化，WCAG 2.x） */
    const lum = ([r, g, b]) => {
      const f = (v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.left = '-9999px';
    document.body.appendChild(probe);
    const resolve = (token) => {
      probe.style.color = `var(${token})`;
      return parse(getComputedStyle(probe).color);
    };

    const html = document.documentElement;
    const out = [];
    for (const theme of themes) {
      for (const mode of modes) {
        const effectiveDark = mode === 'dark' || darkOnly.includes(theme);
        html.dataset.theme = theme;
        html.classList.toggle('dark', effectiveDark);
        // 强制一次样式解析
        void getComputedStyle(html).color;

        const base = resolve('--bg-base');
        const elevated = resolve('--bg-elevated');
        const surfaceSoft = over(resolve('--surface-soft'), base);
        const surfaceColors = {
          '--bg-base': base,
          '--bg-elevated': elevated,
          '--surface-soft': surfaceSoft,
        };
        for (const token of tokens) {
          const fg = resolve(token);
          for (const s of surfaces) {
            out.push({
              theme,
              mode,
              effectiveDark,
              token,
              surface: s,
              ratio: Math.round(ratio(fg, surfaceColors[s]) * 100) / 100,
              fg,
              bg: surfaceColors[s],
            });
          }
        }
      }
    }
    probe.remove();
    return out;
  },
  { themes: THEMES, modes: MODES, darkOnly: [...DARK_ONLY], tokens: TOKENS, surfaces: SURFACES },
);

await browser.close();

const baseline = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const key = (r) => `${r.theme}/${r.mode}/${r.token}/${r.surface}`;

let failures = 0;
const regressions = [];
const belowAA = [];
for (const row of rows) {
  const k = key(row);
  const prev = baseline?.ratios?.[k];
  if (row.ratio < MIN_RATIO) belowAA.push(`${k} = ${row.ratio.toFixed(2)}`);
  if (typeof prev === 'number' && row.ratio < prev - TOLERANCE) {
    regressions.push(`${k}: ${prev.toFixed(2)} → ${row.ratio.toFixed(2)}`);
  }
}

console.log(`对比度令牌审计：${rows.length} 个组合（${THEMES.length} 主题 × ${MODES.length} 模式 × ${TOKENS.length} 令牌 × ${SURFACES.length} 表面）`);
console.log(`门槛：每个组合 ≥ ${MIN_RATIO}:1；相对基线允许抖动 ≤ ${TOLERANCE}`);

if (belowAA.length) {
  failures += belowAA.length;
  console.log(`\n✗ 低于 ${MIN_RATIO}:1 的组合 ${belowAA.length} 个：`);
  belowAA.slice(0, 20).forEach((s) => console.log(`   ${s}`));
}
if (regressions.length) {
  failures += regressions.length;
  console.log(`\n✗ 相对基线退步 ${regressions.length} 个：`);
  regressions.slice(0, 20).forEach((s) => console.log(`   ${s}`));
}

if (!baseline || UPDATE) {
  const ratios = Object.fromEntries(rows.map((r) => [key(r), r.ratio]).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), minRatio: MIN_RATIO, tolerance: TOLERANCE, ratios }, null, 2) + '\n',
  );
  console.log(`\n${UPDATE ? '已重写' : '已写入'}基线：${OUT}`);
} else {
  console.log(`\n基线：${OUT}（${Object.keys(baseline.ratios).length} 个组合）`);
}

if (failures) {
  console.log(`\n===== 失败 ${failures} 项 =====`);
  process.exit(1);
}
const min = Math.min(...rows.map((r) => r.ratio));
console.log(`\n===== 全部通过（最低 ${min.toFixed(2)}:1）=====`);
