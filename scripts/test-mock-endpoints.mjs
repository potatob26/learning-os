/**
 * mock 服务器自测（协作任务 Z2）—— 用 Node 22 内置 fetch 对 mock 自己跑一遍断言。
 * 覆盖任务书 3.4 的 9 项；输出格式与项目其它测试一致：
 *   每条 `PASS xxx`，最后 `===== N/N 通过 =====`，失败 process.exit(1)。
 * 运行：node scripts/test-mock-endpoints.mjs（零依赖，不需要开发服务器）
 */
import assert from 'node:assert';
import { startMockServer } from './mock-endpoints.mjs';

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const CONTRACT_MANIFEST = {
  versionCode: 21,
  versionName: '1.3.0',
  notes: ['第一条更新说明', '第二条'],
  apk: 'https://example.com/LearningOS-v1.3.0.apk',
  minSupportedCode: 19,
};

const FEEDBACK_FULL = {
  message: '用户写的内容',
  versionName: '1.3.0',
  versionCode: 21,
  platform: 'android',
  buildTime: '2026-10-02T12:00:00.000Z',
  diagnostics: { sessions: 12, goals: 3, theme: 'pure-light', hasBackgroundImage: false },
  contact: '可选，用户愿意留才发',
};

const server = await startMockServer();
console.log(`mock 起在 ${server.url}（端口 ${server.port}，随机分配）`);

try {
  /* ---- 1. GET /version：200、字段齐全、类型正确、query 被记录 ---- */
  {
    const res = await fetch(`${server.url}/version?v=18&p=android`);
    const body = await res.json();
    check('GET /version 返回 200', res.status === 200);
    check('清单字段齐全且类型正确',
      typeof body.versionCode === 'number' && typeof body.versionName === 'string'
      && Array.isArray(body.notes) && body.notes.every((n) => typeof n === 'string')
      && typeof body.apk === 'string' && body.apk.startsWith('https://')
      && typeof body.minSupportedCode === 'number',
      JSON.stringify(body));
    check('版本清单与契约一致（deepStrictEqual）', (() => {
      try { assert.deepStrictEqual(body, CONTRACT_MANIFEST); return true; } catch { return false; }
    })());
    const rec = server.requests.find((r) => r.path === '/version');
    check('请求记录里查得到 /version 且带 query',
      !!rec && rec.method === 'GET' && rec.query.v === '18' && rec.query.p === 'android',
      rec ? `query=${JSON.stringify(rec.query)}` : '没记录到');
  }

  /* ---- 2. GET /version.json：同样可用 ---- */
  {
    const res = await fetch(`${server.url}/version.json`);
    const body = await res.json();
    check('GET /version.json 返回 200 且清单一致', res.status === 200 && body.versionCode === 21
      && body.versionName === '1.3.0' && Array.isArray(body.notes));
  }

  /* ---- 3. setVersion(null) → 404 ---- */
  {
    server.setVersion(null);
    const res = await fetch(`${server.url}/version`);
    check('setVersion(null) 后 /version 返回 404', res.status === 404);
    server.setVersion(CONTRACT_MANIFEST);
    const res2 = await fetch(`${server.url}/version`);
    check('setVersion 恢复后重新 200', res2.status === 200);
  }

  /* ---- 4. POST /feedback：逐字段核对（隐私断言的基础） ---- */
  {
    server.clearRequests();
    const res = await fetch(`${server.url}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FEEDBACK_FULL),
    });
    const body = await res.json();
    check('POST /feedback 返回 200 + {"ok":true}', res.status === 200 && body.ok === true);
    const recs = server.requests.filter((r) => r.path === '/feedback');
    check('requests 里恰好记录到这条 POST', recs.length === 1 && recs[0].method === 'POST');
    check('记录的 body 与发送的逐字段一致（deepStrictEqual）', (() => {
      try { assert.deepStrictEqual(recs[0].body, FEEDBACK_FULL); return true; } catch { return false; }
    })());
    check('记录的 Content-Type 是 application/json',
      (recs[0].headers['content-type'] || '').includes('application/json'));
  }

  /* ---- 5. diagnostics: null 与字段缺席都不报错 ---- */
  {
    const res1 = await fetch(`${server.url}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...FEEDBACK_FULL, diagnostics: null, contact: undefined }),
    });
    const rec1 = server.requests.filter((r) => r.path === '/feedback').at(-1);
    check('diagnostics: null（contact 缺席）→ 200 且原样记录',
      res1.status === 200 && rec1.body.diagnostics === null && !('contact' in rec1.body));
    const { diagnostics, contact, ...minimal } = FEEDBACK_FULL;
    const res2 = await fetch(`${server.url}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimal),
    });
    const rec2 = server.requests.filter((r) => r.path === '/feedback').at(-1);
    check('diagnostics 与 contact 整个缺席 → 200 且原样记录',
      res2.status === 200 && !('diagnostics' in rec2.body) && !('contact' in rec2.body));
  }

  /* ---- 6. 失败模式：http500 / malformed / rate-limited ---- */
  {
    server.setMode('http500');
    const r5 = await fetch(`${server.url}/version`);
    check('http500 模式返回 500', r5.status === 500);

    server.setMode('malformed');
    const rm = await fetch(`${server.url}/version`);
    const text = await rm.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 预期走这里 */ }
    check('malformed 模式返回 200 但 body 不是合法 JSON',
      rm.status === 200 && parsed === null && text.length > 0, `body 前 40 字: ${text.slice(0, 40)}`);

    server.setMode('rate-limited');
    const rr = await fetch(`${server.url}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'x' }),
    });
    check('rate-limited 模式返回 429', rr.status === 429);

    let threw = false;
    try { server.setMode('bogus-mode'); } catch { threw = true; }
    check('未知 mode 直接抛错（不静默当 ok）', threw);    server.setMode('ok');
    const rb = await fetch(`${server.url}/version`);
    check('切回 ok 模式恢复 200', rb.status === 200);
  }

  /* ---- 7. timeout 模式：短超时 AbortController 证明它确实不响应（不等 5 秒） ---- */
  {
    server.clearRequests();
    server.setMode('timeout');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 600);
    const t0 = Date.now();
    let aborted = false;
    try {
      await fetch(`${server.url}/version`, { signal: ctrl.signal });
    } catch (e) {
      aborted = e.name === 'AbortError' || /abort/i.test(String(e));
    } finally {
      clearTimeout(timer);
    }
    check('timeout 模式 600ms 内无响应（客户端被迫中断）', aborted, `耗时 ${Date.now() - t0}ms`);
    check('timeout 模式下请求仍被记录（能观测到应用发过什么）',
      server.requests.some((r) => r.path === '/version'));
    server.setMode('ok');
  }

  /* ---- 8. 默认不带 CORS 头；cors 模式带上 ---- */
  {
    const def = await fetch(`${server.url}/version`);
    check('默认模式响应不带 Access-Control-Allow-Origin（刻意设计）',
      def.headers.get('access-control-allow-origin') === null);

    server.setMode('cors');
    const pre = await fetch(`${server.url}/feedback`, {
      method: 'OPTIONS', headers: { 'Content-Type': 'application/json' },
    });
    const withCors = await fetch(`${server.url}/version`);
    check('cors 模式：预检 OPTIONS 204 且带 CORS 头',
      pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');
    check('cors 模式：实际响应带 CORS 头且允许 Content-Type',
      withCors.headers.get('access-control-allow-origin') === '*'
      && (withCors.headers.get('access-control-allow-headers') || '').toLowerCase().includes('content-type'));
    server.setMode('ok');
  }

  /* ---- 9. close() 之后端口释放（再 startMockServer 能起来） ---- */
  {
    const closedPort = server.port;
    await server.close();
    const second = await startMockServer();
    const res = await fetch(`${second.url}/version`);
    check('close() 后新 mock 能起在随机端口且正常响应',
      res.status === 200 && second.port > 0 && second.port !== closedPort,
      `旧端口 ${closedPort} → 新端口 ${second.port}`);
    await second.close();
  }

  /* ---- 附：clearRequests / close 后再 close 不炸 ---- */
  {
    server.clearRequests();
    check('clearRequests 清空请求记录', server.requests.length === 0);
    await server.close();
    check('重复 close() 不抛错（幂等）', true);
  }
} finally {
  await server.close(); // 任务书要求：必须在 finally 里 close，否则进程退不出
}

const failed = results.filter((r) => !r).length;
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`);
if (failed) process.exit(1);
