#!/usr/bin/env node
/**
 * 一键备份
 * ──────────────────────────────────────────────────────────────
 * 三重保护，各防不同的意外：
 *   · git bundle   —— 完整仓库（全部历史 + 标签），单文件，可 git clone 直接恢复
 *   · 源码归档      —— 工作区快照（含安卓工程与 APK），排除依赖与构建产物
 *   · SHA256 清单   —— 验证归档未被损坏
 *
 * 用法：node scripts/backup.mjs [--keep N]
 *   默认保留最近 5 份，更早的自动清理。
 *
 * 为什么用 execFileSync + stdio:'inherit' 而不是 exec：
 *   exec 默认用管道捕获输出，在本机沙箱下会因 EPERM 失败；
 *   inherit 不经过管道，且能直接看到进度。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');
const PROJECT_NAME = PROJECT.split(/[\\/]/).pop();       // 例如 "Learning OS"
// 文件名里不放空格：统一小写、空格转连字符
const SLUG = PROJECT_NAME.toLowerCase().replace(/\s+/g, '-');   // "learning-os"
const PARENT = resolve(PROJECT, '..');                    // 例如 "D:\"
const DEST = join(PARENT, `${PROJECT_NAME} 备份`);

/** 本地时间的 YYYYMMDD-HHmm。
 *  注意不能用 toISOString()：那是 UTC，本地 18:46 会被写成 10:46，
 *  而且截断长度算错还会少一位分钟（曾写出 20260913-10462 这种）。 */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const keepArg = process.argv.indexOf('--keep');
const KEEP = keepArg >= 0 ? Number(process.argv[keepArg + 1]) || 5 : 5;

/** 归档时排除：依赖、缓存、构建产物、开发期截图 */
const EXCLUDES = [
  'node_modules',
  '.npm-cache',
  '.pnpm-store',
  '.preview',
  'dist',
  'android/build',
  'android/app/build',
  'android/.gradle',
  'android/capacitor-cordova-android-plugins',
  'android/app/src/main/assets/public',
  '.git',
];

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function mb(file) {
  return (statSync(file).size / 1024 / 1024).toFixed(2);
}

/* ---------- 0. 前置检查 ---------- */
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: PROJECT, encoding: 'utf8' }).trim();
if (dirty) {
  const n = dirty.split('\n').length;
  console.log(`\n⚠️  工作区有 ${n} 个未提交改动 —— 归档会包含它们，但 bundle（git 历史）不会。`);
  console.log('   如需提交后再备份，请先 git commit。\n');
}

const RUN = stamp();
mkdirSync(DEST, { recursive: true });

const bundle = join(DEST, `${SLUG}-repo-${RUN}.bundle`);
const archive = join(DEST, `${SLUG}-source-${RUN}.tar.gz`);

/* ---------- 1. 完整仓库 ---------- */
console.log(`\n[1/4] 打包 git 仓库…`);
run('git', ['bundle', 'create', bundle, '--all'], { cwd: PROJECT });
console.log(`      ${bundle}  (${mb(bundle)} MB)`);

/* ---------- 2. 源码归档 ---------- */
console.log(`\n[2/4] 归档工作区（排除依赖与构建产物）…`);
const tarArgs = ['-czf', archive];
for (const e of EXCLUDES) tarArgs.push(`--exclude=${PROJECT_NAME}/${e}`);
tarArgs.push(PROJECT_NAME);
run('tar', tarArgs, { cwd: PARENT });
console.log(`      ${archive}  (${mb(archive)} MB)`);

/* ---------- 3. 校验清单 ---------- */
console.log(`\n[3/4] 生成校验清单…`);
const lines = [bundle, archive].map((f) => `${sha256(f)}  ${f.split(/[\\/]/).pop()}`);
writeFileSync(join(DEST, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
for (const l of lines) console.log(`      ${l.slice(0, 16)}…  ${l.split('  ')[1]}`);

/* ---------- 4. 清理旧备份 ---------- */
console.log(`\n[4/4] 清理旧备份（保留最近 ${KEEP} 份）…`);
const all = readdirSync(DEST).filter((f) => /-(repo|source)-.*\.(bundle|tar\.gz)$/.test(f));
const stamps = [...new Set(all.map((f) => f.replace(/^.*-(?:repo|source)-/, '').replace(/\.(bundle|tar\.gz)$/, '')))].sort();
const drop = stamps.slice(0, Math.max(0, stamps.length - KEEP));
if (drop.length === 0) console.log('      无需清理');
for (const s of drop) {
  for (const f of all.filter((x) => x.includes(s))) {
    rmSync(join(DEST, f));
    console.log(`      已删除 ${f}`);
  }
}

/* ---------- 汇总 ---------- */
console.log(`\n✅ 备份完成：${DEST}`);
const remain = readdirSync(DEST).filter((f) => /\.(bundle|tar\.gz)$/.test(f)).sort();
for (const f of remain) console.log(`   ${mb(join(DEST, f)).padStart(7)} MB  ${f}`);

/* ---------- 自检：bundle 是否可读 ---------- */
try {
  const refs = execFileSync('git', ['bundle', 'verify', bundle], { cwd: PROJECT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const n = (refs.match(/refs\//g) ?? []).length;
  console.log(`\n   bundle 校验通过，含 ${n} 个引用`);
} catch (e) {
  console.log(`\n   ⚠️ bundle 校验失败：${String(e.message).slice(0, 80)}`);
}
