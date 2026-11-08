/**
 * 生成 App 图标与 favicon —— 纯程序绘制，零外部素材
 * ──────────────────────────────────────────────────────────
 * 不依赖任何图形库：手写 PNG 编码（zlib + CRC32），
 * 形状用超采样抗锯齿绘制「打开的书 / 知识」抽象图形。
 *
 * 输出：public/icons/icon-192.png、icon-512.png、icon-maskable-512.png
 *       public/apple-touch-icon.png、public/favicon.svg
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'public');
const ICONS = join(OUT, 'icons');

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行前面加一个 filter 字节
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 绘制 ---------------- */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

/** 圆角矩形内部判定（用于 maskable 底板） */
function inRoundedRect(x, y, size, radius) {
  const r = radius;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * 图形：一本打开的书（描边风格，与 favicon.svg 一致）
 * 用线段距离场 + 超采样得到平滑描边，不需要任何图形库。
 */
function bookCoverage(x, y, size) {
  // 归一化坐标
  const u = x / size;
  const v = y / size;

  const stroke = size * 0.034;
  const half = stroke / 2;

  const spineTop = 0.245;
  const spineBottom = 0.705;
  const outerTop = 0.2;
  const outerBottom = 0.15;
  const elbowX = 0.455;
  const baseY = 0.795;

  let d = Infinity;
  const seg = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((u - x1) * dx + (v - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(u - (x1 + t * dx), v - (y1 + t * dy));
  };

  for (const sign of [1, -1]) {
    const mx = (a) => (sign === 1 ? a : 1 - a);
    // 顶端水平段：从外缘到折角
    d = Math.min(d, seg(mx(outerTop), spineTop, mx(elbowX), spineTop));
    // 外缘斜线：从顶端外缘到底部外缘
    d = Math.min(d, seg(mx(outerTop), spineTop, mx(outerBottom), baseY));
    // 底边：从外缘回到书脊底部
    d = Math.min(d, seg(mx(outerBottom), baseY, mx(0.492), spineBottom));
  }

  if (d * size <= half) return 1;
  // 书脊竖线
  if (Math.abs(u - 0.5) * size <= half && v >= spineTop && v <= spineBottom) return 1;
  return 0;
}

function render(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // 超采样
  const from = [0x3f, 0x7d, 0xf6]; // accent
  const to = [0x27, 0x5f, 0xd8]; // accent-strong

  // maskable 需要留出安全边距（内容放在中心 80% 圆内）
  const inset = maskable ? size * 0.1 : 0;
  const plateSize = size - inset * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          // 底板：普通图标是圆角方形；maskable 用整块
          const plateHit = maskable ? 1 : inRoundedRect(px, py, size, size * 0.235) ? 1 : 0;
          if (!plateHit) continue;

          // 渐变底
          const grad = Math.min(1, Math.max(0, (px * 0.35 + py * 0.75) / size));
          const base = mix(from, to, grad);

          // 书本图形（白色描边）
          const local = maskable
            ? bookCoverage(px - inset, py - inset, plateSize)
            : bookCoverage(px, py, size);

          const col = local > 0 ? [255, 255, 255] : base;
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      if (a === 0) {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
      } else {
        const cov = a / (n * 255);
        rgba[i] = Math.round(r / (a / 255));
        rgba[i + 1] = Math.round(g / (a / 255));
        rgba[i + 2] = Math.round(b / (a / 255));
        rgba[i + 3] = Math.round(cov * 255);
      }
    }
  }

  return encodePng(size, size, rgba);
}

/* ---------------- favicon.svg ---------------- */

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3f7df6"/>
      <stop offset="1" stop-color="#275fd8"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 45V23.5c0-1.2.7-2.2 1.9-2.6L32 14.5l18.1 6.4c1.2.4 1.9 1.4 1.9 2.6V45"
      stroke-width="4.2"/>
    <path d="M32 14.5V45" stroke-width="3.4"/>
  </g>
</svg>
`;

mkdirSync(ICONS, { recursive: true });

writeFileSync(join(ICONS, 'icon-192.png'), render(192, { maskable: false }));
writeFileSync(join(ICONS, 'icon-512.png'), render(512, { maskable: false }));
writeFileSync(join(ICONS, 'icon-maskable-512.png'), render(512, { maskable: true }));
writeFileSync(join(OUT, 'apple-touch-icon.png'), render(180, { maskable: false }));
writeFileSync(join(OUT, 'favicon.svg'), FAVICON);

console.log('已生成图标：');
console.log('  public/icons/icon-192.png');
console.log('  public/icons/icon-512.png');
console.log('  public/icons/icon-maskable-512.png');
console.log('  public/apple-touch-icon.png');
console.log('  public/favicon.svg');
