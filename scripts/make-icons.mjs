/**
 * 用用户提供的图生成应用图标
 * ──────────────────────────────────────────────────────────────
 * 处理内容：
 *   1. 自动裁掉四周白边（按非白像素的包围盒）
 *   2. 从四角洪水填充，把圆角外的白底变成透明
 *      ——用填充而不是几何遮罩，是为了忠实保留原图真实的圆角形状
 *   3. 对 alpha 做羽化，避免边缘出现锯齿
 *   4. 输出各尺寸：192 / 512（透明圆角）、512 maskable、180 apple-touch
 *
 * maskable 与 apple-touch 必须是**满幅不透明**的：
 *   maskable 会被安卓按自身形状裁切，留白边会被切出难看的缺口；
 *   iOS 会把透明区域渲染成黑色。
 *   所以这两个版本把图放大后裁中心，让蓝色铺满整块，书本仍在安全区内。
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SRC =
  'C:\\Users\\pc\\.dsh\\attachments\\v1\\objects\\52\\521ecc52a258b7113e12ebc8bf3da2a498327caa109d31743d3ae3bdde98fc68';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const srcBuf = await readFile(SRC);
console.log(`源图: ${(srcBuf.length / 1024).toFixed(0)} KB`);

/**
 * 源图先放到 public 下由开发服务器以 http 提供。
 * 直接塞 1.6MB 的 dataURL 给 about:blank 解码会失败（实测 onerror）。
 */
const TMP_NAME = '_icon-source.png';
const TMP_PATH = path.join('public', TMP_NAME);
await copyFile(SRC, TMP_PATH);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async (srcUrl) => {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('图片解码失败'));
    img.src = srcUrl;
  });

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  // ---- ① 画到画布并读取像素 ----
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const src = g.getImageData(0, 0, W, H);
  const d = src.data;

  const isWhite = (i) => d[i] > 246 && d[i + 1] > 246 && d[i + 2] > 246;

  // ---- ② 求非白内容的包围盒（裁掉白边）----
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!isWhite(i)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('整张图都是白色，找不到内容');
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;

  // ---- ③ 在裁剪后的图上做四角洪水填充，标出外部白底 ----
  const cc = document.createElement('canvas');
  cc.width = cw;
  cc.height = ch;
  const cg = cc.getContext('2d', { willReadFrequently: true });
  cg.drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
  const out = cg.getImageData(0, 0, cw, ch);
  const od = out.data;

  // outside[i] = 1 表示该像素属于外部白底
  const outside = new Uint8Array(cw * ch);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= cw || y >= ch) return;
    const p = y * cw + x;
    if (outside[p]) return;
    const i = p * 4;
    if (!(od[i] > 244 && od[i + 1] > 244 && od[i + 2] > 244)) return;
    outside[p] = 1;
    stack.push(x, y);
  };
  // 四角与四边起点
  for (let x = 0; x < cw; x++) {
    push(x, 0);
    push(x, ch - 1);
  }
  for (let y = 0; y < ch; y++) {
    push(0, y);
    push(cw - 1, y);
  }
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // ---- ④ alpha = 1 - outside，再羽化 ----
  const alpha = new Float32Array(cw * ch);
  for (let p = 0; p < cw * ch; p++) alpha[p] = outside[p] ? 0 : 1;

  // 可分离盒式模糊（半径 2），让边缘平滑过渡，消除锯齿
  const R = 2;
  const tmp = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let s = 0;
      let n = 0;
      for (let k = -R; k <= R; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= cw) continue;
        s += alpha[y * cw + xx];
        n++;
      }
      tmp[y * cw + x] = s / n;
    }
  }
  for (let x = 0; x < cw; x++) {
    for (let y = 0; y < ch; y++) {
      let s = 0;
      let n = 0;
      for (let k = -R; k <= R; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= ch) continue;
        s += tmp[yy * cw + x];
        n++;
      }
      alpha[y * cw + x] = s / n;
    }
  }
  // 羽化会把内部边缘也略微变淡，这里重新拉伸，保证内部仍是不透明
  for (let p = 0; p < cw * ch; p++) {
    od[p * 4 + 3] = Math.round(Math.max(0, Math.min(1, (alpha[p] - 0.15) / 0.7)) * 255);
  }
  cg.putImageData(out, 0, 0);

  const transparent = c.toDataURL; // 占位，避免未使用告警
  void transparent;

  // ---- ⑤ 输出各尺寸 ----
  const make = (size, mode, type, quality) => {
    const oc = document.createElement('canvas');
    oc.width = size;
    oc.height = size;
    const og = oc.getContext('2d');
    og.imageSmoothingEnabled = true;
    og.imageSmoothingQuality = 'high';
    if (mode === 'bleed') {
      // 满幅：放大后裁中心，让圆角外的白底被推出画面。
      // 1.45 倍可保证圆角区域完全移出可视范围，四角不会残留浅色边。
      const S = 1.45;
      const dw = size * S;
      const dh = size * S;
      og.drawImage(cc, (size - dw) / 2, (size - dh) / 2, dw, dh);
    } else {
      // 透明圆角：完整放下，四角透明
      og.drawImage(cc, 0, 0, size, size);
    }
    return oc.toDataURL(type, quality);
  };

  return {
    sourceSize: `${W}x${H}`,
    trimmed: `${cw}x${ch}`,
    inset: `左${minX} 上${minY} 右${W - 1 - maxX} 下${H - 1 - maxY}`,
    // manifest 图标用 WebP：同样尺寸下比 PNG 小约 19 倍，且支持透明。
    // 这个应用本身依赖 React 19 / WebGL / color-mix，能运行的浏览器必然支持 WebP。
    icon192: make(192, 'any', 'image/webp', 0.92),
    icon512: make(512, 'any', 'image/webp', 0.92),
    maskable512: make(512, 'bleed', 'image/webp', 0.92),
    // iOS 的 apple-touch-icon 只认 PNG，必须保留 PNG
    apple180: make(180, 'bleed', 'image/png'),
    // 浏览器标签页图标：PNG 兼容性最好（各浏览器都认），
    // 用 96px 以覆盖 3 倍屏下的 32px 显示
    favicon96: make(96, 'any', 'image/png'),
  };
}, `http://127.0.0.1:5188/${TMP_NAME}`);

await rm(TMP_PATH, { force: true });

console.log(`原图 ${result.sourceSize} → 裁掉白边后 ${result.trimmed}`);
console.log(`四边裁掉量: ${result.inset}`);

const write = async (dataUrl, file) => {
  const b64 = dataUrl.split(',')[1];
  const buf = Buffer.from(b64, 'base64');
  await writeFile(file, buf);
  console.log(`  ✓ ${path.relative(process.cwd(), file)}  ${(buf.length / 1024).toFixed(1)} KB`);
};

await write(result.icon192, 'public/icons/icon-192.webp');
await write(result.icon512, 'public/icons/icon-512.webp');
await write(result.maskable512, 'public/icons/icon-maskable-512.webp');
// iOS 的 apple-touch-icon 固定放在站点根目录（iOS 会自动探测这个位置），
// 只保留一份，避免同样的 50KB 被预缓存两次。
await write(result.apple180, 'public/apple-touch-icon.png');
await write(result.favicon96, 'public/favicon-96.png');

// 旧的 PNG 图标已被 WebP 取代，删除以免白白进入 PWA 预缓存
for (const old of [
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/icons/icon-maskable-512.png',
  'public/icons/apple-touch-icon-180.png',
  // 旧的 favicon 是手绘占位 SVG，已由新图生成的 PNG 取代
  'public/favicon.svg',
]) {
  await rm(old, { force: true });
}
console.log('已清理被取代的旧图标');

await browser.close();
console.log('\n图标已生成。');
