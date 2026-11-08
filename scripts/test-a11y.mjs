/**
 * 无障碍（键盘 / 读屏）验证
 * ──────────────────────────────────────────────────────────────────────────────
 * 覆盖 1.4.x 这批改动：
 *   ① 跳转链接：Tab 第一个命中、Enter 落到 main、不污染 HashRouter
 *   ② document.title 随路由变化（读屏靠它区分页面）
 *   ③ 可交互元素都有可访问名（图标按钮 / 输入框）
 *   ④ 选中态 aria-pressed（分段、标签、筛选）
 *   ⑤ 弹层：aria-modal / labelledby / describedby / ESC / 焦点还原
 *   ⑥ 专注模式：aria-modal + 进入移焦 + 退出还原
 *   ⑦ 课程条目不再「按钮套按钮」
 *   ⑧ 首页排序有键盘替代入口（设置→外观，上移/下移并落盘）
 *   ⑨ 焦点环可见（.field:focus 的 box-shadow 非 none）
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { SEED } from './lib-seed.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const OUT = '.preview/a11y';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
await ctx.addInitScript((s) => {
  try {
    if (localStorage.getItem('__a11y_seeded__')) return;
    localStorage.setItem('learning-os:v1:state', JSON.stringify(s));
    localStorage.setItem('__a11y_seeded__', '1');
    localStorage.setItem('learning-os:release-notes:read', '1');
  } catch {
    /* ignore */
  }
}, SEED);
const page = await ctx.newPage();
await acknowledgeReleaseNotes(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/net::ERR_|Failed to load resource|CORS/i.test(t)) return;
  errors.push(t);
});

const go = async (hash) => {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'load' });
  await page.waitForTimeout(1400);
};

/* ---------------- ① 跳转链接 ---------------- */
console.log('\n=== ① 跳转链接与标题 ===');
await go('/');
const initialHash = await page.evaluate(() => location.hash);
// 从 body 开始按 Tab：第一个可聚焦元素应该是跳转链接
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await page.keyboard.press('Tab');
await page.waitForTimeout(350); // 等 160ms 的滑入过渡结束再量位置
const firstFocus = await page.evaluate(() => {
  const el = document.activeElement;
  const r = el?.getBoundingClientRect();
  return {
    cls: el?.className ?? '',
    text: (el?.textContent ?? '').trim(),
    visible: Boolean(r && r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight),
  };
});
check('Tab 第一个命中「跳到主要内容」', /skip-link/.test(firstFocus.cls) && firstFocus.text.includes('跳到主要内容'), JSON.stringify(firstFocus));
check('未聚焦时视觉隐藏、聚焦后出现在视口内', firstFocus.visible === true);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const afterSkip = await page.evaluate(() => ({
  active: document.activeElement?.id ?? '',
  hash: location.hash,
}));
check('Enter 后焦点落到 main#main', afterSkip.active === 'main', JSON.stringify(afterSkip));
check('跳转不破坏 HashRouter 的路由', afterSkip.hash === initialHash, `${initialHash} → ${afterSkip.hash}`);

/* ---------------- ② document.title ---------------- */
for (const [hash, want] of [
  ['/', '首页'],
  ['/streak', '火花'],
  ['/stats', '统计'],
  ['/settings/appearance', '设置'],
]) {
  await go(hash);
  const title = await page.title();
  check(`document.title 随路由变化（${hash} → ${want}）`, title.includes(want), title);
}

/* ---------------- ③ 可访问名 ---------------- */
console.log('\n=== ③ 可访问名 ===');
const unnamed = await page.evaluate(() => {
  const hasName = (el) => {
    if (el.getAttribute('aria-label')?.trim()) return true;
    if (el.getAttribute('aria-labelledby')?.trim()) return true;
    if (el.getAttribute('title')?.trim()) return true;
    const text = (el.textContent ?? '').replace(/\s+/g, '').trim();
    if (text) return true;
    const label = el.closest('label');
    if (label && (label.textContent ?? '').trim()) return true;
    return false;
  };
  const out = [];
  for (const el of Array.from(document.querySelectorAll('main button, main [role="button"]'))) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (!hasName(el)) out.push(el.outerHTML.slice(0, 90));
  }
  return out.slice(0, 5);
});
check('当前页所有可见按钮都有可访问名', unnamed.length === 0, unnamed.join(' | '));

/* 输入框：逐页扫（占位符不算可访问名） */
async function scanInputs(hash) {
  await go(hash);
  return page.evaluate(() => {
    const named = (el) => {
      if (el.getAttribute('aria-label')?.trim()) return true;
      if (el.getAttribute('aria-labelledby')?.trim()) return true;
      const labelledby = el.getAttribute('id') && document.querySelector(`label[for="${el.id}"]`);
      if (labelledby) return true;
      const label = el.closest('label');
      return Boolean(label && (label.textContent ?? '').trim());
    };
    return Array.from(document.querySelectorAll('main input:not([type="hidden"]), main textarea, main select'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .filter((el) => !named(el))
      .map((el) => el.outerHTML.slice(0, 90))
      .slice(0, 5);
  });
}
for (const hash of ['/settings/appearance', '/settings/courses', '/settings/data', '/settings/schedule', '/settings/background']) {
  const bad = await scanInputs(hash);
  check(`输入框都有可访问名（${hash}）`, bad.length === 0, bad.join(' | '));
}

/* ---------------- ④ aria-pressed ---------------- */
console.log('\n=== ④ 选中态 aria-pressed ===');
await go('/settings/schedule');
const pressedSchedule = await page.evaluate(() =>
  Array.from(document.querySelectorAll('main [aria-pressed]')).map((el) => ({
    pressed: el.getAttribute('aria-pressed'),
    text: (el.textContent ?? '').trim().slice(0, 8),
  })),
);
check(
  '作息分段有 aria-pressed 且恰好一个 true',
  pressedSchedule.length >= 2 && pressedSchedule.filter((x) => x.pressed === 'true').length === 1,
  JSON.stringify(pressedSchedule),
);
await go('/stats');
const pressedStats = await page.evaluate(() => {
  // 统计页有多组 aria-pressed（标签组 + 时间范围等），每组恰好一个 true
  const els = Array.from(document.querySelectorAll('main [aria-pressed]'));
  const groups = new Map();
  for (const el of els) {
    const key = el.closest('[role="group"]') ?? el.parentElement ?? document.body;
    const g = groups.get(key) ?? [];
    g.push(el.getAttribute('aria-pressed'));
    groups.set(key, g);
  }
  return [...groups.values()];
});
check(
  '统计页每组 aria-pressed 恰好一个 true',
  pressedStats.length >= 2 && pressedStats.every((g) => g.filter((p) => p === 'true').length === 1),
  JSON.stringify(pressedStats),
);

/* ---------------- ⑤ 弹层语义 ---------------- */
console.log('\n=== ⑤ 弹层 ===');
await go('/goals');
await page.locator('main button', { hasText: /^新建$/ }).first().click();
await page.waitForTimeout(700);
const dialog = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  const labelId = d.getAttribute('aria-labelledby');
  const descId = d.getAttribute('aria-describedby');
  return {
    modal: d.getAttribute('aria-modal'),
    hasLabel: Boolean(labelId && document.querySelector(`#${CSS.escape(labelId)}`)?.textContent),
    hasDesc: Boolean(descId && document.querySelector(`#${CSS.escape(descId)}`)?.textContent),
    focusedInside: d.contains(document.activeElement),
  };
});
check('弹层 aria-modal=true、有标题关联', dialog?.modal === 'true' && dialog?.hasLabel === true, JSON.stringify(dialog));
check('打开弹层后焦点在弹层内', dialog?.focusedInside === true);

// 焦点环：弹层里的 .field 输入框
const ring = await page.evaluate(() => {
  const input = document.querySelector('[role="dialog"] .field');
  if (!input) return null;
  input.focus();
  return getComputedStyle(input).boxShadow;
});
check('输入框聚焦有可见焦点环', Boolean(ring) && ring !== 'none', String(ring));

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const afterEsc = await page.evaluate(() => ({
  dialogs: document.querySelectorAll('[role="dialog"]').length,
  active: (document.activeElement?.textContent ?? '').trim().slice(0, 8),
}));
check('Escape 关闭弹层并还原焦点', afterEsc.dialogs === 0 && afterEsc.active.length > 0, JSON.stringify(afterEsc));

// 带说明文字的弹层：aria-describedby 必须真的指到那段文字
await go('/settings/data');
await page.locator('main button', { hasText: /清空所有数据/ }).first().click();
await page.waitForTimeout(700);
const described = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  const descId = d.getAttribute('aria-describedby');
  const node = descId ? document.getElementById(descId) : null;
  return { descId, text: (node?.textContent ?? '').trim().slice(0, 20) };
});
check(
  '带说明的弹层 aria-describedby 指向真实文字',
  Boolean(described?.descId) && described.text.length > 0,
  JSON.stringify(described),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

/* ---------------- ⑥ 专注模式 ---------------- */
console.log('\n=== ⑥ 专注模式 ===');
await go('/timer');
await page.getByRole('button', { name: '开始学习' }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '数学' }).first().click();
await page.getByRole('button', { name: '开始计时' }).click();
await page.waitForTimeout(900);
const focus = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="专注计时"]');
  return d
    ? {
        modal: d.getAttribute('aria-modal'),
        tabindex: d.getAttribute('tabindex'),
        focused: d.contains(document.activeElement) || document.activeElement === d,
      }
    : null;
});
check('专注模式是 aria-modal 且有管理焦点', focus?.modal === 'true' && focus?.focused === true, JSON.stringify(focus));
await page.locator('[aria-label="退出专注模式"]').click();
await page.waitForTimeout(700);
const focusGone = await page.evaluate(() => !document.querySelector('[role="dialog"][aria-label="专注计时"]'));
check('退出专注后界面恢复', focusGone === true);

/* ---------------- ⑦ 按钮不嵌套 ---------------- */
console.log('\n=== ⑦ 课程条目结构 ===');
await go('/settings/courses');
const nested = await page.evaluate(() => document.querySelectorAll('main button button').length);
check('课程条目里没有「按钮套按钮」', nested === 0, `嵌套 ${nested} 处`);

/* ---------------- ⑧ 首页排序键盘替代 ---------------- */
console.log('\n=== ⑧ 首页排序（键盘替代） ===');
await go('/settings/appearance');
const orderRows = async () =>
  page.evaluate(() => Array.from(document.querySelectorAll('main [data-module]')).map((el) => el.getAttribute('data-module')));
const orderBefore = await orderRows();
await page.locator('main button[aria-label^="上移"]').nth(1).click();
await page.waitForTimeout(900);
const orderAfter = await orderRows();
check(
  '设置里能把第二个模块上移',
  orderAfter.length === orderBefore.length && orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0],
  `${JSON.stringify(orderBefore)} → ${JSON.stringify(orderAfter)}`,
);
await page.locator('main button[aria-label^="下移"]').first().click();
await page.waitForTimeout(1200);
const orderRestored = await orderRows();
const orderDisk = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('learning-os:v1:state') || '{}');
  return raw.settings?.homeOrder ?? null;
});
check('下移能还原顺序并落盘', JSON.stringify(orderRestored) === JSON.stringify(orderBefore) && Array.isArray(orderDisk), JSON.stringify(orderDisk));

/* ---------------- ⑨ 截图收尾 ---------------- */
console.log('\n=== ⑨ 收尾 ===');
await page.screenshot({ path: `${OUT}/settings-appearance.png` });
check('无 JS 报错', errors.length === 0, [...new Set(errors)].slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
