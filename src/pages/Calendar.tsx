import { CalendarView } from '../components/calendar/CalendarView';

/**
 * 日历独立页（#/calendar）
 *
 * 日历本身已经内嵌在首页（用户要求「日历放主页」）。
 * 这个路由保留下来是为了两件事：
 *   · 深链可用（别人发你一个 #/calendar 能打开）
 *   · 设置页的「打开日历」有地方可去
 * 内容与首页那份是**同一个组件**，不存在两套实现。
 */
export function Calendar() {
  return <CalendarView standalone />;
}
