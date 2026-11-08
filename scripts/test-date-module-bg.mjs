/**
 * 真实 UI 走查：「重要日期」模块自定义背景 + 点开放大
 * ──────────────────────────────────────────────────────────────────────────────
 * test-calendar.mjs 里那几条是**直接写 localStorage** 验证渲染的，没走用户真实路径。
 * 这里按真实操作走完整链路：
 *   ① 设置 → 背景 → 上传图 A          （原有管线仍在）
 *   ② 设置 → 日期 → 模块背景 → 直接上传图 B（新：卡片里就能传，传完自动选用）
 *   ③ 添加一个重要日期                 （没有它首页那块是引导卡，模块根本不存在）
 *   ④ 点缩略图 → 弹层放大看大图 → 「使用这张」换成图 A
 *   ⑤ 首页点「重要日期」卡片 → 弹层放大看大图 → 「设置重要日期」
 *   ⑥ 刷新后仍在（落盘）
 *   ⑥.5 再加第二个日期：小日期条必须和倒计时在同一张玻璃卡里（本次修的 bug）
 *   ⑦ 点「不使用」退回；退回后点卡片应回到老行为（跳设置页）
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const OUT = '.preview/datemodule';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/** 造一张好辨认的测试图 */
async function makePng(colors) {
  return page.evaluate((cs) => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 1200;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 800, 1200);
    grd.addColorStop(0, cs[0]); grd.addColorStop(0.5, cs[1]); grd.addColorStop(1, cs[2]);
    g.fillStyle = grd; g.fillRect(0, 0, 800, 1200);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = 'bold 150px sans-serif';
    g.fillText(cs[3], 250, 640);
    return c.toDataURL('image/png');
  }, colors);
}

/** 清空后首次进入会走「花 30 秒设定作息」引导向导 */
async function finishOnboarding() {
  const steps = ['继续', '下一步', '完成', '开始使用', '知道了，开始使用', '知道了'];
  for (let i = 0; i < 16; i++) {
    const clicked = await page.evaluate((labels) => {
      for (const label of labels) {
        const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === label);
        if (b) { b.click(); return label; }
      }
      return null;
    }, steps);
    if (!clicked) return i;
    await page.waitForTimeout(700);
  }
  return 16;
}

/** 当前弹层的信息 */
const viewerInfo = () => page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return { open: false };
  const img = d.querySelector('img');
  const btns = Array.from(d.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean);
  return {
    open: true,
    title: (d.querySelector('h2')?.textContent ?? '').trim(),
    imgSrcLen: img ? img.getAttribute('src')?.length ?? 0 : 0,
    hasBigImg: Boolean(img),
    btns,
  };
});

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto(`${BASE}#/`, { waitUntil: 'load' });
await page.waitForTimeout(2200);
console.log(`（走完引导向导 ${await finishOnboarding()} 步）`);
await page.waitForTimeout(700);

/* ---------- ① 设置 → 背景 → 上传图 A ---------- */
console.log('\n=== ① 设置 → 背景 → 上传图 A（原有管线）===');
await page.goto(`${BASE}#/settings/background`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
const pngA = await makePng(['#1b4fd8', '#7a2fd0', '#d82f6a', 'A']);
await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
  name: 'photo-A.png', mimeType: 'image/png', buffer: Buffer.from(pngA.split(',')[1], 'base64'),
});
await page.waitForTimeout(3000);
const afterA = await page.evaluate(() => window.__LOS__.useStore.getState().background.custom.map((c) => c.id));
check('图 A 上传成功（设置 → 背景 的管线没坏）', afterA.length === 1, `[${afterA.join(',')}]`);

/* ---------- ② 新功能：在「模块背景」卡片里直接上传 ---------- */
console.log('\n=== ② 设置 → 日期 → 在「模块背景」卡片里直接上传图 B ===');
await page.goto(`${BASE}#/settings/dates`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const cardInputs = await page.locator('input[type="file"][accept="image/*"]').count();
check('「模块背景」卡片里有上传入口', cardInputs === 1, `${cardInputs} 个 file input`);

const uploadBtn = page.locator('button', { hasText: /^上传$/ }).first();
check('卡片标题栏有「上传」按钮', (await uploadBtn.count()) > 0);
await page.screenshot({ path: `${OUT}/1-card-empty.png`, fullPage: true });

const pngB = await makePng(['#0f7a4a', '#12a05e', '#8fd14f', 'B']);
await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
  name: 'photo-B.png', mimeType: 'image/png', buffer: Buffer.from(pngB.split(',')[1], 'base64'),
});
await page.waitForTimeout(3000);

const afterB = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return {
    n: st.background.custom.length,
    ids: st.background.custom.map((c) => c.id),
    cfg: st.settings.dateModuleBackground,
  };
});
check('图 B 进了同一个图库（不是另建一份存储）', afterB.n === 2, `${afterB.n} 张`);
check('刚上传的图 B 自动被模块选用', afterB.cfg?.imageId === afterB.ids[1],
  `imageId=${afterB.cfg?.imageId} 图库=[${afterB.ids.join(',')}]`);
const sliderShown = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').includes('压暗程度'));
check('上传后出现「压暗程度」滑块', sliderShown);
await page.screenshot({ path: `${OUT}/2-card-after-upload.png`, fullPage: true });

/* ---------- ③ 添加一个重要日期 ---------- */
console.log('\n=== ③ 添加一个重要日期 ===');
await page.locator('button', { hasText: /^添加$/ }).first().click();
await page.waitForTimeout(900);
const dlg = page.locator('[role="dialog"]');
await dlg.locator('input').first().fill('中考');
await dlg.locator('input[type="date"]').first().fill('2027-06-15');
await page.waitForTimeout(300);
await page.locator('button', { hasText: /^保存$/ }).first().click();
await page.waitForTimeout(1000);

const datesNow = await page.evaluate(() => window.__LOS__.useStore.getState().dates.map((d) => d.title));
check('日期已添加', datesNow.length === 1 && datesNow[0] === '中考', JSON.stringify(datesNow));
const sheetGone = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
check('保存后表单已关闭（上一轮修的 bug 没回归）', sheetGone === 0, `还剩 ${sheetGone} 个弹层`);

/* ---------- ④ 点缩略图 → 放大 → 「使用这张」 ---------- */
console.log('\n=== ④ 点缩略图 → 放大看大图 → 使用这张 ===');
const thumbs = await page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label^="放大查看"]')).map((b) => ({
  label: b.getAttribute('aria-label'),
  w: Math.round(b.getBoundingClientRect().width),
  h: Math.round(b.getBoundingClientRect().height),
})));
check('缩略图可点（aria-label 指明是放大查看）', thumbs.length === 2, JSON.stringify(thumbs.map((t) => t.label)));
check('缩略图触控尺寸 ≥44', thumbs.every((t) => t.w >= 44 && t.h >= 44), thumbs.map((t) => `${t.w}×${t.h}`).join(' '));

await page.locator('button[aria-label^="放大查看"]').first().click();
await page.waitForTimeout(900);
const v1 = await viewerInfo();
check('点缩略图弹出放大层', v1.open === true);
check('放大层里是大图（img 存在）', v1.hasBigImg === true, `标题「${v1.title}」`);
check('放大层有「使用这张」', v1.btns.includes('使用这张'), v1.btns.join('/'));
// 关键：点一下缩略图不应该立刻改配置
const notYetApplied = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return st.settings.dateModuleBackground?.imageId === st.background.custom[1].id;
});
check('只是放大预览，没有直接改掉正在用的图', notYetApplied === true);
await page.screenshot({ path: `${OUT}/3-viewer.png` });

// 确认使用图 A
await page.locator('[role="dialog"] button', { hasText: /^使用这张$/ }).first().click();
await page.waitForTimeout(900);
const applied = await page.evaluate(() => {
  const st = window.__LOS__.useStore.getState();
  return { cfg: st.settings.dateModuleBackground, ids: st.background.custom.map((c) => c.id) };
});
check('点「使用这张」后换成图 A', applied.cfg?.imageId === applied.ids[0],
  `imageId=${applied.cfg?.imageId} 图 A=${applied.ids[0]}`);
check('放大层已关闭', (await viewerInfo()).open === false);

/* ---------- ⑤ 首页点卡片 → 放大 ---------- */
console.log('\n=== ⑤ 首页点「重要日期」卡片 → 放大 ===');
await page.goto(`${BASE}#/`, { waitUntil: 'load' });
await page.waitForTimeout(2000);

// 点倒计时卡片里的文字，事件冒泡到 Card 的 onClick。
// 注意必须带上日期名：「距离睡觉 / 距离上课」那张进度卡里也有「距离」，
// 只按「距离」匹配会点到那张不可点的卡上（第一次就是这么误报的）。
await page.locator('main p', { hasText: /距离\s*中考/ }).first().click();
await page.waitForTimeout(900);
const v2 = await viewerInfo();
check('首页点卡片弹出放大层', v2.open === true);
check('放大层里是大图', v2.hasBigImg === true, `标题「${v2.title}」`);
check('放大层给出「设置重要日期」入口（没把老路堵死）', v2.btns.includes('设置重要日期'), v2.btns.join('/'));
await page.screenshot({ path: `${OUT}/4-home-viewer.png` });

// 这个入口确实能跳过去
await page.locator('[role="dialog"] button', { hasText: /^设置重要日期$/ }).first().click();
await page.waitForTimeout(1200);
check('「设置重要日期」能跳到设置页', page.url().includes('/settings/dates'), page.url().split('#')[1] ?? '');

/* ---------- ⑥ 刷新后仍在 ---------- */
console.log('\n=== ⑥ 刷新后仍在（落盘）===');
await page.goto(`${BASE}#/`, { waitUntil: 'load' });
await page.waitForTimeout(2200);
const afterReload = await page.evaluate(() => {
  const layers = Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter((el) => {
    const s = getComputedStyle(el);
    return s.backgroundImage && s.backgroundImage.includes('data:image');
  });
  return { layers: layers.length, cfg: window.__LOS__.useStore.getState().settings.dateModuleBackground };
});
check('刷新后背景图仍在', afterReload.layers > 0, `${afterReload.layers} 个`);
check('刷新后仍指向图 A', Boolean(afterReload.cfg?.imageId), JSON.stringify(afterReload.cfg));
await page.screenshot({ path: `${OUT}/5-home-with-bg.png`, fullPage: true });

/* ---------- ⑥.5 多个重要日期：小日期条不能露在玻璃外 ---------- */
console.log('\n=== ⑥.5 第二个重要日期：小日期条必须在玻璃卡内 ===');
await page.evaluate(() => {
  window.__LOS__.useStore.getState().addDate({
    title: '期末考',
    date: '2027-01-12',
    allDay: true,
    primary: false,
    visible: true,
    kind: 'exam',
  });
});
await page.waitForTimeout(1400);
const multi = await page.evaluate(() => {
  const rect = (el) => el.getBoundingClientRect();
  /** 一个元素所在的「玻璃卡」：liquid 档 .glass-liquid；云母 .mica；折射档 [data-key-glass] */
  const glassOf = (el) => (el ? el.closest('.glass-liquid, .lg2, .mica, [data-key-glass]') : null);
  const strip = Array.from(document.querySelectorAll('main button')).find((b) =>
    /期末考/.test(b.textContent || ''),
  );
  const countdownLabel = Array.from(document.querySelectorAll('main p')).find((p) =>
    /距离\s*中考/.test(p.textContent || ''),
  );
  if (!strip || !countdownLabel) return { error: `strip=${Boolean(strip)} label=${Boolean(countdownLabel)}` };
  const stripCard = glassOf(strip);
  const countdownCard = glassOf(countdownLabel);
  const chips = Array.from(document.querySelectorAll('main button')).filter((b) =>
    /期末考|生日|运动会/.test(b.textContent || ''),
  );
  return {
    sameCard: Boolean(stripCard) && stripCard === countdownCard,
    stripCard: stripCard ? rect(stripCard) : null,
    countdownCard: countdownCard ? rect(countdownCard) : null,
    chipRects: chips.map((c) => {
      const r = rect(c);
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    }),
    chipCount: chips.length,
    stripText: (strip.textContent || '').replace(/\s+/g, ' ').trim(),
  };
});
check('首页出现第二个日期小条', !multi.error && multi.chipCount >= 1, multi.error ?? `${multi.chipCount} 条`);
check(
  '小日期条与倒计时在同一张玻璃卡里（不再露在玻璃外）',
  multi.sameCard === true,
  multi.error ?? `sameCard=${multi.sameCard}`,
);
if (multi.stripCard && multi.countdownCard) {
  const bottomOk = multi.chipRects.every((r) => r.bottom <= Math.round(multi.stripCard.bottom) + 1);
  const topOk = multi.chipRects.every((r) => r.top >= Math.round(multi.stripCard.top) - 1);
  check('小日期条在玻璃卡的上下边界内', topOk && bottomOk,
    `chip=[${multi.chipRects.map((r) => `${r.top}~${r.bottom}`).join(',')}] card=${Math.round(multi.stripCard.top)}~${Math.round(multi.stripCard.bottom)}`);
}
await page.screenshot({ path: `${OUT}/5b-two-dates.png`, fullPage: true });

/* ---------- ⑦ 「不使用」退回，老行为恢复 ---------- */
console.log('\n=== ⑦ 点「不使用」退回，点卡片恢复跳设置页 ===');
await page.goto(`${BASE}#/settings/dates`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('button', { hasText: /^不使用$/ }).first().click();
await page.waitForTimeout(800);
await page.goto(`${BASE}#/`, { waitUntil: 'load' });
await page.waitForTimeout(1800);
const off = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter((el) => {
  const s = getComputedStyle(el);
  return s.backgroundImage && s.backgroundImage.includes('data:image');
}).length);
check('退回后首页不再有模块背景', off === 0, `仍剩 ${off} 个`);

await page.locator('main p', { hasText: /距离\s*中考/ }).first().click();
await page.waitForTimeout(1200);
const backToOld = await page.evaluate(() => ({
  hash: location.hash,
  dialog: document.querySelectorAll('[role="dialog"]').length,
}));
check('没有背景图时，点卡片恢复「跳设置页」而不是弹空放大层',
  backToOld.hash.includes('/settings/dates') && backToOld.dialog === 0,
  `hash=${backToOld.hash} 弹层=${backToOld.dialog}`);

check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
console.log(`截图: ${OUT}/`);
if (failed) process.exit(1);
