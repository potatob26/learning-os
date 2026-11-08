/**
 * 核对 APK 里真的包含了各项功能
 * 直接读包内的 JS bundle，按关键字确认，而不是只看构建日志说"成功"。
 *
 * 用法：node scripts/check-apk-content.mjs [apk路径]
 *      不传则自动取 release/ 下版本号最大的那个。
 *
 * ⚠️ 这里原本把 APK 路径硬编码成 LearningOS-v1.2.0.apk。
 *    发到 v1.2.11 之后它仍去检查旧包，于是对着旧包报出"20/20 通过" ——
 *    看起来是绿的实际什么都没验。改为自动选取最新的包，
 *    并在输出里**打印被检查的文件名**，避免再次看走眼。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** 取 release 下版本号最大的 APK */
function latestApk() {
  const files = readdirSync('release').filter((f) => f.endsWith('.apk'));
  if (files.length === 0) throw new Error('release 下没有 APK');
  const ver = (f) => (f.match(/v(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  files.sort((a, b) => {
    const A = ver(a);
    const B = ver(b);
    for (let i = 0; i < 3; i++) if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0);
    return 0;
  });
  return join('release', files[files.length - 1]);
}

const APK = process.argv[2] ?? latestApk();
const TMP = '.preview/apkcheck';

console.log(`检查目标: ${APK}\n`);

execFileSync('powershell', ['-NoProfile', '-Command', `Remove-Item -Recurse -Force '${TMP}' -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force -Path '${TMP}' | Out-Null`], { stdio: 'inherit' });
execFileSync('tar', ['-xf', APK, '-C', TMP], { stdio: 'inherit' });

const assetsDir = join(TMP, 'assets', 'public', 'assets');
const files = readdirSync(assetsDir);
const bundle = files.find((f) => f.endsWith('.js'));
const css = files.find((f) => f.endsWith('.css'));

console.log(`包内 JS: ${bundle}`);
console.log(`包内 CSS: ${css}\n`);

const js = readFileSync(join(assetsDir, bundle), 'utf8');
const style = readFileSync(join(assetsDir, css), 'utf8');

/** 本轮新增的功能，逐个用关键字确认真的打进了包 */
const CHECKS = [
  ['首页「现在该做什么」推荐', js, '现在该做什么'],
  ['推荐理由文案', js, '今天的计划里还没做的一项'],
  ['推荐引擎：逾期加权', js, '已经逾期'],
  ['换一个', js, '换一个'],
  ['统计页：日历标签', js, '学习日历'],
  ['统计页：热力图标签', js, '学习热力图'],
  ['日历：没有学习记录的空态', js, '这一天没有记录'],
  ['专注模式', js, '专注计时'],
  ['专注：全屏失败如实提示', js, '无法进入全屏'],
  ['专注：横屏锁定失败如实提示', js, '无法锁定横屏'],
  ['全屏 API 调用', js, 'requestFullscreen'],
  ['方向锁 API 调用', js, 'lock'],
  ['液态玻璃组件（用户提供）', js, 'liquid-glass'],
  // 注意不能拿函数名（analyzeImage / recommendDim）来查：
  // 压缩后函数名会被重命名。用用户可见文案才靠得住。
  ['背景自动暗化：自动模式说明', js, '切换浅色/深色时也会自动重算'],
  ['背景自动暗化：手动接管说明', js, '已由你手动设定，不再自动调整'],
  ['--accent-on-soft 令牌', style, '--accent-on-soft'],
  ['--primary-bg 令牌', style, '--primary-bg'],
  ['--danger-bg 令牌', style, '--danger-bg'],
  ['--heat 令牌（日历热力）', style, '--heat-4'],
  ['液态玻璃主题配色', style, "liquid-glass-wc"],
  // v1.2.1 起的更新
  ['更新说明弹层', js, '本次更新'],
  // 用字面量属性值而不是组件名：组件名压缩后会被重命名，
  // 拿它来查必然假阴性（曾因此误报"底栏滑动玻璃未打进包"）。
  ['底栏滑动玻璃', js, 'data-component-glass'],
  ['底栏内容折射纹理', js, 'navigation-content'],
  ['折射参数设置', js, '折射强度'],
];

let pass = 0;
for (const [name, hay, needle] of CHECKS) {
  const ok = hay.includes(needle);
  if (ok) pass += 1;
  console.log(`${ok ? '✓' : '✗'}  ${name}`);
}

console.log(`\n===== ${pass}/${CHECKS.length} 项已打进包内 =====`);
console.log(`JS ${(js.length / 1024).toFixed(0)} KB · CSS ${(style.length / 1024).toFixed(0)} KB`);

execFileSync('powershell', ['-NoProfile', '-Command', `Remove-Item -Recurse -Force '${TMP}'`], { stdio: 'inherit' });
if (pass !== CHECKS.length) process.exit(1);
