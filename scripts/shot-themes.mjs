/**
 * 逐个主题截图 + 用像素实测正文对比度，找出「看不见字」的主题
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync, mkdirSync } from 'node:fs';

const flow = process.argv.includes('--flow');
const stats = process.argv.includes('--stats');
const out = (flow ? '.preview/themes-flow' : '.preview/themes') + (stats ? '-stats' : '');
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const THEMES = ['liquid-glass-wc', 'liquid-glass', 'pure-light', 'pure-dark', 'soft', 'immersive'];

const base = (theme, colorMode) => ({
  schema: 1,
  settings: {
    theme,
    colorMode,
    perf: 'balanced',
    glassBlur: true,
    onboarded: true,
    blocks: [],
    quoteSeed: 'x',
  },
  periods: [],
  courses: [],
  goals: [],
  tasks: [],
  sessions: [],
  dates: [],
  background: {
    current: flow ? 'scene:glass-flow' : 'scene:aurora',
    mode: 'fixed',
    rotateMinutes: 60,
    enabledIds: ['scene:aurora'],
    custom: [],
    dim: 0.35,
    dynamic: false,
    showVeil: true,
    grid: false,
  },
  timer: null,
  courseStatus: {},
});

for (const theme of THEMES) {
  const colorMode = theme === 'pure-light' || theme === 'soft' ? 'light' : 'dark';
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    colorScheme: colorMode,
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate(
    (s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)),
    base(theme, colorMode),
  );
  await page.reload({ waitUntil: 'load' });
  if (stats) await page.goto('http://127.0.0.1:5188/#/stats');
  await page.waitForTimeout(1800);

  const info = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => cs.getPropertyValue(n).trim();
    // 找一个真实文字节点，读它的颜色
    const el =
      document.querySelector('main h1, main p, main .num-hero') ||
      document.querySelector('h1, p');
    const textColor = el ? getComputedStyle(el).color : null;
    return {
      bgBase: get('--bg-base'),
      text: get('--text'),
      textSecondary: get('--text-secondary'),
      accent: get('--accent'),
      firstTextColor: textColor,
      rootClass: document.documentElement.className,
      dataTheme: document.documentElement.getAttribute('data-theme'),
    };
  });

  // 正文对比度：把标题区域截出来算最亮/最暗像素差
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 412, height: 200 } });
  const b64 = shot.toString('base64');
  const contrast = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((res) => {
      img.onload = res;
      img.src = dataUrl;
    });
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (l < min) min = l;
      if (l > max) max = l;
    }
    return { min: Math.round(min), max: Math.round(max), range: Math.round(max - min) };
  }, `data:image/png;base64,${b64}`);

  console.log(
    `${theme.padEnd(13)} data-theme=${info.dataTheme} class="${info.rootClass}"\n` +
      `              --bg-base=${info.bgBase} --text=${info.text} --accent=${info.accent}\n` +
      `              实际文字色=${info.firstTextColor} · 顶部区域亮度 ${contrast.min}~${contrast.max}（跨度 ${contrast.range}）`,
  );

  await page.screenshot({ path: `${out}/${theme}.png`, fullPage: false });
  await ctx.close();
}

await browser.close();
console.log(`\n截图输出: ${out}/`);
