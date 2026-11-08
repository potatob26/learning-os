import { Capacitor, registerPlugin } from '@capacitor/core';
import { useStore } from './store';
import { buildQuotePool } from './quotes';
import { todayProgress } from './stats';
import { readThemePalettes, WIDGET_THEME_ORDER } from './widgetPalette';
import { fmtDuration, dayKey, settingsForDay } from './time';
import { effectiveWeekday } from './holidays';

/* ==========================================================================
   桌面小组件的数据桥（WebView → 原生）
   ──────────────────────────────────────────────────────────────────────────
   小组件是原生组件，跑在系统 launcher 进程里，**读不到 WebView 的数据**
   （localStorage / IndexedDB 都在 WebView 里）。所以这里把小组件真正需要的
   那几个数字算好、打成一份小 JSON 推给原生。

   存的是**结构化数据**而不是渲染好的字符串，于是小组件能自己做三件事：
     · 算「还有几天」（跨天后不用打开 App 也是对的）
     · 点一下轮换语句 / 换重要日期（不开 App）
     · 按尺寸选字号
   真正会过期的只有「今日百分比」—— 它依赖当天的学习记录，只有 App 运行过才准。

   推送时机（没有用 @capacitor/app，少一个依赖）：
     · 状态变化后节流 1.2s
     · document.visibilitychange → 切到后台时立刻推一次（用 pagehide 兜底）
   这样「学完一段 → 切出去看桌面」看到的就是最新数字。
   ========================================================================== */

interface WidgetBridgePlugin {
  sync(options: { payload: string }): Promise<{ saved: boolean; bytes: number }>;
  available(): Promise<{ available: boolean }>;
}

/** Web/PWA 上这个插件不存在，调用会抛 —— 所以下面所有出口都先判断平台 */
const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

export function widgetsSupported(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 组装载荷。抽成独立函数是为了能在测试里直接断言内容，不必真的推给原生 */
export function buildWidgetPayload(nowTs: number = Date.now()): string {
  const s = useStore.getState();

  /*
   * 今日目标要取「今天真正生效」的那个（每日目标可按星期几单独设）。
   * weekday 走 effectiveWeekday：调课日与首页、课表同口径 ——
   * 否则小组件和首页会在调课日显示不同的目标，而 test-widget-payload
   * 有一条断言专门要求「与首页显示的数字一致」。
   */
  const daySettings = settingsForDay(s.settings, effectiveWeekday(dayKey(nowTs), s.dayOverrides));

  // 今日百分比：**复用首页那套统计**，不另算一套，避免小组件和首页对不上
  const progress = todayProgress(s.sessions, daySettings, nowTs, 0, 0);

  // 语句池：与首页「换一句」用的是同一个池子（内置 + 用户自定义）
  const pool = buildQuotePool({
    custom: s.settings.customQuotes ?? [],
    useBuiltin: s.settings.useBuiltinQuotes !== false,
  });

  // 重要日期：只推「首页可见」的，并且**按日期升序** ——
  // 方便用户点着往前翻，也和第 0 条是最近的直觉一致
  const dates = s.dates
    .filter((d) => d.visible)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ id: d.id, title: d.title, date: d.date.slice(0, 10) }));

  const palettes = readThemePalettes({
    colorMode: s.settings.colorMode,
    systemDark:
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false,
  });

  const studied = Math.round(progress.studiedMinutes);
  const goal = Math.round(progress.goalMinutes);

  return JSON.stringify({
    v: 1,
    updatedAt: nowTs,
    today: dayKey(nowTs),
    // 一个主题都没解析出来时不给 defaultTheme，原生侧会走兜底色
    defaultTheme: palettes[WIDGET_THEME_ORDER[0]] ? WIDGET_THEME_ORDER[0] : '',
    themeOrder: WIDGET_THEME_ORDER,
    percent: {
      percent: Math.round(progress.percent),
      studiedMinutes: studied,
      goalMinutes: goal,
      detail: goal > 0 ? `${fmtDuration(studied)} / ${fmtDuration(goal)}` : fmtDuration(studied),
    },
    quotes: pool.map((q) => q.text),
    dates,
    palettes,
  });
}

/** 推一次。失败不抛（小组件是可选功能，不能因为推送失败影响主流程） */
export async function pushWidgetData(): Promise<boolean> {
  if (!widgetsSupported()) return false;
  try {
    await WidgetBridge.sync({ payload: buildWidgetPayload() });
    return true;
  } catch (err) {
    console.warn('[widget] 推送失败', err);
    return false;
  }
}

let installed = false;
let timer: number | null = null;

/** 装好自动推送（幂等，重复调用无副作用） */
export function installWidgetSync(): void {
  if (installed || !widgetsSupported() || typeof window === 'undefined') return;
  installed = true;

  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    // 节流：一次学习操作会连着改好几个字段，没必要每条都推
    timer = window.setTimeout(() => {
      timer = null;
      void pushWidgetData();
    }, 1200);
  };

  // 任何状态变化都安排一次推送
  useStore.subscribe(schedule);

  // 切到后台时立刻推 —— 用户很可能就是切出去看桌面上的小组件
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      void pushWidgetData();
    } else {
      schedule();   // 回到前台也同步一次（可能在外面过了好几天）
    }
  });

  // visibilitychange 在个别 WebView 上不可靠，pagehide 兜底
  window.addEventListener('pagehide', () => void pushWidgetData());

  // 首次安装完先推一次，免得用户刚放上小组件看到的是空的
  void pushWidgetData();
}
