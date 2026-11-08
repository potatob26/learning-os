/**
 * 生成安卓原生资源：启动图标、自适应图标、圆形图标、启动屏
 * ──────────────────────────────────────────────────────────────
 * 全部由应用图标（public/icons/icon-512.webp）派生，保证与 Web 端、
 * 桌面图标完全一致。
 *
 * 自适应图标（Android 8+）的说明：
 *   规范画布 108dp，其中只有中间 66dp 是安全区，其余会被启动器按自身
 *   形状裁掉。这里把「满幅」图标直接铺满 108dp 作为前景 ——
 *   图标本身的书本图案位于中心约 55%（≈59dp），落在 66dp 安全区内，
 *   无论启动器用圆形、方形还是水滴形遮罩都不会切到主体。
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_ICON = 'public/icons/icon-512.webp';
const RES = 'android/app/src/main/res';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

// 让浏览器能通过 http 读到源图（dataURL 太大会解码失败，之前踩过）
const TMP = 'public/_icon-src.webp';
await copyFile(SOURCE_ICON, TMP);

/** 各方位的启动屏像素尺寸（与 Capacitor 默认模板一致） */
const SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];

/** Android 密度 → 启动图标边长 */
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

/** 启动屏背景色：取应用深色主题底色，避免启动瞬间白屏刺眼 */
const SPLASH_BG = '#151b30';

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'domcontentloaded' });

const iconUrl = `http://127.0.0.1:5188/${path.basename(TMP)}`;

const outputs = await page.evaluate(
  async ({ srcUrl, densities, splashes, splashBg }) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('图标解码失败'));
      img.src = srcUrl;
    });

    const mk = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      return { c, g };
    };

    const out = {};

    for (const [name, size, adaptive] of densities) {
      // ① 传统方形图标：满幅铺满（安卓会自动按启动器风格处理）
      {
        const { c, g } = mk(size, size);
        g.drawImage(img, 0, 0, size, size);
        out[`mipmap-${name}/ic_launcher.png`] = c.toDataURL('image/png');
      }
      // ② 圆形图标：先画方形，再用 destination-in 裁成圆
      {
        const { c, g } = mk(size, size);
        g.drawImage(img, 0, 0, size, size);
        g.globalCompositeOperation = 'destination-in';
        g.beginPath();
        g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        g.fill();
        out[`mipmap-${name}/ic_launcher_round.png`] = c.toDataURL('image/png');
      }
      // ③ 自适应前景：108dp 画布，图标铺满（主体在安全区内，见文件头注释）
      {
        const { c, g } = mk(adaptive, adaptive);
        g.drawImage(img, 0, 0, adaptive, adaptive);
        out[`mipmap-${name}/ic_launcher_foreground.png`] = c.toDataURL('image/png');
      }
    }

    // ④ 启动屏：纯色底 + 居中图标
    for (const [dir, w, h] of splashes) {
      const { c, g } = mk(w, h);
      g.fillStyle = splashBg;
      g.fillRect(0, 0, w, h);
      // 图标占短边的 26%，视觉上克制一点
      const s = Math.round(Math.min(w, h) * 0.26);
      g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s);
      out[`${dir}/splash.png`] = c.toDataURL('image/png');
    }

    return out;
  },
  { srcUrl: iconUrl, densities: DENSITIES, splashes: SPLASHES, splashBg: SPLASH_BG },
);

await rm(TMP, { force: true });

let total = 0;
for (const [rel, dataUrl] of Object.entries(outputs)) {
  const file = path.join(RES, rel);
  await mkdir(path.dirname(file), { recursive: true });
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  await writeFile(file, buf);
  total += buf.length;
}
console.log(`已生成 ${Object.keys(outputs).length} 个安卓资源，合计 ${(total / 1024).toFixed(0)} KB`);
for (const rel of Object.keys(outputs).filter((r) => r.startsWith('mipmap-xxxhdpi'))) {
  console.log(`  · ${rel}`);
}

await browser.close();
