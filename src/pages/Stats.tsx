import { useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  Flame,
  LineChart,
  School,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { useNow } from '../hooks/useNow';
import { useScheduleToday, classMinutesInRange } from '../hooks/useSchedule';
import { toDayISO } from '../lib/lunar';
import { COURSE_STATUS_LABEL } from '../lib/types';
import { Card, CardTitle } from '../components/ui/Card';
import { EvaluationCard } from '../components/stats/EvaluationCard';
import { AchievementsPanel } from '../components/stats/AchievementsPanel';
import { ExamScoresCard } from '../components/stats/ExamScoresCard';
import { Progress } from '../components/ui/Progress';
import { BarChart, StatTile, SubjectBars } from '../components/charts/BarChart';
import { StudyCalendar } from '../components/stats/StudyCalendar';
import { StudyHeatmap } from '../components/stats/StudyHeatmap';
import {
  computeStats,
  dailyBars,
  monthBars,
  planVsActual,
  rangeBounds,
  weekBars,
  type RangeKey,
} from '../lib/stats';
import { dayKey, fmtDuration, monthDayLabel, settingsForDay, timeLabel } from '../lib/time';
import { computeStreakState } from '../lib/streak';
import { effectiveWeekday } from '../lib/holidays';
import { cx } from '../lib/utils';

type ChartMode = 'day' | 'week' | 'month';
type Metric = 'time' | 'plan';
/** 统计页的子标签。概览保留原有内容，另两个是新增的逐日视图 */
type StatsTab = 'overview' | 'calendar' | 'heatmap' | 'exam' | 'achievements';

const TABS: Array<{ id: StatsTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'calendar', label: '日历' },
  { id: 'heatmap', label: '热力图' },
  { id: 'exam', label: '成绩' },
  { id: 'achievements', label: '成就' },
];

/**
 * 统计页面
 * 所有数字都来自真实 sessions / goals，没有任何占位数据。
 * 区间：今日 / 本周 / 本月（要求十五）
 */
export function Stats() {
  const sessions = useStore((s) => s.sessions);
  const goals = useStore((s) => s.goals);
  const settings = useStore((s) => s.settings);
  const courses = useStore((s) => s.courses);
  const periods = useStore((s) => s.periods);
  const courseStatus = useStore((s) => s.courseStatus);
  const dayOverrides = useStore((s) => s.dayOverrides);
  const streakRescues = useStore((s) => s.streakRescues);
  const ts = useNow();
  const { instances: courseInstances, summary: courseSummary } = useScheduleToday();

  /* 每日目标能按星期几单独设，所以这里要取今天真正生效的那个（调课日按调课星期几） */
  const dayGoalMinutes = useMemo(
    () => settingsForDay(settings, effectiveWeekday(dayKey(ts), dayOverrides)).dailyGoalMinutes,
    [settings, dayOverrides, ts],
  );

  const [range, setRange] = useState<RangeKey>('week');
  const [mode, setMode] = useState<ChartMode>('week');
  const [metric, setMetric] = useState<Metric>('time');
  const [tab, setTab] = useState<StatsTab>('overview');

  const bounds = useMemo(() => rangeBounds(range, ts), [range, ts]);
  const summary = useMemo(
    () => computeStats(sessions, goals, bounds, ts),
    [sessions, goals, bounds, ts],
  );

  /*
   * 上课占用（本区间）。
   * 与上面的「学习总时长」是两种性质的时间，用户要求分开显示：
   *   · 学习总时长 = 自学（sessions），这是「学习时长」
   *   · 上课占用   = 课表安排（含放假/调休/请假调课的处理），不计入学习时长
   * 逐日算再累加 —— 因为放假与调休是按日期变的，不能拿周课表乘周数。
   */
  const classMinutes = useMemo(() => {
    const from = toDayISO(new Date(bounds.start));
    const to = toDayISO(new Date(bounds.end));
    return classMinutesInRange(from, to, courses, periods, courseStatus, dayOverrides);
  }, [bounds, courses, periods, courseStatus, dayOverrides]);
  const allTimeSummary = useMemo(
    () =>
      computeStats(
        sessions,
        goals,
        { start: 0, end: Number.MAX_SAFE_INTEGER, label: '全部', days: 1 },
        ts,
      ),
    [sessions, goals, ts],
  );

  const chartData = useMemo(() => {
    if (mode === 'day') return dailyBars(sessions, ts, 14);
    if (mode === 'week') return weekBars(sessions, ts);
    return monthBars(sessions, ts);
  }, [mode, sessions, ts]);

  const planData = useMemo(
    () => planVsActual(goals, ts, mode === 'day' ? 14 : 7),
    [goals, ts, mode],
  );
  const subjectMax = summary.subjects[0]?.minutes ?? 1;

  /*
   * 连续天数走统一的火花状态（含接回账本校验）。
   * 不能直接用 computeStats 里的 streak：那里只有原始 sessions，
   * 断签后会把「已断」显示成「未开始」，也不认识接回。
   */
  const streakState = useMemo(
    () => computeStreakState(sessions, streakRescues, ts),
    [sessions, streakRescues, ts],
  );

  return (
    <div className="stats-page space-y-4">
      <header className="px-1 pb-1 pt-1">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">统计</h1>
        <p className="mt-1.5 text-xs text-secondary">
          共 {allTimeSummary.sessionCount} 段学习记录 · 累计{' '}
          {fmtDuration(Math.round(allTimeSummary.totalMinutes))}
        </p>
      </header>

      {/* 子标签。概览 = 原有内容；日历与热力图是逐日视图，
          数据同样全部来自真实 sessions，没有记录的天就是 0。 */}
      <div className="stats-tabs flex gap-1 p-1" role="group" aria-label="统计视图">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cx(
              'min-h-11 flex-1 rounded-full text-[0.85rem] font-semibold transition-colors duration-200',
              tab === t.id ? 'stats-tab-selected' : 'text-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'calendar' && (
        <Card padding="md">
          <CardTitle icon={<CalendarDays />} title="学习日历" subtitle="点某一天看当天明细" />
          <StudyCalendar sessions={sessions} nowTs={ts} />
        </Card>
      )}

      {tab === 'heatmap' && (
        <Card padding="md">
          <CardTitle icon={<Flame />} title="学习热力图" subtitle="近半年的坚持情况" />
          <StudyHeatmap sessions={sessions} nowTs={ts} />
        </Card>
      )}

      {tab === 'achievements' && <AchievementsPanel />}

      {tab === 'exam' && <ExamScoresCard />}

      {tab === 'overview' && (
        <EvaluationCard />
      )}

      {tab === 'overview' && (
        <>
      {/* 区间切换：与全 app 的药丸分段控件保持同一语言 */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs font-medium text-secondary">统计范围</span>
        <div className="stats-range flex gap-1" role="group" aria-label="统计范围">
        {(
          [
            { id: 'today' as const, label: '今日' },
            { id: 'week' as const, label: '本周' },
            { id: 'month' as const, label: '本月' },
          ] as const
        ).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            aria-pressed={range === r.id}
            className={cx(
              'min-h-11 min-w-14 rounded-full px-3 text-xs font-semibold transition-colors duration-200',
              range === r.id
                ? 'bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                : 'text-secondary',
            )}
          >
            {r.label}
          </button>
        ))}
        </div>
      </div>

      {/* 关键指标 */}
      <div className="stats-summary grid grid-cols-2 gap-3">
        <StatTile
          label={`${bounds.label}自学时长`}
          value={fmtDuration(Math.round(summary.totalMinutes))}
          sub={`${summary.sessionCount} 段记录 · 不含上课`}
          tone="accent"
        />
        <StatTile
          label={`${bounds.label}上课占用`}
          value={classMinutes > 0 ? fmtDuration(Math.round(classMinutes)) : '无'}
          sub={classMinutes > 0 ? '学校安排 · 不计入学习时长' : '本区间没有课'}
        />
        <StatTile
          label="日均学习"
          value={fmtDuration(Math.round(summary.averageMinutesPerDay))}
          sub={`有记录的 ${summary.activeDays} 天，日均 ${fmtDuration(
            Math.round(summary.averageMinutesPerActiveDay),
          )}`}
        />
        <StatTile
          label="连续学习"
          value={
            streakState.streak > 0
              ? `${streakState.streak} 天`
              : streakState.activeDayKeys.length > 0
                ? '已断'
                : '未开始'
          }
          sub={`最长连续 ${streakState.longest} 天`}
          tone={streakState.streak > 0 ? 'ok' : undefined}
        />
        <StatTile
          label="目标完成率"
          value={summary.goalsTotal > 0 ? `${Math.round(summary.goalCompletionRate)}%` : '—'}
          sub={
            summary.goalsTotal > 0
              ? `${summary.goalsDone} / ${summary.goalsTotal} 个目标`
              : '本期还没有目标'
          }
        />
      </div>

      {/* 交互式条形图 */}
      <Card padding="md">
        <CardTitle
          icon={<BarChart3 />}
          title="学习时长分布"
          subtitle={
            mode === 'week' ? '本周一至周日' : mode === 'month' ? '本月每一天' : '最近 14 天'
          }
        />

        {/* 时间粒度与指标是两组独立选择，分两行放，避免窄屏下换行错乱。
            这两组是卡内的高频切换控件，沿用「中性实底」选中态：
            它自带约 15:1 对比度，而 accent 浅底 + accent 文字在浅色主题下只有
            约 4:1（全 app 既有的页级标签就是这个量级，属于既有问题）。 */}
        <div className="mb-3 space-y-1.5">
          <div className="flex gap-1.5">
            {(
              [
                { id: 'day' as const, label: '按日' },
                { id: 'week' as const, label: '按周' },
                { id: 'month' as const, label: '按月' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={cx(
                  'min-h-11 flex-1 rounded-full px-3.5 text-[0.78rem] font-medium transition-colors duration-200',
                  mode === m.id
                    ? 'bg-[var(--text)] text-[var(--text-invert)]'
                    : 'bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {(
              [
                { id: 'time' as const, label: '学习时长' },
                { id: 'plan' as const, label: '计划 vs 实际' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetric(m.id)}
                className={cx(
                  'min-h-11 flex-1 rounded-full px-3.5 text-[0.78rem] font-medium transition-colors duration-200',
                  metric === m.id
                    ? 'bg-[var(--text)] text-[var(--text-invert)]'
                    : 'bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {metric === 'time' ? (
          <BarChart
            data={chartData}
            height={176}
            emptyHint="这段时间还没有学习记录，去计时页开始第一段吧"
          />
        ) : (
          <BarChart data={planData} planned height={176} emptyHint="还没有带计划时长的目标" />
        )}
      </Card>

      {/* 各科分布 */}
      <Card padding="md">
        <CardTitle
          icon={<LineChart />}
          title="各科学习时间"
          subtitle={`${bounds.label} · ${summary.subjects.length} 个科目`}
        />
        <SubjectBars items={summary.subjects} max={subjectMax} />
      </Card>

      {/* 计划 vs 实际 */}
      <Card padding="md">
        <CardTitle icon={<Target />} title="计划与实际" subtitle={`${bounds.label}目标口径`} />
        {summary.goalsTotal === 0 ? (
          <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2.5 text-center text-[0.72rem] text-secondary">
            本期还没有目标，创建一个就能看到计划与实际的差距
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2.5">
              <StatTile label="计划" value={fmtDuration(Math.round(summary.plannedMinutes))} />
              <StatTile
                label="实际"
                value={fmtDuration(Math.round(summary.actualMinutes))}
                tone="accent"
              />
              <StatTile
                label={summary.planDriftMinutes >= 0 ? '超出' : '节省'}
                value={fmtDuration(Math.abs(Math.round(summary.planDriftMinutes)))}
                tone={summary.planDriftMinutes >= 0 ? 'warn' : 'ok'}
              />
            </div>
            <Progress
              label="实际时间 / 计划时间"
              right={`${Math.round(
                summary.plannedMinutes > 0
                  ? (summary.actualMinutes / summary.plannedMinutes) * 100
                  : 0,
              )}%`}
              percent={
                summary.plannedMinutes > 0 ? (summary.actualMinutes / summary.plannedMinutes) * 100 : 0
              }
              tone="accent"
            />
          </div>
        )}
      </Card>

      {/* 课程完成情况 —— 与学习时长严格分开。
          课程是「学校安排了什么」，学习是「我实际学了多久」，两者不是一回事，
          所以既不合并进总时长，也不放在学习图表里。 */}
      <Card padding="md">
        <CardTitle
          icon={<School />}
          title="课程完成情况"
          subtitle="只统计今天的课表，与学习时长互不相干"
          action={
            courseSummary.total > 0 ? (
              <span className="pill pill-muted">{Math.round(courseSummary.rate)}%</span>
            ) : undefined
          }
        />
        {courseSummary.total === 0 ? (
          <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2.5 text-center text-[0.72rem] text-secondary">
            今天没有课程安排
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <StatTile label="今天课程" value={`${courseSummary.total} 节`} />
              <StatTile label="已上完" value={`${courseSummary.attended} 节`} tone="ok" />
              <StatTile label="未确认" value={`${courseSummary.unconfirmed} 节`} />
              <StatTile label="请假调课" value={`${courseSummary.cancelled} 节`} tone="warn" />
            </div>
            <div className="space-y-1.5">
              {courseInstances.map((inst) => (
                <div key={inst.key} className="flex items-center gap-2.5 text-[0.8rem]">
                  <span className="tnum w-[4.1rem] shrink-0 text-[0.7rem] text-tertiary">
                    {inst.startLabel}
                  </span>
                  <span
                    className={cx(
                      'min-w-0 flex-1 truncate',
                      inst.cancelled && 'text-tertiary line-through',
                    )}
                  >
                    {inst.course.title || inst.course.subject}
                  </span>
                  <span
                    className={cx(
                      'pill shrink-0',
                      inst.status === 'attended'
                        ? 'pill-ok'
                        : inst.status === 'unconfirmed'
                          ? 'pill-muted'
                          : 'pill-warn',
                    )}
                  >
                    {COURSE_STATUS_LABEL[inst.status]}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[0.7rem] leading-relaxed text-tertiary">
              课程状态只用于记录你是否上了这节课。学校上课时间不计入学习时长 ——
              上面的学习数据全部来自计时器与手动补录。
            </p>
          </div>
        )}
      </Card>

      {/* 亮点记录 */}
      <Card padding="md">
        <CardTitle icon={<Trophy />} title="值得一提" />
        <div className="space-y-2.5 text-[0.82rem]">
          <Highlight
            icon={<Flame />}
            label="连续学习"
            value={
              streakState.streak > 0
                ? `${streakState.streak} 天`
                : `最长曾连续 ${streakState.longest} 天`
            }
          />
          <Highlight
            icon={<CalendarDays />}
            label="最常学习科目"
            value={
              allTimeSummary.topSubject
                ? `${allTimeSummary.topSubject.subject} · ${fmtDuration(
                    Math.round(allTimeSummary.topSubject.minutes),
                  )}`
                : '—'
            }
          />
          <Highlight
            icon={<TrendingUp />}
            label="最长一次学习"
            value={
              allTimeSummary.longestSessionAt
                ? `${fmtDuration(Math.round(allTimeSummary.longestSessionMinutes))} · ${monthDayLabel(
                    allTimeSummary.longestSessionAt,
                  )} ${timeLabel(allTimeSummary.longestSessionAt)}`
                : '—'
            }
          />
          <Highlight
            icon={<Target />}
            label="每日目标"
            value={`${fmtDuration(dayGoalMinutes)}（今日已完成 ${
              dayGoalMinutes > 0
                ? Math.round((summary.todayMinutes / dayGoalMinutes) * 100)
                : 0
            }%）`}
          />
        </div>
      </Card>
        </>
      )}
    </div>
  );
}

function Highlight({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-secondary)] [&>svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-secondary">{label}</span>
      <span className="tnum shrink-0 font-semibold">{value}</span>
    </div>
  );
}
