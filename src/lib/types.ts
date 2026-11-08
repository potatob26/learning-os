/**
 * 学习 OS — 领域模型
 * 所有数据结构在这里集中定义，UI 与存储层共用。
 * 周一 = 0 … 周日 = 6（符合中国学生作息习惯）
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
export const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const;

/* ---------------- 设置 ---------------- */

/**
 * 主题 = 材质 + 配色 + 背景性格。
 * 每个主题全权决定卡片用什么材质，避免「主题」与「材质」两个维度互相打架。
 *
 *  mica         云母：模糊 + 内侧高光，无折射。最省电，作为默认
 *  liquid-glass 磨砂玻璃：均匀霜化 + 环境色透入（位移/色散已按用户要求归零）
 *  pure-light   极简白
 *  pure-dark    极简黑
 *  soft         柔和浅色
 *  immersive    沉浸式
 */
/**
 * 主题。
 * 注意 'mica' 已从可选主题中移除：它与磨砂玻璃定位重叠，
 * 而玻璃材质本身仍保留 mica 档作为**降级材质**（见 lib/material.ts），
 * 那是实现细节，不再作为用户可选项出现。
 *
 * 名字方向以 lib/material.ts 顶部那张词汇表为**唯一权威**：
 *   透明玻璃 = liquid-glass-wc（refract）· 磨砂玻璃 = liquid-glass（liquid）
 */
export type ThemeId =
  /** 磨砂玻璃：liquid 档（liquid-glass-react），2026-10 磨砂化后位移归零，只剩均匀霜化 */
  | 'liquid-glass'
  /** 透明玻璃：WebGL 逐像素采样背景做真实折射（vendor/liquid-glass.js） */
  | 'liquid-glass-wc'
  | 'pure-light'
  | 'pure-dark'
  | 'soft'
  | 'immersive';

/**
 * 只有深色变体、不随「浅色/深色」切换的主题。
 *
 * 背景画布的明暗原本只看 settings.colorMode，于是出现真实缺陷：
 * 选「极简黑」+ 明暗设为「浅色」时，背景被画成浅色，
 * 而主题把 --text 固定成近白色 —— 白字压浅背景，几乎看不见。
 * 实测已复现（白字 + 浅灰背景）。
 * 因此背景明暗必须同时考虑主题本身的固有色。
 */
export const DARK_ONLY_THEMES: ThemeId[] = ['pure-dark', 'liquid-glass-wc'];
export type ColorMode = 'light' | 'dark' | 'system';
export type PerfLevel = 'high' | 'balanced' | 'saver';
export type BackgroundMode = 'fixed' | 'random' | 'daily' | 'each-open';
export type AlignMode = 'left' | 'center';

/** 固定活动类型：吃饭 / 补课 / 运动 / 通勤 … */
export type BlockKind = 'meal' | 'commute' | 'tutor' | 'sport' | 'hobby' | 'chore' | 'rest' | 'other';

export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  meal: '吃饭',
  commute: '通勤',
  tutor: '补课',
  sport: '运动',
  hobby: '兴趣活动',
  chore: '家务',
  rest: '休息',
  other: '其他',
};

export interface TimeBlock {
  id: string;
  label: string;
  kind: BlockKind;
  start: string; // 'HH:mm'
  end: string; // 'HH:mm'
  /** 适用的星期；null / 空 = 每天 */
  weekdays?: Weekday[] | null;
}

/* ---------------- 课程完成状态 ---------------- */

/**
 * 课程状态。
 * 注意：课程表是**每周重复**的，所以状态不能直接挂在 Course 上 ——
 * 否则今天给「周一第 1 节数学」标了请假，以后每一周的周一都会是请假。
 * 因此状态按「日期 + 课程 id」记录（见 CourseStatusMap），
 * Course 本身只描述「每周几、第几节、什么课」。
 */
export type CourseStatus = 'unconfirmed' | 'attended' | 'leave' | 'rescheduled';

export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = {
  unconfirmed: '未确认',
  attended: '已上完',
  leave: '请假',
  rescheduled: '调课',
};

/** 哪些状态表示「这节课没有占用你的时间」 */
export const CANCELLED_STATUSES: CourseStatus[] = ['leave', 'rescheduled'];

export function isCancelled(status: CourseStatus): boolean {
  return status === 'leave' || status === 'rescheduled';
}

/** 日期(yyyy-MM-dd) → 课程 id → 状态 */
export type CourseStatusMap = Record<string, Record<string, CourseStatus>>;

/* ---------------- 课程表 ---------------- */

export interface Period {
  id: string;
  name: string; // 第一节 / 晚自习 1
  start: string; // 'HH:mm'
  end: string; // 'HH:mm'
  /** 是否计入「上课占用时间」 */
  counts: boolean;
}

export interface Course {
  id: string;
  /** 科目名，同时也是统计分组依据 */
  subject: string;
  title: string;
  weekday: Weekday;
  periodId: string | null; // null = 自定义时间的课程
  start?: string; // 覆盖节次时间
  end?: string;
  location?: string;
  teacher?: string;
  color?: string; // 科目可自定义色; 未设则用主题调色板
  note?: string;
}

/* ---------------- 目标 / 任务 ---------------- */

export type GoalStatus = 'todo' | 'doing' | 'done' | 'dropped';
export type Priority = 'low' | 'normal' | 'high';

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: '低',
  normal: '普通',
  high: '重要',
};

/**
 * 目标类型。
 *
 * · `'time'`    —— 计时目标：有时间预算（计划 X 分钟），进度 = 实际 / 计划
 * · `'outcome'` —— 成果目标：**没有时间维度**，只有一个数值进度
 *
 * 为什么需要成果目标：「期中到达班级多少名」这类事没法定「学多久」——
 * 强行填一个计划时长，那个数字是编的，进度条也是假的。
 *
 * 旧数据缺省视为 `'time'`，保证已有目标的行为一字不变。
 */
export type GoalKind = 'time' | 'outcome';

/**
 * 成果目标的数值进度。
 *
 * 只存「起始 / 当前 / 目标」三个数，**方向自动推导**：
 *   target < start → 越小越好（班级名次）
 *   target > start → 越大越好（刷完的卷子套数）
 * 表单里因此只需要输「当前值」和「目标值」，不必再选一个
 * 「越大越好 / 越小越好」开关 —— 少一个选错的机会。
 *
 * `start` 在创建时自动取当时的 `current`，所以进度天然从 0% 开始，
 * 而不是像 `current / target` 那样一建出来就显示 40%。
 */
export interface GoalProgress {
  /** 起始值，创建时自动记录，之后不再变 */
  start: number;
  /** 当前值，用户手动更新 */
  current: number;
  /** 目标值 */
  target: number;
  /** 可选单位，如「名」「套」「分」 */
  unit?: string;
}

export interface Goal {
  id: string;
  title: string;
  subject: string;
  description?: string;
  /**
   * 计划时长（分钟）。
   *   · `null` = **不限时长**（计时目标可以"会计时但不说要多久"，成果目标也用它表达"没有计划"）
   *   · 数字 = 预计要花多久
   *
   * ⚠️ 判断「有没有计划」**一律用 `hasPlannedMinutes()`**，不要自己写 `> 0`
   * 或 `!= null` —— 两种空值（null 和成果目标的 0）判定必须只有一处。
   */
  plannedMinutes: number | null;
  /** 实际学习时长（分钟），由计时器写入。成果目标恒为 0（不参与计时） */
  actualMinutes: number;
  /** 截止时间 yyyy-MM-dd HH:mm，可为空 */
  dueAt?: string | null;
  priority: Priority;
  status: GoalStatus;
  createdAt: number;
  completedAt?: number | null;
  /** 目标类型；缺省 = 'time'（旧数据） */
  kind?: GoalKind;
  /** 成果目标的数值进度；计时目标为 null / 缺省 */
  progress?: GoalProgress | null;
}

/** 是否是成果目标（不计时）。旧数据没有 kind，一律按计时目标处理 */
export function isOutcomeGoal(g: Pick<Goal, 'kind'>): boolean {
  return g.kind === 'outcome';
}

/**
 * 这个目标有没有「预计时长」——**全项目唯一的判据**。
 *
 * 为什么必须只有一处：`plannedMinutes` 有两种"没有计划"的表达 ——
 * 成果目标是 `0`（历史约定，测试和统计都依赖它），计时目标不限时长是 `null`。
 * 各处自己写 `> 0` 或 `!= null` 迟早会漏掉其中一种，表现为
 * 「不限时长的目标被算进计划时长总计」或「显示成 0m 计划」这类问题。
 */
export function hasPlannedMinutes(g: Pick<Goal, 'kind' | 'plannedMinutes'>): boolean {
  return !isOutcomeGoal(g) && typeof g.plannedMinutes === 'number' && g.plannedMinutes > 0;
}

export interface Task {
  id: string;
  title: string;
  goalId?: string | null;
  done: boolean;
  createdAt: number;
  doneAt?: number | null;
}

/* ---------------- 学习记录 ---------------- */

export type SessionSource = 'timer' | 'manual';

export interface Session {
  id: string;
  subject: string;
  goalId?: string | null;
  startedAt: number;
  endedAt: number;
  /** 真实经过秒数（已扣除暂停） */
  durationSec: number;
  review?: string;
  focus?: number; // 1..5 自评
  source: SessionSource;
}

/* ---------------- 火花（连续学习天数）的接回账本 ---------------- */

/**
 * 一次已确认的「接回」。
 *
 * 为什么要有账本，而不是直接改数据：
 * 铁律「学习时长只来自计时器与手动补录」，所以断签挽救**绝不能**生成
 * Session、也不能给任何一天凭空加分钟。这里只记录「用户在哪一天、凭哪两天的
 * 真实学习，把缺口接上了」，展示连续天数时再把缺口日当作桥接日算进去。
 *
 * 缺口日本身**仍然不是学习日**（不进 activeDayKeys、不计入学习日数、不影响
 * 累计时长），界面上会明确写「含 1 天缺口已接回」。
 */
export interface StreakRescue {
  id: string;
  /** 缺口那天（yyyy-MM-dd），只允许恰好缺一天 */
  gapDay: string;
  /** 缺口前那段连续的最后一天，用来在读取时校验缺口仍然成立 */
  beforeGapDay: string;
  /** 缺口后用来接回的真实学习日（连续、每天 ≥ 阈值） */
  repairDays: string[];
  /** 确认时快照的缺口前连续天数 */
  restoredFrom: number;
  /** 用户点「接回」的时间戳 */
  rescuedAt: number;
  /** 规则版本：以后改口径时用来区分历史记录 */
  ruleVersion: 1;
}

/** 成就 id（与 lib/achievements.ts 的目录一一对应） */
export type AchievementId =
  | 'total-10h'
  | 'total-50h'
  | 'total-100h'
  | 'days-30'
  | 'days-100'
  | 'streak-7'
  | 'streak-30'
  | 'first-goal'
  | 'goals-10'
  | 'session-90m';

/**
 * 已解锁成就的账本记录。
 *
 * 为什么落盘而不是每次现算：目标被改回 todo 时 `completedAt` 会被清空，
 * 纯派生会让「第一个完成的目标」突然消失；「曾经最长连续 30 天」也不该因为
 * 一次断签就回收。账本只追加、不删除，成就是历史事件。
 */
export interface AchievementUnlock {
  id: AchievementId;
  /** 达成时刻（能按记录推算就推算，推算不出才用首次判定时间） */
  unlockedAt: number;
  /** 达成时的证据值（分钟 / 天数 / 次数），用于展示与审计 */
  evidence: number;
  /** 升级/导入旧数据时补记的，不做「刚刚解锁」提示 */
  backfilled?: boolean;
  /** 规则版本：以后改口径时用来区分历史记录 */
  ruleVersion: 1;
}

/* ---------------- 考试分数（与学习时长完全无关） ---------------- */

/**
 * 一次考试的成绩。
 *
 * 为什么必须有 `fullScore`：105/150 和 95/100 直接比大小会得出
 * 「105 比 95 好」，实际是 70% < 95%。所有比较一律折成百分制比率，
 * 原始分数只用于展示。
 *
 * 为什么 `date` 是 'yyyy-MM-dd' 字符串而不是时间戳：与 CalendarEvent /
 * ImportantDate 同一约定；存时间戳再反算本地日，跨零点/时区会差一天。
 *
 * 缺考用 `score: null`，**绝不记 0 分**：0 分会拉低均值，并让「未达标」
 * 在没参加考试时就成立。
 */
export interface ExamScore {
  id: string;
  /** 科目名，与 Session.subject 同一套字符串（写入时 trim） */
  subject: string;
  /** 考试名称，如「期中」「第一次月考」 */
  examName: string;
  /** 'yyyy-MM-dd' */
  date: string;
  /** 得分；null = 缺考（不参与均值、最近一次、达标判定） */
  score: number | null;
  /** 满分。默认 100，可 150 / 120 / 60 */
  fullScore: number;
  note?: string;
  createdAt: number;
}

/**
 * 某一科的长期分数目标。
 *
 * 为什么按科目存一份，而不是挂在每条 ExamScore 上：
 *  ① 目标是「意图」，不是某次考试的属性；挂记录上意味着改一次目标要回改历史；
 *  ② 趋势图上要画一条**横线** —— 目标线必须只有一个值，挂记录上会变成阶梯线；
 *  ③ 允许「先立志、后考试」：只有目标没有记录时也该显示目标。
 */
export interface SubjectScoreTarget {
  subject: string;
  /** 目标分（按 fullScore 制式计算） */
  targetScore: number;
  /** 目标对应的满分制（100 / 150） */
  fullScore: number;
  updatedAt: number;
}

/* ---------------- 计时器 ---------------- */

export type TimerPhase = 'idle' | 'running' | 'paused' | 'finished';

export interface ActiveTimer {
  id: string;
  subject: string;
  goalId?: string | null;
  /** 本次开始时刻（校准后时间戳） */
  startedAt: number;
  /** 已累计的暂停毫秒数 */
  pausedMs: number;
  /** 当前这次暂停开始的时刻；null 表示正在运行 */
  pausedAt: number | null;
  /** 可选的正计时目标（分钟），到点提示而非强制停止 */
  targetMinutes?: number | null;
  phase: TimerPhase;
  /** 崩溃/刷新恢复时用于提示 */
  autoResumed?: boolean;
}

/* ---------------- 重要日期 ---------------- */

export interface ImportantDate {
  id: string;
  title: string;
  /** 'yyyy-MM-dd' 或 'yyyy-MM-dd HH:mm' */
  date: string;
  /** 全天事件只显示天数 */
  allDay: boolean;
  /** 是否作为首页主倒计时 */
  primary: boolean;
  /** 是否在首页显示 */
  visible: boolean;
  /** 倒计时是否隐藏天数（例如生日） */
  kind: 'exam' | 'holiday' | 'birthday' | 'custom';
  createdAt: number;
}

/* ---------------- 背景 ---------------- */

export type SceneName = 'aurora' | 'dawn' | 'dusk' | 'stars' | 'rain' | 'grid' | 'glow' | 'glass-flow';

export const SCENE_LABEL: Record<SceneName, string> = {
  'glass-flow': '流光',
  aurora: '极光',
  dawn: '晨光',
  dusk: '暮色',
  stars: '星空',
  rain: '雨夜',
  grid: '网格',
  glow: '柔光',
};

export interface CustomBackground {
  id: string;
  name: string;
  /** dataURL（已压缩） */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
  /**
   * 显示范围（用户可调，设置→背景 里拖动/缩放）。
   *   focusX/focusY：焦点 0..1，0=贴左/上、0.5=居中、1=贴右/下
   *   zoom：在 cover 基础上的额外放大，≥1
   * 缺省（undefined）等价于 0.5 / 0.5 / 1 —— 与加这个功能之前**逐像素一致**，
   * 所以老数据不调就完全看不出变化（零回归）。
   */
  focusX?: number;
  focusY?: number;
  zoom?: number;
}

export interface BackgroundSettings {
  /** 当前背景：'none' | 'scene:<name>' | 'img:<id>' */
  current: string;
  mode: BackgroundMode;
  rotateMinutes: number; // 随机/定时切换间隔
  enabledIds: string[]; // 参与轮换的背景池
  custom: CustomBackground[];
  /** 图片背景自动亮度补偿 0..1，越大压得越暗 */
  dim: number;
  dynamic: boolean;
  showVeil: boolean;
  /**
   * 背景微网格与细颗粒。
   * 手机屏幕上这是纯装饰：它能让玻璃的折射有可弯曲的高频内容，
   * 但也会让背景显得更"技术感"。是否保留完全交给用户决定。
   */
  grid: boolean;
  /**
   * `dim` 是否仍由系统自动推荐。
   * 上传图片时自动算一次并置 true；用户一旦手动拖动滑块就置 false，
   * 之后切换浅色/深色不再覆盖用户的选择（用户手动调过就以用户为准）。
   */
  dimAuto: boolean;
}

/* ---------------- 鼓励语 ---------------- */

export interface Quote {
  id: string;
  text: string;
  tone: 'gentle' | 'calm' | 'plain' | 'useful' | 'humor' | 'drive';
}

/* ---------------- 磨砂玻璃参数 ---------------- */

export type GlassMode = 'standard' | 'polar' | 'prominent' | 'shader';

/**
 * 可用的折射模式。
 *
 * `shader` 被刻意排除：实测该模式会调用 createImageData 并抛
 * "Failed to execute 'createImageData' on 'CanvasRenderingContext2D'"，
 * 直接把整棵 React 树打挂。库把它标为 experimental，我们就不提供这个入口。
 *
 * 注：原先配套的 GLASS_MODE_LABEL / GLASS_MODE_DESC 是给设置页的模式选择器
 * 用的；那个面板（磨砂玻璃参数）已按用户要求移除，两个常量随之删除。
 * 这个数组保留，因为它同时是 sanitizeGlassMode 的判据。
 */
export const SELECTABLE_GLASS_MODES: GlassMode[] = ['standard', 'polar', 'prominent'];

/**
 * 把不可用的模式折算成安全值。
 * 兼容两层历史数据：旧存档里可能存过 shader；将来库若再改动模式集合，
 * 这里也会把不认识的值兜到 standard，而不是把它透传给库导致崩溃。
 */
export function sanitizeGlassMode(mode: GlassMode): GlassMode {
  return SELECTABLE_GLASS_MODES.includes(mode) ? mode : 'standard';
}

/**
 * 磨砂玻璃的可调参数。
 * 与 liquid-glass-react 的属性一一对应，默认值按「安静、不像磨砂」调校过：
 * 库内部默认 blurAmount=12（约 blur(388px)，极端磨砂），这里压到 0.045（约 5.4px）。
 */
export interface GlassSettings {
  /** 边缘位移强度（弯折幅度） */
  displacementScale: number;
  /** 模糊量，库内部换算为 blur(4 + blurAmount*32)px */
  blurAmount: number;
  /** 饱和度提升（%） */
  saturation: number;
  /** 色散强度，只作用在边缘 */
  aberrationIntensity: number;
  /** 指针跟随的弹性（触屏无 hover，默认 0） */
  elasticity: number;
  /** 玻璃圆角（px） */
  cornerRadius: number;
  /** 折射模式 */
  mode: GlassMode;
  /**
   * 是否把玻璃染深（对应库里那个 Over Light 开关）。
   * 库开启后会启用两层黑色叠加并把文字强制成白色 —— 它假设亮背景配白字。
   * 本项目的背景由我们控制、且文字用设计令牌，所以默认关闭；
   * 只有当用户上传了很亮的照片背景时才建议打开。
   */
  overLight: boolean;
}

export const DEFAULT_GLASS_SETTINGS: GlassSettings = {
  // 位移偏强一点，边缘弯折才看得出来
  displacementScale: 80,
  // 模糊是磨砂感的唯一来源。0.125 ≈ blur(8px)：
  // 比库内部默认（0.5 ≈ blur(20px)）清澈得多，又保留玻璃的柔和感。
  blurAmount: 0.125,
  saturation: 160,
  // 色散只作用在边缘，保持「轻微」
  aberrationIntensity: 2.4,
  // 触屏没有悬停，弹性默认为 0（开启反而会增加重排开销）
  elasticity: 0,
  cornerRadius: 20,
  mode: 'standard',
  overLight: false,
};

/* ---------------- 设置汇总 ---------------- */

/**
 * 某一天单独覆盖的作息。全部可选 —— **只覆盖填了的字段**，
 * 其余回落 Settings 上的默认值（所以「只改周六的窗口」不会动到别的字段）。
 */
export interface DaySchedule {
  studyFrom?: string;
  studyTo?: string;
  schoolStart?: string;
  schoolEnd?: string;
  wakeTime?: string;
  sleepTime?: string;
  /** 每日学习目标（分钟）。和上面那些一样：这天没设就跟随全周默认 */
  dailyGoalMinutes?: number;
}

/** 按星期几覆盖的**时间**字段（值是 'HH:mm'） */
export const DAY_SCHEDULE_TIME_KEYS = [
  'studyFrom',
  'studyTo',
  'schoolStart',
  'schoolEnd',
  'wakeTime',
  'sleepTime',
] as const satisfies readonly (keyof DaySchedule)[];

/**
 * 按星期几覆盖的**数字**字段。
 * 为什么必须和时间字段分开：`settingsForDay` 合并时判据不同
 * （时间要校验 'HH:mm' 形状，数字要校验有限非负整数），
 * 混在一起就只能靠 `typeof` 分支，容易漏。
 */
export const DAY_SCHEDULE_NUMBER_KEYS = [
  'dailyGoalMinutes',
] as const satisfies readonly (keyof DaySchedule)[];

/** 全部可按星期几覆盖的字段名（校验存档时用） */
export const DAY_SCHEDULE_KEYS = [
  ...DAY_SCHEDULE_TIME_KEYS,
  ...DAY_SCHEDULE_NUMBER_KEYS,
] as const satisfies readonly (keyof DaySchedule)[];

export interface Settings {
  /** 原版折射组件的独立参数，旧存档缺省时使用默认值。 */
  refract?: { strength: number; blur: number; chromatic: boolean; elasticity: number };
  /*
   * 这两个字段已随设置里的两个开关一起删除：
   *   · adaptiveText —— 字体随背景改变那个开关。行为改为**恒常开启**，
   *     所以字段也删掉：若只删 UI 而留着字段，之前手动关过的用户会永远开不回来。
   *   · previousTheme —— 「透明玻璃主题」开关关闭时用来还原上一个主题。
   *     开关删了（主题网格里本来就能直接选透明玻璃），这个字段就成了死代码。
   * 旧存档里多带的这两个键会被直接忽略，不影响读取。
   */
  theme: ThemeId;
  colorMode: ColorMode;
  perf: PerfLevel;
  motion: boolean;
  glassBlur: boolean;
  dynamicBackground: boolean;
  autoRotate: boolean;
  /** 上学时间 / 放学时间 */
  schoolStart: string;
  schoolEnd: string;
  /** 起床 / 睡觉 */
  wakeTime: string;
  sleepTime: string;
  /** 每日学习目标（分钟） */
  dailyGoalMinutes: number;
  blocks: TimeBlock[];
  /** 每天的学习时段（可支配时间的窗口起点/终点）。这是**默认值**，按星期几的覆盖见 byWeekday */
  studyFrom: string;
  studyTo: string;
  /**
   * 按星期几单独设的作息（0 = 周一）。
   *
   * 为什么要有它：上面那几个字段原来**全周共用一套** ——
   * 工作日和周末的窗口、上学时间明明不同，却只能填一个，等于被锁死。
   * 现在每一天都可以单独覆盖，**没覆盖的字段回落到上面的默认值**，
   * 所以旧存档（没有这个字段）行为完全不变，也不需要迁移。
   */
  byWeekday?: Partial<Record<Weekday, DaySchedule>> | null;
  quoteSeed: string;
  /** 首页信息密度 */
  align: AlignMode;
  /**
   * 首页栏目顺序（长按拖动排序，要求四十六）。
   * null = 用默认顺序；数组里缺掉的模块会按默认顺序补在末尾，
   * 未知 id（未来删模块）会被过滤掉。
   */
  homeOrder: string[] | null;
  nickname: string;
  onboarded: boolean;
  /** 磨砂玻璃的可调参数 */
  glass: GlassSettings;
  /**
   * 自定义强调色（十六进制，如 '#e0533d'）。缺省表示沿用主题自带颜色。
   *
   * 只覆盖 `--accent` 一个变量即可 —— 项目里按钮底色/文字色、选中态文字色、
   * 日历热力梯度、主按钮底色全都是用 color-mix 从 `--accent` 派生的，
   * 所以换成任何颜色都不会出现「字压不住底」的情况。
   *
   * **透明玻璃主题（liquid-glass-wc）不使用它**：那个主题的观感由玻璃折射主导，
   * 再叠一层自定义色会打架，因此该主题下沿用固定配色。
   */
  accent?: string | null;
  /**
   * 首页进度环**超过 100% 的那一圈（第二圈）**的颜色（十六进制）。
   *
   * 背景：今日目标百分比不封顶（学了 6h、目标 3h = 200%）。外圈固定表示 0–100%，
   * 超出部分画成里面一圈，用这个颜色 —— 这样"刚好达成"和"超额完成"一眼能分开。
   * 缺省（null / 未设）时跟随强调色 `--accent`。
   *
   * 和 `accent` 一样**只在支持自定义颜色的主题下生效**（透明玻璃主题沿用固定配色）。
   */
  ringOverflow?: string | null;
  /**
   * 首页进度环**正常那一圈（0–100% 的部分）**的颜色（十六进制）。
   *
   * 和 `ringOverflow` 是一对：一个管"还没超额时的进度"，一个管"超出的那一圈"。
   * 缺省（null / 未设）时**保持原样** —— 未达成跟随强调色、达成时按 `celebrate` 转成功色；
   * 一旦设了值，这一圈就恒用该颜色（达成时也不再被成功色盖掉），
   * 这样"我设了颜色却被系统换掉"这种事不会发生。
   */
  ringColor?: string | null;
  /** 用户自己添加的鼓励语。与内置语句库混合参与随机。 */
  customQuotes?: string[];
  /** 是否把内置语句库也纳入随机；关掉后只用自定义语句。 */
  useBuiltinQuotes?: boolean;
  /**
   * 「重要日期」模块区域的独立背景。
   *
   * 只作用于这一个模块（首页那块倒计时卡 + 设置里的重要日期区），
   * 与全局背景互不影响 —— 模块自己的图、自己的压暗程度。
   *
   * imageId 指向 background.custom 里的某张图（复用用户已经上传的背景，
   * 不额外占存储）；null 表示不单独设背景，跟随全局。
   */
  dateModuleBackground?: {
    imageId: string | null;
    /** 压暗 0..0.8。压暗是为了保证卡片上的字始终能看清 */
    dim: number;
    /**
     * 模块自己的取景（可选）。缺省时**沿用那张图在图库里的取景**
     * （也就是「设置 → 背景 → 调整显示范围」里调的同一组值）。
     * 含义与 CustomBackground 完全一致：focusX/focusY 0..1、zoom ≥ 1。
     */
    focusX?: number;
    focusY?: number;
    zoom?: number;
  };
}

/* ---------------- 按日期覆盖课表 ---------------- */

/**
 * 用户对某一天的课表覆盖。优先级**高于**内置节假日表。
 *
 * 典型用途是补课：「1 月 4 日（周日）上班」这种调休日，
 * 到底上星期几的课取决于学校，内置表推不出来，只能由用户指定。
 * 也可以手动把某天设为不上课（学校自己的活动日等）。
 *
 * 定义在这里而不是 lib/holidays.ts，是因为它属于「会被持久化的数据」，
 * 而 AppSnapshot 也在本文件 —— 放 holidays 会形成循环引用。
 */
export interface DayOverride {
  /** 'yyyy-MM-dd' */
  date: string;
  /** 'off' = 这天不上课；0..6 = 按该星期几的课表（0 = 周一） */
  schedule: 'off' | Weekday;
  note?: string;
}

/* ---------------- 数据快照（用于导入导出 / 未来云同步） ---------------- */

export interface AppSnapshot {
  schema: number;
  exportedAt: number;
  settings: Settings;
  periods: Period[];
  courses: Course[];
  goals: Goal[];
  tasks: Task[];
  sessions: Session[];
  dates: ImportantDate[];
  /**
   * 日历事件。
   * 与 ImportantDate **完全独立**：后者是倒计时/记天数（一个重要日期，
   * 没到就显示还有多少天，过了就显示已经多少天），
   * 而日历是另一套东西 —— 按天标注的事情。两者互不影响，也不互相显示。
   */
  calendarEvents?: CalendarEvent[];
  /** 按日期覆盖课表（补课 / 手动放假）。优先级高于内置节假日表。 */
  dayOverrides?: DayOverride[];
  /**
   * 火花（连续学习天数）的接回账本。
   * 旧存档没有这个字段 = 从没接回过，按空数组处理（零回归）。
   */
  streakRescues?: StreakRescue[];
  /** 成就解锁账本；旧存档缺省 = 空数组（hydrate 时会按现有记录补记） */
  achievements?: AchievementUnlock[];
  /** 考试分数记录；旧存档缺省 = 空数组 */
  examScores?: ExamScore[];
  /** 各科目标分；旧存档缺省 = 空数组 */
  subjectScoreTargets?: SubjectScoreTarget[];
  background: BackgroundSettings;
  timer: ActiveTimer | null;
  courseStatus: CourseStatusMap;
}

/* ---------------- 日历事件 ---------------- */

export type CalendarTone = 'default' | 'study' | 'exam' | 'life';

/**
 * 日历上的一个标注。
 * 独立于 ImportantDate —— 详见 AppSnapshot.calendarEvents 的说明。
 */
export interface CalendarEvent {
  id: string;
  /** 'yyyy-MM-dd' */
  date: string;
  title: string;
  /** 可选的备注 */
  note?: string;
  /** 标记色，用于区分类型 */
  tone: CalendarTone;
  createdAt: number;
}

export const CALENDAR_TONE_LABEL: Record<CalendarTone, string> = {
  default: '普通',
  study: '学习',
  exam: '考试',
  life: '生活',
};

export const SCHEMA_VERSION = 1;
