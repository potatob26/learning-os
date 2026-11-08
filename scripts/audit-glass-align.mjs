/**
 * 玻璃错位量化 v2（协作任务第二轮 §2.1 头号症状）
 * ──────────────────────────────────────────────────────────────
 * 复现条件（任务书更新版）：图片背景（含高频细节）+ DPR 2/3 + 滚动 + 液态玻璃主题
 *
 * v2 修正：v1 的 24px 棋盘是周期图案（12 CSS px × dpr = 24 设备 px 周期），
 * ±18px 相关搜索会撞上整数周期出现等值假峰（实测 edgeSad=0 的 (−12,−12)）。
 * v2 改用「坐标渐变场」：R = x/W、G = y/H 的线性 ramp（唯一、无周期），
 * 玻璃面内任意像素的偏移可直接解算：dx = R/255·W − x，再对窗口取中位数。
 * 另叠加低强度高频细节（细网格 + 彩点）模拟真实照片的高频，供折射弯折。
 *
 * 五窗口测量区分机制：
 *   · 平移错位（placement/滚动条）：五窗口偏移一致
 *   · 径向错位（vendor 向心放大 p/(1+k)）：中心≈0，随离中心距离线性增长、指向中心
 *   · 采样滞后（滚动 1 帧差）：静止=0，滚动后瞬间非 0，settle 后回 0
 *
 * 同帧前后对比：每状态截「玻璃可见 / 玻璃隐藏」两帧（内容隐藏排除文字干扰）。
 * 用法：node scripts/audit-glass-align.mjs before|after
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const phase = process.argv[2] === 'after' ? 'after' : 'before';
const OUT = `.preview/glass-align/${phase}`;
mkdirSync(OUT, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ],
});

/** 页内测量函数（注入页面执行）：五窗口偏移解算 + 玻璃/背景同帧像素抓取 */
const MEASURE_SRC = `
window.__glassAlign = async function (route) {
  location.hash = route;
  await new Promise((r) => setTimeout(r, 1500));
  const layer = document.querySelector('.refract-layer');
  if (!layer) return { error: 'no .refract-layer' };
  const glasses = Array.from(layer.querySelectorAll('liquid-glass'));
  if (!glasses.length) return { error: 'no glass instances' };
  const g = glasses.reduce((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return ra.width * ra.height >= rb.width * rb.height ? a : b;
  });
  const gCanvas = g.shadowRoot && g.shadowRoot.querySelector('canvas');
  if (!gCanvas) return { error: 'no shadow canvas' };
  const gr = g.getBoundingClientRect();
  if (gr.width < 60 || gr.height < 60) return { error: 'glass too small: ' + Math.round(gr.width) + 'x' + Math.round(gr.height) };
  const bg = document.querySelector('.bg-canvas');
  if (!bg) return { error: 'no .bg-canvas' };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // 强制重渲染（WebGL 无 preserveDrawingBuffer，须同任务读取）
  if (g.render) g.render();

  const gw = gCanvas.width, gh = gCanvas.height;
  const grab = (src, sx, sy, sw, sh) => {
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const g2 = c.getContext('2d', { willReadFrequently: true });
    g2.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    return g2.getImageData(0, 0, sw, sh).data;
  };
  const glassPx = grab(gCanvas, 0, 0, gw, gh);
  const bgPx = grab(
    bg,
    Math.round(gr.left * (bg.width / window.innerWidth)),
    Math.round(gr.top * (bg.height / window.innerHeight)),
    gw, gh,
  );

  /** 坐标渐变场解算：窗口内每采样点的 (dx,dy) 中位数。
   *  图案：R = x/W·255，G = y/H·255（背景与玻璃同一份，无周期）。
   *  完全对齐时，玻璃本地 (x,y) 显示的背景设备像素 = (baseX+x, baseY+y)，
   *  其中 baseX = gr.left·dpr、baseY = gr.top·dpr（背景画布与视口 1:1）。
   *  实测 dx = R/255·824 − (baseX+x0+x) → 相对「完全对齐」的偏移，0 = 无错位。 */
  const baseX = Math.round(gr.left * dpr), baseY = Math.round(gr.top * dpr);
  const solve = (x0, y0, w, h) => {
    const dxs = [], dys = [];
    for (let y = 4; y < h - 4; y += 4) {
      for (let x = 4; x < w - 4; x += 4) {
        const i = (y * w + x) * 4;
        const r = glassPx[i], gCh = glassPx[i + 1];
        if (r < 8 || gCh < 8) continue; // 被高光/暗沿覆盖的像素跳过
        const dx = (r / 255) * 824 - (baseX + x0 + x);
        const dy = (gCh / 255) * 1830 - (baseY + y0 + y);
        if (Math.abs(dx) > 60 || Math.abs(dy) > 60) continue; // 离群（色散/高光污染）
        dxs.push(dx); dys.push(dy);
      }
    }
    if (dxs.length < 12) return { n: dxs.length, dx: null, dy: null };
    const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    return {
      n: dxs.length,
      dx: +(med(dxs) / 1).toFixed(2), dy: +(med(dys) / 1).toFixed(2), // 设备像素
      dxCss: +((med(dxs) / dpr)).toFixed(2), dyCss: +((med(dys) / dpr)).toFixed(2),
    };
  };

  // 五窗口：中心 + 四象限边（面内中心 60% 区域内）
  const W = gw, H = gh;
  const mx = Math.round(W * 0.2), my = Math.round(H * 0.2);
  const win = Math.round(Math.min(W, H) * 0.22);
  const windows = {
    center: solve(Math.round(W / 2 - win / 2), Math.round(H / 2 - win / 2), win, win),
    left: solve(mx, Math.round(H / 2 - win / 2), win, win),
    right: solve(W - mx - win, Math.round(H / 2 - win / 2), win, win),
    top: solve(Math.round(W / 2 - win / 2), my, win, win),
    bottom: solve(Math.round(W / 2 - win / 2), H - my - win, win, win),
  };
  return {
    route, dpr,
    panel: { w: Math.round(gr.width), h: Math.round(gr.height) },
    dprUsed: dpr,
    glassCanvas: gw + 'x' + gh,
    windows,
  };
};
`;

const results = [];
for (const dpr of [2, 3]) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: dpr,
    locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  await page.addInitScript(MEASURE_SRC); // 跨导航持久：reload 后仍可用
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate(MEASURE_SRC);

  // ① 页内生成「坐标渐变场 + 高频细节」背景（确定性）
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 824; c.height = 1830;
    const g = c.getContext('2d');
    const img = g.createImageData(824, 1830);
    for (let y = 0; y < 1830; y++) {
      for (let x = 0; x < 824; x++) {
        const i = (y * 824 + x) * 4;
        img.data[i] = Math.round((x / 824) * 255);       // R = x/W
        img.data[i + 1] = Math.round((y / 1830) * 255);  // G = y/H
        img.data[i + 2] = 96;                            // B 固定
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // 高频细节：细网格 + 彩点（低强度，不破坏 ramp 解算）
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1;
    for (let x = 0; x <= 824; x += 24) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 1830); g.stroke(); }
    for (let y = 0; y <= 1830; y += 24) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(824, y + 0.5); g.stroke(); }
    const cols = ['#ff5a5a', '#5aff8a', '#5ab4ff', '#ffd25a', '#c95aff'];
    let s = 42;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 60; i++) {
      g.fillStyle = cols[i % 5];
      g.fillRect(Math.floor(rnd() * 810) + 4, Math.floor(rnd() * 1816) + 4, 8, 8);
    }
    return c.toDataURL('image/png');
  });
  const bytes = Math.round(dataUrl.length * 0.75);

  // ② 种子：液态玻璃主题 + 图片背景
  await page.evaluate(({ dataUrl, bytes }) => {
    const state = {
      schema: 3,
      settings: {
        theme: 'liquid-glass-wc', colorMode: 'dark', perf: 'high', glassBlur: true,
        motion: 'off', dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'align',
        dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '22:30',
        refract: { strength: 55, blur: 1, chromatic: true, elasticity: 1 },
      },
      periods: [], courses: [],
      goals: [{ id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60, actualMinutes: 24, status: 'doing', date: new Date().toISOString().slice(0, 10), createdAt: Date.now() }],
      tasks: [], sessions: [], dates: [],
      background: {
        current: 'img:audit1', mode: 'fixed', rotateMinutes: 60,
        enabledIds: [], custom: [{
          id: 'audit1', name: 'audit', dataUrl, width: 824, height: 1830,
          bytes, createdAt: Date.now(),
        }],
        dim: 0.15, dynamic: false, showVeil: false, grid: false,
      },
      timer: null, courseStatus: {},
    };
    localStorage.setItem('learning-os:v1:state', JSON.stringify(state));
  }, { dataUrl, bytes });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click();
  });
  await page.waitForTimeout(800);

  // 状态 1：计时页静止
  const rest = await page.evaluate((r) => window.__glassAlign(r), '#/timer');
  results.push({ dpr, state: 'timer-rest', ...rest });
  // 状态 2：滚动 240 后静止
  await page.evaluate(() => window.scrollTo(0, 240));
  await page.waitForTimeout(500);
  const scrolled = await page.evaluate((r) => window.__glassAlign(r), '#/timer');
  results.push({ dpr, state: 'timer-scrolled', ...scrolled });
  // 状态 3：滚动后立即测（rAF 前的瞬态）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const immediate = await page.evaluate(async (r) => {
    window.scrollTo(0, 300);
    return await window.__glassAlign(r);
  }, '#/timer');
  results.push({ dpr, state: 'timer-immediate', ...immediate });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  // 状态 4：首页卡片
  const home = await page.evaluate((r) => window.__glassAlign(r), '#/');
  results.push({ dpr, state: 'home-rest', ...home });

  // 同帧对比截图（报告用）：玻璃可见 / 玻璃隐藏
  await page.evaluate((r) => { location.hash = r; }, '#/timer');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll('[data-key-glass]'))
      .reduce((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height >=
        b.getBoundingClientRect().width * b.getBoundingClientRect().height ? a : b));
    for (const el of panel.querySelectorAll('*')) el.style.visibility = 'hidden';
  });
  await page.screenshot({ path: `${OUT}/timer-dpr${dpr}--glass-on.png` });
  await page.evaluate(() => { const l = document.querySelector('.refract-layer'); if (l) l.style.display = 'none'; });
  await page.screenshot({ path: `${OUT}/timer-dpr${dpr}--glass-off.png` });
  await page.evaluate(() => { const l = document.querySelector('.refract-layer'); if (l) l.style.display = ''; });
  await page.waitForTimeout(300);

  if (errors.length) results.push({ dpr, state: 'js-errors', errors: [...new Set(errors)].slice(0, 3) });
  await ctx.close();
}

await browser.close();
const path = `${OUT}/align-${phase}.json`;
writeFileSync(path, JSON.stringify(results, null, 2), 'utf8');
const brief = results.map((r) => {
  if (r.windows) {
    const w = r.windows;
    const fmt = (o) => (o && o.dx !== null ? `(${o.dxCss},${o.dyCss})` : 'n/a');
    return `${r.dpr} ${r.state}: C${fmt(w.center)} L${fmt(w.left)} R${fmt(w.right)} T${fmt(w.top)} B${fmt(w.bottom)} n=${w.center.n}`;
  }
  return JSON.stringify(r);
});
console.log(brief.join('\n'));
console.log(`\n结果: ${path}`);
