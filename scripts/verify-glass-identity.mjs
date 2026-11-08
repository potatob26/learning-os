/**
 * 两项验证
 *  A. 指针弹性：指针移出后，变形必须复位（用户反馈的 bug）
 *  B. 实现同一性：把我们页面里的玻璃 DOM 与官方 demo 的 DOM 做逐项对比，
 *     确认用的确实是 rdev/liquid-glass-react
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

/** 提取一个 .glass 元素的结构指纹 */
const FINGERPRINT = () => {
  const glass = document.querySelector('.lg2 .glass') || document.querySelector('.glass');
  if (!glass) return { error: 'no .glass' };
  const warp = glass.querySelector('.glass__warp');
  const filter = document.querySelector('filter');
  const svg = document.querySelector('svg');
  const cs = getComputedStyle(glass);
  const wcs = warp ? getComputedStyle(warp) : null;
  return {
    glassClass: glass.className,
    glassInlineKeys: (glass.getAttribute('style') || '')
      .split(';')
      .map((s) => s.split(':')[0].trim())
      .filter(Boolean)
      .sort(),
    glassDisplay: cs.display,
    glassOverflow: cs.overflow,
    warpClass: warp ? warp.className : null,
    warpInlineKeys: warp
      ? (warp.getAttribute('style') || '')
          .split(';')
          .map((s) => s.split(':')[0].trim())
          .filter(Boolean)
          .sort()
      : null,
    /** 滤镜原语序列 —— 这是该库最独特的指纹 */
    filterPrimitives: filter ? Array.from(filter.children).map((c) => c.tagName.toLowerCase()) : null,
    /** SVG defs 里的渐变遮罩 */
    hasEdgeMaskGradient: Boolean(document.querySelector('[id$="-edge-mask"]')),
    svgChildCount: svg ? svg.children.length : null,
    /** 背板模糊的实际取值 */
    warpBackdrop: wcs ? wcs.backdropFilter : null,
    warpHasSvgFilterRef: wcs ? /url\(/.test(wcs.filter) : null,
  };
};

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

/* ---------------- A. 弹性复位 ---------------- */
{
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  const seed = {
    schema: 1,
    settings: {
      theme: 'liquid-glass',
      colorMode: 'dark',
      perf: 'balanced',
      glassBlur: true,
      dynamicBackground: false,
      onboarded: true,
      blocks: [],
      quoteSeed: 'x',
      // 打开弹性，复现用户遇到的情况
      glass: { elasticity: 0.8 },
    },
    periods: [],
    courses: [],
    goals: [],
    tasks: [],
    sessions: [],
    dates: [],
    background: {
      current: 'scene:aurora',
      mode: 'fixed',
      rotateMinutes: 60,
      enabledIds: ['scene:aurora'],
      custom: [],
      dim: 0.35,
      dynamic: false,
      showVeil: true,
    },
    timer: null,
    courseStatus: {},
  };

  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);

  const readTransform = () =>
    page.evaluate(() => {
      const el = document.querySelector('.lg2 .glass')?.parentElement;
      if (!el) return null;
      const m = /translate\(calc\(-50% \+ ([-\d.]+)px\), calc\(-50% \+ ([-\d.]+)px\)\)/.exec(
        el.getAttribute('style') || '',
      );
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    });

  const box = await page.evaluate(() => {
    const el = document.querySelector('.lg2');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });

  const results = [];
  const check = (n, ok, d = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  };

  if (!box) {
    check('找到玻璃元素', false);
  } else {
    const rest = await readTransform();
    check('静置时位移为 0', rest !== null && Math.abs(rest.x) < 0.5 && Math.abs(rest.y) < 0.5, JSON.stringify(rest));

    // 指针移到元素内部靠下的位置
    await page.mouse.move(box.x + box.w / 2, box.y + box.h - 6);
    await page.waitForTimeout(450);
    const inside = await readTransform();
    check(
      '指针在内部靠下时产生向下位移',
      inside !== null && inside.y > 0.5,
      JSON.stringify(inside),
    );

    // 关键：指针移出元素（继续往下）
    await page.mouse.move(box.x + box.w / 2, box.y + box.h + 220);
    await page.waitForTimeout(700);
    const outside = await readTransform();
    check(
      '指针移出后位移复位为 0（修复点）',
      outside !== null && Math.abs(outside.x) < 0.5 && Math.abs(outside.y) < 0.5,
      JSON.stringify(outside),
    );
  }

  console.log(`\nA 组: ${results.filter(Boolean).length}/${results.length} 通过`);

  // 顺便取我方指纹
  const mine = await page.evaluate(FINGERPRINT);
  console.log('\n=== 我方结构的滤镜原语 ===');
  console.log(JSON.stringify(mine.filterPrimitives));
  console.log('edge-mask 渐变:', mine.hasEdgeMaskGradient, '· warp 背板模糊:', mine.warpBackdrop);
  console.log('warp 带 SVG 滤镜引用:', mine.warpHasSvgFilterRef);
  console.log('glass 内联属性:', JSON.stringify(mine.glassInlineKeys));

  globalThis.__MINE__ = mine;
  await ctx.close();
}

/* ---------------- B. 与官方 demo 对比 ---------------- */
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  try {
    await page.goto('https://liquid-glass.maxrovensky.com', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await page.waitForTimeout(6000);
    const demo = await page.evaluate(FINGERPRINT);

    console.log('\n=== 官方 demo 的滤镜原语 ===');
    console.log(JSON.stringify(demo.filterPrimitives));
    console.log('edge-mask 渐变:', demo.hasEdgeMaskGradient, '· warp 背板模糊:', demo.warpBackdrop);
    console.log('glass 内联属性:', JSON.stringify(demo.glassInlineKeys));

    const same =
      JSON.stringify(demo.filterPrimitives) === JSON.stringify(globalThis.__MINE__.filterPrimitives);
    console.log('\n滤镜原语序列完全一致:', same ? '是' : '否');
    if (!same) {
      console.log('  我方:', JSON.stringify(globalThis.__MINE__.filterPrimitives));
      console.log('  demo:', JSON.stringify(demo.filterPrimitives));
    }
  } catch (e) {
    console.log('\n无法访问官方 demo:', e.message);
  }
  await ctx.close();
}

await browser.close();
