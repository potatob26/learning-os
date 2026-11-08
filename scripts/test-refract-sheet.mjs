/**
 * 验证液态玻璃主题下的弹层
 *  ① 弹层里真的创建了 <liquid-glass> 且 WebGL 渲染成功
 *  ② 它用的是**自己的**来源画布（不是页面那块），尺寸与弹层一致
 *  ③ 玻璃在内容之下，弹层里的文字与按钮未被遮挡
 *  ④ 关闭弹层后实例被清理，WebGL 上下文不泄漏
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/refract-sheet';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const seed = {
  schema: 3,
  settings: {
    theme: 'liquid-glass-wc', colorMode: 'dark', perf: 'high', glassBlur: true,
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
    dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '23:00',
  },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false, dimAuto: false },
  timer: null, courseStatus: {},
};

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2,
  locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.addInitScript((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed);
await page.goto('http://127.0.0.1:5188/#/goals', { waitUntil: 'load' });
await page.waitForFunction(()=>document.querySelector('.nav-glass-stage')?.dataset.contentReady==='true');

const before = await page.evaluate(() => document.querySelectorAll('liquid-glass').length);
console.log(`打开弹层前，页面上的玻璃实例数：${before}`);

// 打开「新建目标」弹层
await page.getByRole('button',{name:'新建',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[role="dialog"] liquid-glass')?.shadowRoot.querySelector('.surface.rendered'));
await page.waitForTimeout(500);

const info = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return { open: false };
  const others = Array.from(document.querySelectorAll('liquid-glass'));
  // 弹层内的那个实例：它应当是弹层面板（有 border 与圆角）的直接子元素
  const panel = dlg.querySelector('div.relative.overflow-hidden');
  const inSheet = panel ? panel.querySelector('liquid-glass') : null;
  const canvas = panel?.querySelector('canvas');
  const r = panel?.getBoundingClientRect();
  return {
    open: true,
    total: others.length,
    hasGlass: Boolean(inSheet),
    rendered: Boolean(inSheet?.shadowRoot?.querySelector('.surface.rendered')),
    hasOwnCanvas: Boolean(canvas),
    canvasSize: canvas ? `${canvas.width}×${canvas.height}` : null,
    panelSize: r ? `${Math.round(r.width)}×${Math.round(r.height)}` : null,
    sourceIsPageCanvas: inSheet ? inSheet.source === document.querySelector('.bg-canvas') : null,
    glassRect: inSheet ? (() => { const g = inSheet.getBoundingClientRect(); return `${Math.round(g.width)}×${Math.round(g.height)}`; })() : null,
  };
});

console.log('弹层信息:', JSON.stringify(info));
check('弹层已打开', info.open);
check('弹层内创建了玻璃实例', info.hasGlass);
check('该实例 WebGL 渲染成功', info.rendered === true);
check('它有自己的来源画布', info.hasOwnCanvas === true);
check('来源画布不是页面那块（避免坐标错位）', info.sourceIsPageCanvas === false);
check('画布尺寸与弹层一致（按 dpr）', typeof info.canvasSize === 'string' && typeof info.panelSize === 'string' && info.canvasSize.split('×')[0] === String(Number(info.panelSize.split('×')[0]) * 2), `canvas ${info.canvasSize} vs panel ${info.panelSize}`);
check('玻璃尺寸与弹层一致', info.glassRect === info.panelSize, `glass ${info.glassRect} vs panel ${info.panelSize}`);

/* 弹层里的按钮必须能真实点到（不能被玻璃挡住）。
   取**完整落在视口内**的按钮：底部主操作（如「创建目标」）常常一半在折叠线外，
   它的中心点 elementFromPoint 会返回 null，看起来像"点不到"，其实是取样点出界。 */
const clickable = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  const vh = window.innerHeight;
  const btns = Array.from(dlg?.querySelectorAll('button') ?? []).filter((b) => {
    if (!(b.textContent || '').trim()) return false;
    const r = b.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= vh && r.width > 20 && r.height > 20;
  });
  const btn = btns[0];
  if (!btn) return { found: false };
  const r = btn.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return {
    found: true,
    label: (btn.textContent || '').trim().slice(0, 10),
    onGlass: Boolean(hit?.closest?.('liquid-glass')),
    isSelfOrChild: Boolean(hit && (hit === btn || btn.contains(hit))),
  };
});
check(
  '弹层内按钮未被玻璃遮挡',
  clickable.found && !clickable.onGlass && clickable.isSelfOrChild,
  JSON.stringify(clickable),
);

await page.screenshot({ path: `${out}/sheet.png` });

/* 关闭弹层后实例应被清理 */
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
const after = await page.evaluate(() => document.querySelectorAll('liquid-glass').length);
check('关闭弹层后实例被清理（不泄漏 WebGL 上下文）', after === before, `关闭前 ${before} · 打开时 ${info.total} · 关闭后 ${after}`);

check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${out}/sheet.png`);
if (failed) process.exit(1);
