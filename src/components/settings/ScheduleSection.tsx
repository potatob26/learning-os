import { useState } from 'react';
import { AlarmClock, CalendarDays, CalendarRange, Clock, Moon, Plus, Target, Trash2, Utensils } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Sheet, ConfirmSheet } from '../ui/Sheet';
import { useStore } from '../../lib/store';
import { BLOCK_KIND_LABEL, WEEKDAY_SHORT } from '../../lib/types';
import type { BlockKind, DaySchedule, TimeBlock, Weekday } from '../../lib/types';
import { blocksForDay, computeDayPlan, fmtDuration, parseHM, settingsForDay, spanMinutes, toWeekday } from '../../lib/time';
import { buildDayCourses } from '../../hooks/useSchedule';
import { cx } from '../../lib/utils';

const KINDS: BlockKind[] = ['meal', 'commute', 'tutor', 'sport', 'hobby', 'chore', 'rest', 'other'];

/**
 * 把「字段名 + 值」组装成 `Partial<DaySchedule>`。
 *
 * 为什么要写成 switch 而不是 `{ [key]: value }`：变量键在 TypeScript 里会退化成
 * 索引签名，赋给 `Partial<DaySchedule>` 直接报错；用 `as` 强转能绕过，
 * 但那就等于放弃类型检查（而这里正是最该有类型保护的地方）。
 * 显式分流既过编译，也顺手把每个字段的值类型定死。
 */
function dayPatch(key: keyof DaySchedule, value: string | number): Partial<DaySchedule> {
  switch (key) {
    case 'studyFrom': return { studyFrom: String(value) };
    case 'studyTo': return { studyTo: String(value) };
    case 'schoolStart': return { schoolStart: String(value) };
    case 'schoolEnd': return { schoolEnd: String(value) };
    case 'wakeTime': return { wakeTime: String(value) };
    case 'sleepTime': return { sleepTime: String(value) };
    case 'dailyGoalMinutes': return { dailyGoalMinutes: Number(value) };
    default: return {};
  }
}

/**
 * 作息设置
 * 这里定义「可支配时间」的计算基础：
 *   学习窗口 − 上课 − 固定活动 = 可支配时间
 * 少填一项，剩余时间就会算错，所以在界面上明确说明。
 */
export function ScheduleSection() {
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  const setDaySchedule = useStore((s) => s.setDaySchedule);
  const clearDaySchedule = useStore((s) => s.clearDaySchedule);
  const applyDayToAll = useStore((s) => s.applyDayToAll);
  const addBlock = useStore((s) => s.addBlock);
  const updateBlock = useStore((s) => s.updateBlock);
  const removeBlock = useStore((s) => s.removeBlock);
  const courses = useStore((s) => s.courses);
  const periods = useStore((s) => s.periods);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TimeBlock | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TimeBlock | null>(null);

  const today = toWeekday(new Date().getDay());
  /* 正在编辑哪一天（仅「按星期几」模式下用）。默认停在今天 —— 常见操作就是「把今天调一下」。 */
  const [day, setDay] = useState<Weekday>(today);
  /*
   * 两种模式，必须让用户显式选，不能靠猜：
   *   · all    —— 全周相同：直接改全局默认值（**这是原来的行为**，所以默认停在这里）
   *   · perDay —— 按星期几：只给选中的那一天加覆盖
   *
   * 为什么需要这个开关：如果一上来就是「按星期几」，用户只想统一改一下作息，
   * 结果只有今天被改了、其余六天还是旧值 —— 那是个很难发现的坑。
   * 已有按天覆盖的数据（旧用户升级或之前设过）就默认进 perDay 模式。
   */
  const [mode, setMode] = useState<'all' | 'perDay'>(
    settings.byWeekday && Object.keys(settings.byWeekday).length > 0 ? 'perDay' : 'all',
  );
  const perDay = mode === 'perDay';

  /** 显示用的值：按天模式看「这天真正生效的」，否则看全局默认 */
  const view = perDay ? settingsForDay(settings, day) : settings;
  const override = settings.byWeekday?.[day];
  const overriddenKeys = override ? Object.keys(override).length : 0;

  const todayBlocks = blocksForDay(settings.blocks, today);

  /**
   * 写入某一项。
   * 全周模式写全局默认（patchSettings）；按天模式只写选中那天的覆盖（setDaySchedule）。
   * 这里绝不能一律用 patchSettings —— 那样「单独改周六」会把七天一起改掉。
   */
  const writeField = (key: keyof DaySchedule, value: string | number) => {
    if (perDay) setDaySchedule(day, dayPatch(key, value));
    else patch(dayPatch(key, value));
  };

  const windowMin = (() => {
    const from = parseHM(view.studyFrom);
    const to = parseHM(view.studyTo);
    if (from === null || to === null) return 0;
    return spanMinutes(from, to);
  })();

  const dailyBlockMinutes = settings.blocks
    .filter((b) => !b.weekdays || b.weekdays.length === 0 || b.weekdays.includes(today))
    .reduce((acc, b) => {
      const s = parseHM(b.start);
      const e = parseHM(b.end);
      return acc + (s !== null && e !== null ? spanMinutes(s, e) : 0);
    }, 0);

  /*
   * 「选中那一天」的可支配时间 —— 用来提示「目标是否超过了当天能学的时间」。
   *
   * 这里**直接复用生产环境的 computeDayPlan**，不另写一套估算：
   * 它有上课与固定活动重叠只扣一次的合并逻辑，自己再算一遍必然对不上。
   * nowTs 传当前时间：这里只读 availableMinutes（窗口 − 上课 − 固定活动），
   * 与「现在几点」无关，所以不会因为时钟不准而算错。
   */
  const dayAvailableMinutes = (() => {
    const classInstances = buildDayCourses(courses, periods, day, 0, {}, '')
      .filter((i) => !i.cancelled && i.endMin - i.startMin > 0)
      .map((i) => ({ startMin: i.startMin, endMin: i.endMin }));
    return computeDayPlan(Date.now(), settings, day, classInstances).availableMinutes;
  })();

  /* 目标超过当天可支配时间：**只提示，不改数字**（用户明确要求） */
  const goalOverWindow = view.dailyGoalMinutes > dayAvailableMinutes;

  /*
   * 清醒时段检查（1.3.0 给「起床」接上的真实用途）。
   *
   * 背景：`wakeTime`（起床）在这之前**只存不算** —— 用户填了完全没反应，
   * 比没有这个字段更糟。不能靠删掉解决（会丢用户已填的数据），所以给它真实作用：
   * 检查学习窗口是否落在「起床 ~ 睡觉」之内。**只提示，不改任何计算口径** ——
   * 可支配时间仍然是「窗口 − 上课 − 固定活动」，作息该由用户自己填对。
   *
   * 睡觉时间没填时回落到窗口终点，与 `computeDayPlan` 的 `sleepMin` 口径一致。
   */
  const windowFrom = parseHM(view.studyFrom);
  const windowTo = parseHM(view.studyTo);
  const wakeMin = parseHM(view.wakeTime);
  const sleepMin = parseHM(view.sleepTime) ?? windowTo;
  const startsBeforeWake = wakeMin !== null && windowFrom !== null && windowFrom < wakeMin;
  const endsAfterSleep = sleepMin !== null && windowTo !== null && windowTo > sleepMin;
  /** 窗口里"还在睡觉"的那一段，用来把提示说得具体 */
  const quietMin =
    startsBeforeWake && wakeMin !== null && windowFrom !== null ? wakeMin - windowFrom : 0;

  return (
    <div className="space-y-3">
      {/*
        模式开关放在最前面：全周相同（改全局默认，原来的行为）/ 按星期几（每天可不同）。
        原来学习窗口和每日作息都**只能全周一套** —— 工作日与周末不同也填不了，等于锁死。
      */}
      <Card padding="md">
        <CardTitle
          icon={<CalendarDays />}
          title="作息怎么设"
          subtitle="全周一样就选「全周相同」；周末和工作日差别大就选「按星期几」"
        />
        <div className="flex gap-1.5" role="group" aria-label="作息设置方式">
          {([['all', '全周相同'], ['perDay', '按星期几']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={cx(
                'min-h-11 flex-1 rounded-xl border text-[0.82rem] font-medium transition-colors duration-200',
                mode === id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
          {perDay
            ? '下面改的是「选中的那一天」；没单独设过的天继续跟随全周默认值。'
            : '下面改的是全周默认值，七天都跟着变。'}
        </p>
      </Card>

      {perDay && (
        <Card padding="md">
          <CardTitle title="选择星期" subtitle="圆点表示这天已单独设过" />
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_SHORT.map((label, i) => {
              const wd = i as Weekday;
              const on = day === wd;
              const custom = !!settings.byWeekday?.[wd];
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDay(wd)}
                  aria-pressed={on}
                  aria-label={`周${label}${custom ? '（已单独设置）' : ''}`}
                  className={cx(
                    'flex min-h-11 flex-col items-center justify-center rounded-xl border text-[0.8rem] font-medium transition-colors duration-200',
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                      : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                  )}
                >
                  {label}
                  {/* 小圆点 = 这天有单独设置，扫一眼就知道哪几天不一样 */}
                  <span
                    className={cx(
                      'mt-0.5 size-1.5 rounded-full',
                      custom ? 'bg-[var(--accent)]' : 'bg-transparent',
                    )}
                  />
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
            正在编辑 <b>周{WEEKDAY_SHORT[day]}</b>
            {day === today && '（今天）'}
            {overriddenKeys > 0
              ? ` · 这一天已单独设置 ${overriddenKeys} 项，其余跟随全周默认`
              : ' · 这天跟随全周默认，改动只作用于这一天'}
          </p>
          {overriddenKeys > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => applyDayToAll(day)}
                className="min-h-10 rounded-full bg-[var(--surface-sunken)] px-3.5 text-[0.72rem] font-medium text-secondary"
              >
                把周{WEEKDAY_SHORT[day]}应用到全部七天
              </button>
              <button
                type="button"
                onClick={() => clearDaySchedule(day)}
                className="min-h-10 rounded-full bg-[var(--surface-sunken)] px-3.5 text-[0.72rem] font-medium text-secondary"
              >
                恢复跟随默认
              </button>
            </div>
          )}
        </Card>
      )}
      <Card padding="md">
        <CardTitle
          icon={<CalendarRange />}
          title="学习窗口"
          subtitle="只有这个时间段内的时间才算「可支配」"
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">开始</span>
            <input
              type="time"
              value={view.studyFrom}
              onChange={(e) => writeField('studyFrom', e.target.value)}
              className="field tnum min-h-12"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">结束</span>
            <input
              type="time"
              value={view.studyTo}
              onChange={(e) => writeField('studyTo', e.target.value)}
              className="field tnum min-h-12"
            />
          </label>
        </div>
        <p className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
          周{WEEKDAY_SHORT[day]}窗口时长 {fmtDuration(windowMin)}
          {dailyBlockMinutes > 0 && `，今天扣除 ${fmtDuration(dailyBlockMinutes)} 的固定活动`}
        </p>
      </Card>

      <Card padding="md">
        <CardTitle
          icon={<AlarmClock />}
          title="每日作息"
          subtitle="上学、放学、起床、睡觉（可按星期几不同）"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="上课时间"
            value={view.schoolStart}
            onChange={(v) => writeField('schoolStart', v)}
          />
          <Field
            label="放学时间"
            value={view.schoolEnd}
            onChange={(v) => writeField('schoolEnd', v)}
          />
          <Field label="起床" value={view.wakeTime} onChange={(v) => writeField('wakeTime', v)} />
          <Field label="睡觉" value={view.sleepTime} onChange={(v) => writeField('sleepTime', v)} />
        </div>
        <p className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
          首页「距离睡觉」按这里的<b>睡觉</b>时间算（以前用的是学习窗口终点，那是「学到几点」，不是「几点睡」）。
          <br />
          <b>起床</b>时间用来检查上面两项是否落在清醒时段内（下面会提示）——
          它<b>不参与</b>可支配时间的计算。
        </p>
        {/*
          「起床 ~ 睡觉」= 清醒时段。
          ⚠️ 这段检查是 1.3.0 才有的：在此之前「起床」只存不算，是个死控件 ——
          用户填了却完全没反应，比没有这个字段更糟。
          现在它**真的参与检查**，但仍然是**只提示、不改任何计算口径**：
          可支配时间 = 窗口 − 上课 − 固定活动，与清醒时段无关（作息本就该由用户自己填对）。
        */}
        {(startsBeforeWake || endsAfterSleep) && (
          <p className="mt-2 rounded-xl bg-[var(--warn-soft)] px-3 py-2 text-[0.72rem] leading-relaxed text-[var(--warn-text)]">
            {startsBeforeWake &&
              `学习窗口从 ${view.studyFrom} 开始，早于起床时间 ${view.wakeTime}${
                quietMin > 0 ? `（约 ${fmtDuration(quietMin)} 在睡觉）` : ''
              }。`}
            {startsBeforeWake && endsAfterSleep && ' '}
            {endsAfterSleep &&
              `学习窗口到 ${view.studyTo}，晚于睡觉时间 ${view.sleepTime}。`}
            {' '}数字保留你填的，只是提醒一下。
          </p>
        )}
      </Card>

      {/*
        每日学习目标从「设置 → 数据」搬到这里。
        理由：它现在也能按星期几单独设，和上面两张卡共用同一个「全周相同 / 按星期几」开关，
        否则会出现两个标签页各有一套按星期几，很容易搞混。
      */}
      <Card padding="md">
        <CardTitle
          icon={<Target />}
          title="每日学习目标"
          subtitle="首页进度环与「今日目标」都按它算；作业多的时候按星期几单独调"
        />
        <div className="flex flex-wrap gap-1.5">
          {[60, 90, 120, 150, 180, 240, 300].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => writeField('dailyGoalMinutes', m)}
              className={cx(
                'min-h-11 rounded-full px-3.5 text-[0.76rem] font-medium transition-colors duration-200',
                view.dailyGoalMinutes === m
                  ? 'bg-[var(--text)] text-[var(--text-invert)]'
                  : 'bg-[var(--surface-sunken)] text-secondary',
              )}
            >
              {m >= 60 ? `${m / 60} 小时` : `${m} 分`}
            </button>
          ))}
        </div>
        {/* 快捷按钮只是常用值，不是上限：可以直接填任意分钟数（例如假期想学 8 小时） */}
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={5}
            step={5}
            value={view.dailyGoalMinutes}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, '');
              writeField('dailyGoalMinutes', raw === '' ? 5 : Math.min(99999, Number(raw)));
            }}
            aria-label="每日学习目标（分钟）"
            className="field tnum min-h-11 w-[4.6rem] shrink-0 text-center"
          />
          <span className="text-xs text-secondary">
            分钟（可填任意值，{fmtDuration(view.dailyGoalMinutes, 'long')}）
          </span>
        </div>
        <p className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
          周{WEEKDAY_SHORT[day]}可支配 {fmtDuration(dayAvailableMinutes)}（已扣上课与固定活动）
        </p>
        {/*
          超窗提示：**只提示，不动用户填的数字**（用户明确要求）。
          数字是用户自己定的计划，应用没资格替他改；但两者矛盾会让人以为算错了，
          所以说清楚差在哪。
        */}
        {goalOverWindow && (
          <p className="mt-2 rounded-xl bg-[var(--warn-soft)] px-3 py-2 text-[0.72rem] leading-relaxed text-[var(--warn-text)]">
            目标 {fmtDuration(view.dailyGoalMinutes, 'long')} 超过了周{WEEKDAY_SHORT[day]}的可支配时间{' '}
            {fmtDuration(dayAvailableMinutes, 'long')} —— 数字保留你填的，只是提醒一下这里学不满。
          </p>
        )}
      </Card>

      <Card padding="md">
        <CardTitle
          icon={<Utensils />}
          title="固定占用"
          subtitle="吃饭、补课、运动等每天固定要做的事"
          action={
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-11 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3.5 text-[0.72rem] font-semibold text-[var(--accent-on-soft)]"
            >
              <Plus className="size-3.5" />
              添加
            </button>
          }
        />
        {settings.blocks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-4 text-center text-[0.78rem] text-secondary">
            还没有固定活动。加上「晚饭 1 小时」这类条目，剩余可支配时间会更准。
          </p>
        ) : (
          <div className="space-y-1.5">
            {settings.blocks.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-xl bg-[var(--surface-sunken)] px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.88rem] font-medium">
                    {b.label}
                    <span className="ml-2 text-[0.7rem] font-normal text-tertiary">
                      {BLOCK_KIND_LABEL[b.kind]}
                    </span>
                  </p>
                  <p className="tnum text-[0.7rem] text-secondary">
                    {b.start} – {b.end}
                    <span className="ml-1.5 text-tertiary">{weekdaysLabel(b.weekdays)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(b)}
                  className="min-h-11 min-w-11 shrink-0 rounded-full px-2.5 text-[0.72rem] font-medium text-secondary"
                >
                  编辑
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${b.label}`}
                  onClick={() => setConfirmDelete(b)}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-tertiary hover:text-[var(--bad-text)]"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {todayBlocks.length > 0 && (
          <p className="mt-2.5 text-[0.7rem] text-tertiary">
            今天有 {todayBlocks.length} 项固定占用，共 {fmtDuration(dailyBlockMinutes)}。
          </p>
        )}
      </Card>

      <BlockSheet
        open={adding || editing !== null}
        block={editing ?? undefined}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSave={(data) => {
          if (editing) updateBlock(editing.id, data);
          else addBlock(data);
          setAdding(false);
          setEditing(null);
        }}
      />

      <ConfirmSheet
        open={confirmDelete !== null}
        title="删除这条固定活动？"
        message={confirmDelete ? `「${confirmDelete.label}」将不再占用可支配时间。` : undefined}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (confirmDelete) removeBlock(confirmDelete.id);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function weekdaysLabel(days?: Weekday[] | null): string {
  if (!days || days.length === 0 || days.length === 7) return '每天';
  if (days.length === 5 && days.every((d) => d <= 4)) return '工作日';
  return days.map((d) => `周${WEEKDAY_SHORT[d]}`).join(' ');
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-secondary">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field tnum min-h-12"
      />
    </label>
  );
}

export function BlockSheet({
  open,
  block,
  onClose,
  onSave,
}: {
  open: boolean;
  block?: TimeBlock;
  onClose: () => void;
  onSave: (data: Omit<TimeBlock, 'id'>) => void;
}) {
  const [label, setLabel] = useState(block?.label ?? '');
  const [kind, setKind] = useState<BlockKind>(block?.kind ?? 'meal');
  const [start, setStart] = useState(block?.start ?? '18:00');
  const [end, setEnd] = useState(block?.end ?? '19:00');
  const [days, setDays] = useState<Weekday[] | null>(block?.weekdays ?? null);
  const [initialized, setInitialized] = useState<string | null>(null);

  // 打开时同步一次数据（用 key 判断是哪一条）
  const key = `${open}-${block?.id ?? 'new'}`;
  if (open && initialized !== key) {
    setInitialized(key);
    setLabel(block?.label ?? '');
    setKind(block?.kind ?? 'meal');
    setStart(block?.start ?? '18:00');
    setEnd(block?.end ?? '19:00');
    setDays(block?.weekdays ?? null);
  }

  const toggleDay = (d: Weekday) => {
    const cur = days && days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setDays(next.length === 0 || next.length === 7 ? null : (next as Weekday[]));
  };

  const activeDays = days && days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={block ? '编辑固定活动' : '添加固定活动'}
      footer={
        <Button
          block
          size="lg"
          disabled={!label.trim()}
          onClick={() => onSave({ label: label.trim(), kind, start, end, weekdays: days })}
        >
          保存
        </Button>
      }
    >
      <div className="space-y-4 pb-1">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">名称</span>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：晚饭 / 篮球训练 / 数学补课"
            className="field min-h-12"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">类型</span>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cx(
                  'min-h-11 rounded-full border px-3 text-[0.78rem] font-medium transition-colors duration-200',
                  kind === k
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {BLOCK_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

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

        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">
            适用星期（默认每天）
          </span>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d as Weekday)}
                className={cx(
                  'min-h-12 flex-1 rounded-xl border text-[0.78rem] font-medium transition-colors duration-200',
                  activeDays.includes(d as Weekday)
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-tertiary',
                )}
              >
                {WEEKDAY_SHORT[d]}
              </button>
            ))}
          </div>
        </div>

        {spanMinutes(parseHM(start) ?? 0, parseHM(end) ?? 0) > 0 && (
          <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] text-secondary">
            每天占用 {fmtDuration(spanMinutes(parseHM(start) ?? 0, parseHM(end) ?? 0))}
          </p>
        )}

        <p className="flex items-start gap-1.5 text-[0.7rem] leading-relaxed text-tertiary">
          <Clock className="mt-0.5 size-3.5 shrink-0" />
          跨零点的时间也可以填，例如 23:30 – 00:30，系统会自动按跨天计算。
        </p>
        <Moon className="hidden" />
      </div>
    </Sheet>
  );
}
