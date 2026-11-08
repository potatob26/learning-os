/**
 * 意见箱（1.3.0）
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求：「用户直接在软件内发送然后我这里可以查看内容」。
 *
 * 这个用例守的四件事（每一条都是"不能违背"的）：
 *   ① **不假装成功**：只有服务器明确认可才算发出去了。
 *      连 HTTP 200 但响应体里 `ok:false` 也必须算失败 ——
 *      上一轮在另一个服务上实测到「无效地址也返回 200、失败藏在 body 里」，
 *      只看状态码会让用户的消息无声消失。
 *   ② **失败不丢字**：发不出去时用户写的内容必须原样还在。
 *   ③ **默认只带版本+平台**；学习数据统计量要用户主动勾选。
 *   ④ **没配置接收地址时整块不出现**（不给假按钮）。
 *
 * 用本地 mock（scripts/mock-endpoints.mjs），不依赖真网络。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
/*
 * 一个只用来返回「HTTP 200 + 业务失败」的小服务器 —— mock 的模式里没有这一种。
 * ⚠️ 必须处理 OPTIONS 预检：带 content-type: application/json 的 POST 会先发预检，
 * 预检不过浏览器就直接判失败，测到的会是"网络不通"而不是"200 但业务失败"。
 * （这个坑和智谱在 mock 里抓到的 OPTIONS 分支漏加 CORS 头是同一个。）
 */
const bodyFail = createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: '机器人转发失败' }));
  });
});
await new Promise((r) => bodyFail.listen(0, '127.0.0.1', r));
const bodyFailUrl = `http://127.0.0.1:${bodyFail.address().port}/feedback`;

try {
  /** 打开设置-数据页，并把意见箱端点写进 localStorage（必须在应用脚本之前） */
  const open = async (url) => {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
    await ctx.addInitScript((u) => {
      try {
        if (u) localStorage.setItem('learning-os:endpoints', JSON.stringify({ feedbackUrl: u }));
        else localStorage.removeItem('learning-os:endpoints');
      } catch { /* 拿不到存储就等于没配置 */ }
    }, url);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await acknowledgeReleaseNotes(page);
    await page.goto('http://127.0.0.1:5188/#/settings/data');
  /*
   * 意见箱现在是设置右上角的一个按钮，点开才是内容（2026-10-05 改的）。
   * 没配置接收地址时按钮根本不存在，count() 为 0 就跳过 —— 这样"未配置时不出现"那条断言不受影响。
   */
  /*
   * 等按钮出现再点。上一版只 sleep(900) 太早 —— dev 首次加载要 1~3 秒，React 还没渲染，
   * count() 为 0 就直接跳过了，导致弹层没打开、后面的断言全找不到内容。
   * 用 waitFor 等（带超时兜底：未配置时它本来就不存在，不能干等）。
   */
  await page
    .locator('[aria-label="意见箱"]')
    .first()
    .waitFor({ state: 'visible', timeout: 4000 })
    .catch(() => {});
  if ((await page.locator('[aria-label="意见箱"]').count()) > 0) {
    await page.locator('[aria-label="意见箱"]').first().click();
    await page.waitForTimeout(700);
  }
    await page.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    // 主树要挂载才能看到这一块（全新上下文里 onboarded=false 时渲染的是首启引导）
    await page.evaluate(() => window.__LOS__.useStore.getState().patchSettings({ onboarded: true }));
    await sleep(800);
    await page.reload();
    await page.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await sleep(900);
    /*
     * 1.3.0 起意见箱内容在弹层里（设置右上角按钮点开）。
     * 前面的点击发生在「onboarded 尚未置 true」的引导页上，点不到；
     * 所以 reload 进入主界面后必须再点一次，否则 Sheet 不会打开、
     * 后面的文案断言会找不到内容。
     */
    if ((await page.locator('[aria-label="意见箱"]').count()) > 0) {
      await page.locator('[aria-label="意见箱"]').first().click();
      await page.waitForTimeout(700);
    }
    return { ctx, page, errors };
  };

  // 意见箱内容在 Sheet 里（Portal 到 body），不在 main 下；用 body 取全文
  const pageText = (page) => page.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ' '));

  /* ---------- ① 没配置 → 整块不出现 ---------- */
  const off = await open(null);
  check('没配置接收地址时意见箱整块不出现（不给假按钮）',
    (await off.page.getByLabel('意见内容').count()) === 0 && (await off.page.locator('button', { hasText: /^发送$/ }).count()) === 0);
  check('没配置时隐私文案也不提意见箱（文案不描述不存在的东西）',
    !(await pageText(off.page)).includes('意见箱'));
  await off.ctx.close();

  /* ---------- ② 配置了 → 出现，并能发出去 ---------- */
  mock.setMode('cors');
  mock.clearRequests();
  const a = await open(mock.url + '/feedback');
  check('配置后出现意见箱', (await pageText(a.page)).includes('意见箱'));
  check('提示里写清默认只带版本与平台',
    (await pageText(a.page)).includes('只带版本号与平台'), '');

  await a.page.getByLabel('意见内容').fill('计时器暂停后偶尔会多算一分钟');
  await sleep(300);
  await a.page.locator('button', { hasText: /^发送$/ }).first().click();
  await sleep(1500);

  const sent = mock.requests.filter((r) => r.method === 'POST');
  check('点发送后服务端确实收到了', sent.length === 1, `收到 ${sent.length} 条 POST`);
  const payload = sent[0]?.body ?? {};
  check('报文带上了用户写的字', payload.message === '计时器暂停后偶尔会多算一分钟', JSON.stringify(payload.message));
  check('报文默认带版本名 + 版本号 + 平台',
    typeof payload.versionName === 'string' && Number.isInteger(payload.versionCode) && ['android', 'web'].includes(payload.platform),
    JSON.stringify({ v: payload.versionName, c: payload.versionCode, p: payload.platform }));
  check('**没勾选就不带诊断信息**（不顺手带上学习数据）',
    payload.diagnostics === undefined || payload.diagnostics === null, JSON.stringify(payload.diagnostics));
  check('没填联系方式就不带该字段', payload.contact === undefined);
  check('成功后提示已发送', (await pageText(a.page)).includes('已经发给我了'));
  check('成功后输入框被清空（清空＝认定它收到了）',
    (await a.page.getByLabel('意见内容').inputValue()) === '');
  check('成功后草稿也清掉了',
    (await a.page.evaluate(() => localStorage.getItem('learning-os:feedback-draft'))) === null);
  await a.ctx.close();

  /* ---------- ③ 失败不丢字：服务器 500 ---------- */
  mock.setMode('http500');
  const c = await open(mock.url + '/feedback');
  await c.page.getByLabel('意见内容').fill('这条不能丢：500 的情况');
  await sleep(300);
  await c.page.locator('button', { hasText: /^发送$/ }).first().click();
  await sleep(1500);
  check('服务器 500 时明确说没发出去', (await pageText(c.page)).includes('没发出去'));
  check('**失败后用户写的内容原样还在**',
    (await c.page.getByLabel('意见内容').inputValue()) === '这条不能丢：500 的情况',
    await c.page.getByLabel('意见内容').inputValue());
  check('失败时不会假装成功（不出现"已经发给我了"）',
    !(await pageText(c.page)).includes('已经发给我了'));
  await c.ctx.close();

  /* ---------- ④ 失败不丢字：超时 ---------- */
  mock.setMode('timeout');
  const d = await open(mock.url + '/feedback');
  await d.page.getByLabel('意见内容').fill('这条不能丢：超时的情况');
  await sleep(300);
  await d.page.locator('button', { hasText: /^发送$/ }).first().click();
  await sleep(7000);
  const dText = await pageText(d.page);
  check('超时后明确说没发出去，并给出原因', dText.includes('没发出去') && dText.includes('网络超时'), dText.slice(0, 160));
  check('超时后内容仍然在', (await d.page.getByLabel('意见内容').inputValue()) === '这条不能丢：超时的情况');
  check('超时期间没有运行时错误', d.errors.length === 0, d.errors.slice(0, 1).join(' | '));
  await d.ctx.close();

  /* ---------- ⑤ HTTP 200 但业务失败 → 也必须算失败 ---------- */
  mock.setMode('cors');
  const e = await open(bodyFailUrl);
  await e.page.getByLabel('意见内容').fill('这条也不能丢：200 但业务失败');
  await sleep(300);
  await e.page.locator('button', { hasText: /^发送$/ }).first().click();
  await sleep(1500);
  const eText = await pageText(e.page);
  check('HTTP 200 但 body 里 ok:false → 判为失败（不假装成功）',
    eText.includes('没发出去') && !eText.includes('已经发给我了'), eText.slice(0, 200));
  check('并把服务端给的原因显示出来', eText.includes('机器人转发失败'), eText.slice(0, 200));
  check('这种情况下内容依然不丢',
    (await e.page.getByLabel('意见内容').inputValue()) === '这条也不能丢：200 但业务失败');
  await e.ctx.close();

  /* ---------- ⑥ 勾选诊断信息 → 只带数量，不带内容 ---------- */
  mock.setMode('cors');
  mock.clearRequests();
  const f = await open(mock.url + '/feedback');
  await f.page.evaluate(() => {
    const s = window.__LOS__.useStore.getState();
    s.addGoal({ title: '这是标题不该出现在诊断里', subject: '数学', priority: 'normal', status: 'todo', plannedMinutes: 30, kind: 'time' });
  });
  await sleep(500);
  await f.page.getByLabel('意见内容').fill('勾选诊断的情况');
  await f.page.getByLabel('附带诊断信息').check();
  await sleep(300);
  check('勾选后说明文字写清会带什么',
    (await pageText(f.page)).includes('只有数量和名称，不含你写的任何内容'));
  await f.page.locator('button', { hasText: /^发送$/ }).first().click();
  await sleep(1500);
  const p2 = mock.requests.filter((r) => r.method === 'POST').pop()?.body ?? {};
  check('勾选后报文里带上了 diagnostics',
    !!p2.diagnostics && typeof p2.diagnostics.sessions === 'number' && typeof p2.diagnostics.goals === 'number',
    JSON.stringify(p2.diagnostics));
  check('诊断信息里**不含任何用户写的文字**（只有数量与枚举）',
    !JSON.stringify(p2.diagnostics).includes('这是标题不该出现在诊断里'),
    JSON.stringify(p2.diagnostics));
  await f.ctx.close();

  /* ---------- ⑦ 草稿：刷新后还在 ---------- */
  const g = await open(mock.url + '/feedback');
  await g.page.getByLabel('意见内容').fill('写一半就关掉应用也不该丢');
  await sleep(500);
  await g.page.reload();
  await g.page.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1000);
  // 刷新后 Sheet 已关闭，先重新点开意见箱，草稿才有地方显示
  if ((await g.page.locator('[aria-label="意见箱"]').count()) > 0) {
    await g.page.locator('[aria-label="意见箱"]').first().click();
    await g.page.waitForTimeout(700);
  }
  check('刷新后草稿还在（写到一半关掉应用也不丢）',
    (await g.page.getByLabel('意见内容').inputValue()) === '写一半就关掉应用也不该丢',
    await g.page.getByLabel('意见内容').inputValue());
  await g.page.screenshot({ path: '.preview/feedback-card.png' });
  await g.ctx.close();

  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await mock.close();
  bodyFail.close();
  await b.close();
}
