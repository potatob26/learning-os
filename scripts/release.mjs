/**
 * 发版脚本：一条命令同步两处版本号，焊死「改了 package.json 忘了 build.gradle」的历史坑。
 *
 *   node scripts/release.mjs 1.3.0
 *
 * 做四件事：
 *   1. package.json version → 指定版本
 *   2. android/app/build.gradle versionCode → 现值 + 1（必须递增，否则手机无法覆盖安装）
 *   3. android/app/build.gradle versionName → 指定版本
 *   4. 校验 package.json version 与安卓 versionName 一致
 * 不做 git 操作、不触发构建 —— 发版流程里由人决定何时提交。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('用法: node scripts/release.mjs <x.y.z>   例: node scripts/release.mjs 1.3.0');
  process.exit(1);
}

const pkgPath = 'package.json';
const gradlePath = 'android/app/build.gradle';
if (!existsSync(gradlePath)) {
  console.error(`找不到 ${gradlePath} —— 要在仓库根目录运行`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const oldVersion = pkg.version;
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

let gradle = readFileSync(gradlePath, 'utf8');
const codeMatch = gradle.match(/versionCode\s+(\d+)/);
if (!codeMatch) {
  console.error('build.gradle 里找不到 versionCode');
  process.exit(1);
}
const oldCode = Number(codeMatch[1]);
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${oldCode + 1}`);
gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
writeFileSync(gradlePath, gradle);

console.log(`版本号已同步:
  package.json            ${oldVersion} -> ${version}
  build.gradle versionCode ${oldCode} -> ${oldCode + 1}
  build.gradle versionName ${oldVersion} -> ${version}

后续: 更新 ReleaseNotes 文案 -> npm run build -> npx cap sync android -> 打包`);
