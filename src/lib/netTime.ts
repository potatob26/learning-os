import { create } from 'zustand';
import { getText } from './netHttp';

/* ==========================================================================
   网络时间校准（要求十九）
   ──────────────────────────────────────────────────────────────────────────
   真实实现，不是 new Date() 包装：
    1. 逐个尝试多个真实网络时间源（不同供应商，避免单点失败）
    2. 用请求往返时间做粗略补偿（假设往返对称）
    3. 得到 服务器时间 - 本地时间 = offset，之后全站只用 now() = Date.now() + offset
    4. 记录校准来源、精度、校准时刻；设备时间明显异常时给出提示
    5. 全部失败 → fallback 到本地时间，并在 UI 明确标注「未校准」

   注意：这些是公开时间 API，会被墙/限流/下线，所以必须多源 + 降级。
   ========================================================================== */

const OFFSET_KEY = 'learning-os:v1:time-offset';

export type SyncSource =
  | 'cloudflare'
  | 'worldtimeapi'
  | 'timeapi.io'
  | 'jsontest'
  | 'cached'
  | 'local';

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'failed';

export interface SyncResult {
  offsetMs: number;
  source: SyncSource;
  /** 请求往返时间，越小越可信 */
  rttMs: number;
  syncedAt: number;
}

interface TimeState {
  /** 校准后的当前时间戳（每秒 tick） */
  ts: number;
  /** 服务器时间 - 本地时间 */
  offsetMs: number;
  status: SyncStatus;
  source: SyncSource;
  rttMs: number;
  syncedAt: number | null;
  /** 本地设备时钟与校准时间的差异（>60s 时提示用户） */
  deviceDriftSec: number;
  lastError: string | null;
  sync: () => Promise<void>;
  tick: () => void;
}

/* ---------------- 存储 offset ---------------- */

function readCachedOffset(): { offsetMs: number; syncedAt: number; source: SyncSource } | null {
  try {
    const raw = localStorage.getItem(OFFSET_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { offsetMs?: number; syncedAt?: number; source?: string };
    if (typeof v.offsetMs !== 'number' || !Number.isFinite(v.offsetMs)) return null;
    return {
      offsetMs: v.offsetMs,
      syncedAt: typeof v.syncedAt === 'number' ? v.syncedAt : Date.now(),
      source: (v.source as SyncSource) ?? 'cached',
    };
  } catch {
    return null;
  }
}

function writeCachedOffset(offsetMs: number, source: SyncSource): void {
  try {
    localStorage.setItem(
      OFFSET_KEY,
      JSON.stringify({ offsetMs, source, syncedAt: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

/* ---------------- 时间源 ---------------- */

interface Probe {
  source: SyncSource;
  /** 返回服务器毫秒时间戳 */
  run: (signal: AbortSignal) => Promise<number>;
}

const TIMEOUT_MS = 5000;

/** Cloudflare 的 traces 端点会返回 `ts=1700000000.123` */
const cloudflareProbe: Probe = {
  source: 'cloudflare',
  run: async (signal) => {
    const r = await getText(`https://www.cloudflare.com/cdn-cgi/trace?t=${Date.now()}`, TIMEOUT_MS, signal);
    if (!r.ok) throw new Error(`cloudflare: ${r.error}`);
    const text = r.text ?? '';
    const m = /(?:^|\n)ts=([\d.]+)/.exec(text);
    if (!m) throw new Error('cloudflare: no ts field');
    const sec = Number(m[1]);
    if (!Number.isFinite(sec) || sec < 1_600_000_000) throw new Error('cloudflare: bad ts');
    return sec * 1000;
  },
};

const worldTimeProbe: Probe = {
  source: 'worldtimeapi',
  run: async (signal) => {
    const r = await getText('https://worldtimeapi.org/api/ip', TIMEOUT_MS, signal);
    if (!r.ok) throw new Error(`worldtimeapi: ${r.error}`);
    const json = JSON.parse(r.text ?? '{}') as { unixtime?: number };
    if (typeof json.unixtime !== 'number') throw new Error('worldtimeapi: no unixtime');
    return json.unixtime * 1000;
  },
};

const timeApiIoProbe: Probe = {
  source: 'timeapi.io',
  run: async (signal) => {
    const r = await getText('https://timeapi.io/api/Time/current/zone?timeZone=Asia/Shanghai', TIMEOUT_MS, signal);
    if (!r.ok) throw new Error(`timeapi.io: ${r.error}`);
    const json = JSON.parse(r.text ?? '{}') as {
      year?: number;
      month?: number;
      day?: number;
      hour?: number;
      minute?: number;
      seconds?: number;
      milliSeconds?: number;
    };
    if (!json.year || !json.month || !json.day) throw new Error('timeapi.io: bad payload');
    return new Date(
      json.year,
      json.month - 1,
      json.day,
      json.hour ?? 0,
      json.minute ?? 0,
      json.seconds ?? 0,
      json.milliSeconds ?? 0,
    ).getTime();
  },
};

/** 兜底：任何 HTTPS 响应的 Date 头都是服务器时间（秒级精度） */
const dateHeaderProbe: Probe = {
  source: 'jsontest',
  run: async (signal) => {
    const r = await getText(`https://worldtimeapi.org/api/timezone/Etc/UTC?t=${Date.now()}`, TIMEOUT_MS, signal);
    if (!r.ok) throw new Error(`dateheader: ${r.error}`);
    const header = r.headers?.date;
    if (!header) throw new Error('no Date header');
    const t = new Date(header).getTime();
    if (!Number.isFinite(t)) throw new Error('bad Date header');
    return t;
  },
};

const PROBES: Probe[] = [cloudflareProbe, timeApiIoProbe, worldTimeProbe, dateHeaderProbe];

/** 单个源采样 3 次，取 RTT 最小的一次（NTP 式粗略过滤） */
async function sampleProbe(probe: Probe): Promise<SyncResult> {
  let best: SyncResult | null = null;
  for (let i = 0; i < 3; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const before = Date.now();
    try {
      const serverTs = await probe.run(controller.signal);
      const after = Date.now();
      const rtt = after - before;
      // 假设往返对称，服务器时间对应往返中点
      const localMid = before + rtt / 2;
      const candidate: SyncResult = {
        offsetMs: serverTs - localMid,
        source: probe.source,
        rttMs: rtt,
        syncedAt: after,
      };
      if (!best || candidate.rttMs < best.rttMs) best = candidate;
      if (rtt < 120) break; // 已经足够准，不用再采样
    } catch {
      /* 本次采样失败，继续 */
    } finally {
      clearTimeout(timer);
    }
  }
  if (!best) throw new Error(`${probe.source}: unreachable`);
  return best;
}

/* ---------------- Store ---------------- */

const cached = typeof localStorage !== 'undefined' ? readCachedOffset() : null;

export const useTimeStore = create<TimeState>((set, get) => ({
  ts: Date.now(),
  offsetMs: cached?.offsetMs ?? 0,
  status: cached ? 'idle' : 'idle',
  source: cached?.source ?? 'local',
  rttMs: 0,
  syncedAt: cached?.syncedAt ?? null,
  deviceDriftSec: 0,
  lastError: null,

  tick: () => {
    const { offsetMs } = get();
    set({ ts: Date.now() + offsetMs });
  },

  sync: async () => {
    if (get().status === 'syncing') return;
    set({ status: 'syncing', lastError: null });

    const results: SyncResult[] = [];
    for (const probe of PROBES) {
      try {
        const r = await sampleProbe(probe);
        results.push(r);
        // 拿到一个 RTT 很小、已经很可信的结果就停止
        if (r.rttMs < 250) break;
      } catch (err) {
        set({ lastError: err instanceof Error ? err.message : String(err) });
      }
    }

    if (results.length === 0) {
      // 全部失败 → 明确降级，并沿用缓存 offset（如果有）
      const fallback = readCachedOffset();
      set({
        status: 'failed',
        source: fallback ? 'cached' : 'local',
        offsetMs: fallback?.offsetMs ?? 0,
        ts: Date.now() + (fallback?.offsetMs ?? 0),
      });
      return;
    }

    // 多源取中位数，抗单源异常
    const sorted = [...results].sort((a, b) => a.offsetMs - b.offsetMs);
    const mid = sorted[Math.floor(sorted.length / 2)];
    const bestRtt = Math.min(...results.map((r) => r.rttMs));

    writeCachedOffset(mid.offsetMs, mid.source);

    set({
      offsetMs: mid.offsetMs,
      status: 'ok',
      source: mid.source,
      rttMs: bestRtt,
      syncedAt: Date.now(),
      ts: Date.now() + mid.offsetMs,
      deviceDriftSec: Math.round(Math.abs(mid.offsetMs) / 1000),
    });
  },
}));

/** 全站统一入口：任何需要「现在」的地方都用它 */
export function now(): number {
  return useTimeStore.getState().ts;
}

/** 非 React 环境的实时取值（计时等场景） */
export function nowExact(): number {
  return Date.now() + useTimeStore.getState().offsetMs;
}

export const SOURCE_LABEL: Record<SyncSource, string> = {
  cloudflare: 'Cloudflare',
  worldtimeapi: 'WorldTimeAPI',
  'timeapi.io': 'timeapi.io',
  jsontest: 'HTTP Date 头',
  cached: '上次校准缓存',
  local: '本机时间（未校准）',
};

/* ---------------- 全局 ticker ---------------- */

let ticker: ReturnType<typeof setInterval> | null = null;

export function startClock(): () => void {
  if (ticker) return () => undefined;

  const fire = () => useTimeStore.getState().tick();
  fire();
  ticker = setInterval(fire, 1000);

  // Android 从后台回来时 setInterval 会被节流/暂停，这里强制补一次
  const onVisible = () => {
    if (document.visibilityState === 'visible') fire();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onVisible);

  return () => {
    if (ticker) clearInterval(ticker);
    ticker = null;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.removeEventListener('online', onVisible);
  };
}

/** 超过这个时间就重新校准一次 */
const RESYNC_AFTER_MS = 6 * 60 * 60 * 1000;

export function shouldResync(): boolean {
  const { syncedAt, status } = useTimeStore.getState();
  if (status === 'syncing') return false;
  if (!syncedAt) return true;
  return Date.now() - syncedAt > RESYNC_AFTER_MS;
}
