/**
 * 首页栏目顺序（拖动排序的稳定数据源）
 * ──────────────────────────────────────────────────────────────
 * 首页长按拖动与设置里的「首页排序」按钮共用这一份 id / 名称 / 默认顺序。
 * 之前这些只写在 Home.tsx 里，设置页想提供键盘替代入口拿不到，只能复制一份 ——
 * 复制就会漂移，所以单独放这里。
 */
export const HOME_MODULES = ['progress', 'quote', 'todos', 'courses', 'dates', 'calendar', 'blocks'] as const;

export type HomeModuleId = (typeof HOME_MODULES)[number];

export const DEFAULT_HOME_ORDER: HomeModuleId[] = [
  'progress',
  'quote',
  'todos',
  'courses',
  'dates',
  'calendar',
  'blocks',
];

/** 给人看的名字（设置里的排序列表用） */
export const HOME_MODULE_LABELS: Record<HomeModuleId, string> = {
  progress: '今日自学',
  quote: '每日一句',
  todos: '今天要做什么',
  courses: '今日课程',
  dates: '重要日期',
  calendar: '日历',
  blocks: '固定日程',
};

export function isModuleId(x: string): x is HomeModuleId {
  return (HOME_MODULES as readonly string[]).includes(x);
}
