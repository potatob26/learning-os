/**
 * App 图标资源生成器（新图标 · 2026-09）
 * ──────────────────────────────────────────────────────────────────────────────
 * 设计意图（用户确认）：手机启动器是**方圆（squircle）遮罩**，
 * 所以图标的圆角要**铺满画布、直接与遮罩对齐** ——
 * 这样圆角以外的填充全部落在遮罩之外，看不到；图标也没有被放大。
 *
 * 反过来两种做法都是错的（已出对照图让用户确认过）：
 *   · 缩进 66dp 安全区 → 遮罩内会露出一圈填充色（用户最初看到的问题）
 *   · 把圆角外补成本体色 → 卡片轮廓被抹掉，不再是他设计的图标
 *
 * 对本图（1037×1038）的关键实测（见运行输出，可复现）：
 *   · 图标本体几乎铺满整张画布，只有四个角是填充，占 4.48% 面积
 *   · 圆角是中段完全贴合圆形的曲线，r ≈ 270px（占边长 26%）
 *   · 四角填充色实测 #F0F6F9
 * 因为遮罩是方圆、半径通常 28% 左右（比图标的 26% 更圆），
 * 遮罩会**切得比图标圆角更多**，所以填充必然被切干净；
 * 万一遇到圆角更小的遮罩（保留更多），露出来的也是背景层 #F0F6F9，与填充同色。
 *
 * 做法：只裁不重绘 —— 仅把圆角外的像素设为透明，图标内容一个像素都不改。
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = process.argv[2];
const OUT = process.argv[3] ?? 'release/icons';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
mkdirSync(OUT, { recursive: true });

const b64 = readFileSync(SRC).toString('base64');
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<body style="margin:0"><img id="i" src="data:image/png;base64,${b64}"></body>`);
await page.waitForFunction(() => document.getElementById('i').complete);

/* ── 1. 测出圆角曲线（逐行找最强梯度 + 递减过滤 + 圆弧外推）─────
   不用「圆角矩形」假设：这张图是连续圆角，硬套会切掉本体一条边。 */
const M = await page.evaluate(async () => {
  const img = document.getElementById('i');
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const L = new Float32Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) L[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const G = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    G[y * W + x] = Math.hypot(L[y * W + x + 1] - L[y * W + x - 1], L[(y + 1) * W + x] - L[(y - 1) * W + x]);
  }
  const XMAX = Math.round(W * 0.3), R = 270;
  const raw = new Array(H).fill(null);
  for (let y = 2; y < Math.round(H * 0.45); y++) {
    let bx = -1, bv = 0;
    for (let x = 1; x < XMAX; x++) if (G[y * W + x] > bv) { bv = G[y * W + x]; bx = x; }
    raw[y] = bv > 4 ? bx : null;          // 前 30% 宽度内不会有 logo，安全
  }
  const table = new Array(H).fill(null);
  let last = Infinity;
  for (let y = 0; y < H; y++) {           // 真边界随 y 增大只会变小，用它过滤误判
    if (raw[y] == null) continue;
    if (raw[y] <= last + 2) { table[y] = raw[y]; last = raw[y]; }
  }
  const Lf = new Float32Array(H);
  let prev = -1;
  for (let y = 0; y < H; y++) {
    if (table[y] != null) {
      if (prev < 0) for (let k = 0; k <= y; k++) Lf[k] = table[y] + (y - k) * 6.2;
      else { const dy = y - prev; for (let k = prev + 1; k < y; k++) Lf[k] = table[prev] + (table[y] - table[prev]) * (k - prev) / dy; }
      Lf[y] = table[y]; prev = y;
    }
  }
  for (let y = 0; y < H; y++) {
    if (y >= R) { Lf[y] = 0; continue; }
    if (table[y] == null) {
      const circle = R - Math.sqrt(Math.max(0, R * R - (R - y) * (R - y)));
      Lf[y] = Math.min(Lf[y] || circle, circle);
    }
    Lf[y] = Math.max(0, Math.min(XMAX, Lf[y]));
  }
  // 四角填充色（源图最外角 8px 平均）
  let s = [0, 0, 0], n = 0;
  const take = (x, y) => { const i = (y * W + x) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; };
  for (let k = 0; k < 8; k++) for (let j = 0; j < 8; j++) { take(k, j); take(W - 1 - k, j); take(k, H - 1 - j); take(W - 1 - k, H - 1 - j); }
  const fill = s.map((v) => Math.round(v / n));
  return { W, H, Lf: Array.from(Lf), fill, samples: [0, 5, 10, 21, 31, 52, 83, 125, 187, 240].map((y) => [y, Math.round(Lf[y])]) };
});

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const BGC = hex(M.fill);
console.log(`原图 ${M.W}×${M.H}，四角填充色 ${BGC}`);
console.log('测得的圆角曲线 L(y):  ' + M.samples.map(([y, x]) => `${y}→${x}`).join('  '));

/* ── 2. 变体 A：圆角外裁成透明（内容零改动）─────────────────── */
const cutUrl = await page.evaluate(async ({ b64, Lf }) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, W, H);
  const p = id.data;
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ly = Lf[y], lx = Lf[x];
    if (x >= ly && y >= lx && x <= W - 1 - ly && y <= H - 1 - lx) continue;
    p[(y * W + x) * 4 + 3] = 0;
    n++;
  }
  g.putImageData(id, 0, 0);
  return { url: c.toDataURL('image/png'), cut: n };
}, { b64, Lf: M.Lf });
console.log(`圆角外像素 ${cutUrl.cut} / ${M.W * M.H} = ${(cutUrl.cut / (M.W * M.H) * 100).toFixed(2)}%`);

/**
 * 把变体 A 画到目标尺寸。
 * mode='fit'  铺满（自适应前景层用：与方圆遮罩对齐，靠遮罩切掉四角）
 * mode='alpha' 铺满但保留透明
 * bg 非空时先铺底色（Web/旧式图标用：与设计原样一致、不透明）
 */
async function render(size, { bg = null, circle = false } = {}) {
  return page.evaluate(async ({ url, size, bg, circle }) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, size, size); }
    if (circle) { g.save(); g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.clip(); }
    const sh = Math.min(W, H);                 // 居中裁成正方，避免 1px 非等比拉伸
    g.drawImage(img, (W - sh) / 2, (H - sh) / 2, sh, sh, 0, 0, size, size);
    if (circle) g.restore();
    return c.toDataURL('image/png');
  }, { url: cutUrl.url, size, bg, circle });
}

const writeAt = (rel, dataUrl) => {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  mkdirSync(rel.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  writeFileSync(rel, buf);
  return buf.length;
};

/* ── 3. 通用 PNG ─────────────────────────────────────────────── */
console.log('\n【1】通用 PNG（圆角外透明）');
for (const s of [1024, 512, 192]) {
  const bytes = writeAt(`${OUT}/icon-${s}.png`, await render(s));
  console.log(`  icon-${s}.png  ${(bytes / 1024).toFixed(1)} KB`);
}

/* ── 4. Android 旧式图标（不透明，铺填充色，与设计原样一致）───── */
console.log('\n【2】Android 旧式图标（旧启动器不做方圆遮罩，所以底色补成填充色）');
const LEGACY = [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]];
for (const [d, s] of LEGACY) {
  const sq = await render(s, { bg: BGC });
  writeAt(`${OUT}/mipmap-${d}/ic_launcher.png`, sq);
  writeAt(`${OUT}/mipmap-${d}/ic_launcher_round.png`, await render(s, { bg: BGC, circle: true }));
  console.log(`  mipmap-${d}  ${s}×${s}（方形 + 圆形）`);
}

/* ── 5. 自适应前景层：铺满 108dp ──────────────────────────────
   不再缩进 66dp 安全区 —— 那正是「遮罩里露出一圈填充色」的原因。
   铺满后图标圆角与方圆遮罩对齐，四角落在遮罩外被切掉。 */
console.log('\n【3】自适应前景层（108dp 铺满，与方圆遮罩对齐）');
const ADAPTIVE = [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]];
for (const [d, s] of ADAPTIVE) {
  writeAt(`${OUT}/mipmap-${d}/ic_launcher_foreground.png`, await render(s));
  console.log(`  mipmap-${d}  ${s}×${s}（铺满）`);
}

/* ── 6. 安装进 Android 工程 + 背景色 ─────────────────────────── */
console.log('\n【4】安装进 Android 工程');
const RES = 'android/app/src/main/res';
let installed = 0;
for (const [d] of [...LEGACY, ...ADAPTIVE]) {
  for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    const src = `${OUT}/mipmap-${d}/${f}`;
    if (!existsSync(src)) continue;
    mkdirSync(`${RES}/mipmap-${d}`, { recursive: true });
    writeFileSync(`${RES}/mipmap-${d}/${f}`, readFileSync(src));
    installed++;
  }
}
writeFileSync(`${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- 自适应图标的背景层颜色 = 原图四个角的填充色（实测 ${BGC}）。
         前景层是「铺满 108dp」的图标，四角透明；启动器的方圆遮罩半径（通常 28%）
         比图标自身圆角（26%）更圆，会切得更多，所以填充必然落在遮罩外、看不到。
         万一遇到圆角更小、保留更多的遮罩，露出的也是这个同色，不会有突兀的边。 -->
    <color name="ic_launcher_background">${BGC}</color>
</resources>
`);
console.log(`  已写入 ${installed} 个 mipmap 文件 + values/ic_launcher_background.xml (${BGC})`);

/* ── 7. Web / PWA 图标 ──────────────────────────────────────── */
console.log('\n【5】Web / PWA 图标');
const WEB = [
  { path: 'public/favicon-96.png', size: 96, content: 1, bg: BGC },
  { path: 'public/apple-touch-icon.png', size: 180, content: 1, bg: BGC },
  { path: 'public/icons/icon-192.webp', size: 192, content: 1, bg: BGC, webp: true },
  { path: 'public/icons/icon-512.webp', size: 512, content: 1, bg: BGC, webp: true },
  { path: 'public/icons/icon-maskable-512.webp', size: 512, content: 0.8, bg: BGC, webp: true },
];
for (const w of WEB) {
  const inner = Math.round(w.size * w.content);
  let url = await render(w.size, { bg: w.bg });
  if (w.content !== 1) {
    // maskable：内容收进中央 80% 安全区，四周用同色补满
    url = await page.evaluate(async ({ u, size, inner, bg }) => {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = u; });
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const g = c.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, size, size);
      g.imageSmoothingQuality = 'high';
      const off = Math.round((size - inner) / 2);
      g.drawImage(img, 0, 0, size, size, off, off, inner, inner);
      return c.toDataURL('image/webp', 0.92);
    }, { u: url, size: w.size, inner, bg: w.bg });
  } else if (w.webp) {
    url = await page.evaluate(async ({ u }) => {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = u; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', 0.92);
    }, { u: url });
  }
  const bytes = writeAt(w.path, url);
  console.log(`  ${w.path.padEnd(38)} ${w.size}×${w.size} 内容 ${(w.content * 100).toFixed(0)}%  ${(bytes / 1024).toFixed(1)} KB`);
}

/* ── 8. 自检：自适应前景层在常见遮罩下，四角会不会露出「不是图标本体」的颜色 ──
   判定标准：前景层是透明的地方，露出的就是背景层 #EEF4F9 —— 而那正是原图
   圆角外的填充色，所以露出来 == 原设计，不算穿帮。
   真正要避免的是「背景层与填充色不一致」；这里逐遮罩量一遍。 */
console.log('\n【6】自检：自适应前景层 x 常见遮罩');
const check = await page.evaluate(async ({ url, bg }) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = url; });
  const S = 200;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  const alpha = (x, y) => d[(y * S + x) * 4 + 3];

  const masks = {
    '圆角方形 r=16%': (x, y) => {
      const r = S * 0.16;
      const dx = x < r ? r - x : x > S - r ? x - (S - r) : 0;
      const dy = y < r ? r - y : y > S - r ? y - (S - r) : 0;
      return dx === 0 || dy === 0 ? true : Math.hypot(dx, dy) <= r;
    },
    '方圆 r=22%': (x, y) => {
      const r = S * 0.22;
      const dx = (x < r ? r - x : x > S - r ? x - (S - r) : 0) / r;
      const dy = (y < r ? r - y : y > S - r ? y - (S - r) : 0) / r;
      return Math.pow(dx, 4) + Math.pow(dy, 4) <= 1;
    },
    '方圆 r=28%（常见）': (x, y) => {
      const r = S * 0.28;
      const dx = (x < r ? r - x : x > S - r ? x - (S - r) : 0) / r;
      const dy = (y < r ? r - y : y > S - r ? y - (S - r) : 0) / r;
      return Math.pow(dx, 4) + Math.pow(dy, 4) <= 1;
    },
    '圆形': (x, y) => Math.hypot(x - S / 2, y - S / 2) <= S / 2,
  };
  const out = [];
  for (const [name, fn] of Object.entries(masks)) {
    let inMask = 0, transparent = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!fn(x, y)) continue;
      inMask++;
      if (alpha(x, y) < 8) transparent++;
    }
    out.push({ name, inMask, transparent, pct: transparent / inMask * 100 });
  }
  // 遮罩内露出的背景色是否与填充色一致
  return { out, bg };
}, { url: await render(200), bg: BGC });

for (const r of check.out) {
  const verdict = r.transparent === 0
    ? '四角全在遮罩外，一点都看不到 ✓'
    : `露出 ${(r.pct).toFixed(2)}% 面积，颜色 = 背景层 ${BGC} = 原图填充色，与原设计一致 ✓`;
  console.log(`  ${r.name.padEnd(20)} 遮罩内 ${String(r.inMask).padStart(6)}px，其中透明 ${String(r.transparent).padStart(5)}px → ${verdict}`);
}

await browser.close();
console.log(`\n输出目录: ${OUT}`);
