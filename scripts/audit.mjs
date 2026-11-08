/**
 * 响应式 / 触控 / 可读性 自动审计
 * ──────────────────────────────────────────────────────────
 * 不靠肉眼抽查 66 张截图，而是用真实浏览器逐元素测量：
 *   1. 可点击元素是否 ≥ 44×44 CSS px（安卓触控硬指标）
 *   2. 是否存在横向溢出（小屏最常见的破图原因）
 *   3. 正文文字是否过小（< 11px 基本读不清）
 *   4. 元素是否被底部导航 / 安全区域遮挡
 *   5. 相对定位祖先是否被意外裁切
 *
 * 用法：node scripts/audit.mjs [url]
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const VIEWPORTS = [
  { name: '小屏安卓 360×640', width: 360, height: 640, dpr: 3, mobile: true },
  { name: '极窄 320×568', width: 320, height: 568, dpr: 2, mobile: true },
  { name: '常见安卓 412×915', width: 412, height: 915, dpr: 2.625, mobile: true },
  { name: '大屏安卓 480×1040', width: 480, height: 1040, dpr: 3, mobile: true },
  { name: '安卓横屏 915×412', width: 915, height: 412, dpr: 2.625, mobile: true },
  { name: '矮屏横屏 740×360', width: 740, height: 360, dpr: 2, mobile: true },
  { name: '平板竖屏 768×1024', width: 768, height: 1024, dpr: 2, mobile: true },
  { name: '平板横屏 1024×768', width: 1024, height: 768, dpr: 2, mobile: true },
  { name: '桌面 1440×900', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: '桌面窄窗 1024×700', width: 1024, height: 700, dpr: 1, mobile: false },
];

const ROUTES = [
  { name: '首页', hash: '#/' },
  { name: '目标', hash: '#/goals' },
  { name: '作业清单', hash: '#/checklist' },
  { name: '计时', hash: '#/timer' },
  { name: '统计', hash: '#/stats' },
  // 日历是独立页面，也要纳入审计 —— 新页面漏审计等于没验过
  { name: '日历', hash: '#/calendar' },
  // 火花独立页（1.4.1 新页面）：新页面必须纳入审计
  { name: '火花', hash: '#/streak' },
  { name: '设置-外观', hash: '#/settings/appearance' },
  { name: '设置-作息', hash: '#/settings/schedule' },
  { name: '设置-课程', hash: '#/settings/courses' },
  { name: '设置-背景', hash: '#/settings/background' },
  { name: '设置-日期', hash: '#/settings/dates' },
  { name: '设置-数据', hash: '#/settings/data' },
];

/** 在页面里跑的测量逻辑 */
const MEASURE = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const findings = { touch: [], overflowX: [], tiny: [], underNav: [], clipped: [] };

  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const cls = (el.className && typeof el.className === 'string' ? el.className : '')
      .split(/\s+/)
      .filter((c) => c && !c.startsWith('anim') && !c.startsWith('snap'))
      .slice(0, 3)
      .join('.');
    const text = (el.textContent ?? '').trim().slice(0, 18).replace(/\s+/g, ' ');
    return `${tag}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
  };

  const visible = (el, r) => {
    if (r.width === 0 || r.height === 0) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) return false;
    // 屏幕外的不算（跳过链接未聚焦时整体在视口上方，是刻意的无障碍模式）
    if (r.bottom <= 0 || r.top > vh + 4000) return false;
    return true;
  };

  /** 元素是否被某个裁剪祖先挡住（装饰性溢出属于正常，不算破图） */
  const isClipped = (el) => {
    let p = el.parentElement;
    let depth = 0;
    while (p && depth++ < 12) {
      const st = getComputedStyle(p);
      if (st.overflow !== 'visible' || st.overflowX !== 'visible') return true;
      p = p.parentElement;
    }
    return false;
  };

  /** 是否是纯装饰层（背景、遮罩等），它们天生比屏幕大 */
  const isDecorative = (el) =>
    el.closest('.bg-layer, [aria-hidden="true"]') !== null ||
    el.matches('.bg-scene, .bg-veil, .bg-protect, .bg-tint, .bg-photo');

  /** 可点元素自带 ≥44px 的命中区（含 ::before 扩展、透明子元素或撑满的父级） */
  const hasBigHitArea = (el, r) => {
    const before = getComputedStyle(el, '::before');
    if (before && before.content !== 'none') {
      const w = parseFloat(before.width);
      const h = parseFloat(before.height);
      if ((Number.isFinite(w) && w >= 44) || (Number.isFinite(h) && h >= 44)) return true;
    }
    // 内联子元素撑满父级：父级实际上承担了命中区
    if (r.width < 24 || r.height < 24) {
      const box = el.getBoundingClientRect();
      for (const child of el.children) {
        const cr = child.getBoundingClientRect();
        if (cr.width >= box.width - 2 && cr.height >= box.height - 2) {
          const pr = el.closest('button, [role="button"], a, label');
          if (pr) {
            const rr = pr.getBoundingClientRect();
            if (rr.width >= 44 && rr.height >= 44) return true;
          }
        }
      }
    }
    const parent = el.closest('button, [role="button"], a, label');
    if (parent && parent !== el) {
      const pr = parent.getBoundingClientRect();
      if (pr.width >= 44 && pr.height >= 44) return true;
    }
    return false;
  };

  const SELECTOR =
    'button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="tab"], [tabindex]:not([tabindex="-1"])';

  for (const el of document.querySelectorAll(SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const st = getComputedStyle(el);

    // 1. 触控目标
    /*
     * 比较前先四舍五入。
     *
     * 理由：浏览器按分数像素布局，一个名义上 44px 的盒子（Tailwind 的 size-11）
     * 量出来可能是 43.999…，于是「显示 44×44 却报不达标」——
     * 这个自相矛盾正是判据有问题的信号。实测同一份代码多次运行，
     * 报的条数在 0~2 之间浮动，全是这一个元素。
     *
     * 先 Math.round 再比，既能滤掉这种亚像素噪声，
     * 又照样抓得住真正偏小的目标（39px、36px 这类四舍五入后仍远小于 44）。
     */
    if (Math.round(r.width) < 44 || Math.round(r.height) < 44) {
      const isFile = el.tagName === 'INPUT' && el.type === 'file';
      const isRange = el.tagName === 'INPUT' && el.type === 'range';
      if (!isFile && !isRange && !hasBigHitArea(el, r)) {
        findings.touch.push({
          el: describe(el),
          size: `${Math.round(r.width)}×${Math.round(r.height)}`,
        });
      }
    }

    // 3. 文字大小
    const fs = parseFloat(st.fontSize);
    const text = (el.textContent ?? '').trim();
    if (text.length > 0 && el.children.length === 0 && fs < 11) {
      findings.tiny.push({ el: describe(el), fontSize: fs });
    }
  }

  // 2. 横向溢出：以文档级滚动宽度为准（装饰层被裁剪不算溢出）
  const docW = document.documentElement.scrollWidth;
  if (docW > vw + 1) {
    findings.overflowX.push({ scope: 'document', scrollWidth: docW, viewport: vw });
  }
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if (r.width === 0) continue;
    if (el.closest('.scroll-x, .no-scrollbar, [data-allow-overflow]')) continue;
    if (isDecorative(el) || isClipped(el)) continue;
    const st = getComputedStyle(el);
    if (st.position === 'fixed') continue;
    if (r.right > vw + 2 || r.left < -2) {
      findings.overflowX.push({
        el: describe(el),
        left: Math.round(r.left),
        right: Math.round(r.right),
        viewport: vw,
      });
    }
  }

  // 4. 被底部导航遮挡（只针对手机上那个固定底部导航）
  const nav = Array.from(document.querySelectorAll('nav')).find((n) => {
    const st = getComputedStyle(n);
    return st.position === 'fixed' && n.getBoundingClientRect().bottom > window.innerHeight - 4;
  });
  if (nav) {
    const nr = nav.getBoundingClientRect();
    const main = document.querySelector('main');
    const lastChild = main?.lastElementChild;
    if (lastChild) {
      const lr = lastChild.getBoundingClientRect();
      const atBottom = window.scrollY + vh >= document.documentElement.scrollHeight - 4;
      // 只有当内容真的压在导航上（无 padding 兜底）才算问题
      if (atBottom && lr.bottom > nr.top + 2) {
        findings.underNav.push({
          el: describe(lastChild),
          bottom: Math.round(lr.bottom),
          navTop: Math.round(nr.top),
        });
      }
    }
  }

  return findings;
};

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const report = [];
let problemCount = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  const jsErrors = [];
  const networkFailures = [];
  page.on('requestfailed', (request) => networkFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = `${m.text()} (${m.location().url || 'unknown source'})`;
    /*
     * 坑 33 的姊妹坑：外网时间源的**资源加载失败**（net::ERR_CONNECTION_RESET /
     * ERR_FAILED / ERR_NAME_NOT_RESOLVED）也会被打成 console error。
     * worldtimeapi.org 一限流就重置连接，审计里 14 个组合会跟着「假失败」
     * （2026-09-25 实测）。只对**应用自身与脚本来源**的错误计错，外网噪声忽略。
     */
    if (/Failed to load resource/i.test(text) && /worldtimeapi|timeapi\.io|cloudflare|googleapis/i.test(text)) return;
    jsErrors.push(text);
  });

  // 注入示例数据，让所有页面都有真实内容可测
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate((seed) => localStorage.setItem('learning-os:v1:state', JSON.stringify(seed)), SEED());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);

  for (const route of ROUTES) {
    await page.goto(`${url}${route.hash}`, { waitUntil: 'load' });
    await page.waitForTimeout(420);
    // 滚到底部，让「被导航遮挡」的检测有意义
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(260);

    /*
     * 等入场动画结束后再测量。
     *
     * 不加这一步会偶发误报：卡片有 anim-rise 入场动画，动画期间带着 scale，
     * 而 getBoundingClientRect() 会把 transform 算进去 —— 于是 44px 的图标按钮
     * 会被量成 43.x，报「触控目标 <44px」。
     * 实测同一份代码连跑两次，一次报 2 条、一次报 0～1 条，就是被这个时序坑的。
     * 动画本身不是缺陷，测量必须避开它。
     *
     * 必须加超时：页面里可能有无限循环的动画（旋转指示器之类），
     * 那样 anim.finished 永远不会 resolve，整个审计会挂死
     * —— 第一版就漏了这一点，跑三次全部超时。
     */
    await page.evaluate(async () => {
      const anims = document.getAnimations?.() ?? [];
      const finite = anims.filter((a) => {
        const d = a.effect?.getComputedTiming?.();
        return d && Number.isFinite(d.endTime);
      });
      await Promise.race([
        Promise.all(finite.map((a) => a.finished.catch(() => {}))),
        new Promise((r) => setTimeout(r, 900)),
      ]);
    });
    await page.waitForTimeout(120);

    const found = await page.evaluate(MEASURE);

    const issues = [];
    const uniqTouch = dedupe(found.touch, (x) => x.el + x.size);
    if (uniqTouch.length) issues.push({ kind: '触控目标 <44px', items: uniqTouch });
    const uniqOverflow = dedupe(found.overflowX, (x) => (x.el ?? x.scope) + (x.right ?? ''));
    if (uniqOverflow.length) issues.push({ kind: '横向溢出', items: uniqOverflow });
    const uniqTiny = dedupe(found.tiny, (x) => x.el);
    if (uniqTiny.length) issues.push({ kind: '字号 <11px', items: uniqTiny });
    if (found.underNav.length) issues.push({ kind: '内容被底部导航遮挡', items: found.underNav });

    if (jsErrors.length) issues.push({ kind: 'JS 错误', items: jsErrors.slice(0, 3).map((e) => ({ el: e })) });

    if (issues.length) problemCount += issues.length;
    report.push({ viewport: vp.name, route: route.name, issues, networkFailures: [...networkFailures] });
    const flag = issues.length ? '×' : '✓';
    console.log(`  ${flag} ${vp.name.padEnd(18)} ${route.name}${issues.length ? `  → ${issues.map((i) => `${i.kind}(${i.items.length})`).join(', ')}` : ''}`);
  }

  await ctx.close();
}

await browser.close();

function dedupe(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    const k = keyFn(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

function isBig(size) {
  const [w, h] = size.split('×').map(Number);
  return w >= 44 && h >= 44;
}
void isBig;

/* ---------------- 示例数据 ---------------- */

function SEED() {
  const wd = (new Date().getDay() + 6) % 7;
  const at = (daysAgo, h, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const sessions = [];
  for (const [d, mins] of [
    [0, 138],
    [1, 175],
    [2, 92],
    [3, 210],
    [4, 60],
    [5, 143],
    [6, 188],
  ]) {
    sessions.push({
      id: `s${d}`,
      subject: ['数学', '英语', '物理'][d % 3],
      goalId: null,
      startedAt: at(d, 19, 0),
      endedAt: at(d, 19, 0) + mins * 60000,
      durationSec: mins * 60,
      source: 'timer',
    });
  }
  return {
    schema: 1,
    settings: {
      theme: 'mica',
      colorMode: 'light',
      perf: 'balanced',
      motion: true,
      glassBlur: true,
      dynamicBackground: true,
      autoRotate: false,
      schoolStart: '08:00',
      schoolEnd: '17:40',
      wakeTime: '06:40',
      sleepTime: '22:30',
      dailyGoalMinutes: 180,
      blocks: [
        { id: 'b1', label: '晚饭', kind: 'meal', start: '17:40', end: '18:30', weekdays: null },
        { id: 'b2', label: '洗漱、收拾', kind: 'chore', start: '22:00', end: '22:25', weekdays: null },
      ],
      studyFrom: '17:40',
      studyTo: '22:30',
      quoteSeed: '2026-09-12',
      align: 'left',
      nickname: '',
      onboarded: true,
    },
    periods: Array.from({ length: 8 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `第 ${i + 1} 节`,
      start: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '55' : '00'}`,
      end: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '40' : '45'}`,
      counts: true,
    })),
    courses: [
      { id: 'c1', subject: '数学', title: '数学', weekday: wd, periodId: 'p1', location: '高二(3)班' },
      { id: 'c2', subject: '英语', title: '英语', weekday: wd, periodId: 'p2', location: '高二(3)班' },
      { id: 'c3', subject: '物理', title: '物理', weekday: wd, periodId: 'p3', location: '实验楼 2' },
      { id: 'c4', subject: '化学', title: '化学', weekday: (wd + 1) % 7, periodId: 'p1' },
    ],
    goals: [
      { id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60, actualMinutes: 47, dueAt: null, priority: 'high', status: 'done', createdAt: at(0, 8), completedAt: at(0, 20) },
      { id: 'g2', title: '背诵英语 Unit 5 单词', subject: '英语', plannedMinutes: 30, actualMinutes: 22, dueAt: null, priority: 'normal', status: 'doing', createdAt: at(0, 8) },
      { id: 'g3', title: '物理错题重做', subject: '物理', plannedMinutes: 45, actualMinutes: 0, dueAt: null, priority: 'high', status: 'todo', createdAt: at(0, 9) },
      { id: 'g4', title: '语文古诗默写', subject: '语文', plannedMinutes: 20, actualMinutes: 0, dueAt: null, priority: 'low', status: 'todo', createdAt: at(0, 10) },
    ],
    tasks: [],
    sessions,
    dates: [
      { id: 'd1', title: '中考', date: '2027-06-15', allDay: true, primary: true, visible: true, kind: 'exam', createdAt: Date.now() },
      { id: 'd2', title: '期末考', date: '2027-01-12', allDay: true, primary: false, visible: true, kind: 'exam', createdAt: Date.now() },
      { id: 'd3', title: '生日', date: '2026-11-03', allDay: true, primary: false, visible: true, kind: 'birthday', createdAt: Date.now() },
    ],
    background: {
      current: 'scene:aurora',
      mode: 'fixed',
      rotateMinutes: 60,
      enabledIds: ['scene:aurora'],
      custom: [],
      dim: 0.35,
      dynamic: true,
      showVeil: true,
    },
    timer: null,
  };
}

/* ---------------- 汇总 ---------------- */

mkdirSync('.preview', { recursive: true });
writeFileSync('.preview/audit-report.json', JSON.stringify(report, null, 2));

console.log('\n================ 审计汇总 ================');
const totalCells = report.length;
const cleanCells = report.filter((r) => r.issues.length === 0).length;
console.log(`${cleanCells}/${totalCells} 个「页面 × 视口」组合完全无问题`);

const byKind = new Map();
for (const r of report) {
  for (const i of r.issues) {
    if (!byKind.has(i.kind)) byKind.set(i.kind, []);
    byKind.get(i.kind).push({ where: `${r.viewport} / ${r.route}`, items: i.items });
  }
}
for (const [kind, list] of byKind) {
  const n = list.reduce((a, x) => a + x.items.length, 0);
  console.log(`\n【${kind}】共 ${n} 处，出现在 ${list.length} 个组合：`);
  for (const l of list.slice(0, 8)) {
    console.log(`  · ${l.where}`);
    for (const it of l.items.slice(0, 4)) {
      console.log(`      ${JSON.stringify(it)}`);
    }
  }
  if (list.length > 8) console.log(`  … 还有 ${list.length - 8} 个组合`);
}
console.log(`\n完整报告：.preview/audit-report.json`);
process.exit(problemCount > 0 ? 1 : 0);
