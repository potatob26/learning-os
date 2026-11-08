/**
 * 验证玻璃参数面板的现状（透明玻璃面板已按用户要求移除）
 *
 *   1. 透明玻璃主题下：整块参数面板**不再出现**
 *      （实时预览 / 折射模式 / 光学参数 / 深色玻璃 都不该有）
 *   2. 透明玻璃主题下：外观页的其它内容仍在，且玻璃卡片照常渲染
 *      —— 删的是界面，不是渲染；settings.glass 的数据仍被 LiquidGlassTwo 使用
 *   3. 液态玻璃主题下：液态玻璃参数面板仍然正常（那是另一个面板，没删）
 *   4. 历史存档里若存过 shader 模式，也不再崩溃（会被折算成 standard）
 *
 * ⚠️ 必须先把「本次更新」弹层关掉。
 *    新版本首次访问会弹它，而它是覆盖整页的 [role="dialog"]，
 *    不关掉的话下面每一次点击都会被它拦下 —— 表现为
 *    "element intercepts pointer events" 超时，看起来像功能坏了，其实只是弹层挡着。
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = '.preview/glass';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const BASE = 'http://127.0.0.1:5188/';

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const seed = (theme, glass = undefined) => ({
  schema: 3,
  settings: {
    theme, colorMode: 'dark', perf: 'balanced', glassBlur: true, dynamicBackground: false,
    onboarded: true, blocks: [], quoteSeed: 'x', dailyGoalMinutes: 180,
    studyFrom: '17:40', studyTo: '23:00',
    // 故意存一个库已废弃的模式，验证兼容处理不会崩
    ...(glass ? { glass } : {}),
  },
  periods: [], courses: [], goals: [], tasks: [], sessions: [], dates: [],
  background: { current: 'scene:grid', mode: 'fixed', rotateMinutes: 60, enabledIds: ['scene:grid'], custom: [], dim: 0.2, dynamic: false, showVeil: false, grid: false, dimAuto: false },
  timer: null, courseStatus: {},
});

async function open(data, hash = '#/settings/appearance') {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN', colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 200);
    const url = m.location()?.url ?? '';
    // 外部校时服务不可达不算应用缺陷（与其它脚本同一口径）
    if (/net::ERR_|Failed to load resource|CORS/i.test(t) && url && !/localhost|127\.0\.0\.1/.test(url)) return;
    errors.push(`[console] ${t}`);
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), data);
  await page.goto(BASE + hash, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click();
  });
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}

/* ---------- 1 & 2：透明玻璃主题，面板应已删除 ---------- */
{
  const { ctx, page, errors } = await open(seed('liquid-glass'));
  const text = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));

  console.log('\n=== 透明玻璃主题：参数面板应已移除 ===');
  const gone = ['实时预览', '光学参数', '折射模式', '深色玻璃', '边缘位移强度', '模糊量', '边缘色散'];
  for (const kw of gone) check(`不再出现「${kw}」`, !text.includes(kw));
  check('底部那条参数提示也一并移除', !text.includes('若觉得不够清澈'));

  // 外观页其它内容仍在
  check('外观页其它内容仍在（主题选择）', text.includes('主题') && text.includes('透明玻璃'));
  check('浅色/深色开关仍在', text.includes('浅色') && text.includes('深色'));

  // 页面没崩
  check('页面未崩溃', !(await page.getByText('页面出了点问题').isVisible().catch(() => false)));

  // 玻璃渲染没受影响：liquid 档现在由 GlassLiquidPanel 画（.glass-liquid），
  // 不再是旧的 liquid-glass-react 适配层（.lg2）—— 2026-10 的收口。
  await page.goto(`${BASE}#/`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click(); });
  await page.waitForTimeout(1000);
  const glassInfo = await page.evaluate(() => {
    const cards = document.querySelectorAll('main .glass-liquid');
    const layered = Array.from(cards).filter(
      (c) => c.querySelector('.glass-liquid__tint') && c.querySelector('.glass-liquid__border'),
    );
    return { cards: cards.length, withLayers: layered.length };
  });
  check('卡片玻璃照常渲染（删界面不影响效果）', glassInfo.cards > 0 && glassInfo.withLayers > 0, `卡片 ${glassInfo.cards} 张，带材质层的 ${glassInfo.withLayers} 张`);
  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: `${out}/frosted-appearance.png` });
  await ctx.close();
}

/* ---------- 3：液态玻璃主题，那个面板没删 ---------- */
{
  const { ctx, page, errors } = await open(seed('liquid-glass-wc'));
  const text = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
  console.log('\n=== 液态玻璃主题：参数面板应仍在 ===');
  // 1.3.0 起这个主题的显示名从「液态玻璃」改成「透明玻璃」，面板标题随之改名
  check('出现「透明玻璃参数」面板', text.includes('透明玻璃参数'));
  check('透明玻璃那几项没有混进来', !text.includes('边缘位移强度') && !text.includes('光学参数'));
  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: `${out}/refract-appearance.png` });
  await ctx.close();
}

/* ---------- 4：历史 shader 模式不崩 ---------- */
{
  const { ctx, page, errors } = await open(seed('liquid-glass', { mode: 'shader' }));
  console.log('\n=== 历史存档（库已废弃的 shader 模式）===');
  check('不崩溃', !(await page.getByText('页面出了点问题').isVisible().catch(() => false)));

  /*
   * 归一化发生在**渲染期**（LiquidGlassTwo 调 sanitizeGlassMode），
   * 存档里保留原值是有意为之 —— 所以不能断言 localStorage 被改写，
   * 而要断言「被消费时确实折算成了合法值」。
   */
  const normalized = await page.evaluate(async () => {
    const m = await import('/src/lib/types.ts');
    return {
      shader: m.sanitizeGlassMode('shader'),
      standard: m.sanitizeGlassMode('standard'),
      polar: m.sanitizeGlassMode('polar'),
      prominent: m.sanitizeGlassMode('prominent'),
    };
  });
  check('废弃的 shader 被折算成合法模式', ['standard', 'polar', 'prominent'].includes(normalized.shader), `shader → ${normalized.shader}`);
  check('三个合法模式原样保留', normalized.standard === 'standard' && normalized.polar === 'polar' && normalized.prominent === 'prominent', JSON.stringify(normalized));

  // 渲染确实用上了折算后的值：卡片玻璃照常存在（liquid 档 = .glass-liquid）
  await page.goto(`${BASE}#/`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('知道了'))?.click(); });
  await page.waitForTimeout(900);
  const cards = await page.evaluate(() => document.querySelectorAll('main .glass-liquid').length);
  check('历史模式下玻璃仍能渲染', cards > 0, `卡片 ${cards} 张`);
  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${out}/`);
if (failed) process.exit(1);
