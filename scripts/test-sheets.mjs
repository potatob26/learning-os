/**
 * 全弹层覆盖测试
 * ──────────────────────────────────────────────────────────────
 * 用户要求「同时检查所有其他 Dialog / Sheet」，这里逐个真实打开并检查：
 *   1. 弹层内按钮是否被底部导航盖住（真实点击命中）
 *   2. 遮罩是否真的挡住底层（点遮罩应关闭弹层，而不是穿透到底层按钮）
 *   3. 弹层打开时底层页面是否被锁滚动
 *   4. 弹层是否完整在视口内（上下都不越界）
 *   5. 底部操作区是否可见
 *   6. 各安卓尺寸都过一遍
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/sheets';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const SIZES = [
  ['360x800', 360, 800],
  ['390x844', 390, 844],
  ['412x915', 412, 915],
];

const seed = () => ({
  schema: 3,
  settings: {
    theme: 'liquid-glass', colorMode: 'dark', perf: 'high', glassBlur: true,
    dynamicBackground: false, onboarded: true, blocks: [], quoteSeed: 'x',
    dailyGoalMinutes: 180, studyFrom: '17:40', studyTo: '22:30',
  },
  periods: [{ id: 'p1', name: '第 1 节', start: '08:00', end: '08:45', counts: true }],
  courses: [{ id: 'c1', subject: '数学', title: '数学', weekday: (new Date().getDay() + 6) % 7, periodId: 'p1' }],
  goals: [{
    id: 'g1', title: '完成一套数学试卷', subject: '数学', plannedMinutes: 60,
    actualMinutes: 0, status: 'doing', date: new Date().toISOString().slice(0, 10), createdAt: Date.now(),
  }],
  tasks: [],
  sessions: [],
  dates: [{ id: 'd1', title: '中考', date: '2027-06-15', primary: true, hidden: false }],
  background: {
    current: 'scene:aurora', mode: 'fixed', rotateMinutes: 60,
    enabledIds: ['scene:aurora'], custom: [], dim: 0.35,
    dynamic: false, showVeil: true, grid: false,
  },
  timer: null,
  courseStatus: {},
});

/** 每个用例：路由 + 触发按钮文字 + 期望弹层里出现的关键按钮文字 */
const CASES = [
  { name: '删除确认(数据)', route: '#/settings/data', trigger: '清空所有数据', expectBtn: '全部清空' },
  { name: '新建目标', route: '#/goals', trigger: '新建', expectBtn: '保存' },
  { name: '添加重要日期', route: '#/settings/dates', trigger: '添加', expectBtn: '保存' },
  { name: '添加固定活动', route: '#/settings/schedule', trigger: '添加', expectBtn: '保存' },
  { name: '开始学习', route: '#/timer', trigger: '开始学习', expectBtn: '开始' },
  { name: '快速添加', route: '#/', trigger: '快速添加', expectBtn: '' },
];

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

/**
 * 打开单个弹层的完整流程（灌种子 → 进路由 reload → 点触发按钮 → 收集弹层信息）。
 * 抽成函数是为了失败时能原样重试：连续跑整套时的偶发时序抖动（弹层来不及出现）
 * 靠重试消掉；重试后仍打不开则在调用处记 FAIL，绝不静默跳过检查。
 */
async function openCase(page, c) {
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed());
  await page.goto(`http://127.0.0.1:5188/${c.route}`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const opened = await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((x) =>
      (x.textContent || '').trim().includes(t) || (x.getAttribute('aria-label') || '').includes(t),
    );
    if (!b) return false;
    b.click();
    return true;
  }, c.trigger);
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return { open: false };
    const panel = d.querySelector('.lg2') ?? d.lastElementChild;
    const pr = panel.getBoundingClientRect();
    const navBtns = Array.from(document.querySelectorAll('nav button'));
    const inPanel = Array.from(d.querySelectorAll('button')).filter((b) => (b.textContent || '').trim());
    const covered = inPanel
      .map((b) => {
        const r = b.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        // 中心不在视口内 = 被弹层自己的滚动区滚出去了，不是被遮挡，跳过
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return null;
        // 内容可滚动；中心被自己的滚动视口裁掉时不是其它界面遮挡。
        for (let parent = b.parentElement; parent && parent !== d; parent = parent.parentElement) {
          if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) {
            const clip = parent.getBoundingClientRect();
            if (cy < clip.top || cy > clip.bottom) return null;
          }
        }
        const hit = document.elementFromPoint(cx, cy);
        if (!hit) return null; // 同上，取不到说明不在可视区
        const ok = hit === b || b.contains(hit) || hit.contains(b);
        return ok ? null : `${(b.textContent || '').trim().slice(0, 10)} 被 ${String(hit.className).slice(0, 24)}`;
      })
      .filter(Boolean);
    return {
      open: true,
      panelTop: Math.round(pr.top),
      panelBottom: Math.round(pr.bottom),
      viewportH: window.innerHeight,
      navCount: navBtns.length,
      covered,
      bodyOverflow: getComputedStyle(document.body).overflow,
      inBody: d.parentElement === document.body,
    };
  });
  return { opened, info };
}

for (const [label, w, h] of SIZES) {
  console.log(`\n########## ${label} ##########`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'dark', isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  for (const c of CASES) {
    let { opened, info } = await openCase(page, c);
    if (!opened || !info.open) {
      // 第一次没打开：回路由原样重来一次（时序抖动兜底）；仍打不开就记 FAIL，绝不静默跳过
      await page.waitForTimeout(600);
      ({ opened, info } = await openCase(page, c));
    }
    if (!opened || !info.open) {
      check(`弹层能打开：${c.name}`, false, `触发按钮「${c.trigger}」没找到或未生效（重试一次后仍失败）`);
      continue;
    }

    console.log(`  ${c.name}:`);
    check('弹层挂在 body 下（脱离页面树）', info.inBody);
    check('弹层完整在视口内', info.panelTop >= 0 && info.panelBottom <= info.viewportH + 1,
      `${info.panelTop}~${info.panelBottom} / ${info.viewportH}`);
    check('弹层内按钮未被遮挡', info.covered.length === 0, info.covered.join(' | '));
    // 再实际滚动到每个操作，保证被滚出视口的按钮仍能到达并点击。
    const buttons = page.locator('[data-sheet] button:not(:disabled)').filter({ hasText: /\S/ });
    let allReachable = true;
    for (const button of await buttons.all()) {
      await button.scrollIntoViewIfNeeded();
      allReachable &&= await button.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit === el || el.contains(hit);
      });
    }
    check('滚动后所有弹层按钮可达', allReachable);
    check('打开时锁定了页面滚动', info.bodyOverflow === 'hidden', info.bodyOverflow);

    // 点遮罩应关闭弹层，而不是穿透
    const before = await page.evaluate(() => location.hash);
    const backdrop = await page.evaluate(() => {
      const b = document.querySelector('.sheet-backdrop');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 24) };
    });
    if (backdrop) {
      await page.mouse.click(backdrop.x, backdrop.y);
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => ({ open: Boolean(document.querySelector('[role="dialog"]')), hash: location.hash }));
      check('点遮罩可关闭且未穿透到导航', !after.open && after.hash === before, `路由 ${before} → ${after.hash}`);
    }

    await page.screenshot({ path: `${out}/${label}-${c.name}.png` });
  }

  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${out}/`);
if (failed) process.exit(1);
