/**
 * 用 Chrome 解码 MP4 并抽取关键帧（本机没有 ffmpeg）
 * 用法: node scripts/extract-frames.mjs <videoPath> <outPrefix> [count]
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const videoPath = process.argv[2];
const outPrefix = process.argv[3] ?? 'ref';
const count = Number(process.argv[4] ?? 8);

const outDir = '.preview/ref';
mkdirSync(outDir, { recursive: true });
mkdirSync('public/_ref', { recursive: true });

// 复制到 public 下，浏览器才能通过 http 读取（file:// 会被媒体策略拦）
const local = `public/_ref/${basename(videoPath)}`;
copyFileSync(videoPath, local);
console.log(`视频大小: ${(statSync(local).size / 1024 / 1024).toFixed(2)} MB`);

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });

const meta = await page.evaluate(async (url) => {
  const v = document.createElement('video');
  v.src = url;
  v.muted = true;
  v.playsInline = true;
  await new Promise((res, rej) => {
    v.onloadedmetadata = () => res();
    v.onerror = () => rej(new Error('视频加载失败：' + (v.error?.message ?? '未知')));
    setTimeout(() => rej(new Error('加载超时')), 15000);
  });
  return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
}, `/_ref/${basename(videoPath)}`);

console.log(`时长 ${meta.duration.toFixed(2)}s · 分辨率 ${meta.width}x${meta.height}`);

// 均匀取帧
const times = [];
for (let i = 0; i < count; i++) {
  times.push((meta.duration * (i + 0.5)) / count);
}

for (let i = 0; i < times.length; i++) {
  const dataUrl = await page.evaluate(
    async ([url, t, w, h]) => {
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      v.playsInline = true;
      await new Promise((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error('加载失败'));
      });
      v.currentTime = t;
      await new Promise((res) => {
        v.onseeked = () => res();
        setTimeout(res, 4000);
      });
      // 原尺寸输出，不缩放，确保边缘细节可判读
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.drawImage(v, 0, 0, w, h);
      return c.toDataURL('image/png');
    },
    [`/_ref/${basename(videoPath)}`, times[i], meta.width, meta.height],
  );

  const b64 = dataUrl.split(',')[1];
  const buf = Buffer.from(b64, 'base64');
  const file = `${outDir}/${outPrefix}-${String(i).padStart(2, '0')}_t${times[i].toFixed(2)}s.png`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, buf);
  console.log(`  ✓ ${file}  (${(buf.length / 1024).toFixed(0)} KB)`);
}

await browser.close();
console.log(`\n完成，输出目录 ${outDir}`);
