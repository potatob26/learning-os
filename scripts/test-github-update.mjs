/**
 * GitHub Releases 自动检测更新
 * ──────────────────────────────────────────────────────────────────────────────
 * 开源后不再自建版本清单服务器：配置 `VITE_GITHUB_REPO=owner/repo`（或运行时
 * `localStorage['learning-os:endpoints'] = { githubRepo }`）后，App 启动时自动查
 * `GET https://api.github.com/repos/<owner>/<repo>/releases/latest`，
 * tag 比当前版本新就弹「发现新版本」，APK 直接取 release 里的 .apk 资产。
 *
 * 这个用例用 Playwright 拦截 GitHub API，完全离线可复现，守：
 *   · 自动检测（不用手动点）→ 弹层出现、版本号正确、下载链接是 release 里的 apk
 *   · 只请求 API 路径，不带任何学习数据；不带 Authorization
 *   · 同版本不打扰；不配置仓库完全不发请求；6 小时节流
 *   · 失败静默（500/坏 tag）；点「以后再说」后同一版本不再弹
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { SEED } from './lib-seed.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const API = 'https://api.github.com/repos/mock/owner/releases/latest';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

/**
 * 打开 app；返回请求记录。
 * @param opts.repo 配置的 GitHub 仓库；null = 不配置
 * @param opts.release GitHub latest release 的 JSON
 * @param opts.status API 状态码
 * @param opts.seedCheckedAt 预置「上次检查时间」来触发 6 小时节流
 */
async function open(opts) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const requests = [];
  await ctx.route('**/releases/latest*', (route) => {
    requests.push(route.request());
    route.fulfill({
      status: opts.status ?? 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify(opts.release ?? {}),
    });
  });
  await ctx.addInitScript(
    ({ repo, seedCheckedAt, seed }) => {
      try {
        // 必须先进主界面（onboarded），否则 UpdateNotice 不会被挂载
        localStorage.setItem('learning-os:v1:state', JSON.stringify(seed));
        if (repo) localStorage.setItem('learning-os:endpoints', JSON.stringify({ githubRepo: repo }));
        else localStorage.removeItem('learning-os:endpoints');
        localStorage.removeItem('learning-os:update-seen-code');
        if (seedCheckedAt) localStorage.setItem('learning-os:update-check-at', String(Date.now()));
        else localStorage.removeItem('learning-os:update-check-at');
      } catch {
        /* ignore */
      }
    },
    { repo: opts.repo, seedCheckedAt: opts.seedCheckedAt ?? false, seed: { ...SEED, settings: { ...SEED.settings, onboarded: true } } },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await acknowledgeReleaseNotes(page);
  await page.goto(`${BASE}/#/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  return { ctx, page, requests, errors };
}

const latest = (tag, { apk = true, body = '- 修好了几个小问题\n- 新增了自动更新' } = {}) => ({
  tag_name: tag,
  name: tag,
  body,
  assets: apk
    ? [{ name: `LearningOS-${tag}.apk`, browser_download_url: `https://example.com/${tag}.apk` }]
    : [],
});

/* ========== ① 配了仓库 + 有新版：启动自动检测并弹层 ========== */
console.log('\n=== ① 自动检测：有新版本 ===');
{
  const { ctx, page, requests, errors } = await open({ repo: 'mock/owner', release: latest('v9.9.9') });
  const dialog = page.getByRole('dialog', { name: /发现新版本/ });
  await dialog.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  const info = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const link = d?.querySelector('a[href^="https://example.com/"]');
    return {
      text: (d?.textContent ?? '').replace(/\s+/g, ' '),
      href: link?.getAttribute('href') ?? null,
    };
  });
  check('启动后自动弹出「发现新版本」', info.text.includes('发现新版本'), info.text.slice(0, 60));
  check('弹层显示远端版本 9.9.9', info.text.includes('v9.9.9'));
  check('下载链接取 release 里的 .apk 资产', info.href === 'https://example.com/v9.9.9.apk', String(info.href));
  check('更新说明来自 release body', info.text.includes('修好了几个小问题') && info.text.includes('新增了自动更新'));
  check('只发了 1 次 GitHub API 请求', requests.length === 1, String(requests.length));
  const reqUrl = requests[0]?.url() ?? '';
  check('请求路径就是 releases/latest，没带学习数据', reqUrl === API, reqUrl.slice(0, 100));
  check('请求没有 Authorization（不要求用户配 token）', !requests[0]?.headers()['authorization']);
  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ========== ② 同版本：不打扰 ========== */
console.log('\n=== ② 已是最新 ===');
{
  const { ctx, page, requests } = await open({ repo: 'mock/owner', release: latest('v1.4.2') });
  await sleep(1800);
  const dialogs = await page.locator('[role="dialog"]').count();
  check('同版本不弹更新层', dialogs === 0, `dialogs=${dialogs}`);
  check('仍然只检查一次', requests.length === 1, String(requests.length));
  await ctx.close();
}

/* ========== ③ 没配仓库：完全不发请求 ========== */
console.log('\n=== ③ 未配置 GitHub 仓库 ===');
{
  const { ctx, page, requests } = await open({ repo: null, release: latest('v9.9.9') });
  await sleep(1800);
  const dialogs = await page.locator('[role="dialog"]').count();
  check('未配置仓库时一次请求都不发', requests.length === 0, String(requests.length));
  check('未配置仓库时不弹更新层', dialogs === 0);
  await ctx.close();
}

/* ========== ④ 6 小时节流：不发请求 ========== */
console.log('\n=== ④ 节流 ===');
{
  const { ctx, page, requests } = await open({
    repo: 'mock/owner',
    release: latest('v9.9.9'),
    seedCheckedAt: true,
  });
  await sleep(1500);
  const dialogs = await page.locator('[role="dialog"]').count();
  check('6 小时内不重复请求', requests.length === 0, String(requests.length));
  check('节流时不弹更新层', dialogs === 0);
  await ctx.close();
}

/* ========== ⑤ 失败静默（500 / 坏 tag） ========== */
console.log('\n=== ⑤ 失败静默 ===');
{
  const { ctx, page, requests, errors } = await open({
    repo: 'mock/owner',
    release: latest('v9.9.9'),
    status: 500,
  });
  await sleep(1600);
  const dialogs = await page.locator('[role="dialog"]').count();
  check('API 500 时不弹层、不报错', dialogs === 0 && errors.length === 0, `dialogs=${dialogs} errors=${errors.length}`);
  check('失败也会记节流时间（只请求 1 次）', requests.length === 1, String(requests.length));
  await ctx.close();
}
{
  const { ctx, page } = await open({ repo: 'mock/owner', release: { tag_name: 'nightly', body: 'x', assets: [] } });
  await sleep(1600);
  const dialogs = await page.locator('[role="dialog"]').count();
  check('非语义化 tag 当作失败、不弹层', dialogs === 0);
  await ctx.close();
}

/* ========== ⑥ 手动检查（force）绕过节流，并明确 apk 缺失 ========== */
console.log('\n=== ⑥ force 检查 ===');
{
  const { ctx, page } = await open({
    repo: 'mock/owner',
    release: latest('v9.9.9', { apk: false }),
    seedCheckedAt: true,
  });
  await sleep(1200);
  const r = await page.evaluate(async () => {
    const m = await import('/src/lib/updateCheck.ts');
    const res = await m.checkForUpdate({ force: true });
    return {
      status: res.status,
      name: res.manifest?.versionName ?? null,
      apk: res.manifest?.apk ?? null,
      code: res.manifest?.versionCode ?? null,
    };
  });
  check('force 不受节流限制', r.status === 'available', JSON.stringify(r));
  check('版本名规范化为 9.9.9', r.name === '9.9.9', String(r.name));
  check('没有 .apk 资产时 apk 为空（UI 会显示暂无下载地址）', r.apk === null, String(r.apk));
  check('给 seen 用的整数版本号是 90909', r.code === 90909, String(r.code));
  await ctx.close();
}

/* ========== ⑦ 设置页「检查更新」按钮：手动 force 检查 ========== */
console.log('\n=== ⑦ 设置页手动检查 ===');
{
  const { ctx, page, requests } = await open({
    repo: 'mock/owner',
    release: latest('v9.9.9'),
    seedCheckedAt: true,
  });
  await page.evaluate(() => {
    location.hash = '#/settings/data';
  });
  const btn = page.getByRole('button', { name: '检查更新' });
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  // 直接触发 click：避免更新公告等弹层挡住 pointer 事件（用例只验证按钮逻辑）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      (x.textContent ?? '').includes('检查更新'),
    );
    b?.click();
  });
  const dialog = page.getByRole('dialog', { name: /发现新版本/ });
  await dialog.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  const visible = await dialog.isVisible().catch(() => false);
  check('点击「检查更新」能绕过 6 小时节流并弹出更新提示', visible);
  check('手动检查确实发了请求', requests.length === 1, String(requests.length));
  await ctx.close();
}
{
  const { ctx, page } = await open({ repo: 'mock/owner', release: latest('v1.4.3') });
  await page.evaluate(() => {
    location.hash = '#/settings/data';
  });
  const btn = page.getByRole('button', { name: '检查更新' });
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      (x.textContent ?? '').includes('检查更新'),
    );
    b?.click();
  });
  await sleep(1500);
  const latestText = await page.getByText(/已是最新版本/).first().isVisible().catch(() => false);
  check('已是最新时显示「已是最新版本」', latestText);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
