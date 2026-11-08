/**
 * 发布包敏感信息扫描
 * ──────────────────────────────────────────────────────────────
 * 在把 zip/APK 发出去之前，扫一遍解压后的目录，确认没有：
 *   个人路径（C:\Users\xxx、/Users/xxx）、本机项目路径、设备型号、
 *   邮箱 / 手机号、API key、token、私钥、旧签名口令。
 * 同时列出所有外链域名，方便人工判断有没有个人域名/私有 bucket。
 *
 * 用法：
 *   Expand-Archive release\v1.4.2\LearningOS-v1.4.2-source.zip release\_scan\src
 *   Expand-Archive release\v1.4.2\LearningOS-v1.4.2-web.zip    release\_scan\web
 *   node scripts/audit-release-secrets.mjs release/_scan/src release/_scan/web
 *
 * 有命中时退出码为 1（可用于发布前门禁）；唯一白名单是 SECURITY.md 里的占位邮箱。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error('用法：node scripts/audit-release-secrets.mjs <解压目录...>');
  process.exit(2);
}

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.html', '.css', '.xml', '.txt',
  '.yml', '.yaml', '.gradle', '.properties', '.example', '.nvmrc', '.gitignore',
  // 真机调试脚本也常带设备信息，不能漏
  '.ps1', '.psm1', '.bat', '.cmd', '.sh', '.py',
]);
const SPECIAL_NAMES = new Set(['.nvmrc', '.gitignore', '.env.example']);
const ALLOWED_EMAIL = new Set(['security@example.com']);

const CHECKS = [
  ['Windows 用户路径', /[A-Za-z]:\\Users\\[^\s"'<>]+/g],
  ['macOS 用户路径', /\/Users\/[A-Za-z0-9._-]+/g],
  ['本机项目路径', /[A-Za-z]:\\Learning OS/gi],
  ['设备型号（华为）', /HUAWEI\s*[A-Z0-9-]{3,}|ELS-[A-Z0-9-]{3,}/gi],
  ['设备型号（三星）', /SM-[A-Z]\d{3,}/gi],
  ['邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  // 前面不能是数字或小数点（避免把 0.14159265359 这种数值常量当手机号）
  ['手机号', /(?<![\d.])1[3-9]\d{9}(?![\d.])/g],
  ['OpenAI key', /sk-[A-Za-z0-9]{20,}/g],
  ['Google key', /AIza[0-9A-Za-z_-]{30,}/g],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['AWS key', /AKIA[0-9A-Z]{16}/g],
  ['私钥', /BEGIN [A-Z ]*PRIVATE KEY/g],
  // 真机调试隐私：写死的设备序列号 / IMEI / MAC / 内网 IP / adb -s 具体值
  ['设备序列号赋值', /serial\s*[:=]\s*['"][A-Za-z0-9]{6,}['"]/gi],
  ['IMEI', /(?<!\d)\d{15}(?!\d)/g],
  ['MAC 地址', /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f])/g],
  ['内网 IP', /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g],
  ['adb -s 具体序列号', /adb\s+-s\s+[A-Za-z0-9]{6,}/gi],
  ['token 赋值', /token\s*[:=]\s*["'][^"']{8,}["']/gi],
  ['api_key 赋值', /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/gi],
  ['secret 赋值', /secret\s*[:=]\s*["'][^"']{8,}["']/gi],
];

const hits = [];
const hosts = new Map();

function scanText(file, text) {
  for (const [label, re] of CHECKS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const value = m[0];
      if (label === '邮箱' && ALLOWED_EMAIL.has(value)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ label, value, file, line });
    }
  }
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>\]]+/g)) {
    try {
      const host = new URL(m[0]).host;
      if (!hosts.has(host)) hosts.set(host, `${file}:${text.slice(0, m.index).split('\n').length}`);
    } catch {
      /* 不是合法 URL，忽略 */
    }
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    // 扫描器自己包含正则里的示例字符串（占位路径/型号），别自己扫自己
    if (name === 'audit-release-secrets.mjs') continue;
    const file = join(dir, name);
    const st = statSync(file);
    if (st.isDirectory()) {
      walk(file);
      continue;
    }
    if (st.size > 3_000_000) continue;
    if (!TEXT_EXT.has(extname(name).toLowerCase()) && !SPECIAL_NAMES.has(name)) continue;
    try {
      scanText(file, readFileSync(file, 'utf8'));
    } catch {
      /* 二进制/编码异常，跳过 */
    }
  }
}

for (const root of roots) walk(root);

console.log(`扫描目录：${roots.join(', ')}`);
console.log(`\n=== 疑似个人信息 / 密钥 ===`);
if (!hits.length) {
  console.log('无');
} else {
  const seen = new Set();
  for (const h of hits) {
    const key = `${h.label}｜${h.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`${h.label}：${h.value.slice(0, 120)}  @ ${h.file}:${h.line}`);
  }
}

console.log(`\n=== 外链域名（${hosts.size} 个，供人工判断） ===`);
for (const [host, where] of [...hosts.entries()].sort()) {
  console.log(`${host}  @ ${where}`);
}

if (hits.length) {
  console.log(`\n失败：${hits.length} 处命中，请先处理再发布。`);
  process.exit(1);
}
console.log('\n通过：没有命中个人信息 / 密钥模式。');
