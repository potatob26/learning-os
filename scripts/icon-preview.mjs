/**
 * 换新 App 图标 —— 测量 + 两套方案预览（先让你选，不写正式资源）
 * ──────────────────────────────────────────────────────────────────────────────
 * 实测结论：图标本体几乎铺满整张画布，四个角是半径约 270px 的大圆角（占边长 26%），
 * 「圆角以外的填充」只占 5.8% 面积，集中在四个角。
 *
 * 两套做法：
 *   A 保留卡片：圆角外裁成透明，自适应图标的背景层用那个填充色 → 设计不变
 *   B 补满同色：把圆角外用本体色沿径向补满 → 整块没有边界，遮罩切哪都一样
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = process.argv[2];
const OUT = 'release/icons-preview';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
mkdirSync(OUT, { recursive: true });
const b64 = readFileSync(SRC).toString('base64');

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<body style="margin:0"><img id="i" src="data:image/png;base64,${b64}"></body>`);
await page.waitForFunction(() => document.getElementById('i').complete);

const res = await page.evaluate(async () => {
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

  /* ── 逐行测左边界：只在前 30% 宽度内找最强梯度，并用「必须递减」过滤误判 ── */
  const XMAX = Math.round(W * 0.3);
  const raw = new Array(H).fill(null);
  for (let y = 2; y < Math.round(H * 0.45); y++) {
    let bx = -1, bv = 0;
    for (let x = 1; x < XMAX; x++) if (G[y * W + x] > bv) { bv = G[y * W + x]; bx = x; }
    raw[y] = bv > 4 ? bx : null;
  }
  // 递减过滤：真边界随 y 增大只会变小
  const table = new Array(H).fill(null);
  let last = Infinity;
  for (let y = 0; y < H; y++) {
    if (raw[y] == null) continue;
    if (raw[y] <= last + 2) { table[y] = raw[y]; last = raw[y]; }
  }
  // 线性插值补齐
  const Lf = new Float32Array(H);
  let prev = -1;
  for (let y = 0; y < H; y++) {
    if (table[y] != null) {
      if (prev < 0) { for (let k = 0; k <= y; k++) Lf[k] = table[y] + (y - k) * 6.2; }
      else {
        const dy = y - prev;
        for (let k = prev + 1; k < y; k++) Lf[k] = table[prev] + (table[y] - table[prev]) * (k - prev) / dy;
      }
      Lf[y] = table[y]; prev = y;
    } else if (prev >= 0 && table[prev] === 0) Lf[y] = 0;
  }
  // 尾部：用圆角模型收敛到 0（实测 r≈270 在该段非常吻合）
  const R = 270;
  for (let y = 0; y < H; y++) {
    if (y >= R) { Lf[y] = 0; continue; }
    if (table[y] == null) {
      const circle = R - Math.sqrt(Math.max(0, R * R - (R - y) * (R - y)));
      if (prev < 0 || Lf[y] > circle) Lf[y] = Math.min(Lf[y] || circle, circle);
    }
  }
  for (let y = 0; y < H; y++) Lf[y] = Math.max(0, Math.min(XMAX, Lf[y]));

  // inside：左右上下四条边界同时满足
  const inside = (x, y) => x >= Lf[y] && y >= Lf[x] && x <= W - 1 - Lf[y] && y <= H - 1 - Lf[x];

  /* ── 变体 A：圆角外 → 透明 ── */
  const ca = document.createElement('canvas'); ca.width = W; ca.height = H;
  const ga = ca.getContext('2d', { willReadFrequently: true });
  ga.drawImage(img, 0, 0);
  const ia = ga.getImageData(0, 0, W, H);
  /* ── 变体 B：圆角外 → 沿径向取本体色补满 ── */
  const cb = document.createElement('canvas'); cb.width = W; cb.height = H;
  const gb = cb.getContext('2d', { willReadFrequently: true });
  gb.drawImage(img, 0, 0);
  const ib = gb.getImageData(0, 0, W, H);

  let cut = 0, sum = [0, 0, 0], n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (inside(x, y)) continue;
    const i = (y * W + x) * 4;
    ia.data[i + 3] = 0;
    cut++;
    // 朝「所在那个角」的圆弧圆心走（= 沿边缘法线方向），直到踩进本体。
    // 不能朝画布中心走：那样在角上会斜着穿过去，取到本体内部的渐变，补出来有色差。
    const CX = x < W / 2 ? R : W - R;
    const CY = y < H / 2 ? R : H - R;
    let dx = CX - x, dy = CY - y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    let sx = x, sy = y, entered = false;
    for (let s = 1; s < 600; s++) {
      sx = x + dx * s; sy = y + dy * s;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) break;
      if (inside(Math.round(sx), Math.round(sy))) { entered = true; break; }
    }
    // 再往里多走 10px，避开边缘抗锯齿的过渡像素，取到干净的本体色
    if (entered) { sx += dx * 10; sy += dy * 10; }
    const j = (Math.min(H - 1, Math.max(0, Math.round(sy))) * W + Math.min(W - 1, Math.max(0, Math.round(sx)))) * 4;
    ib.data[i] = d[j]; ib.data[i + 1] = d[j + 1]; ib.data[i + 2] = d[j + 2]; ib.data[i + 3] = 255;
    sum[0] += d[j]; sum[1] += d[j + 1]; sum[2] += d[j + 2]; n++;
  }
  // B 的四周改用**统一的平色**：四个角各自补出来的颜色略有差异，
  // 放到启动器遮罩下会看到接缝，平色则与背景层完全一致、且与缩放无关。
  const flat = sum.map((v) => Math.round(v / n));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (inside(x, y)) continue;
    const i = (y * W + x) * 4;
    ib.data[i] = flat[0]; ib.data[i + 1] = flat[1]; ib.data[i + 2] = flat[2]; ib.data[i + 3] = 255;
  }
  ga.putImageData(ia, 0, 0);
  gb.putImageData(ib, 0, 0);

  // 变体 C：B 再把本体最外那圈边缘阴影裁掉、用同色补满 —— 更干净，logo 也小一点
  const INSET = 34;
  const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
  const gc2 = cc.getContext('2d');
  gc2.fillStyle = `rgb(${flat.join(',')})`;
  gc2.fillRect(0, 0, W, H);
  gc2.imageSmoothingQuality = 'high';
  gc2.drawImage(cb, INSET, INSET, W - INSET * 2, H - INSET * 2, INSET, INSET, W - INSET * 2, H - INSET * 2);

  // 角部填充色（源图最外角）
  const px = (src, x, y) => { const i = (y * W + x) * 4; return [src[i], src[i + 1], src[i + 2]]; };
  const src = ia.data;
  const fillCorner = px(src, 3, 3);

  return {
    W, H, cut, total: W * H,
    fillCorner, bodyCorner: flat, avgExtend: flat,
    Ls: [0, 5, 10, 21, 31, 52, 83, 125, 187, 240, 269, 275, 300].map((y) => [y, Math.round(Lf[y])]),
    a: ca.toDataURL('image/png'),
    b: cb.toDataURL('image/png'),
    c: cc.toDataURL('image/png'),
  };
});

const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
console.log(`原图 ${res.W}×${res.H}`);
console.log(`圆角外像素 ${res.cut} / ${res.total} = ${(res.cut / res.total * 100).toFixed(2)}%`);
console.log(`角部填充色 ${hex(res.fillCorner)}   补满后角部色 ${hex(res.bodyCorner)}   补满平均取自 rgb(${res.avgExtend.join(',')})`);
console.log('测得的左边界曲线 L(y):');
for (const [y, x] of res.Ls) console.log(`  y=${String(y).padStart(4)}  L=${x}`);

/** 对照图：三种遮罩下 A / B 的表现 */
const preview = await page.evaluate(async ({ a, b, c: imgC, fillA, fillB }) => {
  const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
  const [ia, ib, ic] = await Promise.all([load(a), load(b), load(imgC)]);
  const S = 240, PAD = 16, LBL = 34;
  const rows = [
    { t: 'A1 · 保留圆角卡片，铺满画布 100%（对齐方圆遮罩）', img: ia, scale: 1.0, bg: fillA },
    { t: 'A2 · 保留卡片，缩到安全区 61%', img: ia, scale: 0.61, bg: fillA },
    { t: 'C  · 圆角外补成本体色铺满（抹掉卡片轮廓）', img: ic, scale: 1.0, bg: fillB },
  ];
  const masks = [['squircle', '方圆遮罩（半径 28%）'], ['circle', '圆形遮罩']];
  const c = document.createElement('canvas');
  c.width = PAD + masks.length * (S + PAD);
  c.height = PAD + rows.length * (S + LBL + PAD);
  const g = c.getContext('2d');
  g.fillStyle = '#e4e6ea'; g.fillRect(0, 0, c.width, c.height);
  rows.forEach((row, ri) => {
    const y0 = PAD + ri * (S + LBL + PAD);
    g.font = '700 17px "Segoe UI",sans-serif'; g.fillStyle = '#1b1f26';
    g.fillText(row.t, PAD, y0 - 8 + 20);
    masks.forEach(([mask, name], ci) => {
      const x0 = PAD + ci * (S + PAD), yy = y0 + LBL - 14;
      g.save();
      g.beginPath();
      if (mask === 'circle') g.arc(x0 + S / 2, yy + S / 2, S / 2, 0, Math.PI * 2);
      else g.roundRect(x0, yy, S, S, S * 0.28);
      g.clip();
      g.fillStyle = row.bg; g.fillRect(x0, yy, S, S);
      const sz = S * row.scale, off = (S - sz) / 2;
      g.drawImage(row.img, x0 + off, yy + off, sz, sz);
      g.restore();
      g.font = '500 14px "Segoe UI",sans-serif'; g.fillStyle = '#5b626c';
      g.fillText(name, x0 + 2, yy + S + 20);
      g.font = '700 17px "Segoe UI",sans-serif';
    });
  });
  return c.toDataURL('image/png');
}, { a: res.a, b: res.b, c: res.c, fillA: hex(res.fillCorner), fillB: hex(res.bodyCorner) });

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/preview-approaches.png`, Buffer.from(preview.split(',')[1], 'base64'));
writeFileSync(`${OUT}/variant-a-cut.png`, Buffer.from(res.a.split(',')[1], 'base64'));
writeFileSync(`${OUT}/variant-b-filled.png`, Buffer.from(res.b.split(',')[1], 'base64'));
writeFileSync(`${OUT}/variant-c-inset.png`, Buffer.from(res.c.split(',')[1], 'base64'));
console.log(`\n对照图  ${OUT}/preview-approaches.png`);
console.log(`变体 A  ${OUT}/variant-a-cut.png`);
console.log(`变体 B  ${OUT}/variant-b-filled.png`);
console.log(`变体 C  ${OUT}/variant-c-inset.png`);
await browser.close();
