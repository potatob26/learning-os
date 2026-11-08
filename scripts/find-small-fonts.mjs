/**
 * 找出所有小于 0.7rem 的字号类并统计（只读，不改动）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(n)) files.push(p);
  }
})('src');

const counts = new Map();
const where = new Map();
for (const f of files) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/text-\[(\d+(?:\.\d+)?)rem\]/g)) {
    const v = parseFloat(m[1]);
    if (v >= 0.7) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!where.has(v)) where.set(v, new Set());
    where.get(v).add(relative(process.cwd(), f));
  }
}

console.log('小于 0.7rem（11.2px）的字号：');
for (const v of [...counts.keys()].sort((a, b) => a - b)) {
  const px = Math.round(v * 16 * 10) / 10;
  console.log(`  text-[${v}rem] = ${px}px   ${counts.get(v)} 处`);
  for (const f of where.get(v)) console.log(`      ${f}`);
}
const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`\n合计 ${total} 处需要调整`);
