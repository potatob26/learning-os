/**
 * 验证
 *  1. 主题列表里不再有「云母 Mica」
 *  2. 老数据里 theme='mica' 会自动迁移到 liquid-glass
 *  3. 「极简黑」在「浅色」明暗设置下，背景必须仍是深色，文字可读
 *     （这是用户反馈的「看不见字」）
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/themes';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
};

const seed = (theme, colorMode) => ({
  schema: 1,
  settings: { theme, colorMode, perf: 'balanced', glassBlur: true, onboarded: true, blocks: [], quoteSeed: 'x' },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: {
    current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['scene:aurora'], custom: [], dim: 0.35,
    dynamic: false, showVeil: true, grid: false,
  },
  timer: null, courseStatus: {},
});

/* ① + ② */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 1200 }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  // 故意写入老主题 mica，验证迁移
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed('mica', 'dark'));
  await page.goto('http://127.0.0.1:5188/#/settings/appearance', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    hasMicaCard: (document.querySelector('main')?.textContent ?? '').includes('云母'),
    themeLabels: ['透明玻璃', '极简白', '极简黑', '柔和浅色', '沉浸式'].filter((l) =>
      (document.querySelector('main')?.textContent ?? '').includes(l),
    ),
  }));

  check('老数据 theme=mica 已迁移到 liquid-glass', info.dataTheme === 'liquid-glass', `data-theme=${info.dataTheme}`);
  check('主题列表里不再出现「云母」', !info.hasMicaCard);
  check('五个主题都在列表中', info.themeLabels.length === 5, info.themeLabels.join(' / '));
  await ctx.close();
}

/* ③ 极简黑 + 浅色明暗 */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed('pure-dark', 'light'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const m = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const el = Array.from(document.querySelectorAll('main *')).find(
      (e) => e.children.length === 0 && (e.textContent || '').includes('今日自学'),
    );
    return {
      rootClass: document.documentElement.className,
      bgBase: cs.getPropertyValue('--bg-base').trim(),
      text: cs.getPropertyValue('--text').trim(),
      labelColor: el ? getComputedStyle(el).color : null,
    };
  });

  // 背景画布中心亮度：应该偏暗（深色背景）
  const bgLum = await page.evaluate(() => {
    const c = document.querySelector('.bg-canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return Math.round(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]);
  });

  console.log(`  极简黑 + 浅色 → --bg-base=${m.bgBase} 背景亮度=${bgLum} 文字色=${m.labelColor}`);
  check('极简黑在浅色明暗下仍然使用深色背景', bgLum < 70, `背景亮度 ${bgLum}`);
  check('文字为浅色（与深背景对比）', /238|239|240|241|242|243|244|245|246|247|248|249|250|251|252|253|254|255/.test(m.labelColor || ''), String(m.labelColor));

  await page.screenshot({ path: `${out}/puredark-fixed.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
