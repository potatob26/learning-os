/**
 * 小组件载荷（payload）的契约测试
 * ──────────────────────────────────────────────────────────────────────────────
 * 原生小组件完全依赖这份 JSON，它错了小组件就是错的（而且很难从桌面上看出来）。
 * 所以在这里把契约固定下来：字段、口径、排序、边界。
 *
 * 重点验「口径一致性」：percent 必须和首页那个进度环同源，
 * 不能各算一套 —— 否则桌面上显示 68%、打开 App 显示 70%，用户会不信这个数。
 */
import { chromium } from './browser.mjs';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
mkdirSync('.preview/widget', { recursive: true });

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(1200);

/*
 * 用 addInitScript 在**页面脚本之前**写 localStorage。
 * 直接在已加载的页面里 evaluate 会撞上导航/落盘竞态
 * （应用刚启动时的重定向会把执行上下文销毁，第一版就是这么挂的）。
 * startedAt 取「1 分钟前」而不是「几小时前」：跨零点时几小时前会落到昨天，
 * 今日统计就变 0 了 —— 用例不该在半夜莫名其妙地失败。
 */
const seed = {
  schema: 1,
  settings: {
    theme: 'pure-dark', colorMode: 'dark', perf: 'high', onboarded: true,
    dailyGoalMinutes: 180, studyFrom: '00:00', studyTo: '23:59',
    blocks: [], quoteSeed: 'seed', customQuotes: ['自定义的一句'], useBuiltinQuotes: true,
  },
  periods: [], courses: [], goals: [], tasks: [],
  sessions: [
    // 今天学了 90 分钟 → 90/180 = 50%
    { id: 's1', subject: '数学', startedAt: Date.now() - 60_000, endedAt: Date.now(), durationSec: 5400 },
  ],
  dates: [
    { id: 'd1', title: '期末考', date: '2027-01-12', allDay: true, visible: true, primary: false, kind: 'exam', createdAt: Date.now() },
    { id: 'd2', title: '中考', date: '2027-06-15', allDay: true, visible: true, primary: true, kind: 'exam', createdAt: Date.now() + 1 },
    { id: 'd3', title: '不要出现在小组件里', date: '2026-10-01', allDay: true, visible: false, primary: false, kind: 'custom', createdAt: Date.now() + 2 },
  ],
  calendarEvents: [], dayOverrides: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: [], custom: [], dim: 0.3, dynamic: false, showVeil: true, grid: false, dimAuto: false },
  timer: null, courseStatus: {},
};
const seedJson = JSON.stringify(seed);
await page.addInitScript((raw) => {
  try { localStorage.setItem('learning-os:v1:state', raw); } catch { /* ignore */ }
}, seedJson);

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
check('种下测试数据', true);

const payload = await page.evaluate(async () => {
  const m = await import('/src/lib/widgetBridge.ts');
  return m.buildWidgetPayload();
});
const p = JSON.parse(payload);

/* ---------- 契约 ---------- */
console.log('\n=== 字段契约 ===');
for (const key of ['v', 'updatedAt', 'today', 'themeOrder', 'percent', 'quotes', 'dates', 'palettes']) {
  check(`载荷含字段 ${key}`, key in p, typeof p[key]);
}

console.log('\n=== 今日百分比（必须与首页同源）===');
check('percent = 90/180 = 50%', p.percent.percent === 50, JSON.stringify(p.percent));
check('detail 文案带真实时长', p.percent.detail === '1h30m / 3h', p.percent.detail);
/*
 * 口径一致性的验证方式：**和用户在 App 里看到的数字比**，而不是另导入一份 store。
 * 第一版是 `await import('/src/lib/store.ts')` 拿状态再算一遍 —— 拿到的可能是
 * 另一个模块实例（还没 hydrate），算出来 0，于是假失败。
 * 真正要保证的是「桌面上和首页是同一个数」，那就直接读首页渲染出来的那个百分比。
 */
const homePercent = await page.evaluate(() => {
  const text = (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ');
  const m = /(\d+)%/.exec(text);
  return m ? Number(m[1]) : null;
});
check('与首页显示的数字一致（用户看到的是同一个口径）',
  homePercent === p.percent.percent, `载荷 ${p.percent.percent}% vs 首页 ${homePercent}%`);

console.log('\n=== 语句 ===');
check('语句池非空', Array.isArray(p.quotes) && p.quotes.length > 100, `${p.quotes.length} 条`);
check('用户自定义语句也在池子里', p.quotes.includes('自定义的一句'));
check('语句不含空串', p.quotes.every((q) => typeof q === 'string' && q.trim().length > 0));
check('语句不出现感叹号（项目铁律）', p.quotes.every((q) => !q.includes('！') && !q.includes('!')),
  p.quotes.find((q) => q.includes('！')) ?? '无');

console.log('\n=== 重要日期 ===');
check('只推可见的（隐藏的那条被过滤）', p.dates.every((d) => d.title !== '不要出现在小组件里'),
  JSON.stringify(p.dates.map((d) => d.title)));
check('保留了 2 条可见日期', p.dates.length === 2, `${p.dates.length} 条`);
check('按日期升序（方便点着往前翻）',
  p.dates.length === 2 && p.dates[0].date < p.dates[1].date,
  p.dates.map((d) => `${d.title}@${d.date}`).join(' → '));
check('日期只保留 yyyy-MM-dd', p.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)));

console.log('\n=== 调色板 ===');
const themeIds = ['liquid-glass-wc', 'liquid-glass', 'pure-light', 'pure-dark', 'soft', 'immersive'];
check('6 套主题全部解析出来', themeIds.every((t) => p.palettes[t]), Object.keys(p.palettes).join(', '));
check('每套都有 5 个颜色字段',
  themeIds.every((t) => ['bg', 'text', 'secondary', 'accent', 'line'].every((k) => /^#[0-9A-F]{6}$/.test(p.palettes[t][k]))),
  JSON.stringify(p.palettes['pure-dark']));
// 小组件是原生 RemoteViews，只认 #RRGGBB；半透明或 color-mix 必须在 Web 侧就合成掉
check('颜色全部是不透明 #RRGGBB（原生只认这个格式）',
  themeIds.every((t) => ['bg', 'text', 'secondary', 'accent', 'line'].every((k) => /^#[0-9A-F]{6}$/.test(p.palettes[t][k]))));
check('固定深色主题被正确标记（极简黑 / 液态玻璃）',
  p.palettes['pure-dark'].dark === true && p.palettes['liquid-glass-wc'].dark === true,
  `pure-dark.dark=${p.palettes['pure-dark'].dark} liquid-glass-wc.dark=${p.palettes['liquid-glass-wc'].dark}`);
check('主题顺序表齐全', Array.isArray(p.themeOrder) && p.themeOrder.length === 6, p.themeOrder.join(','));
check('defaultTheme 指向真实存在的一套', Boolean(p.palettes[p.defaultTheme]), p.defaultTheme);

console.log('\n=== 解析调色板后必须还原现场 ===');
const rootAfter = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  dark: document.documentElement.classList.contains('dark'),
}));
check('采样完 <html> 上的主题被还原（不留副作用）',
  rootAfter.theme === 'pure-dark' && rootAfter.dark === true, JSON.stringify(rootAfter));

console.log('\n=== 非安卓平台不应尝试调用原生 ===');
const supported = await page.evaluate(async () => {
  const m = await import('/src/lib/widgetBridge.ts');
  return { supported: m.widgetsSupported(), pushed: await m.pushWidgetData() };
});
check('Web 上 widgetsSupported() 为 false', supported.supported === false);
check('Web 上 pushWidgetData() 安全返回 false（不抛异常）', supported.pushed === false);

check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
