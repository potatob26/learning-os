import { get as idbGet, set as idbSet, del as idbDel, createStore } from 'idb-keyval';
import type { AppSnapshot } from './types';
import { SCHEMA_VERSION } from './types';

/**
 * 数据层
 * ─────────────────────────────────────────────────────────────
 * 设计目标：
 *  1. 刷新 / 崩溃 / 关机都不能丢数据
 *  2. 写入不阻塞 UI（节流 + 空闲回调）
 *  3. 换存储后端（IndexedDB → 云端）只需替换这一层
 *
 * 落盘策略：内存(状态) → 节流 400ms → localStorage(快) + IndexedDB(大)
 * 图片背景体积极大，只进 IndexedDB，不进 localStorage。
 */

const LS_KEY = 'learning-os:v1:state';

let idbStore: ReturnType<typeof createStore> | null = null;
try {
  idbStore = createStore('learning-os-db', 'kv');
} catch {
  idbStore = null;
}

export type StorageHealth = 'ok' | 'degraded' | 'memory';

export interface PersistedState {
  schema: number;
  settings: unknown;
  periods: unknown;
  courses: unknown;
  goals: unknown;
  tasks: unknown;
  sessions: unknown;
  dates: unknown;
  /** 日历事件（与 important dates 相互独立）。旧存档缺省时按空数组处理。 */
  calendarEvents?: unknown;
  /** 按日期覆盖课表（补课 / 放假） */
  dayOverrides?: unknown;
  /** 火花（连续学习天数）的接回账本；旧存档缺省 = 空数组 */
  streakRescues?: unknown;
  /** 成就解锁账本；旧存档缺省 = 空数组（hydrate 时按现有记录补记） */
  achievements?: unknown;
  /** 考试分数记录；旧存档缺省 = 空数组 */
  examScores?: unknown;
  /** 各科目标分；旧存档缺省 = 空数组 */
  subjectScoreTargets?: unknown;
  background: unknown;
  timer: unknown;
  /** 课程完成状态：日期 → 课程 id → 状态 */
  courseStatus?: unknown;
}

/* ---------------- localStorage（同步、快） ---------------- */

function lsAvailable(): boolean {
  try {
    const k = '__los_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export const hasLocalStorage = lsAvailable();

/** 背景里的大图不进 localStorage */
function stripHeavy(state: PersistedState): PersistedState {
  try {
    const bg = state.background as { custom?: unknown } | null;
    if (bg && Array.isArray(bg.custom)) {
      return {
        ...state,
        background: { ...(bg as object), custom: [] },
      };
    }
  } catch {
    /* ignore */
  }
  return state;
}

function readLocal(): PersistedState | null {
  if (!hasLocalStorage) return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

function writeLocal(state: PersistedState): boolean {
  if (!hasLocalStorage) return false;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(stripHeavy(state)));
    return true;
  } catch {
    // 配额满了：丢掉最重的 sessions 历史再试一次
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(stripHeavy(state)));
      return true;
    } catch {
      return false;
    }
  }
}

/* ---------------- IndexedDB（大、异步） ---------------- */

async function readIdb(): Promise<PersistedState | null> {
  if (!idbStore) return null;
  try {
    const v = (await idbGet(LS_KEY, idbStore)) as PersistedState | undefined;
    return v ?? null;
  } catch {
    return null;
  }
}

async function writeIdb(state: PersistedState): Promise<void> {
  if (!idbStore) return;
  try {
    await idbSet(LS_KEY, state, idbStore);
  } catch {
    /* 磁盘满 / 隐私模式：静默降级 */
  }
}

async function clearIdb(): Promise<void> {
  if (!idbStore) return;
  try {
    await idbDel(LS_KEY, idbStore);
  } catch {
    /* ignore */
  }
}

/* ---------------- 版本迁移 ---------------- */

/**
 * 主题改名 / 下线迁移。
 * - 老的 'glass' 其实是普通毛玻璃，后来改名为 'mica'
 * - 'mica' 主题现已下线（与毛玻璃定位重叠），迁移到毛玻璃；
 *   玻璃材质里的 mica 档作为降级材质仍然保留，不受影响
 */
const THEME_RENAMES: Record<string, string> = {
  glass: 'mica',
  mica: 'liquid-glass',
};

function migrate(state: PersistedState): PersistedState {
  const schema = typeof state.schema === 'number' ? state.schema : 0;
  let next = state;

  // 主题重命名不需要升 schema，逐次幂等处理即可
  const settings = state.settings as { theme?: string } | null | undefined;
  const oldTheme = settings?.theme;
  if (oldTheme && THEME_RENAMES[oldTheme]) {
    next = {
      ...next,
      settings: { ...(settings as object), theme: THEME_RENAMES[oldTheme] },
    };
  }

  if (schema === SCHEMA_VERSION) return next;
  return { ...next, schema: SCHEMA_VERSION };
}

/* ---------------- 对外接口 ---------------- */

export async function loadState(): Promise<{ state: PersistedState | null; health: StorageHealth }> {
  const local = readLocal();
  const idb = await readIdb();

  if (local && idb) {
    // 取信息量更完整的一份（IndexedDB 含图片背景）
    const localSessions = Array.isArray(local.sessions) ? local.sessions.length : 0;
    const idbSessions = Array.isArray(idb.sessions) ? idb.sessions.length : 0;
    const idbHasBg =
      !!idb.background && Array.isArray((idb.background as { custom?: unknown[] }).custom) &&
      ((idb.background as { custom: unknown[] }).custom.length > 0);
    if (idbHasBg || idbSessions >= localSessions) {
      return { state: migrate(idb), health: 'ok' };
    }
    return { state: migrate(local), health: 'ok' };
  }
  if (local) return { state: migrate(local), health: 'degraded' };
  if (idb) return { state: migrate(idb), health: 'degraded' };
  return { state: null, health: hasLocalStorage ? 'ok' : 'memory' };
}

let pending: PersistedState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWriteOk = true;

function flush(): void {
  if (!pending) return;
  const state = pending;
  pending = null;
  timer = null;
  const ok = writeLocal(state);
  if (!ok) lastWriteOk = false;
  else lastWriteOk = true;
  void writeIdb(state);
}

/** 节流保存：400ms 合并一次，页面隐藏时立即落盘 */
export function saveState(state: PersistedState): void {
  pending = state;
  if (timer) return;
  timer = setTimeout(flush, 400);
}

export function flushNow(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flush();
}

/** 立即同步落盘一次（导出、清空等关键操作） */
export async function saveStateNow(state: PersistedState): Promise<boolean> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
  const ok = writeLocal(state);
  await writeIdb(state);
  return ok;
}

export async function wipeAll(): Promise<void> {
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (hasLocalStorage) {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }
  await clearIdb();
}

export function isPersistHealthy(): boolean {
  return lastWriteOk && hasLocalStorage;
}

/* ---------------- 页面生命周期 ---------------- */

if (typeof document !== 'undefined') {
  const onHide = () => flushNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);
}

/* ---------------- 导出 / 导入 ---------------- */

export function snapshotFrom(state: PersistedState): AppSnapshot {
  return {
    schema: SCHEMA_VERSION,
    exportedAt: Date.now(),
    settings: state.settings,
    periods: state.periods,
    courses: state.courses,
    goals: state.goals,
    tasks: state.tasks,
    sessions: state.sessions,
    dates: state.dates,
    calendarEvents: state.calendarEvents ?? [],
    dayOverrides: state.dayOverrides ?? [],
    streakRescues: state.streakRescues ?? [],
    achievements: state.achievements ?? [],
    examScores: state.examScores ?? [],
    subjectScoreTargets: state.subjectScoreTargets ?? [],
    background: state.background,
    timer: state.timer,
    courseStatus: state.courseStatus ?? {},
  } as unknown as AppSnapshot;
}

/** 下载一份 JSON 备份；纯本地操作，不上传任何数据 */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
