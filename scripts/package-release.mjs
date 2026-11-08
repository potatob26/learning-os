/**
 * 打一个「可以直接发出去」的发布包（可重复使用）
 * ──────────────────────────────────────────────────────────────
 * 产物（都在 release/vX.Y.Z/ 下）：
 *   LearningOS-vX.Y.Z.apk         已有 APK（从 release/ 复制）
 *   LearningOS-vX.Y.Z-source.zip  源码快照（只含该公开的文件）
 *   LearningOS-vX.Y.Z-web.zip     已构建的静态 Web/PWA（dist/）
 *   SHA256SUMS.txt                上面三个文件的校验和
 *   下载说明.md                    这一版的下载/安装/校验说明
 *
 * 用法：先 `npm run build`（Web），再 `node scripts/package-release.mjs`
 *
 * 注意：源码 zip 用 `git ls-files` 作为白名单，所以**未提交的新文件不会进包**；
 * 内部文档（交接文档/待办/软著材料/开源清单）与私钥、构建产物一律排除。
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
// 与 export-public-repo.mjs 共用同一份「哪些文件可以公开」的清单
import { isPublicFile } from './public-files.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const outDir = join('release', tag);
const stage = join('release', `_stage-${tag}`);
/** 从 gradle 里读真实 versionCode，别在说明文档里手写造成漂移 */
const versionCode = (() => {
  try {
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    return gradle.match(/versionCode\s+(\d+)/)?.[1] ?? '?';
  } catch {
    return '?';
  }
})();

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });

/**
 * 用 tar -a（Windows 自带 bsdtar）压缩。
 * 原因：PowerShell 5.1 的 Compress-Archive 会把 zip 条目写成 `android\app\...` 反斜杠，
 * 在 macOS/Linux 上解压会变成一个带反斜杠的怪文件名。bsdtar 写标准 `/` 分隔符。
 */
const zipDir = (dir, zipPath) => {
  const entries = readdirSync(dir);
  run('tar.exe', ['-a', '-c', '-f', zipPath, '-C', dir, ...entries]);
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

/* 1. 校验前置条件 */
const apk = join('release', `LearningOS-${tag}.apk`);
if (!existsSync(apk)) {
  console.error(`找不到 APK：${apk}（先打包 / 改名）`);
  process.exit(1);
}
if (!existsSync('dist/index.html')) {
  console.error('找不到 dist/index.html（先 npm run build）');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

/* 2. 源码 zip：只复制白名单里、且不在排除列表的已跟踪文件 */
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);

let copied = 0;
for (const f of tracked) {
  if (!isPublicFile(f)) continue;
  if (!existsSync(f)) continue;
  const dest = join(stage, f);
  mkdirSync(join(dest, '..'), { recursive: true });
  cpSync(f, dest, { recursive: false });
  copied += 1;
}
console.log(`源码快照：${copied} 个文件`);

/* 3. 打 source zip（用 Windows 自带 tar/bsdtar，保证条目用正斜杠 `/`） */
const sourceZip = join(outDir, `LearningOS-${tag}-source.zip`);
rmSync(sourceZip, { force: true });
zipDir(stage, sourceZip);

/* 4. 打 web zip */
const webZip = join(outDir, `LearningOS-${tag}-web.zip`);
rmSync(webZip, { force: true });
zipDir('dist', webZip);

/* 5. 复制 APK + 校验和 */
const apkOut = join(outDir, `LearningOS-${tag}.apk`);
copyFileSync(apk, apkOut);
const files = [apkOut, sourceZip, webZip];
const sums = files.map((f) => `${sha256(f)}  ${f.split(/[\\/]/).pop()}`).join('\n') + '\n';
writeFileSync(join(outDir, 'SHA256SUMS.txt'), sums, 'utf8');

/* 6. 下载说明 */
const apkSize = readFileSync(apkOut).length;
const srcSize = readFileSync(sourceZip).length;
const webSize = readFileSync(webZip).length;
writeFileSync(
  join(outDir, '下载说明.md'),
  [
    `# 学习 OS ${tag} · 下载与安装`,
    '',
    `> 版本 ${version} / Android versionCode ${versionCode}；MIT 许可。`,
    '> 项目介绍：仓库内 `docs/项目介绍.md`',
    '',
    '## 选哪个文件',
    '',
    '| 文件 | 大小 | 适合谁 | 怎么用 |',
    '|---|---|---|---|',
    `| \`LearningOS-${tag}.apk\` | ${mb(apkSize)} | 想直接装到安卓手机 | 传到手机，允许「安装未知来源应用」，覆盖安装会保留数据 |`,
    `| \`LearningOS-${tag}-web.zip\` | ${mb(webSize)} | 想在浏览器/自己服务器上用 | 解压后把内容放到任意静态服务器；本地可用 \`npx serve\` |`,
    `| \`LearningOS-${tag}-source.zip\` | ${mb(srcSize)} | 想读代码/自己构建 | 解压 → \`npm ci\` → \`npx tsc -b\` → \`npm run build\`（Android 见 README） |`,
    '| `SHA256SUMS.txt` | - | 想校验完整性 | Windows: `Get-FileHash -Algorithm SHA256 文件名`；macOS/Linux: `sha256sum -c SHA256SUMS.txt` |',
    '',
    '## 安装 APK',
    '',
    '1. 把 APK 传到手机（数据线 / 微信文件传输 / 网盘均可）。',
    '2. 打开文件，系统会提示允许安装未知来源应用 —— 这是侧载，不是从应用商店安装。',
    '3. 覆盖安装会保留已有学习数据；卸载重装会清空数据，请先在「设置 → 数据」导出备份。',
    '',
    '## Web 版',
    '',
    '- 解压 `web.zip` 后是纯静态文件（含 PWA 的 `sw.js`），可部署到任意静态托管。',
    '- 浏览器里数据存在该站点的 IndexedDB/localStorage；**不同域名之间数据不互通**。',
    '- 网页版关掉页面后收不到通知（系统通知本来也还没做）。',
    '',
    '## 校验',
    '',
    '```',
    sums.trim(),
    '```',
    '',
    '## 这一版是什么',
    '',
    `- 本版说明：仓库内 \`docs/UPDATE-${tag}.md\`（若存在）。`,
    '- 完整的更新说明与已知边界见仓库 README 与 `docs/项目介绍.md`。',
    '',
  ].join('\n'),
  'utf8',
);

rmSync(stage, { recursive: true, force: true });
console.log('\n发布包：');
for (const f of [...files, join(outDir, 'SHA256SUMS.txt'), join(outDir, '下载说明.md')]) {
  console.log('  ', f, existsSync(f) ? mb(readFileSync(f).length) : '（文本）');
}
