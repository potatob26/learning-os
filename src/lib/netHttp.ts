/**
 * 联网请求（版本检测与意见箱共用）
 * ──────────────────────────────────────────────────────────────────────────────
 * 两条铁律，都来自本项目已有的 `netTime.ts`：
 *
 * 1. **永远不假装成功**：失败就返回失败，绝不把超时/500/坏 JSON 当成空结果吞掉。
 *    调用方据此决定"静默降级"或"明确告诉用户没发出去"。
 * 2. **永远不阻塞**：全部带超时（默认 5 秒），且**绝不抛异常**给调用方 ——
 *    联网是可选功能，不能因为它把整个应用带崩。
 *
 * 为什么原生下不能用普通 fetch：`capacitor.config.ts` 里 `androidScheme: 'https'`，
 * WebView 的页面来源是 `https://localhost` —— 对第三方域名的普通 fetch 会被 CORS 拦掉。
 * 安卓侧必须走 `CapacitorHttp`（它绕过 WebView 的 CORS，走原生网络栈）。
 * ⚠️ 这条路径**只能在真机/模拟器里验**：浏览器里跑的是 fetch 分支。
 */

import { Capacitor } from '@capacitor/core';

/** 默认超时。netTime.ts 用 5000，这里保持一致，免得两处行为不同。 */
export const HTTP_TIMEOUT_MS = 5000;

export interface HttpResult<T> {
  ok: boolean;
  /** 成功时的解析结果 */
  data?: T;
  /** 失败原因（供调用方判断要不要提示用户；不需要给用户看原文） */
  error?: 'timeout' | 'network' | 'status' | 'parse' | 'unconfigured';
  /** HTTP 状态码（有的话） */
  status?: number;
}

/** 是否在原生容器里（安卓/iOS）。决定走 CapacitorHttp 还是普通 fetch。 */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 带超时的 AbortController。CapacitorHttp 的 timeout 参数单独传，这里只给 fetch 用。 */
function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/**
 * 取一个 JSON（GET）。**不抛异常**，所有失败都体现在返回值里。
 * `query` 用来说明"我们是谁"（例如 `?v=19&p=android`）—— 服务端可以忽略。
 */
export async function getJson<T>(
  url: string,
  query?: Record<string, string | number>,
  timeoutMs: number = HTTP_TIMEOUT_MS,
): Promise<HttpResult<T>> {
  if (!url) return { ok: false, error: 'unconfigured' };

  const qs = query
    ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const full = url + qs;

  try {
    if (isNative()) {
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.get({ url: full, connectTimeout: timeoutMs, readTimeout: timeoutMs });
      if (res.status < 200 || res.status >= 300) return { ok: false, error: 'status', status: res.status };
      // CapacitorHttp 在 content-type 是 JSON 时已经把 data 解析成对象；
      // 是字符串时再自己解析一次，解析不了就是坏数据（不是空结果）。
      const data = typeof res.data === 'string' ? (JSON.parse(res.data) as T) : (res.data as T);
      if (data === undefined || data === null) return { ok: false, error: 'parse', status: res.status };
      return { ok: true, data, status: res.status };
    }

    const { signal, done } = withTimeout(timeoutMs);
    try {
      const res = await fetch(full, { signal, headers: { accept: 'application/json' } });
      if (!res.ok) return { ok: false, error: 'status', status: res.status };
      return { ok: true, data: (await res.json()) as T, status: res.status };
    } finally {
      done();
    }
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') return { ok: false, error: 'timeout' };
    if (e instanceof SyntaxError) return { ok: false, error: 'parse' };
    return { ok: false, error: 'network' };
  }
}

export interface TextResult {
  ok: boolean;
  /** 成功时的响应正文 */
  text?: string;
  /** 响应头（小写键）。`Date` 头就是服务器时间，时间校准的兜底探测要用。 */
  headers?: Record<string, string>;
  error?: 'timeout' | 'network' | 'status' | 'parse' | 'unconfigured';
  status?: number;
}

/**
 * 取一个**文本**响应（GET），顺带返回响应头。**不抛异常**。
 *
 * 为什么时间校准需要它：`netTime.ts` 的四个探测源原来用裸 fetch，
 * 在安卓正式包里会被 CORS 全数拦掉 → 界面永远显示「时间未校准」。
 * 走这条路（原生 CapacitorHttp / 网页 fetch）才能在真机上真正取到时间。
 *
 * `responseType: 'text'` 是必须的：CapacitorHttp 默认按 content-type 自动解析，
 * 而 Date 头那类兜底探测依赖的是**响应头**，不是正文结构。
 */
export async function getText(
  url: string,
  timeoutMs: number = HTTP_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<TextResult> {
  if (!url) return { ok: false, error: 'unconfigured' };

  try {
    if (isNative()) {
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.get({
        url,
        responseType: 'text',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      if (res.status < 200 || res.status >= 300) return { ok: false, error: 'status', status: res.status };
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) headers[String(k).toLowerCase()] = String(v);
      return { ok: true, text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? ''), headers, status: res.status };
    }

    const { signal: s, done } = withTimeout(timeoutMs);
    try {
      const res = await fetch(url, { signal: signal ?? s, cache: 'no-store' });
      if (!res.ok) return { ok: false, error: 'status', status: res.status };
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      return { ok: true, text: await res.text(), headers, status: res.status };
    } finally {
      done();
    }
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'network' };
  }
}

/**
 * 提交一个 JSON（POST）。**不抛异常**。
 * 成功必须是服务端明确认可（2xx）—— 不能因为"请求发出去了"就算成功。
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  timeoutMs: number = HTTP_TIMEOUT_MS,
): Promise<HttpResult<T>> {
  if (!url) return { ok: false, error: 'unconfigured' };

  try {
    if (isNative()) {
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.post({
        url,
        data: body,
        headers: { 'content-type': 'application/json' },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      if (res.status < 200 || res.status >= 300) return { ok: false, error: 'status', status: res.status };
      const data = typeof res.data === 'string' && res.data ? (JSON.parse(res.data) as T) : (res.data as T);
      return { ok: true, data, status: res.status };
    }

    const { signal, done } = withTimeout(timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: 'status', status: res.status };
      const text = await res.text();
      let data: T | undefined;
      try {
        data = text ? (JSON.parse(text) as T) : undefined;
      } catch {
        // 2xx 但 body 不是 JSON：请求**确实成功了**，只是没有可解析的响应体
        return { ok: true, data: undefined, status: res.status };
      }
      return { ok: true, data, status: res.status };
    } finally {
      done();
    }
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'network' };
  }
}
