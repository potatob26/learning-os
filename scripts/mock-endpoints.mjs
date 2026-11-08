/**
 * 本地 mock 服务器（协作任务 Z2）—— 给 v1.3.0 的「版本检测」与「意见箱」做测试基建
 * ──────────────────────────────────────────────────────────────
 * 接口契约（主线按此写代码，字段名不要改）：
 *   GET  /version?v=<versionCode>&p=<android|web>   → 200 + 版本清单 JSON
 *   GET  /version.json                              → 同上（静态文件形式）
 *   POST /feedback                                  → 200 + {"ok":true}
 *
 * 刻意的设计：
 *   · 默认【不带】任何 CORS 响应头 —— 安卓 WebView 里普通 fetch 会被 CORS 拦，
 *     应用必须走原生 CapacitorHttp 才能成功；mock 默认态正好用来证明这一点。
 *     要测浏览器/PWA 路径时用 setMode('cors') 显式带头。
 *   · 端口用 listen(0) 让系统分配，避免和主线的 5188/4173 抢。
 *   · 只用 node:http，零依赖。
 */
import http from 'node:http';

/** /version 的默认返回（测试夹具，与任务书契约示例一致；测试里通常用 setVersion 显式覆盖） */
const DEFAULT_MANIFEST = {
  versionCode: 21,
  versionName: '1.3.0',
  notes: ['第一条更新说明', '第二条'],
  apk: 'https://example.com/LearningOS-v1.3.0.apk',
  minSupportedCode: 19,
};

const MODES = new Set(['ok', 'http500', 'timeout', 'malformed', 'no-cors', 'cors', 'rate-limited']);

const MALFORMED_BODY = '<!doctype html><html>gateway error, not json at all {{{';

export async function startMockServer(options = {}) {
  const state = {
    mode: options.mode ?? 'ok',
    manifest: options.manifest === undefined ? DEFAULT_MANIFEST : options.manifest,
    requests: [],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw; // 解析不了就给原始字符串
        }
      }
      // 记录每个请求（含 query 与解析后的 body）——主线做「不发送学习数据」这类隐私断言全靠它
      state.requests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: { ...req.headers },
        body,
      });

      if (state.mode === 'timeout') return; // 收到请求后挂住不响应，专测客户端超时降级
      respond(req, res, url, state);
    });
  });

  // 记住所有连接：close() 时要连 timeout 模式挂住的 socket 一起销毁，否则测试进程退不出
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  function corsHeaders(res) {
    // 只在 'cors' 模式带头；默认模式刻意不带（见文件头注释）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  function respond(req, res, url, st) {
    // 浏览器跨域时的预检请求：只在 cors 模式下应答，且必须带 CORS 头，其余模式按普通路由走（自然失败）
    if (req.method === 'OPTIONS' && st.mode === 'cors') {
      corsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (st.mode === 'http500') {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'internal error (mock)' }));
      return;
    }
    if (st.mode === 'rate-limited') {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'rate limited (mock)' }));
      return;
    }
    if (st.mode === 'malformed') {
      // 200 + 声明是 JSON 但内容不是合法 JSON —— 最恶劣的失败形态，专测解析容错
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(MALFORMED_BODY);
      return;
    }

    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    if (st.mode === 'cors') corsHeaders(res);

    if ((url.pathname === '/version' || url.pathname === '/version.json') && req.method === 'GET') {
      if (st.manifest === null) {
        json(404, { ok: false, error: 'no manifest (mock setVersion(null))' });
        return;
      }
      json(200, st.manifest);
      return;
    }
    if (url.pathname === '/feedback' && req.method === 'POST') {
      json(200, { ok: true });
      return;
    }
    json(404, { ok: false, error: `no route: ${req.method} ${url.pathname} (mock)` });
  }

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests: state.requests,

    /** 切换失败模式；未知模式直接抛错（宁可炸在测试里也不要静默按 ok 走） */
    setMode(mode) {
      if (!MODES.has(mode)) {
        throw new Error(`unknown mock mode: ${mode}（可用：${[...MODES].join(', ')}）`);
      }
      state.mode = mode;
    },

    /** 设置 /version 返回的清单；传 null 让它返回 404 */
    setVersion(manifest) {
      state.manifest = manifest;
    },

    clearRequests() {
      state.requests.length = 0;
    },

    /** 关闭服务器并销毁所有连接。必须在 finally 里调用，否则 timeout 模式会把测试进程挂住 */
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        for (const s of sockets) s.destroy();
      });
    },
  };
}
