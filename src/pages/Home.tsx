import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { nowExact } from '../lib/netTime';
import { useNow } from '../hooks/useNow';
import { useDayPlan, useScheduleToday } from '../hooks/useSchedule';
import { dayKey, settingsForDay } from '../lib/time';
import { todayProgress } from '../lib/stats';
import { computeStreakState } from '../lib/streak';
import {
  HomeHeader,
  HomeQuote,
  StudyProgressCard,
  TimerMini,
  TodayGoalsCard,
} from '../components/home/HomeCards';
import { CountdownCard } from '../components/home/CountdownCard';
import { DEFAULT_HOME_ORDER, isModuleId, type HomeModuleId } from '../lib/homeModules';
import { CalendarView } from '../components/calendar/CalendarView';
import { FixedBlocks, TodayCourses } from '../components/home/TodayCourses';
import { QuickAdd } from '../components/quick/QuickAdd';
import { StartStudySheet } from '../components/timer/StartStudySheet';

/**
 * 首页
 * 信息优先级（要求三十五）：
 *   1. 现在是什么时候        → 顶部时钟
 *   2. 现在该做什么          → 主倒计时 / 今日课程 / 今日目标
 *   3. 今天完成了多少        → 学习进度卡
 * 栏目顺序可长按拖动调整（要求四十六），顺序持久化在 settings.homeOrder。
 *
 * 拖动手感对齐 iOS 主屏图标：
 *   长按 450ms 提起 → 卡片 1:1 跟手（transform，不走 React 重排）→
 *   其他栏目以 220ms 过渡「让位」出插入口 → 松手 FLIP 归位 → 顺序才落盘。
 */

/* ---------------- 首页栏目定义（id/默认顺序在 lib/homeModules.ts） ---------------- */

/** 拖动参数 */
const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 8;
const EDGE_SCROLL_PX = 96;
const PART_TRANSITION = 'transform 220ms cubic-bezier(0.2, 0.8, 0.3, 1)';
const SETTLE_TRANSITION = 'transform 190ms cubic-bezier(0.2, 0.8, 0.3, 1)';

interface DragMeta {
  id: HomeModuleId;
  /** 按下点到卡片顶边的偏移（client 坐标），提起后保持不变 = 跟手 */
  grabDY: number;
  /** 拖动开始时的原始布局（page 坐标，滚动无关） */
  items: Array<{ id: HomeModuleId; top: number; height: number }>;
  stackTop: number;
  gap: number;
  height: number;
  /** 拖动开始时卡片顶边的 page 坐标（= 原位，位移相对它计算） */
  origTopPage: number;
  /** 当前插入索引（在除拖动卡以外的序列里） */
  target: number;
  /** 拖动卡当前的视觉位移（相对原位） */
  lastTy: number;
}

export function Home() {
  const navigate = useNavigate();
  const ts = useNow();

  const settings = useStore((s) => s.settings);
  const sessions = useStore((s) => s.sessions);
  const dates = useStore((s) => s.dates);
  const timer = useStore((s) => s.timer);
  const patchSettings = useStore((s) => s.patchSettings);
  const streakRescues = useStore((s) => s.streakRescues);

  const { plan, weekday } = useDayPlan();
  const schedule = useScheduleToday();
  const { instances, summary, dateKey } = schedule;
  const setCourseStatus = useStore((s) => s.setCourseStatus);
  const [quickOpen, setQuickOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  /*
   * 今天「真正生效」的作息与每日目标。
   * 必须用 useDayPlan 返回的 weekday —— 它内部走 resolveDay，
   * 调课日按调课后的课表星期几；直接用 new Date().getDay() 会让
   * 窗口（按调课星期几）和每日目标（按日历星期几）不同步。
   */
  const daySettings = useMemo(() => settingsForDay(settings, weekday), [settings, weekday]);

  /*
   * 火花状态：连续天数、断签挽救进度、账本校验都在这里一次算完。
   * 依赖里不放 ts（每秒变），只放「今天」——状态是日级的，
   * 秒级重算 sessions 全量没有意义。
   */
  const todayStamp = dayKey(ts);
  const streakState = useMemo(
    () => computeStreakState(sessions, streakRescues, ts),
    // 用 todayStamp 触发跨天重算；ts 本身不参与依赖，避免每秒 O(n) 扫 sessions
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, streakRescues, todayStamp],
  );

  const progress = useMemo(
    () =>
      todayProgress(
        sessions,
        daySettings,
        ts,
        plan.availableMinutes,
        plan.remainingAvailableMinutes,
      ),
    [sessions, daySettings, ts, plan.availableMinutes, plan.remainingAvailableMinutes],
  );

  const fixedBlocks = useMemo(
    () =>
      plan.blocks.filter((b) => {
        // 只显示还没结束的固定活动，避免列表被过去的事情塞满
        const d = new Date(ts);
        const nowMin = d.getHours() * 60 + d.getMinutes();
        return b.endMin > nowMin;
      }),
    [plan.blocks, ts],
  );

  const startStudy = () => {
    if (timer) navigate('/timer');
    else setStartOpen(true);
  };

  /* ---------------- 栏目顺序（长按拖动，iOS 手感） ---------------- */

  const homeOrderRaw = settings.homeOrder;
  const [dragging, setDragging] = useState<HomeModuleId | null>(null);

  const order = useMemo(() => {
    const stored = (homeOrderRaw ?? []).filter(isModuleId);
    // 存档里缺掉的模块按默认顺序补在末尾；未知 id 已被过滤
    return [...stored, ...DEFAULT_HOME_ORDER.filter((id) => !stored.includes(id))];
  }, [homeOrderRaw]);

  const orderRef = useRef(order);
  orderRef.current = order;
  const sectionRefs = useRef(new Map<HomeModuleId, HTMLDivElement | null>());
  const pressRef = useRef<{ id: HomeModuleId; x: number; y: number; timer: number } | null>(null);
  const draggingRef = useRef<HomeModuleId | null>(null);
  const dragMeta = useRef<DragMeta | null>(null);
  const rafRef = useRef(0);
  const lastPointer = useRef({ x: 0, y: 0 });
  const pendingSettle = useRef<{ id: HomeModuleId; visualTopPage: number } | null>(null);
  const suppressClickRef = useRef(false);

  const clearPress = () => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };

  /** 拖动期间的每帧更新：卡片跟手 + 其他栏目让位 + 边缘自动滚屏 */
  function dragTick() {
    const st = dragMeta.current;
    if (!st) return;
    const el = sectionRefs.current.get(st.id);
    if (!el) return;

    // 边缘自动滚屏
    const vh = window.innerHeight;
    if (lastPointer.current.y < EDGE_SCROLL_PX) window.scrollBy(0, -14);
    else if (lastPointer.current.y > vh - EDGE_SCROLL_PX) window.scrollBy(0, 14);

    // 卡片 1:1 跟手（transform 相对原位；滚动已折算在 page 坐标里）
    st.lastTy = lastPointer.current.y - st.grabDY - (st.origTopPage - window.scrollY);
    el.style.transform = `translate3d(0, ${Math.round(st.lastTy)}px, 0) scale(1.03)`;

    // 拖动卡中心越过了哪一格的中线，就插到哪
    const centerPage = (lastPointer.current.y - st.grabDY) + st.height / 2 + window.scrollY;
    const others = st.items.filter((i) => i.id !== st.id);
    let t = 0;
    for (let j = 0; j < others.length; j++) {
      let slotTop = st.stackTop;
      for (let k = 0; k < j; k++) slotTop += others[k].height + st.gap;
      if (centerPage > slotTop + others[j].height / 2) t = j + 1;
    }
    if (t !== st.target) {
      st.target = t;
      // 其他栏目过渡到新位置（让位动画）
      others.forEach((o, j) => {
        const oel = sectionRefs.current.get(o.id);
        if (!oel) return;
        let slotTop = st.stackTop;
        for (let k = 0; k < j; k++) slotTop += others[k].height + st.gap;
        if (j >= t) slotTop += st.height + st.gap;
        const delta = Math.round(slotTop - o.top);
        oel.style.transform = delta ? `translate3d(0, ${delta}px, 0)` : '';
      });
    }
  }

  function dragTickLoop() {
    if (!dragMeta.current) return;
    dragTick();
    rafRef.current = requestAnimationFrame(dragTickLoop);
  }

  function onWindowPointerMove(e: PointerEvent) {
    lastPointer.current = { x: e.clientX, y: e.clientY };
  }

  function onWindowPointerUp() {
    cancelAnimationFrame(rafRef.current);
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onWindowPointerUp);
    window.removeEventListener('touchmove', preventTouchScroll);

    const st = dragMeta.current;
    if (!st) return;
    const el = sectionRefs.current.get(st.id);

    // 提交新顺序；拖动卡与其他卡的视觉位置由 layout effect 无缝接手
    const others = st.items.filter((i) => i.id !== st.id).map((i) => i.id);
    const nextOrder = [...others.slice(0, st.target), st.id, ...others.slice(st.target)];
    pendingSettle.current = { id: st.id, visualTopPage: st.origTopPage + st.lastTy };
    dragMeta.current = null;
    draggingRef.current = null;
    setDragging(null);
    if (el) el.style.willChange = '';
    for (const [mid, oel] of sectionRefs.current) {
      if (mid === st.id || !oel) continue;
      oel.style.transition = '';
    }
    patchSettings({ homeOrder: nextOrder });
  }

  function preventTouchScroll(e: TouchEvent) {
    e.preventDefault();
  }

  const beginDrag = (id: HomeModuleId) => {
    const el = sectionRefs.current.get(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const scrollY = window.scrollY;
    const items = orderRef.current.map((mid) => {
      const er = sectionRefs.current.get(mid)?.getBoundingClientRect();
      return { id: mid, top: (er?.top ?? 0) + scrollY, height: er?.height ?? 0 };
    });
    const gap = items.length > 1
      ? Math.max(0, items[1].top - (items[0].top + items[0].height))
      : 14;
    dragMeta.current = {
      id,
      grabDY: lastPointer.current.y - r.top,
      items,
      stackTop: items[0].top,
      gap,
      height: r.height,
      origTopPage: r.top + scrollY,
      target: orderRef.current.indexOf(id),
      lastTy: 0,
    };
    draggingRef.current = id;
    setDragging(id);
    suppressClickRef.current = true;
    try {
      navigator.vibrate?.(15);
    } catch { /* 桌面端无振动，忽略 */ }

    // 提起：浮层质感 + 跟手；其他栏目挂让位过渡
    el.style.willChange = 'transform';
    el.style.zIndex = '30';
    el.style.transform = 'translate3d(0, 0, 0) scale(1.03)';
    for (const [mid, oel] of sectionRefs.current) {
      if (mid === id || !oel) continue;
      oel.style.transition = PART_TRANSITION;
    }
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    window.addEventListener('touchmove', preventTouchScroll, { passive: false });
    rafRef.current = requestAnimationFrame(dragTickLoop);
  };

  const startPress = (id: HomeModuleId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 只在非交互元素上触发长按，避免和卡内按钮/链接抢手势
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [role="button"]')) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    pressRef.current = {
      id,
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        clearPress();
        beginDrag(id);
      }, LONG_PRESS_MS),
    };
  };

  const onSectionPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) return; // 拖动中的 move 由 window 处理
    const p = pressRef.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_CANCEL_PX) clearPress();
  };

  /* 松手落位：其他卡自然位置 == 让位后的视觉位置（无跳变），
     拖动卡从手指位置 FLIP 滑进它的格子 */
  useLayoutEffect(() => {
    const s = pendingSettle.current;
    if (!s) return;
    pendingSettle.current = null;
    for (const [id, oel] of sectionRefs.current) {
      if (!oel) continue;
      if (id === s.id) continue;
      oel.style.transform = '';
      oel.style.transition = '';
    }
    const el = sectionRefs.current.get(s.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const delta = Math.round(s.visualTopPage - (r.top + window.scrollY));
    el.style.transition = 'none';
    el.style.transform = delta ? `translate3d(0, ${delta}px, 0)` : '';
    requestAnimationFrame(() => {
      el.style.transition = SETTLE_TRANSITION;
      el.style.transform = '';
      window.setTimeout(() => {
        el.style.transition = '';
        el.style.willChange = '';
        el.style.zIndex = '';
      }, 230);
    });
  });

  /* 拖动中的 section 属性 */
  const sectionProps = (id: HomeModuleId) => ({
    ref: (el: HTMLDivElement | null) => {
      sectionRefs.current.set(id, el);
    },
    'data-home-section': id,
    onPointerDown: startPress(id),
    onPointerMove: onSectionPointerMove,
    onPointerUp: clearPress,
    onPointerCancel: clearPress,
    // 拖完的那次 click 不触发卡片自己的跳转
    onClickCapture: (e: React.MouseEvent) => {
      if (suppressClickRef.current) {
        e.stopPropagation();
        e.preventDefault();
        suppressClickRef.current = false;
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (draggingRef.current) e.preventDefault();
    },
  });

  const section = (id: HomeModuleId, node: ReactNode) => (
    <div
      key={id}
      {...sectionProps(id)}
      className={dragging === id
        ? 'relative select-none rounded-2xl shadow-2xl'
        : dragging
          ? 'relative select-none'
          : 'relative'}
      style={dragging === id ? { willChange: 'transform' } : undefined}
    >
      {node}
    </div>
  );

  const sections: Record<HomeModuleId, ReactNode> = {
    progress: (
      <StudyProgressCard
        progress={progress}
        plan={plan}
        nowTs={ts}
        dailyGoalMinutes={daySettings.dailyGoalMinutes}
        onOpenStats={() => navigate('/stats')}
        delay={0.04}
      />
    ),
    quote: <HomeQuote />,
    todos: <TodayGoalsCard nowTs={ts} onOpenGoals={() => navigate('/goals')} delay={0.12} />,
    courses: (
      <TodayCourses
        instances={instances}
        summary={summary}
        classMinutes={schedule.classMinutes}
        day={schedule.day}
        onSetStatus={(courseId, status) => setCourseStatus(courseId, dateKey, status)}
        onOpen={() => navigate('/settings/courses')}
        delay={0.16}
      />
    ),
    dates: (
      <CountdownCard
        items={dates}
        nowTs={ts}
        onOpen={() => navigate('/settings/dates')}
        delay={0.2}
      />
    ),
    calendar: <CalendarView />,
    blocks: <FixedBlocks blocks={fixedBlocks} delay={0.24} onOpen={() => navigate('/settings/schedule')} />,
  };

  return (
    <div className="space-y-3.5">
      <HomeHeader
        nowTs={ts}
        settings={settings}
        streakState={streakState}
        onOpenStreak={() => navigate('/streak')}
        onQuickAdd={() => setQuickOpen(true)}
      />

      {/* 计时迷你条是功能性提醒（有计时在跑才出现），固定在页首不参与排序 */}
      <TimerMini
        nowTs={ts}
        onOpenTimer={() => navigate('/timer')}
        onStart={startStudy}
        remainingMinutes={plan.remainingAvailableMinutes}
        delay={0.08}
      />

      {/* 每日一句：按用户要求移到「今日自学」正下方，第二眼位置。 */}
      {order.map((id) => section(id, sections[id]))}

      {/* 可支配时间的口径说明（一句话讲清，数字在上面卡片里已经有了） */}
      <p className="px-1 pb-2 text-center text-[0.7rem] leading-relaxed text-tertiary">
        可支配时间 = 学习窗口 − 上课 − 固定活动；上课时间不计入学习时长
      </p>

      <QuickAdd
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onStartStudy={() => setStartOpen(true)}
      />
      <StartStudySheet open={startOpen} onClose={() => setStartOpen(false)} />
    </div>
  );
}

/** 供首页使用：拿到「精确现在」，用于倒计时等秒级计算 */
export function useExactNow(): () => number {
  return nowExact;
}
