import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Clock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Sheet, ConfirmSheet } from '../ui/Sheet';
import { useStore } from '../../lib/store';
import { WEEKDAY_LABELS, WEEKDAY_SHORT } from '../../lib/types';
import type { Course, Period, Weekday } from '../../lib/types';
import { fmtDuration, parseHM, spanMinutes, toWeekday } from '../../lib/time';
import { cx } from '../../lib/utils';

const SUBJECTS = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
  '政治',
  '历史',
  '地理',
  '体育',
  '信息',
  '其他',
];

/**
 * 课程表设置
 * ──────────────────────────────────────────────
 * 手机优先：不做横向滚动的巨型表格，而是「先选星期，再看当天节次」。
 * 节次时间完全可编辑，不写死任何学校的时间安排。
 */
export function CoursesSection() {
  const courses = useStore((s) => s.courses);
  const periods = useStore((s) => s.periods);
  const removeCourse = useStore((s) => s.removeCourse);
  const resetPeriods = useStore((s) => s.resetPeriods);

  const [day, setDay] = useState<Weekday>(() => toWeekday(new Date().getDay()));
  const [editingCourse, setEditingCourse] = useState<{
    course?: Course;
    periodId?: string | null;
  } | null>(null);
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);
  const [addingPeriod, setAddingPeriod] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const dayCourses = useMemo(() => courses.filter((c) => c.weekday === day), [courses, day]);
  const byPeriod = useMemo(() => {
    const map = new Map<string, Course>();
    for (const c of dayCourses) if (c.periodId) map.set(c.periodId, c);
    return map;
  }, [dayCourses]);

  const looseCourses = dayCourses.filter((c) => !c.periodId);

  const periodMinutes = periods.reduce((acc, p) => {
    const s = parseHM(p.start);
    const e = parseHM(p.end);
    return acc + (s !== null && e !== null ? spanMinutes(s, e) : 0);
  }, 0);

  return (
    <div className="space-y-3">
      {/* 节次时间 */}
      <Card padding="md">
        <CardTitle
          icon={<Clock />}
          title="节次时间"
          subtitle={`共 ${periods.length} 节 · 全天 ${fmtDuration(periodMinutes)}`}
          action={
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAddingPeriod(true)}
                className="flex min-h-11 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3.5 text-[0.72rem] font-semibold text-[var(--accent-on-soft)]"
              >
                <Plus className="size-3.5" />
                添加
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                aria-label="恢复默认节次"
                className="grid size-11 place-items-center rounded-full text-tertiary"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
          }
        />
        <div className="space-y-1.5">
          {periods.map((p, i) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-xl bg-[var(--surface-sunken)] px-3 py-2"
            >
              <span className="tnum w-6 shrink-0 text-center text-[0.72rem] font-semibold text-tertiary">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => setEditingPeriod(p)}
                className="min-h-11 min-w-0 flex-1 text-left"
              >
                <p className="truncate text-[0.85rem] font-medium">{p.name}</p>
                <p className="tnum text-[0.7rem] text-secondary">
                  {p.start} – {p.end}
                  <span className="ml-1.5 text-tertiary">
                    {fmtDuration(spanMinutes(parseHM(p.start) ?? 0, parseHM(p.end) ?? 0))}
                  </span>
                </p>
              </button>
              <PeriodOrderButtons id={p.id} />
            </div>
          ))}
        </div>
      </Card>

      {/* 当天课程 */}
      <Card padding="md">
        <CardTitle
          icon={<BookOpen />}
          title="课程安排"
          subtitle="点某节课即可添加或修改"
          action={
            <button
              type="button"
              onClick={() => setEditingCourse({})}
              className="flex min-h-11 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3.5 text-[0.72rem] font-semibold text-[var(--accent-on-soft)]"
            >
              <Plus className="size-3.5" />
              加课
            </button>
          }
        />

        {/* 星期选择。
            触控下限是 44px，而 7 个 44px 需要 308px，卡片内容区只有 296px —— 物理上放不下。
            卡片左右各有 16px 内边距，让这一行外扩 12px（-mx-3）即可腾出空间：
            (296 + 24 - 6×2) / 7 ≈ 44px，同时距卡片边缘仍留 4px。
            间隙用 2px 而不是 4px，也是为同样目的。 */}
        <div className="-mx-3 mb-3 grid grid-cols-7 gap-0.5">
          {WEEKDAY_LABELS.map((lb, i) => {
            const has = courses.some((c) => c.weekday === i);
            return (
              <button
                key={lb}
                type="button"
                onClick={() => setDay(i as Weekday)}
                className={cx(
                  'relative min-h-12 rounded-xl border text-[0.78rem] font-medium transition-colors duration-200',
                  day === i
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {WEEKDAY_SHORT[i]}
                {has && (
                  <span
                    className={cx(
                      'absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full',
                      day === i ? 'bg-[var(--accent)]' : 'bg-[var(--text-tertiary)]',
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          {periods.map((p) => {
            const c = byPeriod.get(p.id);
            return (
              <div
                key={p.id}
                className={cx(
                  'flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 transition-colors duration-200',
                  c
                    ? 'border-[var(--line)] bg-[var(--surface-sunken)]'
                    : 'border-dashed border-[var(--line-strong)] bg-transparent',
                )}
              >
                {/*
                 * 原来是 <button> 里嵌套一个 role="button" 的删除块 —— HTML 不允许按钮嵌套，
                 * 读屏会把两层按钮读成一团。现在外层是 div，里面并排两个真按钮：
                 * 左边编辑（占满剩余宽度），右边删除（44×44）。
                 */}
                <button
                  type="button"
                  onClick={() => setEditingCourse({ course: c, periodId: p.id })}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="tnum w-[4.1rem] shrink-0 text-[0.72rem] font-medium text-secondary">
                    {p.start}
                    <span className="text-tertiary">–{p.end}</span>
                  </span>
                  {c ? (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.88rem] font-medium">
                        {c.title || c.subject}
                      </span>
                      <span className="block truncate text-[0.7rem] text-tertiary">
                        {c.subject}
                        {c.location ? ` · ${c.location}` : ''}
                        {c.teacher ? ` · ${c.teacher}` : ''}
                      </span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 text-[0.82rem] text-tertiary">
                      {p.name} · 未安排
                    </span>
                  )}
                </button>
                {c && (
                  <button
                    type="button"
                    aria-label={`删除 ${c.title || c.subject}`}
                    onClick={() => removeCourse(c.id)}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-tertiary hover:text-[var(--bad-text)]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {looseCourses.length > 0 && (
          <div className="mt-3 border-t border-[var(--line)] pt-3">
            <p className="mb-2 text-[0.7rem] font-medium text-tertiary">
              这些课程没有绑定节次时间
            </p>
            <div className="space-y-1.5">
              {looseCourses.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-xl bg-[var(--surface-sunken)] px-3 py-2"
                >
                  <span className="tnum w-[4.1rem] shrink-0 text-[0.7rem] text-secondary">
                    {c.start}–{c.end}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingCourse({ course: c })}
                    className="min-h-11 min-w-0 flex-1 truncate text-left text-[0.85rem]"
                  >
                    {c.title || c.subject}
                  </button>
                  <button
                    type="button"
                    aria-label="删除课程"
                    onClick={() => removeCourse(c.id)}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-tertiary hover:text-[var(--bad-text)]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-3 text-[0.7rem] leading-relaxed text-tertiary">
          课程表决定首页「今日课程」和可支配时间里的上课占用，请如实填写。
        </p>
      </Card>

      <CourseSheet
        open={editingCourse !== null}
        day={day}
        course={editingCourse?.course}
        periodId={editingCourse?.periodId ?? null}
        onClose={() => setEditingCourse(null)}
      />
      <PeriodSheet
        open={addingPeriod || editingPeriod !== null}
        period={editingPeriod ?? undefined}
        onClose={() => {
          setAddingPeriod(false);
          setEditingPeriod(null);
        }}
      />

      <ConfirmSheet
        open={confirmReset}
        title="恢复默认节次时间？"
        message="只会重置节次名称与时间，已安排的课程会保留。"
        confirmText="恢复默认"
        onConfirm={resetPeriods}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

function PeriodOrderButtons({ id }: { id: string }) {
  const movePeriod = useStore((s) => s.movePeriod);
  return (
    <span className="flex shrink-0 flex-col">
      <button
        type="button"
        aria-label="上移"
        onClick={() => movePeriod(id, -1)}
        className="grid size-11 place-items-center rounded text-tertiary hover:text-[var(--text)]"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        aria-label="下移"
        onClick={() => movePeriod(id, 1)}
        className="grid size-11 place-items-center rounded text-tertiary hover:text-[var(--text)]"
      >
        <ChevronDown className="size-4" />
      </button>
    </span>
  );
}

function CourseSheet({
  open,
  day,
  course,
  periodId,
  onClose,
}: {
  open: boolean;
  day: Weekday;
  course?: Course;
  periodId: string | null;
  onClose: () => void;
}) {
  const periods = useStore((s) => s.periods);
  const addCourse = useStore((s) => s.addCourse);
  const updateCourse = useStore((s) => s.updateCourse);
  const removeCourse = useStore((s) => s.removeCourse);

  const editing = Boolean(course);
  const [subject, setSubject] = useState(course?.subject ?? '数学');
  const [title, setTitle] = useState(course?.title ?? '');
  const [period, setPeriod] = useState<string | null>(course?.periodId ?? periodId);
  const [location, setLocation] = useState(course?.location ?? '');
  const [teacher, setTeacher] = useState(course?.teacher ?? '');
  const [weekday, setWeekday] = useState<Weekday>(course?.weekday ?? day);
  const [customStart, setCustomStart] = useState(course?.start ?? '18:00');
  const [customEnd, setCustomEnd] = useState(course?.end ?? '19:00');

  const key = `${open}-${course?.id ?? 'new'}-${periodId ?? ''}`;
  const [init, setInit] = useState<string | null>(null);
  if (open && init !== key) {
    setInit(key);
    setSubject(course?.subject ?? '数学');
    setTitle(course?.title ?? '');
    setPeriod(course?.periodId ?? periodId ?? null);
    setLocation(course?.location ?? '');
    setTeacher(course?.teacher ?? '');
    setWeekday(course?.weekday ?? day);
    setCustomStart(course?.start ?? '18:00');
    setCustomEnd(course?.end ?? '19:00');
  }

  const save = () => {
    const payload = {
      subject,
      title: title.trim() || subject,
      periodId: period,
      weekday,
      location: location.trim() || undefined,
      teacher: teacher.trim() || undefined,
      start: period ? undefined : customStart,
      end: period ? undefined : customEnd,
    };
    if (course) updateCourse(course.id, payload);
    else addCourse(payload);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? '编辑课程' : '添加课程'}
      footer={
        <div className="flex gap-2">
          {editing && (
            <Button
              variant="secondary"
              size="lg"
              icon={<Trash2 />}
              className="text-[var(--bad-text)]"
              onClick={() => {
                if (course) removeCourse(course.id);
                onClose();
              }}
            >
              删除
            </Button>
          )}
          <Button size="lg" block onClick={save}>
            保存
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">科目</span>
          <div className="flex flex-wrap gap-1.5">
            {SUBJECTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSubject(s);
                  if (!title.trim()) setTitle(s);
                }}
                className={cx(
                  'min-h-11 rounded-full border px-3.5 text-[0.8rem] font-medium transition-colors duration-200',
                  subject === s
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">课程名称</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={subject}
            className="field min-h-12"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">星期</span>
          <div className="flex gap-1">
            {WEEKDAY_LABELS.map((lb, i) => (
              <button
                key={lb}
                type="button"
                onClick={() => setWeekday(i as Weekday)}
                className={cx(
                  'min-h-12 flex-1 rounded-xl border text-[0.76rem] font-medium transition-colors duration-200',
                  weekday === i
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {WEEKDAY_SHORT[i]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">第几节</span>
          <select
            value={period ?? ''}
            onChange={(e) => setPeriod(e.target.value || null)}
            className="field min-h-12"
          >
            <option value="">不绑定节次（自定义时间）</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.start}–{p.end}）
              </option>
            ))}
          </select>
          {!period && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="time"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="field tnum min-h-12"
              />
              <input
                type="time"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="field tnum min-h-12"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">地点（可选）</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="高二(3)班"
              className="field min-h-12"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">老师（可选）</span>
            <input
              value={teacher}
              onChange={(e) => setTeacher(e.target.value)}
              placeholder="王老师"
              className="field min-h-12"
            />
          </label>
        </div>
      </div>
    </Sheet>
  );
}

function PeriodSheet({
  open,
  period,
  onClose,
}: {
  open: boolean;
  period?: Period;
  onClose: () => void;
}) {
  const addPeriod = useStore((s) => s.addPeriod);
  const updatePeriod = useStore((s) => s.updatePeriod);
  const removePeriod = useStore((s) => s.removePeriod);

  const [name, setName] = useState(period?.name ?? '');
  const [start, setStart] = useState(period?.start ?? '18:00');
  const [end, setEnd] = useState(period?.end ?? '18:45');

  const key = `${open}-${period?.id ?? 'new'}`;
  const [init, setInit] = useState<string | null>(null);
  if (open && init !== key) {
    setInit(key);
    setName(period?.name ?? '');
    setStart(period?.start ?? '18:00');
    setEnd(period?.end ?? '18:45');
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={period ? '编辑节次' : '添加节次'}
      footer={
        <div className="flex gap-2">
          {period && (
            <Button
              variant="secondary"
              size="lg"
              icon={<Trash2 />}
              className="text-[var(--bad-text)]"
              onClick={() => {
                removePeriod(period.id);
                onClose();
              }}
            >
              删除
            </Button>
          )}
          <Button
            size="lg"
            block
            disabled={!name.trim()}
            onClick={() => {
              if (period) updatePeriod(period.id, { name: name.trim(), start, end });
              else addPeriod({ name: name.trim(), start, end, counts: true });
              onClose();
            }}
          >
            保存
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">名称</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="第 1 节 / 晚自习"
            className="field min-h-12"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">开始</span>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="field tnum min-h-12"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">结束</span>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="field tnum min-h-12"
            />
          </label>
        </div>
      </div>
    </Sheet>
  );
}
