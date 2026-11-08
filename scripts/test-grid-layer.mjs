/**
 * 验证「背景网格」是独立叠加层：
 * 对 无背景 / 各种场景 / 自定义图片 分别测试，网格开关都要能独立生效。
 * 判定方式：画布像素哈希（客观），并对比网格开关前后的差异幅度。
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

/** 生成一张纯色渐变的 dataURL 图片，作为「自定义图片背景」 */
const makeImageDataUrl = async (page) =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, '#c2410c');
    grad.addColorStop(1, '#0e7490');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c.toDataURL('image/png');
  });

const base = ({ current, grid, image }) => ({
  schema: 1,
  settings: {
    theme: 'liquid-glass',
    colorMode: 'dark',
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
    current,
    mode: 'fixed',
    rotateMinutes: 60,
    enabledIds: [current],
    custom: image ? [{ id: 'img1', name: '测试图', dataUrl: image, addedAt: Date.now() }] : [],
    dim: 0.35,
    dynamic: false,
    showVeil: false,
    grid,
  },
  timer: null,
  courseStatus: {},
});

/** 取画布中间一条带的像素指纹 */
const fingerprint = async (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.bg-canvas');
    if (!c) return null;
    const g = c.getContext('2d');
    const d = g.getImageData(0, Math.floor(c.height / 2), c.width, 2).data;
    const arr = [];
    for (let i = 0; i < d.length; i += 4) arr.push(d[i], d[i + 1], d[i + 2]);
    return arr.join(',');
  });

const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
};

const CASES = [
  { label: '无背景', current: 'none', image: false },
  { label: '极光', current: 'scene:aurora', image: false },
  { label: '星空', current: 'scene:stars', image: false },
  { label: '雨', current: 'scene:rain', image: false },
  { label: '网格(作为背景场景)', current: 'scene:grid', image: false },
  { label: '自定义图片', current: 'img:img1', image: true },
];

/** 记录每种背景「网格关闭」时的哈希，用于顺带校验背景本身是否真的不同 */
const baseHashes = {};

// 先拿一张图片 dataURL
const tmp = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN' });
const tmpPage = await tmp.newPage();
await tmpPage.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
const imgDataUrl = await makeImageDataUrl(tmpPage);
await tmp.close();
console.log(`已生成测试图片 dataURL（${imgDataUrl.length} 字符）\n`);

for (const c of CASES) {
  const hashes = {};
  for (const grid of [false, true]) {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
    await page.evaluate(
      (s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)),
      base({ current: c.current, grid, image: c.image ? imgDataUrl : null }),
    );
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1900);
    const fp = await fingerprint(page);
    hashes[grid] = fp ? createHash('sha1').update(fp).digest('hex').slice(0, 10) : null;
    if (grid) await page.screenshot({ path: `${out}/gridlayer-${c.label}-on.png` });
    await ctx.close();
  }
  const differs = hashes[false] !== hashes[true] && hashes[false] !== null;
  check(`「${c.label}」背景可以独立叠加网格`, differs, `关 ${hashes[false]} / 开 ${hashes[true]}`);
  baseHashes[c.label] = hashes[false];
}

// 顺带校验：各背景本身确实不同（否则说明某个背景选项没生效）
check(
  '「无背景」与「极光」确实是不同画面',
  baseHashes['无背景'] !== baseHashes['极光'],
  `无背景 ${baseHashes['无背景']} vs 极光 ${baseHashes['极光']}`,
);
check(
  '「星空」与「极光」确实是不同画面',
  baseHashes['星空'] !== baseHashes['极光'],
  `星空 ${baseHashes['星空']} vs 极光 ${baseHashes['极光']}`,
);
check(
  '自定义图片与极光是不同画面',
  baseHashes['自定义图片'] !== baseHashes['极光'],
  `图片 ${baseHashes['自定义图片']} vs 极光 ${baseHashes['极光']}`,
);

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
