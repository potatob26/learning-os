/** 汇总审计报告，列出仍然存在的唯一问题元素 */
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('.preview/audit-report.json', 'utf8'));
const cells = report.length;
const clean = report.filter((x) => x.issues.length === 0).length;
console.log(`共 ${cells} 个「页面 × 视口」组合，其中 ${clean} 个完全干净，${cells - clean} 个有残留`);

const kinds = {};
for (const c of report) {
  for (const i of c.issues) kinds[i.kind] = (kinds[i.kind] ?? 0) + i.items.length;
}
console.log('残留分类：', JSON.stringify(kinds, null, 2));

const els = new Map();
for (const c of report) {
  for (const i of c.issues) {
    for (const it of i.items) {
      const k = String(it.el ?? '').replace(/\s+"[^"]*"$/, '');
      els.set(k, (els.get(k) ?? 0) + 1);
    }
  }
}

console.log('\n仍然存在的唯一元素类型（按出现次数）：');
for (const [k, v] of [...els.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(3)}x  ${k}`);
}
