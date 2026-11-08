/**
 * 意见箱：把用户写的内容发到开发者那里
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户的原始要求：「用户直接在软件内发送然后我这里可以查看内容」。
 *
 * 几条硬性设计：
 *
 * 1. **不假装成功**。只有**服务器明确认可**才算发出去：
 *    HTTP 2xx 且响应体里的 `ok` 不是 false。
 *    为什么连响应体都要看：上一轮在另一个服务上实测到「无效地址也返回 HTTP 200、
 *    业务失败藏在 body 里」—— 只看状态码会让用户的消息**无声消失**。
 * 2. **失败时绝不丢用户写的字**。文案以外的地方一行都不动，
 *    草稿在 localStorage 里随时可取（每次输入都存），刷新页面也还在。
 * 3. **默认只带版本与平台**（用户明确要求）。学习数据的统计量（条数之类）
 *    **必须用户主动勾选**才带，而且界面上写清带的是什么 —— 不搞"顺手带上"。
 * 4. **没配置接收地址时整个功能不出现**（不是灰按钮、不是点了没反应）。
 */

import { APP_VERSION, APP_VERSION_CODE, BUILD_TIME } from './version';
import { readEndpoints } from './endpoints';
import { postJson, HTTP_TIMEOUT_MS, isNative } from './netHttp';

/** 与 mock / 云函数约定的报文结构，**字段名不要改** */
export interface FeedbackPayload {
  message: string;
  versionName: string;
  versionCode: number;
  platform: 'android' | 'web';
  buildTime: string;
  /**
   * 只有用户勾选才带。**只放数量与开关状态，不放任何用户写的文字** ——
   * 学习记录条数这种"规模信息"足够定位问题，而具体学了什么与反馈无关。
   */
  diagnostics?: {
    sessions: number;
    goals: number;
    theme: string;
    hasBackgroundImage: boolean;
  } | null;
  /** 用户愿意留才带 */
  contact?: string;
}

export type SendOutcome =
  | { ok: true }
  /** 失败原因用中文短句，直接可以给用户看 */
  | { ok: false; reason: string };

const REASON: Record<string, string> = {
  timeout: '网络超时',
  network: '网络不通',
  status: '服务器没接受',
  parse: '服务器返回的内容看不懂',
  unconfigured: '没有配置接收地址',
};

/** 当前是否配置了意见箱接收地址（没配置时界面不显示这一块） */
export function feedbackConfigured(): boolean {
  return !!readEndpoints().feedbackUrl;
}

export function buildFeedbackPayload(opts: {
  message: string;
  includeDiagnostics: boolean;
  contact?: string;
  diagnostics?: FeedbackPayload['diagnostics'];
}): FeedbackPayload {
  const payload: FeedbackPayload = {
    message: opts.message,
    versionName: APP_VERSION,
    versionCode: APP_VERSION_CODE,
    // 平台按"实际在跑哪个容器"判断，不按谁编译的 —— Web 预览里不该自称 android
    platform: isNative() ? 'android' : 'web',
    buildTime: BUILD_TIME,
  };
  if (opts.includeDiagnostics && opts.diagnostics) payload.diagnostics = opts.diagnostics;
  const contact = opts.contact?.trim();
  if (contact) payload.contact = contact;
  return payload;
}

/** 发送。**不抛异常**，失败如实返回原因。 */
export async function sendFeedback(payload: FeedbackPayload): Promise<SendOutcome> {
  const { feedbackUrl } = readEndpoints();
  if (!feedbackUrl) return { ok: false, reason: REASON.unconfigured };

  const res = await postJson<{ ok?: boolean; error?: string }>(feedbackUrl, payload, HTTP_TIMEOUT_MS);
  if (!res.ok) return { ok: false, reason: REASON[res.error ?? 'network'] ?? '发送失败' };

  /*
   * 2xx 还不够：服务端可能用 200 + {ok:false} 表达"业务上没收下"
   * （转发到 IM 失败、限流、字段校验不过都可能这样返回）。
   * 只有明确没有 ok 字段、或 ok 不是 false，才算真的成功。
   */
  const body = res.data;
  if (body && typeof body === 'object' && body.ok === false) {
    return { ok: false, reason: body.error?.trim() || '服务器没有接收' };
  }
  return { ok: true };
}

/* ---------------- 草稿（失败时不能把用户写的字弄丢） ---------------- */

const DRAFT_KEY = 'learning-os:feedback-draft';

export function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(text: string): void {
  try {
    if (text.trim() === '') localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, text);
  } catch {
    /* 存不进去最多是刷新后要重写一遍，不影响本次发送 */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 忽略 */
  }
}
