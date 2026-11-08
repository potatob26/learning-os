/**
 * 逐层走查 liquid-glass-react 的 DOM，定位它被推到视口外的原因
 * 同时列出所有可能影响它的级联样式来源
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 1000 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  colorScheme: 'dark',
});
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const url = process.argv[2] ?? 'http://127.0.0.1:5188/glass-versus.html';
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2400);

const report = await page.evaluate(() => {
  const caseEl = document.querySelector('[data-lib-case]');
  if (!caseEl) return { error: '找不到对比容器' };

  const lines = [];
  const walk = (el, depth) => {
    if (depth > 6) return;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const desc =
      `${'  '.repeat(depth)}<${el.tagName.toLowerCase()}` +
      (el.id ? `#${el.id}` : '') +
      (typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '') +
      `>`;
    lines.push(
      `${desc}\n` +
        `${'  '.repeat(depth + 1)}rect=${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}` +
        `  position=${cs.position} display=${cs.display} float=${cs.float}` +
        (cs.transform !== 'none' ? ` transform=${cs.transform}` : '') +
        (cs.marginLeft !== '0px' ? ` marginLeft=${cs.marginLeft}` : '') +
        (cs.left !== 'auto' ? ` left=${cs.left}` : '') +
        (cs.right !== 'auto' ? ` right=${cs.right}` : '') +
        (cs.paddingLeft !== '0px' ? ` paddingLeft=${cs.paddingLeft}` : ''),
    );
    for (const child of Array.from(el.children)) walk(child, depth + 1);
  };
  walk(caseEl, 0);

  // 谁给 .glass 设了样式？
  const glass = caseEl.querySelector('.glass');
  const warp = caseEl.querySelector('.glass__warp');
  const svg = caseEl.querySelector('svg');

  return {
    tree: lines.join('\n'),
    glassFound: Boolean(glass),
    glassPosition: glass ? getComputedStyle(glass).position : null,
    glassRect: glass ? JSON.stringify(glass.getBoundingClientRect().toJSON()) : null,
    warpStyleAttr: warp ? warp.getAttribute('style') : null,
    svgStyleAttr: svg ? svg.getAttribute('style') : null,
    rootClass: (() => {
      const first = caseEl.firstElementChild;
      return first ? first.className : null;
    })(),
    tailwindRelativeExists: (() => {
      // 检查 Tailwind 的 .relative 是否真的生效
      const probe = document.createElement('div');
      probe.className = 'relative';
      document.body.appendChild(probe);
      const ok = getComputedStyle(probe).position === 'relative';
      probe.remove();
      return ok;
    })(),
  };
});

console.log('页面错误:', logs.length ? logs.slice(0, 3) : '无');
console.log('\n=== DOM 走查 ===');
console.log(report.tree);
console.log('\n=== 细节 ===');
console.log('glassFound       :', report.glassFound);
console.log('glassPosition    :', report.glassPosition);
console.log('glassRect        :', report.glassRect);
console.log('warp style 属性  :', report.warpStyleAttr);
console.log('svg style 属性   :', report.svgStyleAttr);
console.log('库根 div 的 class:', report.rootClass);
console.log('Tailwind .relative 生效:', report.tailwindRelativeExists);

await browser.close();
