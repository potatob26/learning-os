/**
 * 联网端点地址
 * ──────────────────────────────────────────────────────────────────────────────
 * 为什么单独一层、而且要能运行时覆盖：
 *
 * 1. **测试必须能指向本地 mock 服务器**。否则用例依赖真网络 —— 不可复现、
 *    离线就跑不了、还会把开发者的真实端点打上测试数据。
 * 2. **地址是构建期注入的**（`vite.config.ts` 的 `__UPDATE_MANIFEST_URL__` /
 *    `__FEEDBACK_URL__`），但**发布后不能再改**。运行时覆盖留了一个口子，
 *    排查问题时可以在控制台里换成临时地址，不用重新打包。
 * 3. **没配置时整个功能静默禁用**（返回 undefined），不报错、不弹提示 ——
 *    这是「离线仍然完全可用」这条硬要求的前提。
 *
 * 覆盖值存在 localStorage 而不是持久化进主存档：
 * 它是**环境配置**，不是用户数据（导出/导入学习数据时不该把它带走）。
 */

const OVERRIDE_KEY = 'learning-os:endpoints';

export interface Endpoints {
  /** 版本清单地址（GET 返回 JSON）。未配置 = 不检测更新 */
  manifestUrl?: string;
  /** GitHub 仓库（owner/repo）。配置后可直接用 Releases 自动检测更新，不需要自建端点 */
  githubRepo?: string;
  /** 意见箱接收地址（POST JSON）。未配置 = 意见箱入口不显示 */
  feedbackUrl?: string;
}

/** 只接受 http(s) 且非空；其余（空串、javascript: 之类）一律当作未配置 */
function clean(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const t = url.trim();
  if (!t) return undefined;
  return /^https?:\/\//i.test(t) ? t : undefined;
}

/** GitHub 仓库只接受 owner/repo（每段只允许字母数字、点、下划线、连字符） */
function cleanRepo(repo: unknown): string | undefined {
  if (typeof repo !== 'string') return undefined;
  const t = repo.trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t) ? t : undefined;
}

/** 运行时覆盖（可只覆盖其中一个字段） */
export function writeEndpointOverride(patch: Endpoints): void {
  try {
    const cur = readEndpointOverride();
    const next: Endpoints = { ...cur, ...patch };
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
  } catch {
    /* 存不进去就本次生效不了，不影响其它功能 */
  }
}

function readEndpointOverride(): Endpoints {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Endpoints;
    return {
      manifestUrl: clean(o?.manifestUrl),
      githubRepo: cleanRepo(o?.githubRepo),
      feedbackUrl: clean(o?.feedbackUrl),
    };
  } catch {
    return {};
  }
}

/**
 * 取当前生效的端点：**运行时覆盖优先于构建期注入**。
 *
 * `import.meta.env` 也读一次的原因：某些构建（例如纯 Web 预览）走的是
 * Vite 的 env 机制而不是 `define`，两条都读才不会出现"明明配了却没生效"。
 */
export function readEndpoints(): Endpoints {
  const override = readEndpointOverride();
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const built = {
    manifestUrl: clean(env.VITE_UPDATE_MANIFEST_URL),
    githubRepo: cleanRepo(env.VITE_GITHUB_REPO),
    feedbackUrl: clean(env.VITE_FEEDBACK_URL),
  };
  return {
    manifestUrl: override.manifestUrl ?? built.manifestUrl,
    githubRepo: override.githubRepo ?? built.githubRepo,
    feedbackUrl: override.feedbackUrl ?? built.feedbackUrl,
  };
}

/** 测试与排查用：清掉运行时覆盖，回到构建期注入的值 */
export function clearEndpointOverride(): void {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 供测试/排查在控制台里直接换端点 */
declare global {
  interface Window {
    __LOS_SET_ENDPOINTS__?: (patch: Endpoints) => void;
    __LOS_CLEAR_ENDPOINTS__?: () => void;
  }
}

if (typeof window !== 'undefined') {
  window.__LOS_SET_ENDPOINTS__ = writeEndpointOverride;
  window.__LOS_CLEAR_ENDPOINTS__ = clearEndpointOverride;
}
