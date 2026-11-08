/**
 * 进入程序自动检测新版本（1.3.0）
 * ──────────────────────────────────────────────────────────────────────────────
 * 用本地 mock 服务器验（scripts/mock-endpoints.mjs，智谱写的，契约见任务书 §3.1），
 * **完全不依赖真网络**，所以可复现、离线也能跑。
 *
 * 这个用例守的几条硬要求：
 *   · 只比整数 versionCode，不比版本名字符串
 *   · 失败静默（离线/超时/500/坏 JSON 都当作"没有更新"，不报错不抛异常）
 *   · 默认 6 小时节流；手动检查（force）不受限
 *   · **不阻塞**：服务器挂住不响应时，应用照常渲染
 *   · 隐私：请求里只有版本号与平台两个参数，**不含任何学习数据**
 *   · 没配置端点时静默禁用（skipped），不报错
 */
import assert from 'node:assert/strict';
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
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await acknowledgeReleaseNotes(p);
  await p.goto('http://127.0.0.1:5188/#/');
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(800);

  /** 在页面里跑一次 checkForUpdate，返回结果（force 默认 true，绕开节流） */
  const checkUpdate = (opts = { force: true }) =>
    p.evaluate(async (o) => {
      const m = await import('/src/lib/updateCheck.ts');
      const r = await m.checkForUpdate(o);
      return { status: r.status, error: r.error ?? null, required: r.required ?? null, code: r.manifest?.versionCode ?? null, name: r.manifest?.versionName ?? null, notes: r.manifest?.notes ?? null };
    }, opts);

  const setManifest = (m) =>
    p.evaluate(async (v) => {
      const mod = await import('/src/lib/endpoints.ts');
      mod.writeEndpointOverride({ manifestUrl: window.__MOCK_URL__ });
      return v;
    }, m);

  /* ---------- 注入的本地 versionCode 必须来自 build.gradle ---------- */
  const local = await p.evaluate(async () => {
    const m = await import('/src/lib/version.ts');
    return { code: m.APP_VERSION_CODE, name: m.APP_VERSION };
  });
  check('本地 versionCode 已由构建期注入且是正整数',
    Number.isInteger(local.code) && local.code > 0, JSON.stringify(local));

  /* ---------- 先把端点指向 mock，并打开 CORS（浏览器里走 fetch 分支） ---------- */
  await p.evaluate((url) => { window.__MOCK_URL__ = url; }, mock.url);
  mock.setMode('cors');
  await p.evaluate(async () => {
    const mod = await import('/src/lib/endpoints.ts');
    mod.writeEndpointOverride({ manifestUrl: window.__MOCK_URL__ + '/version' });
  });

  /* ---------- 1. 有新版 ---------- */
  mock.setVersion({ versionCode: local.code + 5, versionName: '9.9.9', notes: ['第一条', '第二条'], apk: 'https://example.com/a.apk' });
  mock.clearRequests();
  let r = await checkUpdate();
  check('服务器 versionCode 更大 → available', r.status === 'available', JSON.stringify(r));
  check('带回版本名与更新说明', r.name === '9.9.9' && Array.isArray(r.notes) && r.notes.length === 2, JSON.stringify(r.notes));

  /* ---------- 2. 隐私：请求里只有 v 与 p，不含任何学习数据 ---------- */
  const req = mock.requests.find((x) => x.path.includes('version'));
  check('请求参数只有 v 与 p（没有学习数据、没有设备标识）',
    !!req && Object.keys(req.query ?? {}).sort().join(',') === 'p,v',
    JSON.stringify(req?.query));
  check('v 就是本地 versionCode，p 是 android',
    req?.query?.v === String(local.code) && req?.query?.p === 'android', JSON.stringify(req?.query));

  /* ---------- 3. 已是最新 / 服务器更旧 ---------- */
  mock.setVersion({ versionCode: local.code, versionName: local.name });
  r = await checkUpdate();
  check('versionCode 相等 → latest', r.status === 'latest', JSON.stringify(r));
  mock.setVersion({ versionCode: Math.max(1, local.code - 3), versionName: '0.0.1' });
  r = await checkUpdate();
  check('服务器 versionCode 更小 → latest（不会被旧版本"降级"）', r.status === 'latest', JSON.stringify(r));

  /* ---------- 4. 坏数据 / 500 / 超时：一律失败静默 ---------- */
  /*
   * ⚠️ 诚实说明：在**浏览器**分支下，`http500` 与 `malformed` 两种模式的表现
   * 和"网络错误"无法区分 —— 因为只有 `cors` 模式才带 CORS 响应头，
   * 浏览器在读到 500 的 body 之前就已经被 CORS 拦掉了（返回的 error 都是 'network'）。
   * 所以这两条断言验的是**结果正确**（都归为 failed、不抛异常），
   * 而 `status` / `parse` 这两个具体分支要等安卓真机上走 CapacitorHttp 才能覆盖到。
   */
  mock.setVersion({ versionName: '没有 versionCode' });
  r = await checkUpdate();
  check('清单缺 versionCode → failed（不是 available）', r.status === 'failed', JSON.stringify(r));

  mock.setMode('http500');
  r = await checkUpdate();
  check('服务器 500 → failed 且不抛异常', r.status === 'failed', JSON.stringify(r));

  mock.setMode('malformed');
  r = await checkUpdate();
  check('响应不是合法 JSON → failed', r.status === 'failed', JSON.stringify(r));

  mock.setMode('timeout');
  const t0 = Date.now();
  r = await checkUpdate();
  const elapsed = Date.now() - t0;
  check('服务器不响应 → failed（超时兜底）', r.status === 'failed', JSON.stringify(r));
  check('超时在 5~7 秒内结束（不是无限挂住）', elapsed > 4000 && elapsed < 8000, `${elapsed}ms`);

  /* ---------- 5. 挂住的服务器不影响应用渲染（不阻塞首屏） ---------- */
  mock.setMode('timeout');
  await p.evaluate(() => {
    void import('/src/lib/updateCheck.ts').then((m) => m.checkForUpdate({ force: true }));
  });
  await sleep(1500);
  const painted = await p.evaluate(() => (document.querySelector('#root')?.textContent ?? '').length);
  check('检测进行中时界面照常渲染（不阻塞）', painted > 50, `渲染 ${painted} 字符`);

  /* ---------- 6. 节流 ---------- */
  mock.setMode('cors');
  mock.setVersion({ versionCode: local.code + 5, versionName: '9.9.9' });
  await p.evaluate(async () => {
    const m = await import('/src/lib/updateCheck.ts');
    m.markSeen(0); // 清掉"已看过"的影响，专测节流
  });
  await checkUpdate(); // 这一下会写入检查时间
  const throttled = await checkUpdate({ force: false });
  check('6 小时内自动检查会被节流跳过（skipped）', throttled.status === 'skipped', JSON.stringify(throttled));
  const forced = await checkUpdate({ force: true });
  check('手动检查（force）不受节流限制', forced.status === 'available', JSON.stringify(forced));

  /* ---------- 7. 同一个版本只提醒一次 ---------- */
  const notify = await p.evaluate(async () => {
    const m = await import('/src/lib/updateCheck.ts');
    const older = { versionCode: m.localVersion().code + 5, versionName: '9.9.9' };
    m.markSeen(older.versionCode);
    return {
      same: m.shouldNotify(older),
      newer: m.shouldNotify({ ...older, versionCode: older.versionCode + 1 }),
    };
  });
  check('点过"以后再说"的版本不再提醒', notify.same === false);
  check('出现更新的版本时会重新提醒', notify.newer === true);

  /* ---------- 8. 未配置端点 → 静默禁用 ---------- */
  const unconfigured = await p.evaluate(async () => {
    const e = await import('/src/lib/endpoints.ts');
    e.clearEndpointOverride();
    const m = await import('/src/lib/updateCheck.ts');
    const r = await m.checkForUpdate({ force: true });
    return r.status;
  });
  check('没配置清单地址时静默禁用（skipped），不报错', unconfigured === 'skipped', unconfigured);

  /* ---------- 9. 浏览器里普通 fetch 会被 CORS 拦（这正是不带 CORS 头的 mock 模式存在的理由）---------- */
  await p.evaluate((url) => {
    window.__MOCK_URL__ = url;
  }, mock.url);
  const corsProof = await p.evaluate(async (url) => {
    const e = await import('/src/lib/endpoints.ts');
    e.writeEndpointOverride({ manifestUrl: url + '/version' });
    const m = await import('/src/lib/updateCheck.ts');
    const r = await m.checkForUpdate({ force: true });
    return r.status;
  }, mock.url);
  mock.setMode('no-cors'); // 默认模式：不带 CORS 头
  const blocked = await p.evaluate(async () => {
    const m = await import('/src/lib/updateCheck.ts');
    const r = await m.checkForUpdate({ force: true });
    return r.status;
  });
  check('不带 CORS 头时浏览器 fetch 会被拦 → failed（所以安卓侧必须走 CapacitorHttp）',
    blocked === 'failed', `带 CORS 时 ${corsProof} / 不带 CORS 时 ${blocked}`);

  check('无运行时错误', errors.length === 0, errors.slice(0, 1).join(' | '));
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await mock.close();
  await b.close();
}
