/**
 * 验证滚动修复后：
 *   1. 静止时玻璃与卡片仍然对齐
 *   2. 滚动过程中玻璃跟着走（不再重影）
 *   3. 折射内容仍然采样自「卡片当前所在的背景位置」
 *      —— 背景固定不动，所以卡片滚到哪就该采到哪
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/scrollfix';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const seed = {
  schema: 3,
  settings: { theme: 'liquid-glass-wc', colorMode: 'dark', perf: 'high', glassBlur: true, dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x', dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '23:00' },
  periods: [], courses: [],
  goals: [{ id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60, actualMinutes: 24, status: 'doing', priority: 'normal', createdAt: Date.now(), completedAt: null, dueAt: null, description: '' }],
  tasks: [], sessions: [], dates: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false, dimAuto: false },
  timer: null, courseStatus: {},
};

const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => { Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click(); });
await page.waitForTimeout(1200);

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

console.log('\n=== 1. 静止时对齐 ===');
const align0 = await page.evaluate(() => {
  const layer = document.querySelector('.refract-layer');
  const gs = Array.from(layer.querySelectorAll('liquid-glass'));
  const cards = Array.from(document.querySelectorAll('main [class*="rounded-[var(--radius-card)]"]')).slice(0, 4);
  /*
   * 按**几何**配对，不能按下标。
   * 玻璃层的元素顺序与 DOM 里的卡片顺序不保证一致，按下标会把两张卡对调，
   * 测出 ±223px 这种「错位」——上一版就是这样误报的（详见交接文档「坑 31」）。
   * 键取 left|width|height，且要求**唯一**；不唯一就不猜，直接跳过这一个。
   */
  const key = (r) => `${Math.round(r.left)}|${Math.round(r.width)}|${Math.round(r.height)}`;
  const byKey = new Map();
  for (const g of gs) {
    const k = key(g.getBoundingClientRect());
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  return cards.flatMap((c) => {
    const k = key(c.getBoundingClientRect());
    if (byKey.get(k) !== 1) return [];          // 键不唯一 → 不猜
    const g = gs.find((x) => key(x.getBoundingClientRect()) === k);
    if (!g) return [];
    const cr = c.getBoundingClientRect();
    const gr = g.getBoundingClientRect();
    return [{ dt: Math.round((cr.top - gr.top) * 10) / 10, dl: Math.round((cr.left - gr.left) * 10) / 10 }];
  });
});
check('静止时卡片与玻璃对齐',
  align0.length > 0 && align0.every((a) => Math.abs(a.dt) < 2 && Math.abs(a.dl) < 2),
  `${align0.length} 组配对 ${JSON.stringify(align0)}`);

console.log('\n=== 2. 层的定位方式 ===');
const pos = await page.evaluate(() => getComputedStyle(document.querySelector('.refract-layer')).position);
check('折射层为 absolute（随内容滚动，交给合成器）', pos === 'absolute', `position: ${pos}`);

console.log('\n=== 3. 采样原点随滚动更新（内容坐标绘制 / 视口坐标采样）===');
const sampleCheck = await page.evaluate(async () => {
  const layer = document.querySelector('.refract-layer');
  const g = layer.querySelector('liquid-glass');
  const read = () => {
    const gr = g.getBoundingClientRect();
    /*
     * 面板用**几何配对**认领，别用索引 —— 玻璃元素的创建顺序来自 pickRenderableTargets()，
     * 与 listKeyGlassTargets() 的注册顺序不同，按索引配会配错（我踩过，得到"整齐的 ±221px"假象）。
     */
    /*
     * 面板认领：优先用 data-key-glass 标记；没有就按矩形匹配，
     * 但**排除折射层内部的元素**（否则会匹配到玻璃元素自己）。
     * 注意这个测试跑在 4173 预览（dist/），没有 /src/，所以不能 import 应用模块。
     */
    const cands = Array.from(document.querySelectorAll('[data-key-glass]'));
    const pool = cands.length > 0 ? cands : Array.from(document.querySelectorAll('main *')).filter((el) => !el.closest('.refract-layer'));
    const panel = pool
      .map((el) => el.getBoundingClientRect())
      .find((r) => Math.abs(r.left - gr.left) < 1 && Math.abs(r.width - gr.width) < 1.5 && Math.abs(r.height - gr.height) < 1.5);
    // 背景画布的场景高度：按宽高比换回 CSS 像素（不再依赖私有字段）
    const bg = document.querySelector('.bg-canvas');
    const bgSceneH = bg && bg.width ? Math.round(bg.height * (window.innerWidth / bg.width)) : null;
    return {
      // 绘制位置 = CSS transform（内容坐标）
      transform: g.style.transform,
      rectTop: Math.round(gr.top),
      panelTop: panel ? Math.round(panel.top) : null,
      bgSceneH,
    };
  };
  await new Promise((r) => setTimeout(r, 100));
  const before = read();
  window.scrollTo(0, 180);
  await new Promise((r) => setTimeout(r, 400));
  const after = read();
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
  return { before, after };
});
const b = sampleCheck.before, a = sampleCheck.after;
console.log(`  滚动前: transform=${b.transform} 玻璃=${b.rectTop} 面板=${b.panelTop} 场景高=${b.bgSceneH}`);
console.log(`  滚动后: transform=${a.transform} 玻璃=${a.rectTop} 面板=${a.panelTop} 场景高=${a.bgSceneH}`);
check(
  '绘制位置（内容坐标）不随滚动变化 —— 位置交给合成器，所以零延迟',
  b.transform === a.transform && b.transform !== '' && b.transform !== undefined,
  `${b.transform} → ${a.transform}`,
);
check(
  '元素在视口里确实移动了（说明滚动生效、玻璃跟着内容走）',
  Math.abs(a.rectTop - b.rectTop) > 100,
  `rectTop ${b.rectTop} → ${a.rectTop}`,
);
check(
  '玻璃的视口位置与它所属面板**始终一致**（滚动前后都在 1px 内）—— 这是"跟着内容走"的可观测判据',
  a.panelTop !== null && b.panelTop !== null && Math.abs(a.panelTop - a.rectTop) <= 1 && Math.abs(b.panelTop - b.rectTop) <= 1,
  `滚动前 玻璃${b.rectTop}/面板${b.panelTop}，滚动后 玻璃${a.rectTop}/面板${a.panelTop}`,
);
check(
  '场景尺寸取视口（背景画布宽高比 = 视口宽高比，与固定的背景画布对齐）',
  b.bgSceneH !== null && Math.abs(b.bgSceneH - 915) <= 2,
  `场景高=${b.bgSceneH}（视口 915）`,
);

console.log('\n=== 4. 滚动过程中采样对齐 ===');
await page.evaluate(() => {
  /*
   * 配对规则：用「左边界 | 宽 | 高」——这三项都不随滚动变化。
   * 并且**只统计这个键唯一的卡片**。
   *
   * 为什么必须要求唯一：首页有若干张尺寸相同的非玻璃卡片（例如日历的详情卡），
   * 按尺寸配对会撞车，把卡片配到很远的另一块玻璃上。
   * 实测踩过：加了日历之后这里报出 1069.8px 的「错位」，
   * 而实际上玻璃与卡片完全同步 —— 是配对错了，不是应用坏了。
   * （第一版更糟：直接按数组下标 gs[i] 配，任何首页改动都会让它失准。）
   */
  window.__m = [];
  let stop = false;
  const keyOf = (r) => Math.round(r.left) + '|' + Math.round(r.width) + '|' + Math.round(r.height);
  const tick = () => {
    if (stop) return;
    const layer = document.querySelector('.refract-layer');
    let worst = 0;
    let paired = 0;
    const cards = Array.from(document.querySelectorAll('main [class*="rounded-[var(--radius-card)]"]'));
    const byKey = new Map();
    for (const c of cards) {
      const k = keyOf(c.getBoundingClientRect());
      byKey.set(k, (byKey.get(k) ?? 0) + 1);
    }
    for (const g of layer.querySelectorAll('liquid-glass')) {
      const k = keyOf(g.getBoundingClientRect());
      if (byKey.get(k) !== 1) continue; // 键不唯一就不配，避免错配
      const card = cards.find((c) => keyOf(c.getBoundingClientRect()) === k);
      if (!card) continue;
      paired++;
      const d = Math.abs(card.getBoundingClientRect().top - g.getBoundingClientRect().top);
      if (d > worst) worst = d;
    }
    window.__m.push({ d: Math.round(worst * 10) / 10, paired });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__stop = () => { stop = true; return window.__m; };
});
await page.mouse.move(206, 500);
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 130); await page.waitForTimeout(16); }
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -130); await page.waitForTimeout(16); }
await page.waitForTimeout(600);
const m = await page.evaluate(() => window.__stop());
const valid = m.filter((x) => x.paired > 0);
const worst = valid.length ? Math.max(...valid.map((x) => x.d)) : -1;
check('滚动全程最大错位 < 2px', worst >= 0 && worst < 2, `最大 ${worst}px（修复前为 120px 级；有效配对帧 ${valid.length}/${m.length}）`);

console.log('\n=== 5. 截图 ===');
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/scroll0.png` });
await page.evaluate(() => window.scrollTo(0, 200));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/scroll200.png` });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
console.log(`  ${out}/scroll0.png · ${out}/scroll200.png`);

const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);

await ctx.close();
await browser.close();
if (failed) process.exit(1);
