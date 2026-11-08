/**
 * 对比两份 audit-quality 报告，找出新增 / 消除的低对比文字。
 * 用法：node scripts/compare-quality.mjs <base.json> <next.json>
 */
import { readFileSync } from 'node:fs';

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error('用法: node scripts/compare-quality.mjs <base.json> <next.json>');
  process.exit(1);
}
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const base = load(aPath);
const next = load(bPath);

const key = (c, lc) => `${c.theme}|${c.route}|${lc.text}|${lc.px}`;

const collect = (list) => {
  const m = new Map();
  for (const c of list) for (const lc of c.lowContrast ?? []) m.set(key(c, lc), { c, lc });
  return m;
};

const A = collect(base);
const B = collect(next);

const total = (m) => [...m.values()].reduce((s, { c }) => s + 0, 0) + m.size;
console.log(`基线低对比条目：${A.size}   修复后：${B.size}   差：${B.size - A.size >= 0 ? '+' : ''}${B.size - A.size}`);

const added = [...B.entries()].filter(([k]) => !A.has(k));
const removed = [...A.entries()].filter(([k]) => !B.has(k));

const byRoute = (arr) => {
  const m = {};
  for (const [, { c }] of arr) m[`${c.theme} ${c.route}`] = (m[`${c.theme} ${c.route}`] || 0) + 1;
  return m;
};

if (added.length) {
  console.log('\n新增（可能是本次改动引入）：');
  for (const [k, v] of Object.entries(byRoute(added)).sort((x, y) => y[1] - x[1]).slice(0, 12)) {
    console.log(`  ${k}  ${v} 条`);
  }
  console.log('  明细样例：');
  for (const [, { c, lc }] of added.slice(0, 10)) {
    console.log(`    [${c.theme} ${c.route}] "${lc.text}" ${lc.ratio}:1 (需 ${lc.need})`);
  }
} else {
  console.log('\n新增：无');
}

if (removed.length) {
  console.log('\n消除（改动修好的）：' + removed.length + ' 条');
  for (const [, { c, lc }] of removed.slice(0, 12)) {
    console.log(`    [${c.theme} ${c.route}] "${lc.text}" ${lc.ratio}:1 → 已达标`);
  }
}
