/**
 * 导出「干净历史」的公开仓库
 * ──────────────────────────────────────────────────────────────
 * 为什么需要它：私有开发仓库的 git 历史里有旧签名口令、真机序列号、本机路径，
 * 直接 `git push` 会把历史一起公开。这个脚本只复制**当前工作树里的公开文件**到一个
 * 新目录，重新 `git init` + 首次提交 —— 公开仓库只有这一条提交，历史干净。
 *
 * 用法：
 *   node scripts/export-public-repo.mjs [目标目录]
 * 默认目标：D:\LearningOS-public
 *
 * 导出后：
 *   cd D:\LearningOS-public
 *   git remote add origin https://github.com/potatob26/learning-os.git
 *   git push -u origin main
 *
 * ⚠️ 目标目录必须不存在或为空（脚本拒绝覆盖，避免误删）。
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isPublicFile } from './public-files.mjs';

const target = process.argv[2] ?? 'D:\\LearningOS-public';

if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`目标目录非空：${target}\n先确认里面没有要保留的东西，再删掉或换一个路径。`);
  process.exit(1);
}

const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter(isPublicFile);

mkdirSync(target, { recursive: true });
let copied = 0;
for (const file of tracked) {
  if (!existsSync(file)) continue;
  const dest = join(target, file);
  mkdirSync(join(dest, '..'), { recursive: true });
  cpSync(file, dest);
  copied += 1;
}

const git = (args) => execFileSync('git', args, { cwd: target, stdio: 'inherit' });
git(['init', '-b', 'main']);
git(['add', '-A']);
git(['commit', '-m', '初始开源快照：学习 OS v1.4.3（MIT）']);

const files = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], {
  cwd: target,
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);

const size = files.reduce((sum, f) => {
  try {
    return sum + statSync(join(target, f)).size;
  } catch {
    return sum;
  }
}, 0);
console.log(`\n导出完成：${target}`);
console.log(`文件 ${files.length} 个，约 ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log('下一步：');
console.log(`  cd ${target}`);
console.log('  git remote add origin https://github.com/potatob26/learning-os.git');
console.log('  git push -u origin main');
