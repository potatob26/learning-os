/**
 * 打开官方 demo，提取它对 .glass / .glass__warp 的真实样式，
 * 以及它如何摆放这个组件（wrapper 结构、position、transform）
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  locale: 'en-US',
});
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

try {
  await page.goto('https://liquid-glass.maxrovensky.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
} catch (e) {
  console.log('加载 demo 失败:', e.message);
}

console.log('页面错误:', logs.length ? logs.slice(0, 3) : '无');

const info = await page.evaluate(() => {
  const glass = document.querySelector('.glass');
  if (!glass) return { error: 'demo 页面里找不到 .glass' };

  const warp = glass.querySelector('.glass__warp');
  const pick = (el, props) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p);
    return out;
  };

  // 组件最外层：从 .glass 往上找到带 transform 的祖先
  const chain = [];
  let node = glass;
  for (let i = 0; i < 6 && node; i++) {
    const cs = getComputedStyle(node);
    const r = node.getBoundingClientRect();
    chain.push({
      tag: node.tagName,
      cls: typeof node.className === 'string' ? node.className : '',
      rect: `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}`,
      position: cs.position,
      display: cs.display,
      top: cs.top,
      left: cs.left,
      transform: cs.transform,
      width: cs.width,
      height: cs.height,
      styleAttr: node.getAttribute('style'),
    });
    node = node.parentElement;
  }

  // 找出所有包含 .glass 的 CSS 规则
  const rules = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    const scan = (arr) => {
      for (const rule of Array.from(arr)) {
        const t = rule.cssText ?? '';
        if (t.includes('.glass')) rules.push(t.slice(0, 400));
        if (rule.cssRules) scan(rule.cssRules);
      }
    };
    scan(list);
  }

  return {
    glassStyle: pick(glass, [
      'width', 'height', 'display', 'position', 'padding', 'border-radius',
      'background-color', 'overflow', 'transition', 'box-shadow',
    ]),
    glassInline: glass.getAttribute('style'),
    warpStyle: pick(warp, [
      'width', 'height', 'position', 'inset', 'filter', 'backdrop-filter', 'border-radius',
    ]),
    warpInline: warp ? warp.getAttribute('style') : null,
    ancestorChain: chain,
    glassRules: [...new Set(rules)].slice(0, 20),
  };
});

console.log(JSON.stringify(info, null, 2));

await page.screenshot({ path: `${out}/demo-reference.png` });
console.log(`\n已截图: ${out}/demo-reference.png`);

await browser.close();
