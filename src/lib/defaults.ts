import type { Period, Settings, TimeBlock, Weekday } from './types';
import { DEFAULT_GLASS_SETTINGS } from './types';

/* ==========================================================================
   默认作息（中国中学常见）
   全部可编辑，没有任何写死的业务数据。
   ========================================================================== */

const P = (id: string, name: string, start: string, end: string, counts = true): Period => ({
  id,
  name,
  start,
  end,
  counts,
});

export const DEFAULT_PERIODS: Period[] = [
  P('p1', '第 1 节', '08:00', '08:45'),
  P('p2', '第 2 节', '08:55', '09:40'),
  P('p3', '第 3 节', '10:00', '10:45'),
  P('p4', '第 4 节', '10:55', '11:40'),
  P('p5', '第 5 节', '14:00', '14:45'),
  P('p6', '第 6 节', '14:55', '15:40'),
  P('p7', '第 7 节', '16:00', '16:45'),
  P('p8', '第 8 节', '16:55', '17:40'),
  P('p9', '晚自习 1', '19:00', '20:00'),
  P('p10', '晚自习 2', '20:10', '21:10'),
];

export const ALL_WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4];

function blk(
  id: string,
  label: string,
  kind: TimeBlock['kind'],
  start: string,
  end: string,
  weekdays: Weekday[] | null = null,
): TimeBlock {
  return { id, label, kind, start, end, weekdays };
}

export const DEFAULT_BLOCKS: TimeBlock[] = [
  blk('b_lunch', '午饭', 'meal', '11:40', '12:30'),
  blk('b_dinner', '晚饭', 'meal', '17:40', '18:30'),
  blk('b_tidy', '洗漱、收拾', 'chore', '22:00', '22:25'),
];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'liquid-glass',
  colorMode: 'system',
  perf: 'balanced',
  motion: true,
  glassBlur: true,
  dynamicBackground: true,
  autoRotate: false,

  schoolStart: '08:00',
  schoolEnd: '17:40',
  wakeTime: '06:40',
  sleepTime: '22:30',

  dailyGoalMinutes: 180,

  blocks: DEFAULT_BLOCKS,

  studyFrom: '17:40',
  studyTo: '22:30',

  quoteSeed: '',
  align: 'left',
  // null = 按默认顺序排列首页栏目（长按可拖动排序）
  homeOrder: null,
  nickname: '',
  onboarded: false,
  glass: { ...DEFAULT_GLASS_SETTINGS },
  // null = 沿用主题自带强调色
  accent: null,
  customQuotes: [],
  useBuiltinQuotes: true,
  // 重要日期模块的独立背景：默认不设，跟随全局背景
  dateModuleBackground: { imageId: null, dim: 0.25 },
};

/* ---------------- 节次工具 ---------------- */

export function periodMap(periods: Period[]): Map<string, Period> {
  return new Map(periods.map((p) => [p.id, p]));
}

/** 排序后的节次（按开始时间） */
export function sortedPeriods(periods: Period[]): Period[] {
  return [...periods].sort((a, b) => a.start.localeCompare(b.start));
}

let periodSeq = 100;
export function nextPeriodId(): string {
  periodSeq += 1;
  return `p_custom_${periodSeq}_${Math.random().toString(36).slice(2, 6)}`;
}

let blockSeq = 100;
export function nextBlockId(): string {
  blockSeq += 1;
  return `b_custom_${blockSeq}_${Math.random().toString(36).slice(2, 6)}`;
}
