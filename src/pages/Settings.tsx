import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  Database,
  Image as ImageIcon,
  MessageSquarePlus,
  Palette,
  Table2,
  Timer as TimerIcon,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { useTimeStore, SOURCE_LABEL } from '../lib/netTime';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { GlassSection } from '../components/settings/GlassSection';
import { HomeOrderList } from '../components/settings/HomeOrderList';
import { ScheduleSection } from '../components/settings/ScheduleSection';
import { CoursesSection } from '../components/settings/CoursesSection';
import { BackgroundSection } from '../components/settings/BackgroundSection';
import { DatesSection } from '../components/settings/DatesSection';
import { Sheet } from '../components/ui/Sheet';
import { IconButton } from '../components/ui/Button';
import { feedbackConfigured } from '../lib/feedback';
import { DataSection } from '../components/settings/DataSection';
import { FeedbackCard } from '../components/settings/FeedbackCard';
import { cx } from '../lib/utils';
import { dayKey, fmtDuration, parseHM, settingsForDay, spanMinutes } from '../lib/time';
import { effectiveWeekday } from '../lib/holidays';

type TabId = 'appearance' | 'schedule' | 'courses' | 'background' | 'dates' | 'data';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: '外观', icon: <Palette /> },
  { id: 'schedule', label: '作息', icon: <TimerIcon /> },
  { id: 'courses', label: '课程', icon: <Table2 /> },
  { id: 'background', label: '背景', icon: <ImageIcon /> },
  { id: 'dates', label: '日期', icon: <CalendarClock /> },
  { id: 'data', label: '数据', icon: <Database /> },
];

/** 旧链接 / 别名 → 实际标签。glass 曾作为独立分类，现并入「外观」 */
const TAB_ALIAS: Record<string, TabId> = {
  schedule: 'schedule',
  timetable: 'courses',
  theme: 'appearance',
  appearance: 'appearance',
  glass: 'appearance',
  courses: 'courses',
  background: 'background',
  dates: 'dates',
  data: 'data',
};

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 应用使用 HashRouter，`?tab=` 不可靠，所以用路径段：#/settings/dates
  const sub = location.pathname.split('/').filter(Boolean)[1] ?? null;
  const settings = useStore((s) => s.settings);
  const courses = useStore((s) => s.courses);
  const dayOverrides = useStore((s) => s.dayOverrides);
  const time = useTimeStore();

  const initial = useMemo<TabId>(() => (sub ? (TAB_ALIAS[sub] ?? 'appearance') : 'appearance'), [sub]);
  const [tab, setTab] = useState<TabId>(initial);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    setTab(initial);
  }, [initial]);

  const select = (id: TabId) => {
    setTab(id);
    navigate(`/settings/${id}`, { replace: true });
  };

  /*
   * 头部这几项汇总必须是**今天真正生效**的那一套：
   * 学习窗口和每日学习目标都能按星期几单独设，读全局默认值会在周末显示与实际不符的数字。
   * weekday 走 effectiveWeekday（与 useDayPlan 同一套解析）——
   * 直接用 new Date().getDay() 会让调课日的窗口与目标不同步。
   */
  const todaySettings = settingsForDay(settings, effectiveWeekday(dayKey(Date.now()), dayOverrides));
  const windowMin = (() => {
    const from = parseHM(todaySettings.studyFrom);
    const to = parseHM(todaySettings.studyTo);
    return from !== null && to !== null ? spanMinutes(from, to) : 0;
  })();

  return (
    <div className="space-y-3.5">
      <header className="px-1 pt-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
          {/*
            意见箱入口：用户要求放在设置主界面右上角、点开才显示内容
            （原来是直接嵌在【数据】里）。没配置接收地址时**不显示** ——
            这条是既有的诚实性纪律，test-feedback 有断言。
          */}
          {feedbackConfigured() && (
            <IconButton label="意见箱" size="sm" onClick={() => setFeedbackOpen(true)}>
              <MessageSquarePlus className="size-4" />
            </IconButton>
          )}
        </div>
        <p className="mt-0.5 text-xs text-secondary">
          目标 {fmtDuration(todaySettings.dailyGoalMinutes)}/天 · 课程 {courses.length} 门 · 学习窗口{' '}
          {fmtDuration(windowMin)} · 时间
          {time.status === 'ok' ? `已校准（${SOURCE_LABEL[time.source]}）` : '未校准'}
        </p>
      </header>

      {/* 分类标签：横滑，手机上不换行挤压 */}
      <div className="scroll-x -mx-4 gap-1.5 px-4 pb-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t.id)}
            className={cx(
              'snap-item flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[0.8rem] font-medium transition-colors duration-200',
              '[&>svg]:size-4',
              tab === t.id
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="anim-fade">
        {tab === 'appearance' && (
          <div className="space-y-3">
            <AppearanceSection />
            {/* 透明玻璃的参数并入「外观」，不再单独占一个分类 */}
            <GlassSection />
            {/* 首页长按拖动只有指针路径，这里给键盘用户一个等价入口 */}
            <HomeOrderList />
          </div>
        )}
        {tab === 'schedule' && <ScheduleSection />}
        {tab === 'courses' && <CoursesSection />}
        {tab === 'background' && <BackgroundSection />}
        {tab === 'dates' && <DatesSection />}
        {tab === 'data' && <DataSection />}

      {/*
        意见箱：点右上角按钮才展开。内容仍是原来的 FeedbackCard，
        行为（默认只带版本+平台、失败时内容不丢）完全不变。
      */}
      <Sheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} title="意见箱">
        <FeedbackCard />
      </Sheet>
      </div>
    </div>
  );
}
