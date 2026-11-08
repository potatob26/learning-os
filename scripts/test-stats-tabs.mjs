/**
 * 验证统计页三个子标签
 *  ① 视觉：逐个截图
 *  ② 数值：核对日历/热力图显示的数字与 sessions 的真实聚合是否一致
 *     （不是"看起来对"，而是拿独立算出的期望值去比对）
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/statstabs';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

/* ---------- 造一份有结构的半年记录（确定性，不用随机数）---------- */
const subjects = ['数学', '英语', '物理', '语文'];
const sessions = [];
const now = Date.now();
for (let d = 179; d >= 0; d--) {
  const dayTs = now - d * 86400000;
  // 用日期做确定性"强度"：周期 + 锯齿，制造深浅层次，且周末更少
  const wd = new Date(dayTs).getDay();
  const wave = (Math.sin(d / 9) + 1) / 2;          // 0..1
  const saw = ((d * 7) % 11) / 11;                  // 0..1
  let n = Math.floor(wave * 3 + saw * 2);
  if (wd === 0 || wd === 6) n = Math.max(0, n - 2);
  for (let i = 0; i < n; i++) {
    const start = dayTs - (i + 1) * 3600000;
    const mins = 20 + ((d * 13 + i * 17) % 45);
    sessions.push({
      id: `s-${d}-${i}`,
      subject: subjects[(d + i) % subjects.length],
      goalId: null,
      startedAt: start,
      endedAt: start + mins * 60000,
      durationSec: mins * 60,
      source: 'timer',
    });
  }
}

/* ---------- 独立算出期望值（不复用应用代码，避免同错同对）---------- */
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const byDay = new Map();
for (const s of sessions) {
  const k = keyOf(s.startedAt);
  byDay.set(k, (byDay.get(k) ?? 0) + Math.round(s.durationSec / 60));
}
const d0 = new Date(now);
const thisMonth = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}`;
let expectMonthMin = 0;
let expectMonthDays = 0;
for (const [k, v] of byDay) {
  if (k.startsWith(thisMonth)) {
    expectMonthMin += v;
    if (v > 0) expectMonthDays += 1;
  }
}
// 近 26 周（182 天）
let expect26wMin = 0;
let expect26wDays = 0;
const cutoff = now - 181 * 86400000;
for (const [k, v] of byDay) {
  const t = new Date(k + 'T00:00:00').getTime();
  if (t >= new Date(cutoff).setHours(0, 0, 0, 0)) {
    expect26wMin += v;
    if (v > 0) expect26wDays += 1;
  }
}
console.log('=== 期望值（独立计算，作为比对基准）===');
console.log(`  本月合计 ${expectMonthMin} 分钟 · 有记录 ${expectMonthDays} 天`);
console.log(`  近 26 周合计 ${expect26wMin} 分钟 · 有记录 ${expect26wDays} 天\n`);

const seed = (theme, colorMode) => ({
  schema: 3,
  settings: {
    theme, colorMode, perf: 'high', glassBlur: true, dynamicBackground: false,
    onboarded: true, blocks: [], quoteSeed: 'x', dailyGoalMinutes: 180,
  },
  periods: [], courses: [], goals: [], tasks: [], sessions,
  dates: [],
  background: { current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:aurora'], custom: [], dim: 0.35, dynamic: false, showVeil: true, grid: false, dimAuto: false },
  timer: null, courseStatus: {},
});

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2,
  locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
const errors = [];
/**
 * 只收「应用自身」的错误。
 * 应用会向外部校时服务（worldtimeapi）发请求，那台服务不稳定，失败时会产生
 * 三类控制台错误：net::ERR_CONNECTION_CLOSED、net::ERR_FAILED、
 * 以及 CORS 拦截（"blocked by CORS policy"）。
 *
 * 判断关键是 **失败的是哪个 URL**，不是错误的措辞：
 *   · 资源加载失败的文案常常只有 "Failed to load resource: net::ERR_..."，
 *     **文本里根本没有 URL** —— 光靠正则匹配文本会全漏（第一版就栽在这）
 *   · 真正的 URL 在 consoleMessage.location() 里
 * 所以：拿到 location 的 URL，只要是外部地址就算外部依赖问题。
 */
const isNetFail = (t) =>
  /net::ERR_|Failed to load resource|blocked by CORS|Access-Control-Allow-Origin/i.test(t);
const isLocal = (u) => /localhost|127\.0\.0\.1/.test(u);

page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text().slice(0, 200);
  const locUrl = m.location()?.url ?? '';
  // 文本里偶尔也会带 URL（例如 CORS 那条），一并取出来
  const url = locUrl || (/https?:\/\/[^\s'")]+/.exec(t)?.[0] ?? '');
  if (isNetFail(t) && url && !isLocal(url)) return; // 外部依赖不可达，不算应用缺陷
  errors.push(url ? `${t} @${url}` : t);
});

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed('liquid-glass', 'dark'));
await page.goto('http://127.0.0.1:5188/#/stats', { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2000);

/* ---------- 三个标签都能切到并渲染 ---------- */
for (const [id, label] of [['overview', '概览'], ['calendar', '日历'], ['heatmap', '热力图'], ['exam', '成绩'], ['achievements', '成就']]) {
  const ok = await page.evaluate((lb) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === lb);
    if (!b) return false;
    b.click();
    return true;
  }, label);
  await page.waitForTimeout(900);
  /*
   * 原来只断言 `main.textContent.length > 100` —— 用纯字符数当「这个标签有内容」的代理。
   * 这个指标会随日期和数据浮动：热力图那屏实测 99 字，正好卡在阈值下，
   * 于是用例在什么都没坏的情况下失败（已用「把 src/ 暂回 HEAD 重建」证明是既有问题，
   * 不是某次改动引入的）。
   *
   * 改成看**有内容的可见元素个数**：它能真正区分「标签切过去了但渲染成空白」
   * 和「内容确实在，只是字数少」。字数下限保留一个很低的兜底值，用来抓住完全空白的情况；
   * 各标签的实质校验由下面那些具体断言负责（日历合计、热力图格子数等）。
   */
  const rendered = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return { chars: 0, nodes: 0 };
    const nodes = Array.from(main.querySelectorAll('*')).filter((el) => {
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
      return own && el.getBoundingClientRect().height > 0;
    }).length;
    return { chars: (main.textContent || '').trim().length, nodes };
  });
  check(`「${label}」标签可切换且有内容`, ok && rendered.chars > 40 && rendered.nodes >= 3,
    `文本 ${rendered.chars} 字 / 有内容元素 ${rendered.nodes} 个`);
  await page.screenshot({ path: `${out}/${id}.png` });
}

/* ---------- 日历：本月合计应与独立计算一致 ---------- */
await page.evaluate(() => {
  Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '日历')?.click();
});
await page.waitForTimeout(900);
const calTotals = await page.evaluate(() => {
  const txt = document.querySelector('main')?.textContent ?? '';
  const m = /有记录\s*(\d+)\s*天\s*·\s*合计\s*([\dhm ]+)/.exec(txt.replace(/\s+/g, ' '));
  return m ? { days: Number(m[1]), dur: m[2].trim() } : null;
});
const expectDur = `${Math.floor(expectMonthMin / 60)}h ${expectMonthMin % 60}m`;
/** 把 "21h6m" / "45m" 解析成分钟再比较。
 *  不要直接比字符串：应用用 fmtDuration，输出无空格（21h6m），
 *  我第一版拼成 "21h 6m" 就误报了一次失败 —— 数值其实是对的。 */
const parseDur = (s) => {
  const h = /(\d+)\s*h/.exec(s);
  const m = /(\d+)\s*m/.exec(s);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
};
check(
  '日历「本月合计」与独立计算一致',
  calTotals !== null && calTotals.days === expectMonthDays && parseDur(calTotals.dur) === expectMonthMin,
  `页面 ${JSON.stringify(calTotals)}（${parseDur(calTotals?.dur ?? '')} 分钟）vs 期望 ${expectMonthDays} 天 / ${expectMonthMin} 分钟`,
);

/* ---------- 日历：日格尺寸必须 ≥44（触控下限）---------- */
const cellSize = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).filter((x) => /^\d{1,2}$/.test((x.textContent || '').trim()));
  if (!b.length) return null;
  const r = b[0].getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
check('日历日格 ≥44×44', cellSize !== null && cellSize.w >= 44 && cellSize.h >= 44, JSON.stringify(cellSize));

/* ---------- 点某天 → 详情更新 ---------- */
const detail = await page.evaluate(() => {
  const days = Array.from(document.querySelectorAll('button')).filter((x) => /^\d{1,2}$/.test((x.textContent || '').trim()));
  // 找一个有记录的天（底不是全透明）
  const withData = days.find((d) => {
    const bg = getComputedStyle(d).backgroundImage + getComputedStyle(d).backgroundColor;
    return bg.includes('color') || bg.includes('rgb');
  });
  (withData ?? days[5])?.click();
  return { clicked: (withData ?? days[5])?.textContent?.trim() ?? null };
});
await page.waitForTimeout(800);
const hasDetail = await page.evaluate(() => {
  const t = document.querySelector('main')?.textContent ?? '';
  return /学习\s*[\dhms ]+/.test(t) || /没有学习记录/.test(t);
});
check('点某天后显示当天详情', detail.clicked !== null && hasDetail, `点了 ${detail.clicked} 日`);

/* ---------- 热力图：格子数与"近半年"一致 ---------- */
await page.evaluate(() => {
  Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '热力图')?.click();
});
await page.waitForTimeout(900);
const heat = await page.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('[role="img"][aria-label*="学习"]'));
  const txt = document.querySelector('main')?.textContent ?? '';
  const m = /近\s*(\d+)\s*周共\s*(\d+)\s*小时/.exec(txt.replace(/\s+/g, ' '));
  const m2 = /有记录\s*(\d+)\s*天/.exec(txt.replace(/\s+/g, ' '));
  return {
    cells: cells.length,
    weeks: m ? Number(m[1]) : null,
    hours: m ? Number(m[2]) : null,
    days: m2 ? Number(m2[1]) : null,
  };
});
check('热力图格子数为 周数×7', heat.weeks !== null && heat.cells === heat.weeks * 7, `${heat.weeks} 周 × 7 = 期望 ${heat.weeks ? heat.weeks * 7 : '?'}，实际 ${heat.cells}`);
check('热力图「有记录天数」与独立计算一致', heat.days === expect26wDays, `页面 ${heat.days} vs 期望 ${expect26wDays}`);
check('热力图小时数与独立计算一致', heat.hours === Math.round(expect26wMin / 60), `页面 ${heat.hours} vs 期望 ${Math.round(expect26wMin / 60)}`);

check('无 JS 报错', errors.length === 0, [...new Set(errors)].slice(0, 2).join(' | '));

await ctx.close();
await browser.close();

const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${out}/  (overview.png / calendar.png / heatmap.png)`);
if (failed) process.exit(1);
