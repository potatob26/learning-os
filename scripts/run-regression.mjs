/**
 * 全量回归（发版前必跑）
 * ──────────────────────────────────────────────────────────────────────────────
 *   node scripts/run-regression.mjs            # 跑基线套件
 *   node scripts/run-regression.mjs --only=test-sheets,e2e
 *   node scripts/run-regression.mjs --list
 *
 * 为什么要单独一个脚本（而不是每次手敲一长串 for 循环）：
 *   ① **增量输出**：每跑完一个立刻打印并落盘，中途能看到进度 ——
 *      之前用一次性命令写，结果只在全部跑完才写文件，跑 30 分钟期间完全看不到进展，
 *      也没法判断是"在跑"还是"卡住了"。
 *   ② **基线名单只有一处**：与交接文档 §8.2 的基线表对应，避免漏跑或重复跑。
 *   ③ 失败时**非零退出**，可以直接接在发版流程前面。
 *
 * 环境要求（脚本会自己检查并提示）：
 *   · 开发服务器 5188 —— 绝大多数用例需要
 *   · 预览服务器 4173 —— `test-scroll-sync` / `test-accent-quotes` 需要，
 *     而且**必须带 `--host 127.0.0.1`**（vite preview 默认只绑 localhost(IPv6)，
 *     用例连 127.0.0.1 会 ERR_CONNECTION_REFUSED）
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/** 基线套件。与交接文档 §8.2 的表一致；新增用例请同时补进那张表。 */
const BASELINE = [
  'e2e',
  'audit',
  'audit-quality',
  'test-sheets',
  'test-calendar',
  'test-lunar',
  'test-holidays',
  'test-scroll-sync',
  'test-glass-settings',
  'test-focus',
  'test-stats-tabs',
  'test-nextup',
  'test-autodim',
  'test-refract-theme',
  'test-refract-sheet',
  'test-dialog-hit',
  'test-nav-original',
  'test-nav-material',
  'test-adaptive-text',
  'test-update',
  'test-course-logic',
  'test-accent-quotes',
  'test-theme-cleanup',
  'test-grid-layer',
  'test-date-module-bg',
  'test-outcome-goal',
  'test-widget-payload',
  'test-duration-unlimited',
  'test-schedule-per-day',
  'test-daily-goal-per-day',
  'test-unlimited-goal',
  'test-rank-progress',
  'test-streak-rescue',
  'test-achievements',
  'test-exam-scores',
  'test-awake-window',
  'test-ring-over',
  'test-feedback',
  'test-update-check',
  'test-update-notice',
  'test-mock-endpoints',
  'test-delivery',
  // ↓ 2026-10-04 新增（作业清单 / 背景图位置 / 学习评价三层 / 玻璃两项证明）
  'test-bg-focus',
  'test-checklist',
  'test-evaluate-engine',
  'test-evaluate-text',
  'test-evaluation-ui',
  'test-glass-off-isolation',
  'test-glass-fallback',
  'test-typing',
  'pwa',
  'check-quotes',
  'verify-icons',
  // ↓ 1.4.1 新增：对比度令牌门禁 + 无障碍（键盘/读屏）
  'audit-contrast-tokens',
  'test-a11y',
  // ↓ 2026-11-08 新增：GitHub Releases 自动检测更新
  'test-github-update',
];

/** 需要 4173 预览服务器的用例 */
const NEEDS_PREVIEW = new Set(['test-scroll-sync', 'test-accent-quotes']);

/**
 * 需要 **5189 第二个开发服务器**的用例。
 *
 * `test-delivery` 要同时访问两个源（一个看正式构建的特性、一个看开发态），
 * 而它读的是 `window.__LOS__` —— 那是 `import.meta.env.DEV` 为真时才挂上去的调试入口。
 * 所以 5189 **必须是 dev 服务器，不能是 `vite preview`**：
 * 预览跑的是生产构建，`window.__LOS__` 不存在，用例会在 page.evaluate 里报
 * "Cannot read properties of undefined (reading 'useStore')" —— 很容易被误判成回归。
 * （这条要求以前没写进任何文档，2026-10 排查时才发现。）
 */
const NEEDS_SECOND_DEV = new Set(['test-delivery']);

const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log(BASELINE.join('\n'));
  process.exit(0);
}
const onlyArg = args.find((a) => a.startsWith('--only='));
const list = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : BASELINE;

async function reachable(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** 跑一个脚本，返回 { code, summary, errorLine } */
function run(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${name}.mjs`], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => {
      const lines = out.split(/\r?\n/);
      const summaryLine = [...lines].reverse().find((l) => /通过|无问题|合计|PASS |OK$/.test(l));
      const errLine = lines.find((l) => /AssertionError|TimeoutError|ReferenceError|TypeError|Error:/.test(l));
      resolve({
        code: code ?? 1,
        summary: (summaryLine ?? '').replace(/\s+/g, ' ').trim().slice(0, 90),
        errorLine: (errLine ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      });
    });
  });
}

const hasDev = await reachable(5188);
const hasPreview = await reachable(4173);
const hasSecondDev = await reachable(5189);
console.log(
  `环境：5188 ${hasDev ? '✓' : '✗ 未启动'} · 4173 ${hasPreview ? '✓' : '✗ 未启动'} · 5189 ${hasSecondDev ? '✓' : '✗ 未启动'}`,
);
if (!hasDev) console.log('  ⚠️ 开发服务器没起，绝大多数用例会直接失败：npm run dev -- --port 5188 --host 127.0.0.1');
if (!hasPreview) {
  console.log('  ⚠️ 预览服务器没起，下面这几个会失败：');
  console.log('     npm run preview -- --port 4173 --host 127.0.0.1   （--host 127.0.0.1 不能省）');
}
if (!hasSecondDev) {
  console.log('  ⚠️ 5189 没起，test-delivery 会失败（必须用 dev，不能用 preview）：');
  console.log('     npm run dev -- --port 5189 --host 127.0.0.1');
}

const started = Date.now();
const results = [];
let failed = 0;
console.log(`\n开始跑 ${list.length} 个用例\n`);

for (const [i, name] of list.entries()) {
  const need = NEEDS_PREVIEW.has(name);
  const need2 = NEEDS_SECOND_DEV.has(name);
  if ((need && !hasPreview) || (need2 && !hasSecondDev)) {
    failed++;
    const why = need ? '需要 4173 预览服务器' : '需要 5189 第二个 dev 服务器';
    results.push({ name, ok: false, summary: `跳过：${why}` });
    console.log(`[${i + 1}/${list.length}] ✗ ${name} — 跳过（${why}）`);
    continue;
  }
  const t0 = Date.now();
  const r = await run(name);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.code === 0;
  if (!ok) failed++;
  results.push({ name, ok, summary: r.summary || r.errorLine });
  console.log(`[${i + 1}/${list.length}] ${ok ? '✓' : '✗'} ${name.padEnd(26)} ${secs}s  ${r.summary}`);
  if (!ok && r.errorLine) console.log(`        ${r.errorLine}`);
}

const mins = ((Date.now() - started) / 60000).toFixed(1);
const header = `=== 全量回归 ${new Date().toISOString()} ===\n失败 ${failed} / 共 ${list.length}，用时 ${mins} 分钟\n`;
const body = results
  .map((r) => `${r.ok ? 'OK  ' : 'FAIL'} ${r.name.padEnd(26)} ${r.summary}`)
  .join('\n');
writeFileSync('.preview/full-regression.txt', header + body + '\n', 'utf8');

console.log(`\n===== 失败 ${failed} / 共 ${list.length}，用时 ${mins} 分钟 =====`);
console.log('明细已写入 .preview/full-regression.txt');
process.exit(failed === 0 ? 0 : 1);

