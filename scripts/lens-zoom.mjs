/**
 * 逐个放大截图每个透镜变体，并做像素级测量：
 *   - 网格线在玻璃内是否被拉伸（相干透镜）还是被揉乱（噪声）
 *   - 边缘是否有色散（R/B 通道偏移）
 *   - 玻璃内平均亮度 vs 背景（判断白雾程度）
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({
  viewport: { width: 460, height: 1000 },
  deviceScaleFactor: 4,
  locale: 'zh-CN',
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5188/lens-lab.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);

const panels = await page.$$('.panel');
const names = ['A-frosted', 'B-noise', 'C-softlens', 'D-chroma', 'E-clear'];
for (let i = 0; i < panels.length; i++) {
  await panels[i].scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await panels[i].screenshot({ path: `${out}/lens-${names[i]}.png` });
  console.log(`已截 ${names[i]}`);
}

/* 像素测量：对每个变体，取玻璃内部一行像素，看网格线的位置分布 */
const measure = await page.evaluate(async () => {
  const result = {};
  const panels = Array.from(document.querySelectorAll('.panel'));

  for (let i = 0; i < panels.length; i++) {
    const el = panels[i];
    const r = el.getBoundingClientRect();
    const key = ['A', 'B', 'C', 'D', 'E'][i];
    // 读取元素所在位置的屏幕像素是做不到的（没有 drawElementImage），
    // 因此这里只能报告几何信息与使用的滤镜，像素判断交给人工看放大图。
    result[key] = {
      rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
      backdrop: (getComputedStyle(el).backdropFilter || '').slice(0, 80),
      background: getComputedStyle(el).backgroundColor,
      border: getComputedStyle(el).borderColor,
    };
  }
  return result;
});
console.log(JSON.stringify(measure, null, 2));

await browser.close();
