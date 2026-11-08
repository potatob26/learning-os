/**
 * 运行时全页面扫描：界面上是否还存在「液态玻璃」，以及现在显示的名称是什么
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  colorScheme: 'light',
  isMobile: true,
});
const page = await ctx.newPage();

for (const theme of ['liquid-glass', 'pure-light', 'pure-dark', 'soft', 'immersive']) {
  const seed = {
    schema: 3,
    settings: {
      theme, colorMode: 'light', perf: 'high', glassBlur: true,
      dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
    },
    periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
    background: {
      current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60,
      enabledIds: ['scene:aurora'], custom: [], dim: 0.35,
      dynamic: false, showVeil: true, grid: false,
    },
    timer: null, courseStatus: {},
  };
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);

  const routes = ['#/', '#/goals', '#/timer', '#/stats', '#/settings/appearance', '#/settings/background', '#/settings/data', '#/settings/courses'];
  const hits = [];
  for (const r of routes) {
    await page.goto(`http://127.0.0.1:5188/${r}`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1100);
    const found = await page.evaluate(() => {
      const out = [];
      const body = document.body.innerText ?? '';
      if (body.includes('液态玻璃')) out.push('页面文字');
      // 属性里的文案（aria-label / title / placeholder）也要查
      for (const el of Array.from(document.querySelectorAll('*'))) {
        for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
          const v = el.getAttribute(a);
          if (v && v.includes('液态玻璃')) out.push(`${a}="${v.slice(0, 30)}"`);
        }
      }
      // 连不可见的 <style> / <script> 内容也一并查，避免遗漏
      for (const el of Array.from(document.querySelectorAll('style,script'))) {
        if ((el.textContent ?? '').includes('液态玻璃')) out.push(`${el.tagName} 内容`);
      }
      return [...new Set(out)];
    });
    if (found.length) hits.push(`${r}: ${found.join(' / ')}`);
  }

  // 当前主题在设置页显示成什么
  await page.goto('http://127.0.0.1:5188/#/settings/appearance', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const label = await page.evaluate(() => {
    const t = document.body.innerText ?? '';
    return {
      has毛玻璃: t.includes('毛玻璃'),
      has液态: t.includes('液态玻璃'),
      themeAttr: document.documentElement.getAttribute('data-theme'),
    };
  });

  console.log(
    `${theme.padEnd(13)} data-theme=${label.themeAttr} · 界面出现「毛玻璃」=${label.has毛玻璃} · 出现「液态玻璃」=${label.has液态}`,
  );
  if (hits.length) hits.forEach((h) => console.log(`      ⚠️ ${h}`));
}

await browser.close();
console.log('\n（若上面「出现液态玻璃」全为 false，说明源码已改净，用户看到的应是旧构建）');
