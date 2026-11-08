/**
 * 进入程序自动检测新版本 → 弹层（2.2）
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求原话：「进入程序自动检测新版本」。
 *
 * 这个用例验的是**启动行为**，不是函数行为：
 *   · 冷启动后**不用用户做任何事**，自己弹出更新提示
 *   · 「以后再说」之后同一个版本不再出现（重载验一遍）
 *   · 服务器挂住/离线时**什么都不发生**，界面照常可用（不阻塞、不报错）
 *   · 没有 APK 地址时按钮不可用并说明原因，**不给一个点了没反应的按钮**
 *
 * 端点覆盖必须在应用脚本之前写进 localStorage，所以用 addInitScript。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { startMockServer } from './mock-endpoints.mjs';

const b = await chromium.launch({ headless: true });
let n = 0;
const check = (name, ok, detail = '') => {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  n++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = await startMockServer();
try {
  mock.setMode('cors');
  /*
 * ⚠️ 不要写死版本号 —— 原来这里是 `const localCode = 19` + 断言里的 `当前 v1.2.16`，
 * 发版抬高版本号的那一刻测试就坏（而且坏得像是功能出问题，实际是测试腐烂）。
 * 改为从 build.gradle 动态读取。
 */
const gradleText = readFileSync('android/app/build.gradle', 'utf8');
const localCode = Number(/versionCode\s+(\d+)/.exec(gradleText)?.[1] ?? 0);
const localName = /versionName\s+"?([0-9.]+)"?/.exec(gradleText)?.[1] ?? '';
if (!localCode || !localName) throw new Error('没能从 android/app/build.gradle 读出版本号');
  mock.setVersion({
    versionCode: localCode + 5,
    versionName: '9.9.9',
    notes: ['第一条新功能', '第二条新功能'],
    apk: 'https://example.com/LearningOS-v9.9.9.apk',
  });

  const openWithEndpoint = async (url) => {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
    await ctx.addInitScript((manifestUrl) => {
      try {
        if (manifestUrl) localStorage.setItem('learning-os:endpoints', JSON.stringify({ manifestUrl }));
        else localStorage.removeItem('learning-os:endpoints');
      } catch {
        /* 忽略：拿不到存储就等于没配置端点，走静默禁用分支 */
      }
    }, url);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await acknowledgeReleaseNotes(page);
    await page.goto('http://127.0.0.1:5188/#/');
    await page.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    /*
     * ⚠️ 必须把「首启引导」标记成已完成。
     * 全新上下文里 onboarded 是 false，应用渲染的是 FirstRun，
     * **主树（含更新弹层）根本没挂载** —— 曾经的失败就卡在这里：
     * 检测其实跑了、store 也写进了 pending，但没有任何组件渲染它，怎么等都等不到。
     * 端点存在 localStorage 里，能活过 reload。
     */
    await page.evaluate(() => window.__LOS__.useStore.getState().patchSettings({ onboarded: true }));
    await sleep(800);
    /*
     * 还要清掉"上次检查时间"。
     * 第一次加载（引导页那一次）已经把检测跑掉了、并写下节流时间戳；
     * 直接 reload 的话第二次启动会被**节流跳过**，于是什么都看不到。
     * 清掉它，reload 后才是真正的"冷启动第一次检测"。
     * （用例 2 的 reload 故意不清，用来验节流+已看过确实不重复打扰。）
     */
    await page.evaluate(() => localStorage.removeItem('learning-os:update-check-at'));
    await page.reload();
    await page.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await sleep(400);
    return { ctx, page, errors };
  };

  /* ---------- 1. 冷启动自己弹出来（用户什么都不用做）---------- */
  const a = await openWithEndpoint(mock.url + '/version');
  const dialogTitle = async (page) =>
    page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return null;
      return (d.textContent ?? '').replace(/\s+/g, ' ').slice(0, 240);
    });
  // 等到弹层出现（空闲回调 + 网络往返）
  await a.page
    .waitForFunction(
      () => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes('发现新版本'),
      { timeout: 15000 },
    )
    .catch(() => {});
  const shown = await dialogTitle(a.page);
  check('冷启动后自动出现更新提示（无需用户操作）', !!shown && shown.includes('发现新版本'), shown ?? '(没有弹层)');
  check('标题带新版版本名', !!shown && shown.includes('v9.9.9'), shown?.slice(0, 60) ?? '');
  check('显示当前版本与更新说明', !!shown && shown.includes(`当前 v${localName}`) && shown.includes('第一条新功能'));
  check('说明里写清"安卓不允许应用自己悄悄装上"（不假装能一键更新）',
    !!shown && shown.includes('安卓不允许应用跳过这一步自己装'));

  const href = await a.page.evaluate(() => {
    const a2 = [...document.querySelectorAll('a')].find((x) => (x.textContent ?? '').includes('下载并安装'));
    return a2 ? a2.getAttribute('href') : null;
  });
  check('「下载并安装」指向清单里的 APK 地址', href === 'https://example.com/LearningOS-v9.9.9.apk', String(href));
  check('「去下载」是新窗口打开（交给系统浏览器，零新权限）',
    await a.page.evaluate(() => {
      const a2 = [...document.querySelectorAll('a')].find((x) => (x.textContent ?? '').includes('下载并安装'));
      return a2?.getAttribute('target');
    }) === '_blank');

  /* ---------- 2. 「以后再说」→ 同一个版本不再出现 ---------- */
  await a.page.locator('[role="dialog"] button', { hasText: '以后再说' }).first().click();
  await sleep(900);
  check('点「以后再说」后弹层关闭',
    (await dialogTitle(a.page)) === null || !(await dialogTitle(a.page)).includes('发现新版本'));
  const seen = await a.page.evaluate(() => Number(localStorage.getItem('learning-os:update-seen-code')));
  check('记下了"这个版本用户已经知道"', seen === localCode + 5, String(seen));

  // 重载：同一个版本不该再出现（节流 + 已看过 双保险）
  await a.page.reload();
  await a.page.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(6000);
  const after = await dialogTitle(a.page);
  check('重载后同一个版本不再打扰用户', !after || !after.includes('发现新版本'), after ?? '(无弹层)');
  check('整个流程没有运行时错误', a.errors.length === 0, a.errors.slice(0, 1).join(' | '));
  await a.ctx.close();

  /* ---------- 3. 服务器挂住 → 什么都不发生，界面照常可用 ---------- */
  mock.setMode('timeout');
  const c = await openWithEndpoint(mock.url + '/version');
  await sleep(2500);
  const interactive = await c.page.evaluate(() => ({
    hasHome: (document.querySelector('main')?.textContent ?? '').length > 50,
    hasDialog: !!document.querySelector('[role="dialog"]'),
  }));
  check('服务器不响应时界面照常渲染（不阻塞）', interactive.hasHome, JSON.stringify(interactive));
  check('服务器不响应时不弹任何错误弹层（失败静默）', interactive.hasDialog === false);
  check('挂住期间没有运行时错误', c.errors.length === 0, c.errors.slice(0, 1).join(' | '));
  await c.ctx.close();

  /* ---------- 4. 没有下载地址 → 按钮不可用并说明，而不是假按钮 ---------- */
  mock.setMode('cors');
  mock.setVersion({ versionCode: localCode + 6, versionName: '9.9.10', notes: ['只有说明没有包'] });
  const d = await openWithEndpoint(mock.url + '/version');
  await d.page
    .waitForFunction(
      () => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes('发现新版本'),
      { timeout: 15000 },
    )
    .catch(() => {});
  const dText = await dialogTitle(d.page);
  check('清单没有 apk 时按钮变成「暂无下载地址」而不是点了没反应',
    !!dText && dText.includes('暂无下载地址'), dText?.slice(0, 120) ?? '(无弹层)');
  check('没有 apk 时不渲染任何指向空地址的链接',
    (await d.page.evaluate(() =>
      [...document.querySelectorAll('a')].filter((x) => (x.textContent ?? '').includes('下载并安装')).length,
    )) === 0);
  await d.ctx.close();

  /* ---------- 5. 未配置端点 → 不检测、不弹 ---------- */
  mock.setVersion({ versionCode: localCode + 9, versionName: '9.9.99' });
  const e = await openWithEndpoint(null);
  await sleep(3000);
  const eText = await dialogTitle(e.page);
  check('没配置清单地址时不检测也不弹（离线仍完全可用）',
    !eText || !eText.includes('发现新版本'), eText?.slice(0, 80) ?? '(无弹层)');
  await e.ctx.close();

  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await mock.close();
  await b.close();
}
