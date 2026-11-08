/**
 * 把小于 0.7rem 的字号统一提升到 0.7rem（11.2px）
 * ──────────────────────────────────────────────────────────────
 * 手机上 8.8~10.6px 的正文确实看不清（用户反馈「文字显示不清楚」）。
 * 统一到一个下限，同时保留相对大小关系（更小的都变成同一个起点）。
 * 用 Node 处理以保证 UTF-8 中文不被破坏。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

const FLOOR = 0.7;
let changedFiles = 0;
let changedHits = 0;

for (const f of files) {
  const before = readFileSync(f, 'utf8');
  let hits = 0;
  const after = before.replace(/text-\[(\d+(?:\.\d+)?)rem\]/g, (full, num) => {
    const v = parseFloat(num);
    if (v >= FLOOR) return full;
    hits++;
    return `text-[${FLOOR}rem]`;
  });
  if (hits === 0) continue;
  writeFileSync(f, after, 'utf8');
  changedFiles++;
  changedHits += hits;
  console.log(`  ${relative(process.cwd(), f).padEnd(56)} ${hits} 处`);
}

console.log(`\n共修改 ${changedFiles} 个文件、${changedHits} 处`);

// 复核
let remaining = 0;
for (const f of files) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/text-\[(\d+(?:\.\d+)?)rem\]/g)) {
    if (parseFloat(m[1]) < FLOOR) remaining++;
  }
}
console.log(`复核：仍小于 0.7rem 的字号 ${remaining} 处`);
