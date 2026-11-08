/**
 * 把显示名「液态玻璃」批量改为「毛玻璃」
 * ──────────────────────────────────────────────────────────────
 * 只替换中文字符串，**不动**以下标识符（它们关系到数据兼容与依赖）：
 *   · 主题 id `liquid-glass`（已写进用户 localStorage，改了会丢主题设置）
 *   · CSS 选择器 [data-theme='liquid-glass']
 *   · 依赖包名 liquid-glass-react
 *   · 组件名 LiquidGlass / LiquidGlassTwo / LiquidSurface
 *
 * 用 Node 而不是 PowerShell：PowerShell 读写 UTF-8 中文会损坏文件（此前踩过）。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'src';
const FROM = '液态玻璃';
const TO = '毛玻璃';

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
})(ROOT);

let totalFiles = 0;
let totalHits = 0;
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  const hits = before.split(FROM).length - 1;
  if (hits === 0) continue;
  const after = before.split(FROM).join(TO);
  writeFileSync(f, after, 'utf8');
  totalFiles++;
  totalHits += hits;
  console.log(`  ${relative(process.cwd(), f).padEnd(52)} ${hits} 处`);
}

console.log(`\n共修改 ${totalFiles} 个文件、${totalHits} 处`);

// 复核：确认标识符没有被误伤
console.log('\n=== 复核关键标识符是否完好 ===');
const mustExist = [
  ["src/hooks/useTheme.ts", "id: 'liquid-glass'"],
  ['src/lib/storage.ts', 'liquid-glass'],
  ['src/lib/material.ts', "'liquid-glass'"],
];
for (const [file, needle] of mustExist) {
  const txt = readFileSync(file, 'utf8');
  console.log(`  ${file}: ${txt.includes(needle) ? '完好 ✓' : '⚠️ 缺失 ' + needle}`);
}
