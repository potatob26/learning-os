/**
 * 验证本轮三项改动
 *  ① 强调色自定义：选了颜色后 --accent 及派生令牌真的变了；液态玻璃主题下不生效
 *  ② 鼓励语位置：在「今日自学」之下、页面底部（「现在该做什么」之后）
 *  ③ 语句：自定义能加、能删、能关内置；「换一句」真的换到**不同**的一条
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/round3';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const BASE = 'http://127.0.0.1:4173/';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'] });

const seed = (over = {}) => ({
  schema: 3,
  settings: {
    theme: 'pure-light', colorMode: 'light', perf: 'high', glassBlur: true, dynamicBackground: false,
    onboarded: true, blocks: [], quoteSeed: 'x', dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '23:00',
    accent: null, customQuotes: [], useBuiltinQuotes: true,
    ...over,
  },
  periods: [], courses: [],
  goals: [{ id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60, actualMinutes: 24, status: 'doing', priority: 'normal', createdAt: Date.now(), completedAt: null, dueAt: null, description: '' }],
  tasks: [], sessions: [], dates: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false, dimAuto: false },
  timer: null, courseStatus: {},
});

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

async function open(data, hash = '') {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'light', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), data);
  await page.goto(BASE + hash, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => { Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click(); });
  await page.waitForTimeout(700);
  return { ctx, page };
}

/* ---------- ① 强调色 ---------- */
{
  const { ctx, page } = await open(seed({ accent: '#e0533d' }));
  const colors = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    // 主按钮的实际底色（不能只看令牌，要看按钮真的画成什么颜色）
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /开始 \d+ 分钟/.test(b.textContent || ''));
    return {
      accent: g('--accent'),
      onSoft: g('--accent-on-soft'),
      primaryBg: g('--primary-bg'),
      onAccent: g('--on-accent'),
      btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
    };
  });
  console.log('\n=== ① 自定义强调色 #e0533d（极简白主题）===');
  console.log('  ' + JSON.stringify(colors));
  check('--accent 被替换成自定义色', colors.accent === '#e0533d', colors.accent);
  check('选中态文字色跟着变（color-mix 生效）', colors.onSoft.includes('e0533d'), colors.onSoft);
  check('主按钮底色跟着变（不再固定为蓝）', /224|e0533d|rgb\(1[0-9]{2}|rgb\(2[0-9]{2}/i.test(colors.btnBg ?? ''), `按钮底色 ${colors.btnBg}`);
  await page.screenshot({ path: `${out}/accent-custom.png` });
  await ctx.close();
}
{
  // 明黄这种「压白字压深字都不行」的极端颜色，也要能算出可读的按钮底色
  const { ctx, page } = await open(seed({ accent: '#eab308' }));
  const r = await page.evaluate(() => {
    function lin(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    function lum(s) { const m = s.match(/[\d.]+/g).map(Number); return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]); }
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /开始 \d+ 分钟/.test(b.textContent || ''));
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    const L1 = lum(cs.color), L2 = lum(cs.backgroundColor);
    const a = Math.max(L1, L2), b = Math.min(L1, L2);
    return { color: cs.color, bg: cs.backgroundColor, contrast: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 };
  });
  console.log('\n=== ① 极端色 #eab308（明黄）===');
  console.log('  ' + JSON.stringify(r));
  check('明黄下按钮文字仍达标（≥4.5）', r !== null && r.contrast >= 4.5, `${r?.contrast}:1  ${r?.color} on ${r?.bg}`);
  await ctx.close();
}
{
  // 液态玻璃主题下应当被忽略
  const { ctx, page } = await open(seed({ theme: 'liquid-glass-wc', colorMode: 'dark', accent: '#e0533d' }));
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  console.log('\n=== ① 液态玻璃主题下应忽略自定义色 ===');
  check('液态玻璃主题不使用自定义强调色', !/e0533d/i.test(accent), `--accent = ${accent}`);
  await ctx.close();
}

/* ---------- ② 鼓励语位置 ----------
   不能按文案找：语句是随机挑的，写死某一句必然匹配不上（第一版就栽在这）。
   改为按 DOM 结构定位：首页第二张卡就是鼓励语卡。 */
{
  const { ctx, page } = await open(seed());
  const order = await page.evaluate(() => {
    const main = document.querySelector('main');
    const topOf = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
    const progress = Array.from(main.querySelectorAll('p')).find((p) => (p.textContent || '').trim() === '今日自学');
    const quote = main.querySelector('button[aria-label="换一句"]')?.closest('div');
    const next = Array.from(main.querySelectorAll('p')).find((p) => (p.textContent || '').trim() === '现在该做什么');
    return {
      progress: progress ? topOf(progress) : null,
      quote: quote ? topOf(quote) : null,
      next: next ? topOf(next) : null,
      quoteText: quote ? (quote.textContent || '').trim().slice(0, 30) : null,
    };
  });
  console.log('\n=== ② 鼓励语位置 ===');
  console.log('  ' + JSON.stringify(order));
  check('鼓励语卡存在', order.quote !== null, order.quoteText ?? '未找到');
  check('在「今日自学」之下', order.progress !== null && order.quote !== null && order.quote > order.progress,
    `今日自学 ${order.progress} → 鼓励语 ${order.quote}`);
  /*
   * 鼓励语**刻意放在页面底部**（首屏要让给「今天学了多少 / 还能学多久 / 现在该做什么」三问），
   * 所以它应该在「现在该做什么」**之后**，而不是之前。
   * 这条断言原先写的是 `quote < next`（在它之上），与现行设计相反 ——
   * 属于断言过期，不是页面错位。
   */
  check('在「现在该做什么」之下', order.next !== null && order.quote !== null && order.quote > order.next,
    `现在该做什么 ${order.next} → 鼓励语 ${order.quote}`);
  await page.screenshot({ path: `${out}/home-order.png` });
  await ctx.close();
}

/* ---------- ③ 自定义语句 + 换一句 ---------- */
{
  const { ctx, page } = await open(seed({ customQuotes: ['今天先做五分钟就好', '慢一点也算前进'], useBuiltinQuotes: false }));
  const first = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('main p')).find((x) => /今天先做五分钟就好|慢一点也算前进/.test(x.textContent || ''));
    return p ? (p.textContent || '').trim() : null;
  });
  check('关掉内置后只显示自定义语句', first !== null, first ?? '未找到');

  const hasBtn = await page.evaluate(() => Boolean(document.querySelector('button[aria-label="换一句"]')));
  check('候选 ≥2 时显示「换一句」按钮', hasBtn);

  const second = await page.evaluate(() => {
    document.querySelector('button[aria-label="换一句"]')?.click();
    return new Promise((r) => setTimeout(() => {
      const p = Array.from(document.querySelectorAll('main p')).find((x) => /今天先做五分钟就好|慢一点也算前进/.test(x.textContent || ''));
      r(p ? (p.textContent || '').trim() : null);
    }, 400));
  });
  check('「换一句」换到了不同的一条', second !== null && second !== first, `${first} → ${second}`);
  await ctx.close();
}
{
  // 关掉内置且没有自定义 → 应显示兜底文案并给出提示
  const { ctx, page } = await open(seed({ customQuotes: [], useBuiltinQuotes: false }));
  const txt = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
  check('关内置且无自定义时显示兜底文案', txt.includes('开始就好'), txt.slice(0, 60));
  await ctx.close();
}
{
  // 设置页里能加、能删
  const { ctx, page } = await open(seed(), '#/settings/appearance');
  const added = await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input')).find((i) => (i.placeholder || '').includes('写一句'));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '这是我自己加的一句话');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '添加')?.click();
  });
  await page.waitForTimeout(600);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('learning-os:v1:state')).settings.customQuotes);
  check('设置页能添加自定义语句', added && Array.isArray(saved) && saved.includes('这是我自己加的一句话'), JSON.stringify(saved));
  await page.screenshot({ path: `${out}/settings-quote.png` });

  await page.evaluate(() => {
    document.querySelector('button[aria-label="删除这一条"]')?.click();
  });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('learning-os:v1:state')).settings.customQuotes);
  check('设置页能删除自定义语句', Array.isArray(after) && after.length === 0, JSON.stringify(after));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${out}/`);
if (failed) process.exit(1);
