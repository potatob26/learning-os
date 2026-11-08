import { create } from 'zustand';
import type {
  AchievementUnlock,
  ActiveTimer,
  BackgroundSettings,
  Course,
  CourseStatus,
  CourseStatusMap,
  CustomBackground,
  ExamScore,
  Goal,
  GoalKind,
  GoalProgress,
  GoalStatus,
  ImportantDate,
  CalendarEvent,
  DayOverride,
  Period,
  Session,
  Settings,
  StreakRescue,
  SubjectScoreTarget,
  Task,
  TimeBlock,
  Weekday,
} from './types';
import type { DaySchedule } from './types';
import { DAY_SCHEDULE_NUMBER_KEYS, DAY_SCHEDULE_TIME_KEYS } from './types';
import { SCHEMA_VERSION } from './types';
import {
  DEFAULT_PERIODS,
  DEFAULT_SETTINGS,
  nextBlockId,
  nextPeriodId,
  sortedPeriods,
} from './defaults';
import { DEFAULT_GLASS_SETTINGS } from './types';
import {
  flushNow,
  loadState,
  saveState,
  saveStateNow,
  wipeAll,
  type PersistedState,
  type StorageHealth,
} from './storage';
// 注意：计时相关的时间一律用 Date.now()（原始时间），不要用 nowExact()。
// 时钟校正是异步的，校准完成时 nowExact() 会整体前跳（等于时钟偏移量），
// 那会让已经在跑的计时器读数凭空多出一大截。时长是差值，本就与偏移无关。
// 详见 hooks/useElapsed.ts 的说明。
import { elapsedMs, dayKey, parseHM, spanMinutes, toWeekday } from './time';
import { computeStreakState, makeStreakRescue } from './streak';
import {
  backfillAchievements,
  normalizeAchievements,
  reconcileAchievements as reconcileAchievementList,
} from './achievements';
import {
  normalizeExamScoreInput,
  sanitizeExamScores,
  sanitizeSubjectTargets,
} from './examScores';
import { uid } from './utils';

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  current: 'scene:aurora',
  mode: 'fixed',
  rotateMinutes: 60,
  enabledIds: ['scene:aurora', 'scene:stars'],
  custom: [],
  dim: 0.35,
  dynamic: true,
  showVeil: true,
  // 手机屏幕上默认关闭：这是纯装饰，且会让背景显得更"技术感"。
  // 想要玻璃折射更明显、背景更有质感的用户可以在设置里打开。
  grid: false,
  // 默认**不**自动接管。
  // 持久化数据会与默认值合并（{...DEFAULT_BACKGROUND, ...saved}），
  // 若这里默认 true，老用户（存档里没有这个字段）切换浅色/深色时
  // 手动调过的 dim 会被系统悄悄覆盖。自动只在**分析过图片之后**才有意义，
  // 因此由上传流程显式置 true。
  dimAuto: false,
};

interface AppState {
  hydrated: boolean;
  storageHealth: StorageHealth;
  saveError: string | null;

  settings: Settings;
  periods: Period[];
  courses: Course[];
  goals: Goal[];
  tasks: Task[];
  sessions: Session[];
  dates: ImportantDate[];
  /**
   * 日历事件。与 ImportantDate 完全独立 ——
   * 后者是倒计时/记天数，前者是日历上按天的标注，两者互不显示。
   */
  calendarEvents: CalendarEvent[];
  /** 按日期覆盖课表（补课 / 手动放假），优先级高于内置节假日表 */
  dayOverrides: DayOverride[];
  background: BackgroundSettings;
  timer: ActiveTimer | null;
  /** 课程完成状态：日期 → 课程 id → 状态 */
  courseStatus: CourseStatusMap;
  /** 火花（连续学习天数）的接回账本：只记录事件，不产生学习记录 */
  streakRescues: StreakRescue[];
  /** 成就解锁账本：只追加、不删除 */
  achievements: AchievementUnlock[];
  /** 考试分数记录（与学习时长完全无关） */
  examScores: ExamScore[];
  /** 各科目标分（按科目存一份长期目标） */
  subjectScoreTargets: SubjectScoreTarget[];

  /* 生命周期 */
  hydrate: () => Promise<void>;
  persist: () => void;
  exportSnapshot: () => PersistedState;
  importSnapshot: (raw: unknown) => { ok: boolean; message: string };
  resetAll: () => Promise<void>;

  /* 设置 */
  patchSettings: (patch: Partial<Settings>) => void;
  /** 按星期几单独覆盖作息（值传空串 = 取消该天的该项覆盖） */
  setDaySchedule: (weekday: Weekday, patch: Partial<DaySchedule>) => void;
  /** 取消某一天的全部覆盖，回到跟随默认 */
  clearDaySchedule: (weekday: Weekday) => void;
  /** 把某一天的作息复制到全部七天 */
  applyDayToAll: (weekday: Weekday) => void;

  /* 作息 */
  addBlock: (b: Omit<TimeBlock, 'id'>) => void;
  updateBlock: (id: string, patch: Partial<TimeBlock>) => void;
  removeBlock: (id: string) => void;

  /* 节次 */
  addPeriod: (p: Omit<Period, 'id'>) => string;
  updatePeriod: (id: string, patch: Partial<Period>) => void;
  removePeriod: (id: string) => void;
  movePeriod: (id: string, dir: -1 | 1) => void;
  resetPeriods: () => void;

  /* 课程 */
  addCourse: (c: Omit<Course, 'id'>) => void;
  updateCourse: (id: string, patch: Partial<Course>) => void;
  removeCourse: (id: string) => void;

  /* 课程完成状态（按日期 + 课程） */
  setCourseStatus: (courseId: string, dateKey: string, status: CourseStatus) => void;
  clearCourseStatus: (courseId: string, dateKey: string) => void;

  /* 目标 */
  addGoal: (g: Partial<Goal> & { title: string }) => string;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  setGoalStatus: (id: string, status: GoalStatus) => void;
  /** 更新成果目标的当前值（计时目标会被忽略） */
  setGoalProgress: (id: string, current: number) => void;
  removeGoal: (id: string) => void;

  /* 任务 */
  addTask: (title: string, goalId?: string | null) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;

  /* 学习记录 */
  addSession: (s: Omit<Session, 'id'>) => void;
  updateSession: (id: string, patch: Partial<Session>) => void;
  removeSession: (id: string) => void;
  manualSession: (input: {
    subject: string;
    goalId?: string | null;
    minutes: number;
    at?: number;
    review?: string;
  }) => void;

  /* 计时器 */
  startTimer: (subject: string, goalId?: string | null, targetMinutes?: number | null) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  cancelTimer: () => void;
  finishTimer: (opts?: { review?: string; focus?: number; discard?: boolean }) => Session | null;
  acknowledgeResume: () => void;

  /* 重要日期 */
  addDate: (d: Omit<ImportantDate, 'id' | 'createdAt'>) => string;
  updateDate: (id: string, patch: Partial<ImportantDate>) => void;
  removeDate: (id: string) => void;
  setPrimaryDate: (id: string) => void;

  /* 日历事件（与重要日期互相独立，见 CalendarEvent 的说明） */
  addCalendarEvent: (e: Omit<CalendarEvent, 'id' | 'createdAt'>) => string;
  updateCalendarEvent: (id: string, patch: Partial<CalendarEvent>) => void;
  removeCalendarEvent: (id: string) => void;
  clearCalendarEventsOn: (date: string) => void;

  /* 按日期覆盖课表（补课 / 放假） */
  setDayOverride: (date: string, schedule: DayOverride['schedule'], note?: string) => void;
  clearDayOverride: (date: string) => void;

  /* 火花（连续学习天数） */
  /**
   * 把「两日修复」的缺口接回。
   * 条件由 computeStreakState 现场重算（不信任 UI 传来的状态）；
   * 只有 phase === 'ready' 且缺口日一致才写入。返回是否成功。
   */
  confirmStreakRescue: (gapDay: string, repairDays: string[]) => boolean;

  /* 成就 */
  /** 把「已达成但账本里没有」的成就补进去（幂等；没有变化不落盘） */
  reconcileAchievements: () => void;

  /* 考试分数（只记录，不计入任何学习时长） */
  addExamScore: (input: {
    subject: string;
    examName: string;
    date: string;
    score: number | null;
    fullScore: number;
    note?: string;
  }) => string | null;
  updateExamScore: (
    id: string,
    patch: {
      subject?: string;
      examName?: string;
      date?: string;
      score?: number | null;
      fullScore?: number;
      note?: string;
    },
  ) => boolean;
  removeExamScore: (id: string) => void;
  setSubjectScoreTarget: (subject: string, targetScore: number, fullScore: number) => boolean;
  removeSubjectScoreTarget: (subject: string) => void;

  /* 背景 */
  patchBackground: (patch: Partial<BackgroundSettings>) => void;
  /** 返回新图的 id：调用方（如「模块背景」上传后自动选用）需要它 */
  addCustomBackground: (bg: Omit<CustomBackground, 'id' | 'createdAt'>) => string;
  removeCustomBackground: (id: string) => void;
  setBackground: (current: string) => void;
}

/* ---------------- 初始化数据 ---------------- */

function seedSettings(): Settings {
  return { ...DEFAULT_SETTINGS, quoteSeed: dayKey(Date.now()) };
}

/**
 * 把持久化数据里的 settings 规范化。
 * 必须对**嵌套对象**做深合并：旧版本存档、手工编辑过的备份、
 * 或只写了部分字段的数据，都会让 `settings.glass` 缺少字段，
 * 从而在读取（例如滑块的 toFixed）时抛异常、整页崩掉。
 */
function normalizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings> & { glass?: Partial<Settings['glass']> };
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    // 嵌套对象逐一合并，缺失字段回落到默认值
    glass: { ...DEFAULT_GLASS_SETTINGS, ...(r.glass ?? {}) },
    blocks: Array.isArray(r.blocks) ? r.blocks : DEFAULT_SETTINGS.blocks,
    // 按星期几的作息覆盖：形状不对就整块丢掉，回落到「全周相同」
    byWeekday: normalizeByWeekday(r.byWeekday),
    // 首页栏目顺序：只接受字符串数组，坏数据回落到默认顺序
    homeOrder: Array.isArray(r.homeOrder) ? r.homeOrder.filter((x) => typeof x === 'string') : null,
    quoteSeed: r.quoteSeed || dayKey(Date.now()),
  };
}

/**
 * 校验「按星期几的作息覆盖」。
 *
 * 为什么必须校验：`settingsForDay` 会把这些值当成时间字符串直接 parse，
 * 坏数据（数字、对象、'abc'）会一路传到计算里。这里只接受
 * `{0..6: {studyFrom: 'HH:mm', …}}` 这一种形状，其余一律丢弃 ——
 * 丢掉的结果就是「这周跟默认」，是安全的降级。
 *
 * 时间字段与数字字段判据不同，所以分开遍历（见 types.ts 的两个键表）。
 */
function normalizeByWeekday(raw: unknown): Settings['byWeekday'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: NonNullable<Settings['byWeekday']> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const wd = Number(k);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const day: DaySchedule = {};
    for (const key of DAY_SCHEDULE_TIME_KEYS) {
      const val = (v as Record<string, unknown>)[key];
      if (typeof val === 'string' && /^\d{1,2}:\d{2}$/.test(val)) day[key] = val;
    }
    for (const key of DAY_SCHEDULE_NUMBER_KEYS) {
      const val = (v as Record<string, unknown>)[key];
      if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 99999) {
        day[key] = Math.round(val);
      }
    }
    if (Object.keys(day).length > 0) out[wd as Weekday] = day;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 归一化「计划时长」——**创建与更新必须走同一套**。
 *
 * 原来两处规则不同：`addGoal` 允许 0，`updateGoal` 把 ≤0 一律改成 30。
 * 同一个值在不同路径下结果不一样；更糟的是后者会把「不限时长」(null) 悄悄改成 30 分钟。
 *
 * 规则：`null` / `undefined` / 非有限数 / ≤0 → `null`（＝不限时长）；否则取整后的正整数。
 */
function normalizePlannedMinutes(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw);
}

/**
 * 校验火花接回账本。
 * 只接受结构正确的记录：坏数据丢条目而不是整包失败（导入是用户主动操作，
 * 不能因为一条脏记录拒绝全部数据）。日期用 yyyy-MM-dd 形状校验；
 * 记录是否**现在仍然成立**由 lib/streak.ts 在每次读取时重算，这里只做形状。
 */
function normalizeStreakRescues(raw: unknown): StreakRescue[] {
  if (!Array.isArray(raw)) return [];
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const seen = new Set<string>();
  const out: StreakRescue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Partial<StreakRescue>;
    if (typeof r.id !== 'string' || !r.id) continue;
    if (typeof r.gapDay !== 'string' || !dateRe.test(r.gapDay)) continue;
    if (seen.has(r.gapDay)) continue;
    if (typeof r.beforeGapDay !== 'string' || !dateRe.test(r.beforeGapDay)) continue;
    const days = Array.isArray(r.repairDays)
      ? r.repairDays.filter((d): d is string => typeof d === 'string' && dateRe.test(d))
      : [];
    if (days.length < 1) continue;
    const restoredFrom = Number.isFinite(r.restoredFrom) ? Math.round(Number(r.restoredFrom)) : 0;
    const rescuedAt = Number.isFinite(r.rescuedAt) ? Number(r.rescuedAt) : Date.now();
    if (r.ruleVersion !== 1) continue;
    seen.add(r.gapDay);
    out.push({
      id: r.id,
      gapDay: r.gapDay,
      beforeGapDay: r.beforeGapDay,
      repairDays: days,
      restoredFrom,
      rescuedAt,
      ruleVersion: 1,
    });
  }
  // 按时间升序，最多留 200 条（一天只能救一次，200 条足够覆盖几年）
  return out.sort((a, b) => a.rescuedAt - b.rescuedAt).slice(-200);
}

/* ---------------- 课程时长 ---------------- */

export function courseMinutes(course: Course, periods: Period[]): number {
  const p = course.periodId ? periods.find((x) => x.id === course.periodId) : null;
  const start = course.start ?? p?.start;
  const end = course.end ?? p?.end;
  const s = parseHM(start);
  const e = parseHM(end);
  if (s === null || e === null) return 0;
  return spanMinutes(s, e);
}

/* ---------------- Store ---------------- */

/**
 * 成果目标进度的兜底与净化。
 *
 * 存档可能来自旧版本、手改的 JSON、或导入的备份，所以这里不信任任何字段：
 *   · 非数字 / NaN / Infinity 一律替换成安全值
 *   · current 缺省取 start（于是进度从 0% 开始，而不是 0/0 = NaN）
 *   · 目标值等于起始值时跨度为 0，进度无意义且会除零 —— 推开 1
 * 宁可把数据修正成合法值，也不要让 NaN 落进存档、再污染进度条与统计。
 */
function normalizeProgress(p?: GoalProgress | null): GoalProgress | null {
  if (!p) return null;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const start = num(p.start, 0);
  const current = num(p.current, start);
  const target = num(p.target, start + 1);
  return {
    start,
    current,
    target: target === start ? start + 1 : target,
    unit: p.unit?.trim() || undefined,
  };
}

export const useStore = create<AppState>((set, get) => {
  /** 统一的保存触发 */
  const commit = () => {
    const s = get();
    if (!s.hydrated) return;
    saveState({
      schema: SCHEMA_VERSION,
      settings: s.settings,
      periods: s.periods,
      courses: s.courses,
      goals: s.goals,
      tasks: s.tasks,
      sessions: s.sessions,
      dates: s.dates,
      /*
       * ⚠️ 这个 commit 是**实际落盘**的那条路径，
       * 与 exportSnapshot 是两处独立的字段清单 —— 加新字段时**两处都要改**。
       * 实测踩过：calendarEvents 只加进了 exportSnapshot，忘了这里，
       * 结果是事件写进内存、界面也显示，但刷新后就没了。
       * 由 scripts/test-calendar.mjs 分别断言 store 与 localStorage 才发现。
       */
      calendarEvents: s.calendarEvents,
      dayOverrides: s.dayOverrides,
      // 火花接回账本：只记录事件，不生成学习记录
      streakRescues: s.streakRescues,
      // 成就解锁账本：只追加、不删除
      achievements: s.achievements,
      examScores: s.examScores,
      subjectScoreTargets: s.subjectScoreTargets,
      background: s.background,
      timer: s.timer,
      courseStatus: s.courseStatus,
    });
  };

  return {
    hydrated: false,
    storageHealth: 'ok',
    saveError: null,

    settings: seedSettings(),
    periods: DEFAULT_PERIODS,
    courses: [],
    goals: [],
    tasks: [],
    sessions: [],
    dates: [],
    calendarEvents: [],
    dayOverrides: [],
    background: DEFAULT_BACKGROUND,
    timer: null,
    courseStatus: {},
    streakRescues: [],
    achievements: [],
    examScores: [],
    subjectScoreTargets: [],

    /* ---------------- 生命周期 ---------------- */

    hydrate: async () => {
      const { state, health } = await loadState();
      if (!state) {
        set({ hydrated: true, storageHealth: health });
        return;
      }
      const s = state as Partial<PersistedState>;
      const settings = normalizeSettings(s.settings);

      let timer = (s.timer as ActiveTimer | null) ?? null;
      if (timer) {
        // 崩溃 / 关机 / 刷新恢复：基于真实时间戳继续，不丢时间也不假造时间
        if (timer.phase === 'running' || timer.phase === 'paused') {
          timer = { ...timer, autoResumed: true };
        } else {
          timer = null;
        }
      }

      const sessions = (s.sessions as Session[]) ?? [];
      const goals = (s.goals as Goal[]) ?? [];
      const streakRescues = normalizeStreakRescues(s.streakRescues);
      const examScores = sanitizeExamScores(s.examScores);
      const subjectScoreTargets = sanitizeSubjectTargets(s.subjectScoreTargets);
      /*
       * 成就：账本为空时按现有记录补记（首次升级 / 清空后重新长出数据）。
       * 补记统一标 backfilled，并且不弹「刚刚解锁」——那些成就是过去的事。
       */
      const storedAchievements = normalizeAchievements(s.achievements);
      const achievements =
        storedAchievements.length > 0
          ? storedAchievements
          : backfillAchievements(sessions, goals, streakRescues, Date.now());

      set({
        hydrated: true,
        storageHealth: health,
        settings,
        periods: (s.periods as Period[])?.length ? (s.periods as Period[]) : DEFAULT_PERIODS,
        courses: (s.courses as Course[]) ?? [],
        goals,
        tasks: (s.tasks as Task[]) ?? [],
        sessions,
        dates: (s.dates as ImportantDate[]) ?? [],
        calendarEvents: (s.calendarEvents as CalendarEvent[]) ?? [],
        dayOverrides: (s.dayOverrides as DayOverride[]) ?? [],
        streakRescues,
        achievements,
        examScores,
        subjectScoreTargets,
        background: { ...DEFAULT_BACKGROUND, ...((s.background as Partial<BackgroundSettings>) ?? {}) },
        timer,
        courseStatus: (s.courseStatus as CourseStatusMap) ?? {},
      });

      /*
       * 补记了成就就立刻落盘：hydrate 本身不 commit，若等下一次用户操作，
       * 旧备份里的成就会「这次看到、刷新又没了」。只在新补记时写，避免无谓 IO。
       */
      if (storedAchievements.length === 0 && achievements.length > 0) commit();
    },

    persist: () => commit(),

    exportSnapshot: () => {
      const s = get();
      return {
        schema: SCHEMA_VERSION,
        settings: s.settings,
        periods: s.periods,
        courses: s.courses,
        goals: s.goals,
        tasks: s.tasks,
        sessions: s.sessions,
        dates: s.dates,
        calendarEvents: s.calendarEvents,
        dayOverrides: s.dayOverrides,
        streakRescues: s.streakRescues,
        achievements: s.achievements,
        examScores: s.examScores,
        subjectScoreTargets: s.subjectScoreTargets,
        background: s.background,
        timer: s.timer,
        courseStatus: s.courseStatus,
      };
    },

    importSnapshot: (raw) => {
      try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (typeof obj !== 'object' || obj === null) return { ok: false, message: '文件内容不是一个对象' };
        const o = obj as Partial<PersistedState>;
        if (!Array.isArray(o.sessions) && !Array.isArray(o.goals) && !o.settings) {
          return { ok: false, message: '这不像是学习 OS 的备份文件' };
        }
        const sessions = (o.sessions as Session[]) ?? [];
        const goals = (o.goals as Goal[]) ?? [];
        const streakRescues = normalizeStreakRescues(o.streakRescues);
        const examScores = sanitizeExamScores(o.examScores);
        const subjectScoreTargets = sanitizeSubjectTargets(o.subjectScoreTargets);
        // 导入旧备份：没有成就账本时按导入的数据补记（不拿「现在」冒充历史时刻）
        const storedAchievements = normalizeAchievements(o.achievements);
        const achievements =
          storedAchievements.length > 0
            ? storedAchievements
            : backfillAchievements(sessions, goals, streakRescues, Date.now());
        set({
          settings: normalizeSettings(o.settings),
          periods: (o.periods as Period[])?.length ? (o.periods as Period[]) : DEFAULT_PERIODS,
          courses: (o.courses as Course[]) ?? [],
          goals,
          tasks: (o.tasks as Task[]) ?? [],
          sessions,
          dates: (o.dates as ImportantDate[]) ?? [],
          // 日历事件是后加的字段：导入旧备份时缺省为空数组，不影响原有数据
          calendarEvents: (o.calendarEvents as CalendarEvent[]) ?? [],
          dayOverrides: (o.dayOverrides as DayOverride[]) ?? [],
          // 旧备份没有接回账本 → 空数组；这里必须显式覆盖，
          // 否则「导入 A 备份」会带着当前内存里 B 的账本（importSnapshot 不经过 migrate）
          streakRescues,
          achievements,
          examScores,
          subjectScoreTargets,
          background: { ...DEFAULT_BACKGROUND, ...((o.background as Partial<BackgroundSettings>) ?? {}) },
          timer: null,
          courseStatus: (o.courseStatus as CourseStatusMap) ?? {},
        });
        void saveStateNow(get().exportSnapshot());
        return { ok: true, message: '导入完成' };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : '解析失败' };
      }
    },

    resetAll: async () => {
      flushNow();
      await wipeAll();
      set({
        settings: seedSettings(),
        periods: DEFAULT_PERIODS,
        courses: [],
        goals: [],
        tasks: [],
        sessions: [],
        dates: [],
        calendarEvents: [],
        dayOverrides: [],
        streakRescues: [],
        achievements: [],
        examScores: [],
        subjectScoreTargets: [],
        background: { ...DEFAULT_BACKGROUND },
        timer: null,
        courseStatus: {},
        saveError: null,
      });
      void saveStateNow(get().exportSnapshot());
    },

    /* ---------------- 设置 ---------------- */

    patchSettings: (patch) => {
      /*
       * 这里原来还会在切到液态玻璃时记一个 previousTheme，
       * 供设置里那个「液态玻璃主题」开关关闭时还原。那个开关已删除
       * （主题网格里本来就能直接选），previousTheme 没人再读，所以一并去掉。
       */
      set((s) => ({ settings: { ...s.settings, ...patch } }));
      commit();
    },

    /*
     * 按星期几单独覆盖作息。
     * 只写传进来的字段，其余继续跟随全局默认 —— 所以「只改周六的窗口」
     * 不会把这天的上学/睡觉也一起钉住。
     * 时间字段传空串、数字字段传 undefined/null 表示**取消这一天的该项覆盖**（回到跟随默认）。
     *
     * 两组键分开遍历：`day[key] = v` 在 `keyof DaySchedule` 这种联合键下
     * TypeScript 会拒绝（要求值是所有可能属性类型的交集），而且分开写也更清楚
     * —— 时间要判空串、数字要判有限非负。
     */
    setDaySchedule: (weekday, patch) => {
      set((s) => {
        const day: DaySchedule = { ...(s.settings.byWeekday?.[weekday] ?? {}) };
        /*
         * ⚠️ 必须先用 `in` 判断「这次到底传了哪些字段」。
         * 这里原来是无条件遍历全部字段，于是 `patch` 只带 `studyTo` 时，
         * `patch['studyFrom']` 是 undefined → 走进 delete 分支 → **把已有的 studyFrom 删掉** ✗
         * 症状很隐蔽：单改「结束」会把「开始」打回全局默认值
         * （实测 18:00–20:30 变成 09:00–20:30，可支配从 150 分钟变 690 分钟）。
         * 被既有的 test-schedule-per-day 抓住。
         */
        for (const key of DAY_SCHEDULE_TIME_KEYS) {
          if (!(key in patch)) continue;
          const v = patch[key];
          if (v === undefined || v === null || v === '') delete day[key];
          else day[key] = v;
        }
        for (const key of DAY_SCHEDULE_NUMBER_KEYS) {
          if (!(key in patch)) continue;
          const v = patch[key];
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) day[key] = Math.round(v);
          else delete day[key];
        }
        const byWeekday = { ...(s.settings.byWeekday ?? {}) };
        // 这一天一个覆盖都不剩就整个删掉，免得存档里堆一堆空对象
        if (Object.keys(day).length === 0) delete byWeekday[weekday];
        else byWeekday[weekday] = day;
        return { settings: { ...s.settings, byWeekday } };
      });
      commit();
    },
    clearDaySchedule: (weekday) => {
      set((s) => {
        const byWeekday = { ...(s.settings.byWeekday ?? {}) };
        delete byWeekday[weekday];
        return { settings: { ...s.settings, byWeekday } };
      });
      commit();
    },
    /* 把某一天的作息应用到全部七天（用来把「每天都一样」一次设好） */
    applyDayToAll: (weekday) => {
      set((s) => {
        const day = s.settings.byWeekday?.[weekday];
        if (!day) return {};
        const byWeekday: NonNullable<Settings['byWeekday']> = {};
        for (let d = 0; d < 7; d++) byWeekday[d as Weekday] = { ...day };
        return { settings: { ...s.settings, byWeekday } };
      });
      commit();
    },

    /* ---------------- 作息 ---------------- */

    addBlock: (b) => {
      set((s) => ({ settings: { ...s.settings, blocks: [...s.settings.blocks, { ...b, id: nextBlockId() }] } }));
      commit();
    },
    updateBlock: (id, patch) => {
      set((s) => ({
        settings: {
          ...s.settings,
          blocks: s.settings.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        },
      }));
      commit();
    },
    removeBlock: (id) => {
      set((s) => ({ settings: { ...s.settings, blocks: s.settings.blocks.filter((b) => b.id !== id) } }));
      commit();
    },

    /* ---------------- 节次 ---------------- */

    addPeriod: (p) => {
      const id = nextPeriodId();
      set((s) => ({ periods: sortedPeriods([...s.periods, { ...p, id }]) }));
      commit();
      return id;
    },
    updatePeriod: (id, patch) => {
      set((s) => ({
        periods: sortedPeriods(s.periods.map((p) => (p.id === id ? { ...p, ...patch } : p))),
      }));
      commit();
    },
    removePeriod: (id) => {
      set((s) => ({
        periods: s.periods.filter((p) => p.id !== id),
        // 引用该节次的课程改为「无节次」，不静默删课
        courses: s.courses.map((c) => (c.periodId === id ? { ...c, periodId: null } : c)),
      }));
      commit();
    },
    movePeriod: (id, dir) => {
      set((s) => {
        const list = sortedPeriods(s.periods);
        const i = list.findIndex((p) => p.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return s;
        // 交换二者时间，从而交换顺序
        const a = list[i];
        const b = list[j];
        const swapped = new Map<string, { start: string; end: string }>([
          [a.id, { start: b.start, end: b.end }],
          [b.id, { start: a.start, end: a.end }],
        ]);
        return {
          periods: list.map((p) => {
            const sw = swapped.get(p.id);
            return sw ? { ...p, ...sw } : p;
          }),
        };
      });
      commit();
    },
    resetPeriods: () => {
      set({ periods: DEFAULT_PERIODS });
      commit();
    },

    /* ---------------- 课程 ---------------- */

    addCourse: (c) => {
      set((s) => ({ courses: [...s.courses, { ...c, id: uid('c') }] }));
      commit();
    },
    updateCourse: (id, patch) => {
      set((s) => ({ courses: s.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
      commit();
    },
    removeCourse: (id) => {
      set((s) => ({
        courses: s.courses.filter((c) => c.id !== id),
      }));
      commit();
    },

    /* ---------------- 课程完成状态 ---------------- */

    setCourseStatus: (courseId, dateKey, status) => {
      set((s) => {
        const forDay = { ...(s.courseStatus[dateKey] ?? {}) };
        forDay[courseId] = status;
        return { courseStatus: { ...s.courseStatus, [dateKey]: forDay } };
      });
      commit();
    },

    clearCourseStatus: (courseId, dateKey) => {
      set((s) => {
        const forDay = { ...(s.courseStatus[dateKey] ?? {}) };
        delete forDay[courseId];
        const next = { ...s.courseStatus };
        if (Object.keys(forDay).length === 0) delete next[dateKey];
        else next[dateKey] = forDay;
        return { courseStatus: next };
      });
      commit();
    },

    /* ---------------- 目标 ---------------- */

    addGoal: (g) => {
      const id = uid('g');
      const kind: GoalKind = g.kind === 'outcome' ? 'outcome' : 'time';
      const outcome = kind === 'outcome';
      const goal: Goal = {
        id,
        title: g.title.trim() || '未命名目标',
        subject: g.subject?.trim() || '其他',
        description: g.description,
        // 成果目标没有时间预算：计划与实际时长都钉成 0。
        // 这样它会**自然**被排除在所有时长统计之外（求和加 0、除法有 >0 守卫），
        // 不需要在每个统计点都补一个 if (isOutcome)。
        // 计时目标则统一走 normalizePlannedMinutes：0/负数/缺省 → null（＝不限时长）。
        plannedMinutes: outcome ? 0 : normalizePlannedMinutes(g.plannedMinutes),
        actualMinutes: 0,
        dueAt: g.dueAt ?? null,
        priority: g.priority ?? 'normal',
        status: g.status ?? 'todo',
        createdAt: g.createdAt ?? Date.now(),
        completedAt: null,
        kind,
        progress: outcome ? normalizeProgress(g.progress) : null,
      };
      set((s) => ({ goals: [goal, ...s.goals] }));
      commit();
      return id;
    },
    updateGoal: (id, patch) => {
      set((s) => ({
        goals: s.goals.map((g) => {
          if (g.id !== id) return g;
          const next: Goal = { ...g, ...patch };
          if (next.kind === 'outcome') {
            next.kind = 'outcome';
            next.plannedMinutes = 0;
            next.actualMinutes = 0;
            next.progress = normalizeProgress(next.progress ?? g.progress);
          } else {
            /*
             * 从成果目标改回计时目标、或本来就是计时目标：计划时长统一归一化。
             *
             * 原来这里写的是「≤0 就改成 30」，有两个后果：
             *   ① 与 addGoal 的规则不一致（那边允许 0），同一个值在不同路径下结果不同；
             *   ② **「不限时长」(null) 会被悄悄改成 30 分钟** —— 用户设的不限时长
             *      一编辑就变成"计划 30 分钟"，而界面上还说是不限，属于最坏的一类 bug。
             */
            next.kind = 'time';
            next.progress = null;
            next.plannedMinutes = normalizePlannedMinutes(next.plannedMinutes);
          }
          return next;
        }),
      }));
      commit();
    },
    setGoalProgress: (id, current) => {
      set((s) => ({
        goals: s.goals.map((g) => {
          if (g.id !== id || g.kind !== 'outcome' || !g.progress) return g;
          const c = Number.isFinite(current) ? current : g.progress.current;
          return { ...g, progress: { ...g.progress, current: c } };
        }),
      }));
      commit();
    },
    setGoalStatus: (id, status) => {
      set((s) => ({
        goals: s.goals.map((g) =>
          g.id === id
            ? {
                ...g,
                status,
                completedAt: status === 'done' ? (g.completedAt ?? Date.now()) : null,
              }
            : g,
        ),
      }));
      commit();
    },
    removeGoal: (id) => {
      set((s) => ({
        goals: s.goals.filter((g) => g.id !== id),
        tasks: s.tasks.map((t) => (t.goalId === id ? { ...t, goalId: null } : t)),
        sessions: s.sessions.map((x) => (x.goalId === id ? { ...x, goalId: null } : x)),
      }));
      commit();
    },

    /* ---------------- 任务 ---------------- */

    addTask: (title, goalId = null) => {
      const t: Task = { id: uid('t'), title: title.trim(), goalId, done: false, createdAt: Date.now() };
      if (!t.title) return;
      set((s) => ({ tasks: [t, ...s.tasks] }));
      commit();
    },
    toggleTask: (id) => {
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : null } : t,
        ),
      }));
      commit();
    },
    removeTask: (id) => {
      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
      commit();
    },

    /* ---------------- 学习记录 ---------------- */

    addSession: (sess) => {
      const s: Session = { ...sess, id: uid('s') };
      set((st) => ({ sessions: [s, ...st.sessions] }));
      commit();
    },
    updateSession: (id, patch) => {
      set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      commit();
    },
    removeSession: (id) => {
      set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
      commit();
    },
    manualSession: ({ subject, goalId = null, minutes, at, review }) => {
      const end = at ?? Date.now();
      const dur = Math.max(60, Math.round(minutes * 60));
      const sess: Session = {
        id: uid('s'),
        subject,
        goalId,
        startedAt: end - dur * 1000,
        endedAt: end,
        durationSec: dur,
        review,
        source: 'manual',
      };
      set((s) => ({
        sessions: [sess, ...s.sessions],
        goals: goalId
          ? s.goals.map((g) => (g.id === goalId ? { ...g, actualMinutes: g.actualMinutes + minutes } : g))
          : s.goals,
      }));
      commit();
    },

    /* ---------------- 计时器 ---------------- */

    startTimer: (subject, goalId = null, targetMinutes = null) => {
      const existing = get().timer;
      if (existing && (existing.phase === 'running' || existing.phase === 'paused')) {
        // 不静默丢弃正在进行的计时，交给 UI 先结算
        return;
      }
      const t: ActiveTimer = {
        id: uid('tm'),
        subject,
        goalId,
        // 用原始时间而不是 nowExact()：时长必须与时钟校准解耦。
        // 校时是异步的，若这里用校准时间，校时完成后 nowExact() 会整体前跳，
        // 读数会凭空多出整个偏移量（实测本机慢 60 秒时直接显示 01:05）。
        // 「开始于」这类墙上时间在显示时再换算即可。
        startedAt: Date.now(),
        pausedMs: 0,
        pausedAt: null,
        targetMinutes: targetMinutes ?? null,
        phase: 'running',
      };
      set({ timer: t });
      commit();
    },

    pauseTimer: () => {
      const t = get().timer;
      if (!t || t.phase !== 'running') return;
      // 同上：暂停时刻也用原始时间，保证 (now - startedAt - pausedMs) 自洽
      set({ timer: { ...t, phase: 'paused', pausedAt: Date.now() } });
      commit();
    },

    resumeTimer: () => {
      const t = get().timer;
      if (!t || t.phase !== 'paused' || t.pausedAt === null) return;
      const extra = Math.max(0, Date.now() - t.pausedAt);
      set({
        timer: {
          ...t,
          phase: 'running',
          pausedAt: null,
          pausedMs: t.pausedMs + extra,
          autoResumed: false,
        },
      });
      commit();
    },

    cancelTimer: () => {
      set({ timer: null });
      commit();
    },

    acknowledgeResume: () => {
      const t = get().timer;
      if (!t) return;
      set({ timer: { ...t, autoResumed: false } });
      commit();
    },

    finishTimer: (opts) => {
      const t = get().timer;
      if (!t) return null;
      const endTs = Date.now();
      const ms = elapsedMs(t, endTs);
      set({ timer: null });

      if (opts?.discard || ms < 1000) {
        commit();
        return null;
      }

      const durationSec = Math.max(1, Math.round(ms / 1000));
      const sess: Session = {
        id: uid('s'),
        subject: t.subject,
        goalId: t.goalId ?? null,
        startedAt: Math.round(endTs - ms),
        endedAt: endTs,
        durationSec,
        review: opts?.review,
        focus: opts?.focus,
        source: 'timer',
      };

      set((s) => ({
        sessions: [sess, ...s.sessions],
        // 目标实际用时按秒累计，避免短时间学习被四舍五入成 0 而丢失
        goals: t.goalId
          ? s.goals.map((g) =>
              g.id === t.goalId ? { ...g, actualMinutes: g.actualMinutes + durationSec / 60 } : g,
            )
          : s.goals,
      }));
      commit();
      return sess;
    },

    /* ---------------- 重要日期 ---------------- */

    addDate: (d) => {
      const id = uid('d');
      const item: ImportantDate = { ...d, id, createdAt: Date.now() };
      set((s) => ({
        dates: [...s.dates, item],
        // 第一个添加的自动成为主倒计时
        ...(s.dates.some((x) => x.primary) ? {} : {}),
      }));
      commit();
      return id;
    },
    updateDate: (id, patch) => {
      set((s) => ({
        dates: s.dates.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      }));
      commit();
    },
    removeDate: (id) => {
      set((s) => ({ dates: s.dates.filter((d) => d.id !== id) }));
      commit();
    },
    setPrimaryDate: (id) => {
      set((s) => ({ dates: s.dates.map((d) => ({ ...d, primary: d.id === id })) }));
      commit();
    },

    /* ---------------- 日历事件 ---------------- */

    addCalendarEvent: (e) => {
      const id = uid('ce');
      const item: CalendarEvent = { ...e, id, createdAt: Date.now() };
      set((s) => ({ calendarEvents: [...s.calendarEvents, item] }));
      commit();
      return id;
    },
    updateCalendarEvent: (id, patch) => {
      set((s) => ({
        calendarEvents: s.calendarEvents.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      }));
      commit();
    },
    removeCalendarEvent: (id) => {
      set((s) => ({ calendarEvents: s.calendarEvents.filter((e) => e.id !== id) }));
      commit();
    },
    clearCalendarEventsOn: (date) => {
      set((s) => ({ calendarEvents: s.calendarEvents.filter((e) => e.date !== date) }));
      commit();
    },

    /* ---------------- 按日期覆盖课表 ---------------- */

    setDayOverride: (date, schedule, note) => {
      set((s) => {
        const rest = s.dayOverrides.filter((o) => o.date !== date);
        // 'auto' 语义等价于「没有覆盖」，所以不落记录，直接删掉
        if (schedule === ('auto' as never)) return { dayOverrides: rest };
        return { dayOverrides: [...rest, { date, schedule, note }] };
      });
      commit();
    },
    clearDayOverride: (date) => {
      set((s) => ({ dayOverrides: s.dayOverrides.filter((o) => o.date !== date) }));
      commit();
    },

    /* ---------------- 火花（连续学习天数） ---------------- */

    confirmStreakRescue: (gapDay, repairDays) => {
      const s = get();
      const now = Date.now();
      // UI 传来的补学日只是佐证；真正写进账本的是下面重算出来的那两天
      if (!Array.isArray(repairDays) || repairDays.length < 2) return false;
      // 不信任 UI 传来的状态：按当前 sessions + 账本重新算一遍
      const state = computeStreakState(s.sessions, s.streakRescues, now);
      if (state.phase !== 'ready' || state.gapDay !== gapDay) return false;
      const item = makeStreakRescue(state, uid('sr'), now);
      if (!item) return false;
      set({ streakRescues: normalizeStreakRescues([...s.streakRescues, item]) });
      commit();
      return true;
    },

    /* ---------------- 成就 ---------------- */

    reconcileAchievements: () => {
      const s = get();
      const next = reconcileAchievementList(
        s.achievements,
        s.sessions,
        s.goals,
        s.streakRescues,
        Date.now(),
        'live',
      );
      if (next === s.achievements) return; // 幂等：没有新增就不落盘
      set({ achievements: next });
      commit();
    },

    /* ---------------- 考试分数 ---------------- */

    addExamScore: (input) => {
      const normalized = normalizeExamScoreInput(input);
      if (!normalized) return null;
      const item: ExamScore = { ...normalized, id: uid('ex'), createdAt: Date.now() };
      set((s) => ({ examScores: sanitizeExamScores([...s.examScores, item]) }));
      commit();
      return item.id;
    },
    updateExamScore: (id, patch) => {
      const s = get();
      const prev = s.examScores.find((e) => e.id === id);
      if (!prev) return false;
      const merged = {
        subject: patch.subject ?? prev.subject,
        examName: patch.examName ?? prev.examName,
        date: patch.date ?? prev.date,
        score: patch.score !== undefined ? patch.score : prev.score,
        fullScore: patch.fullScore ?? prev.fullScore,
        note: patch.note !== undefined ? patch.note : prev.note,
      };
      const normalized = normalizeExamScoreInput(merged);
      if (!normalized) return false;
      const next: ExamScore = { ...prev, ...normalized, id, createdAt: prev.createdAt };
      set({ examScores: sanitizeExamScores(s.examScores.map((e) => (e.id === id ? next : e))) });
      commit();
      return true;
    },
    removeExamScore: (id) => {
      // 只删成绩记录：绝不触碰 sessions / goals（成绩与学习时长是两套口径）
      set((s) => ({ examScores: s.examScores.filter((e) => e.id !== id) }));
      commit();
    },
    setSubjectScoreTarget: (subject, targetScore, fullScore) => {
      const sub = subject.trim();
      const full = Number(fullScore);
      const target = Number(targetScore);
      if (!sub || !Number.isFinite(full) || full <= 0 || full > 1000) return false;
      if (!Number.isFinite(target) || target < 0 || target > full) return false;
      const next: SubjectScoreTarget = {
        subject: sub,
        targetScore: target,
        fullScore: full,
        updatedAt: Date.now(),
      };
      set((s) => ({
        subjectScoreTargets: sanitizeSubjectTargets([
          ...s.subjectScoreTargets.filter((t) => t.subject !== sub),
          next,
        ]),
      }));
      commit();
      return true;
    },
    removeSubjectScoreTarget: (subject) => {
      set((s) => ({ subjectScoreTargets: s.subjectScoreTargets.filter((t) => t.subject !== subject) }));
      commit();
    },

    /* ---------------- 背景 ---------------- */

    patchBackground: (patch) => {
      set((s) => ({ background: { ...s.background, ...patch } }));
      commit();
    },
    addCustomBackground: (bg) => {
      const item: CustomBackground = { ...bg, id: uid('bg'), createdAt: Date.now() };
      set((s) => ({ background: { ...s.background, custom: [...s.background.custom, item] } }));
      commit();
      return item.id;
    },
    removeCustomBackground: (id) => {
      set((s) => {
        const custom = s.background.custom.filter((b) => b.id !== id);
        const current = s.background.current === `img:${id}` ? 'scene:aurora' : s.background.current;
        return { background: { ...s.background, custom, current } };
      });
      commit();
    },
    setBackground: (current) => {
      set((s) => ({ background: { ...s.background, current } }));
      commit();
    },
  };
});

/* ---------------- 派生工具 ---------------- */

export function useWeekday(): Weekday {
  return toWeekday(new Date().getDay());
}

/** 计时器真实经过毫秒（供 UI 调用，非响应式） */
export function timerElapsedMs(t: ActiveTimer | null, nowTs: number): number {
  if (!t) return 0;
  return elapsedMs(t, nowTs);
}

/** 某天某科目的上课分钟数 */
export function classMinutesForDay(courses: Course[], periods: Period[], weekday: Weekday): {
  startMin: number;
  endMin: number;
}[] {
  const pMap = new Map(periods.map((p) => [p.id, p]));
  const out: { startMin: number; endMin: number }[] = [];
  for (const c of courses) {
    if (c.weekday !== weekday) continue;
    const p = c.periodId ? pMap.get(c.periodId) : null;
    const start = c.start ?? p?.start;
    const end = c.end ?? p?.end;
    const s = parseHM(start);
    const e = parseHM(end);
    if (s === null || e === null) continue;
    out.push({ startMin: s, endMin: e });
  }
  return out;
}
