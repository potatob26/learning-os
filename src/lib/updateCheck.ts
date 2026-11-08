/**
 * 进入程序自动检测新版本
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求：「进入程序自动检测新版本」。
 *
 * 设计约束（都是硬要求）：
 *
 * 1. **不阻塞首屏**：调用方在首屏渲染之后再调它，且**不要 await**。
 *    它内部也要保证任何情况下都在 5 秒内返回。
 * 2. **失败静默**：离线、超时、500、坏 JSON 一律当作"没有更新"，
 *    不弹错误、不写控制台噪音。用户在用学习工具，不该被网络问题打扰。
 * 3. **只比整数 versionCode**：字符串比较会遇到 "1.10.0" < "1.9.0" 这种荒谬结果。
 * 4. **节流**：默认 6 小时内不重复请求（每次冷启动都打一次服务器既浪费也没必要）。
 *    但**手动检查（force）不受节流限制**。
 * 5. **同一个版本只提醒一次**：用户点了"以后再说"就不再烦他，
 *    直到出现**更新的** versionCode 才再提。
 *
 * 关于"能不能自动更新"：安卓不经过商店**无法静默自更新**，
 * 所以这个功能只能做到「发现 → 告诉用户 → 引导去下载」，不能假装能自动装。
 */

import { APP_VERSION, APP_VERSION_CODE } from './version';
import { readEndpoints } from './endpoints';
import { getJson, HTTP_TIMEOUT_MS } from './netHttp';

/** 服务器上的版本清单。字段名与 mock/云函数约定一致，**不要改**。 */
export interface UpdateManifest {
  /** 整数版本号，比较只认它 */
  versionCode: number;
  /** 展示用版本名，例如 "1.3.0" */
  versionName: string;
  /** 更新说明，逐条 */
  notes?: string[];
  /** 新版 APK 地址 */
  apk?: string;
  /** 低于这个 versionCode 视为"必须更新"（可选） */
  minSupportedCode?: number;
}

export type UpdateStatus =
  /** 没配置端点，或本次被节流跳过 */
  | 'skipped'
  /** 已是最新 */
  | 'latest'
  /** 有新版 */
  | 'available'
  /** 检查失败（离线、超时、500、坏数据）—— 对用户等同于"没有更新" */
  | 'failed';

export interface UpdateCheckResult {
  status: UpdateStatus;
  manifest?: UpdateManifest;
  /** 是否属于"必须更新"（本地版本低于 minSupportedCode） */
  required?: boolean;
  /** 失败原因，仅供排查，不展示给用户 */
  error?: string;
}

const CHECKED_AT_KEY = 'learning-os:update-check-at';
const SEEN_KEY = 'learning-os:update-seen-code';

/** 节流窗口：6 小时 */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function readNumber(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* 存不进去只影响节流，不影响功能 */
  }
}

/** 上次检查时间（用于节流判断与设置页展示） */
export function lastCheckedAt(): number | null {
  return readNumber(CHECKED_AT_KEY);
}

/** 用户已"以后再说"过的 versionCode */
export function seenVersionCode(): number | null {
  return readNumber(SEEN_KEY);
}

/** 记下"这个版本用户已经知道了"，下次不再提醒 */
export function markSeen(versionCode: number): void {
  writeNumber(SEEN_KEY, versionCode);
}

/* ---------------- GitHub Releases（开源后不需要自建端点） ---------------- */

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string | null;
  html_url?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

/** "v1.4.2" / "1.4.2" → [1,4,2]；不是三段数字就返回 null */
function parseSemver(value: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i.exec(value.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** 给 seen / shouldNotify 用的稳定整数：1.4.2 → 10402（同一仓库内单调递增） */
function semverCode(v: [number, number, number]): number {
  return v[0] * 10000 + v[1] * 100 + v[2];
}

/**
 * 从 GitHub 最新 Release 生成更新清单：
 *   · 版本号取 tag_name（v1.4.2 → 1.4.2），按语义化版本比较；
 *   · APK 取 release 资产里第一个 .apk 的 browser_download_url；
 *   · notes 取 Release 正文的前几行（去掉 Markdown 列表符号）。
 * 任何失败都返回 failed，由调用方静默处理。
 */
async function checkGitHubRelease(repo: string): Promise<UpdateCheckResult> {
  const api = `https://api.github.com/repos/${repo}/releases/latest`;
  // 不传 query：GitHub API 不需要版本参数，也别把本地版本拼进 URL（隐私）
  const res = await getJson<GitHubRelease>(api, undefined, HTTP_TIMEOUT_MS);
  if (!res.ok || !res.data) return { status: 'failed', error: res.error };

  const remote = parseSemver(String(res.data.tag_name ?? ''));
  const local = parseSemver(APP_VERSION) ?? [0, 0, 0];
  if (!remote) return { status: 'failed', error: 'bad-manifest' };
  if (compareSemver(remote, local) <= 0) return { status: 'latest' };

  const assets = Array.isArray(res.data.assets) ? res.data.assets : [];
  const apkAsset = assets.find(
    (a) =>
      typeof a?.name === 'string' &&
      /\.apk$/i.test(a.name) &&
      typeof a?.browser_download_url === 'string',
  );
  const notes = String(res.data.body ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);

  return {
    status: 'available',
    manifest: {
      versionCode: semverCode(remote),
      versionName: remote.join('.'),
      notes,
      apk: apkAsset?.browser_download_url,
    },
    required: false,
  };
}

/**
 * 检查更新。**不抛异常**。
 * @param opts.force 忽略节流（手动检查用）
 */
export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<UpdateCheckResult> {
  const { manifestUrl, githubRepo } = readEndpoints();
  if (!manifestUrl && !githubRepo) return { status: 'skipped' };

  if (!opts.force) {
    const last = lastCheckedAt();
    if (last !== null && Date.now() - last < CHECK_INTERVAL_MS) return { status: 'skipped' };
  }

  /*
   * 两种来源：
   *   1. 显式配置了 manifestUrl → 用自建/第三方清单（老行为，按 versionCode 比较）；
   *   2. 只配置了 githubRepo → 直接查 GitHub Releases（开源后不用自己维护服务器）。
   * 两个都配时 manifestUrl 优先，方便需要灰度/多环境的人。
   */
  if (!manifestUrl && githubRepo) {
    const r = await checkGitHubRelease(githubRepo);
    // 无论成功失败都记时间：失败后立刻重试既没意义、又会在断网时反复打请求
    writeNumber(CHECKED_AT_KEY, Date.now());
    return r;
  }

  const res = await getJson<UpdateManifest>(manifestUrl!, {
    v: APP_VERSION_CODE,
    p: 'android',
  }, HTTP_TIMEOUT_MS);

  // 无论成功失败都记时间：失败后立刻重试既没意义、又会在断网时反复打请求
  writeNumber(CHECKED_AT_KEY, Date.now());

  if (!res.ok || !res.data) {
    return { status: 'failed', error: res.error };
  }

  const m = res.data;
  // 坏数据当作"没有更新"：versionCode 必须是有限整数
  if (typeof m.versionCode !== 'number' || !Number.isFinite(m.versionCode)) {
    return { status: 'failed', error: 'bad-manifest' };
  }

  if (m.versionCode <= APP_VERSION_CODE) return { status: 'latest' };

  const required =
    typeof m.minSupportedCode === 'number' && APP_VERSION_CODE < m.minSupportedCode;

  return { status: 'available', manifest: m, required };
}

/**
 * 这个更新**值不值得打扰用户**：
 * 用户对同一个 versionCode 点过"以后再说"就不再提；
 * 出现更大的 versionCode 时重新提醒（否则用户会永远收不到后续更新）。
 */
export function shouldNotify(manifest: UpdateManifest): boolean {
  const seen = seenVersionCode();
  if (seen === null) return true;
  return manifest.versionCode > seen;
}

/**
 * 清掉"已看过"的记录。**仅供测试与排查** ——
 * 它不写在设置界面里，因为正常用户没有"重新提醒我"这个需求。
 */
export function clearSeen(): void {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* 忽略 */
  }
}

let inFlight: Promise<UpdateCheckResult> | null = null;

/**
 * 启动时用的检测入口：**同一次启动内只真正请求一次**。
 *
 * 为什么必须幂等 —— 这个坑是写用例时发现的：
 * React 的 StrictMode 在**开发期会把 effect 跑两次**（挂载→卸载→再挂载）。
 * 如果每次调用都真的发请求，那么第一次会发出请求并写下节流时间戳，
 * 而它的结果因为组件已"卸载"被丢弃；第二次调用就只剩 `skipped`（被节流），
 * 于是**开发期永远看不到更新提示**，而生产构建里却是好的 —— 这种"只在一边坏"
 * 的问题最难查。用一个共享 promise 兜住，两边行为就一致了。
 */
export function checkForUpdateOnce(): Promise<UpdateCheckResult> {
  inFlight ??= checkForUpdate();
  return inFlight;
}

/** 仅供测试：重置幂等状态，让下一次 checkForUpdateOnce 重新真正请求 */
export function resetOnceState(): void {
  inFlight = null;
}

/** 本地版本信息，供设置页与弹层展示 */
export function localVersion(): { name: string; code: number } {
  return { name: APP_VERSION, code: APP_VERSION_CODE };
}
