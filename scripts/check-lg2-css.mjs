/**
 * 检查适配层的 CSS 是否真的生效，以及 .glass 的实际尺寸来源
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
  viewport: { width: 412, height: 1200 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  colorScheme: 'dark',
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5188/glass-versus.html', { waitUntil: 'load' });
await page.waitForTimeout(2400);

const info = await page.evaluate(() => {
  const wrap = document.querySelector('[data-lib-adapted]');
  if (!wrap) return { error: '找不到适配层用例' };
  const lg2 = wrap.querySelector('.lg2');
  const glass = wrap.querySelector('.glass');
  const root = lg2?.firstElementChild;
  const cs = glass ? getComputedStyle(glass) : null;
  const rcs = root ? getComputedStyle(root) : null;

  // 这条规则有没有被浏览器接受
  let ruleFound = false;
  let ruleText = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      const t = rule.cssText ?? '';
      if (t.includes('.lg2 .glass')) {
        ruleFound = true;
        ruleText = t.slice(0, 160);
      }
    }
  }

  return {
    wrapperClass: lg2 ? lg2.className : null,
    wrapperHeight: lg2 ? getComputedStyle(lg2).height : null,
    rootTag: root ? root.tagName : null,
    rootStyle: root ? root.getAttribute('style') : null,
    glassWidth: cs?.width,
    glassHeight: cs?.height,
    glassDisplay: cs?.display,
    glassPosition: cs?.position,
    rootWidth: rcs?.width,
    rootPosition: rcs?.position,
    rootTransform: rcs?.transform,
    rootTop: rcs?.top,
    rootLeft: rcs?.left,
    cssRuleFound: ruleFound,
    cssRuleText: ruleText,
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
