/**
 * 补漏：把 .css 与 .html 里残留的「液态玻璃」也统一改为「毛玻璃」
 * ──────────────────────────────────────────────────────────────
 * 上一版脚本只处理了 .ts/.tsx，漏掉了 src/styles/index.css（16 处注释）
 * 以及几个开发页。注释虽然不影响显示，但留着会让后续维护困惑。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const TARGETS = ['src', 'dev-labs'];
const FROM = '液态玻璃';
const TO = '毛玻璃';
const EXT = /\.(ts|tsx|css|html)$/;

const files = [];
for (const root of TARGETS) {
  try {
    walk(root);
  } catch {
    /* 目录不存在就跳过 */
  }
}
function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.test(n)) files.push(p);
  }
}
// 根目录下的开发页
for (const f of ['glass-versus.html', 'index.html']) {
  try {
    if (statSync(f).isFile()) files.push(f);
  } catch {
    /* 忽略 */
  }
}

let changedFiles = 0;
let changedHits = 0;
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  const hits = before.split(FROM).length - 1;
  if (hits === 0) continue;
  writeFileSync(f, before.split(FROM).join(TO), 'utf8');
  changedFiles++;
  changedHits += hits;
  console.log(`  ${relative(process.cwd(), f).padEnd(46)} ${hits} 处`);
}
console.log(`\n共修改 ${changedFiles} 个文件、${changedHits} 处`);

// 全项目复核
let left = 0;
for (const root of ['src', 'dev-labs']) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (EXT.test(n)) left += readFileSync(p, 'utf8').split(FROM).length - 1;
    }
  }
}
console.log(`复核：src 与 dev-labs 中剩余 ${left} 处`);
