import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useNow } from '../../hooks/useNow';
import { cx } from '../../lib/utils';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { toDayISO, parseDay, solarToLunar, lunarMonthName, lunarDayName } from '../../lib/lunar';
import { festivalsOf, monthGrid, type DayCell } from '../../lib/festivals';
import { CALENDAR_TONE_LABEL, WEEKDAY_LABELS, type CalendarTone, type Weekday } from '../../lib/types';
import { resolveDay } from '../../lib/holidays';
import { toWeekday } from '../../lib/time';

/* ==========================================================================
   日历（独立页面）
   ──────────────────────────────────────────────────────────────────────────
   这个模块与「重要日期」**完全独立**：
     · 重要日期 = 倒计时 / 记天数。写一个日期，没到就显示还有多少天，
       过了就显示已经多少天。首页那个大倒计时就是它。
     · 日历     = 按天标注。看年月日、农历、节日，在任意一天写点东西。
   两者不共享数据、也不互相显示。

   节日数据全部内置（见 lib/festivals）：应用本地优先、无后端、无 API。
   本页**只回答「今天是什么节日」，不回答「放不放假」** ——
   调休安排每年由国务院单独发布，硬编码会很快过期并给出错误信息。
   ========================================================================== */

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

const TONES: CalendarTone[] = ['default', 'study', 'exam', 'life'];

/** 标记色：用设计令牌，跟随主题与自定义强调色 */
const TONE_CLASS: Record<CalendarTone, string> = {
  default: 'bg-[var(--text-tertiary)]',
  study: 'bg-[var(--accent)]',
  exam: 'bg-[var(--danger)]',
  life: 'bg-[var(--warn)]',
};

/**
 * 日历视图。
 *
 * 两种用法共用同一份实现，避免两处各写一遍：
 *   · 首页内嵌（standalone=false）：作为首页的一个区块，标题用 h2
 *   · 独立页 #/calendar（standalone=true）：标题用 h1，方便深链与设置页跳转
 */
export function CalendarView({ standalone = false }: { standalone?: boolean }) {
  const events = useStore((s) => s.calendarEvents);
  const addEvent = useStore((s) => s.addCalendarEvent);
  const removeEvent = useStore((s) => s.removeCalendarEvent);
  const dayOverrides = useStore((s) => s.dayOverrides);
  const setDayOverride = useStore((s) => s.setDayOverride);
  const clearDayOverride = useStore((s) => s.clearDayOverride);

  const ts = useNow();
  // 只有跨天才需要重算，避免每秒重排整个月历
  const todayIso = toDayISO(new Date(ts));
  const today = useMemo(() => parseDay(todayIso), [todayIso]);

  const [cursor, setCursor] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() + 1 }));
  const [selected, setSelected] = useState<string>(todayIso);
  const [draft, setDraft] = useState('');
  const [tone, setTone] = useState<CalendarTone>('default');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cells = useMemo(() => monthGrid(cursor.y, cursor.m, today), [cursor, today]);
  const byDate = useMemo(() => {
    const m = new Map<string, typeof events>();
    for (const e of events) {
      const arr = m.get(e.date);
      if (arr) arr.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [events]);

  const selectedDate = parseDay(selected);
  const selectedLunar = solarToLunar(selectedDate);
  const selectedFestivals = festivalsOf(selectedDate);
  const selectedEvents = byDate.get(selected) ?? [];
  // 这天上不上课、按周几的课表（内置节假日表 + 用户覆盖，见 lib/holidays）
  const selectedResolved = resolveDay(selected, toWeekday(selectedDate.getDay()), dayOverrides);
  const selectedOverride = dayOverrides.find((o) => o.date === selected) ?? null;

  // 切月时把选中日记到目标月的同一天，避免详情区停留在看不见的月份
  useEffect(() => {
    const [sy, sm] = selected.split('-').map(Number);
    if (sy !== cursor.y || sm !== cursor.m) {
      const day = Math.min(Number(selected.slice(8)) || 1, new Date(cursor.y, cursor.m, 0).getDate());
      setSelected(toDayISO(new Date(cursor.y, cursor.m - 1, day)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const shift = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.y, c.m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  };

  const goToday = () => {
    setCursor({ y: today.getFullYear(), m: today.getMonth() + 1 });
    setSelected(todayIso);
  };

  const submit = () => {
    const title = draft.trim();
    if (!title) return;
    addEvent({ date: selected, title, tone });
    setDraft('');
  };

  return (
    <div className="space-y-3.5">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          {standalone ? (
            <h1 className="text-[1.6rem] font-semibold leading-tight tracking-tight">日历</h1>
          ) : (
            <h2 className="text-[1.05rem] font-semibold leading-tight tracking-tight">日历</h2>
          )}
          <p className="mt-0.5 text-[0.8rem] text-secondary">
            {selectedLunar
              ? `${lunarMonthName(selectedLunar.month, selectedLunar.isLeap)}${lunarDayName(selectedLunar.day)}`
              : '农历不可用'}
            {selectedFestivals.length > 0 && ` · ${selectedFestivals.map((f) => f.name).join(' · ')}`}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={goToday}>
          今天
        </Button>
      </header>

      {/*
        窄屏（<372px）时这个卡片**通栏**（-mx-4 抵消页面左右各 1rem 的 --page-x）。
        原因是硬约束：320px 极窄屏上，7 列日历若还留页面边距，
        每格最多只有 41px —— 怎么调都不够 44px 的触控下限。
        ≥372px 时每格已 ≥44px（(vw-56-6)/7），恢复普通边距与其他卡片对齐
        —— 否则日历会比页面里其他卡片两侧各宽 1rem，视觉上突兀。
      */}
      <Card padding="sm" className="-mx-4 min-[372px]:mx-0">
        {/* 月份切换 */}
        <div className="mb-3 flex items-center justify-between gap-2 px-3 min-[372px]:px-0">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => shift(-1)}
            className="grid size-11 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-sunken)] active:scale-95"
          >
            <ChevronLeft className="size-5" />
          </button>
          <span data-calendar-title className="tnum text-[1.05rem] font-semibold tracking-tight">
            {cursor.y} 年 {cursor.m} 月
          </span>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => shift(1)}
            className="grid size-11 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-sunken)] active:scale-95"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        {/* 窄屏时再往外顶 12px 抵消 Card 的 p-3，用满整张通栏卡片；≥372px 保持内边距 */}
        <div className="-mx-3 min-[372px]:mx-0">
          <div className="grid grid-cols-7 gap-px pb-1">
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                className={cx(
                  'text-center text-[0.72rem] font-medium',
                  i >= 5 ? 'text-[var(--accent-on-soft)]' : 'text-[var(--text)]',
                )}
              >
                {w}
              </span>
            ))}
          </div>

          {/* 42 格，固定高度不跳动 */}
          <div className="grid grid-cols-7 gap-px">
            {cells.map((c) => (
              <DayCellView
                key={c.iso}
                cell={c}
                selected={c.iso === selected}
                events={byDate.get(c.iso) ?? []}
                onSelect={() => setSelected(c.iso)}
              />
            ))}
          </div>
        </div>
      </Card>

      {/* 选中日的详情 */}
      <Card padding="md">
        <CardTitle
          icon={<CalendarDays />}
          title={`${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日`}
          subtitle={
            selectedFestivals.length > 0
              ? selectedFestivals.map((f) => f.name).join(' · ')
              : (selectedLunar ? `农历${lunarMonthName(selectedLunar.month, selectedLunar.isLeap)}${lunarDayName(selectedLunar.day)}` : '')
          }
        />

        {/*
          这天上不上课、按周几的课表。
          法定放假与调休由内置表给出（见 lib/holidays，数据抄自国务院通知），
          但**调休日到底上星期几的课取决于学校**，内置表推不出来 ——
          所以这里必须让用户选。不选的话，周日上班会按周日的课表排，
          通常一节都没有，等于白丢一天课。

          按钮统一用 min-h-11（44px）：这是审计的硬指标，
          写 min-h-9（36px）会被判「触控目标 <44px」。
        */}
        <div className="mb-3 rounded-xl bg-[var(--surface-sunken)] px-3 py-2.5">
          <p className="text-[0.74rem] leading-relaxed text-[var(--text)]">
            {selectedResolved.reason === 'holiday' && `法定放假 · ${selectedResolved.label ?? ''}`}
            {selectedResolved.reason === 'makeup' && `调休上课 · ${selectedResolved.label ?? ''}（请指定按周几）`}
            {selectedResolved.reason === 'user-off' && '已设为不上课'}
            {selectedResolved.reason === 'user-makeup' && `按${WEEKDAY_LABELS[selectedResolved.weekday]}的课表`}
            {selectedResolved.reason === 'normal' && '正常上课'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => clearDayOverride(selected)}
              className={cx(
                'min-h-11 rounded-full px-3 text-[0.72rem] font-medium transition-colors',
                !selectedOverride
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'bg-[var(--surface-hover)] text-secondary',
              )}
            >
              跟随默认
            </button>
            <button
              type="button"
              onClick={() => setDayOverride(selected, 'off')}
              className={cx(
                'min-h-11 rounded-full px-3 text-[0.72rem] font-medium transition-colors',
                selectedOverride?.schedule === 'off'
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'bg-[var(--surface-hover)] text-secondary',
              )}
            >
              不上课
            </button>
            {WEEKDAY_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => setDayOverride(selected, i as Weekday)}
                className={cx(
                  // px-3 而不是 px-2.5：两字的标签在 px-2.5 下只有 43px 宽，
                  // 差 1px 达不到 44px 的触控下限（审计照样会报）
                  'min-h-11 rounded-full px-3 text-[0.72rem] font-medium transition-colors',
                  selectedOverride?.schedule === i
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'bg-[var(--surface-hover)] text-secondary',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 那一天有什么节日/节气 */}
        {selectedFestivals.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {selectedFestivals.map((f) => (
              <span
                key={f.name}
                className={cx(
                  'rounded-full px-2.5 py-1 text-[0.72rem] font-medium',
                  f.major
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {f.name}
              </span>
            ))}
          </div>
        )}

        {/* 已有事件 */}
        {selectedEvents.length > 0 ? (
          <ul className="mb-3 space-y-1.5">
            {selectedEvents.map((e) => (
              <li key={e.id} className="flex items-center gap-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2">
                <span className={cx('size-2 shrink-0 rounded-full', TONE_CLASS[e.tone])} aria-hidden />
                <span className="min-w-0 flex-1 text-[0.82rem] leading-relaxed">{e.title}</span>
                {e.tone !== 'default' && (
                  <span className="shrink-0 text-[0.7rem] text-tertiary">{CALENDAR_TONE_LABEL[e.tone]}</span>
                )}
                <button
                  type="button"
                  aria-label={`删除「${e.title}」`}
                  onClick={() => removeEvent(e.id)}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-tertiary transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--bad-text)]"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-[0.72rem] leading-relaxed text-tertiary">
            这一天还没有标注。写点什么，比如一次考试、一节课、一件想记住的事。
          </p>
        )}

        {/* 新增 */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            data-calendar-event-input
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') submit();
            }}
            maxLength={40}
            placeholder="在这一天标注…"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-sunken)] px-3 text-[0.82rem] outline-none focus:border-[var(--accent)]"
          />
          <Button onClick={submit} disabled={!draft.trim()}>
            添加
          </Button>
        </div>

        {/* 类型（决定标记色） */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              className={cx(
                // min-h-11 而不是 min-h-9：36px 达不到 44px 的触控下限（审计会报）
                'flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.72rem] font-medium transition-colors',
                tone === t
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'bg-[var(--surface-sunken)] text-secondary',
              )}
            >
              <span className={cx('size-2 rounded-full', TONE_CLASS[t])} aria-hidden />
              {CALENDAR_TONE_LABEL[t]}
            </button>
          ))}
        </div>
      </Card>

      <p className="px-1 pb-2 text-center text-[0.7rem] leading-relaxed text-tertiary">
        日历与「重要日期」是两套独立的东西：后者是倒计时与记天数，这里只是按天标注。
        节日为内置数据，不含放假调休安排。
      </p>
    </div>
  );
}

/* ───────────────────────── 单个日期格 ───────────────────────── */

/**
 * 一个日期格。
 *
 * **跨月的日子不渲染成按钮**：它们是相邻月份的补位，在本月视图里只是占位。
 * 这么做的原因是硬指标（都由 audit 逐条量出来）：
 *   · 跨月日若做成按钮，触控目标要 ≥44px，而 320px 屏上 7 列本就吃紧；
 *   · 跨月日要「看起来淡」，任何淡化（opacity 或更浅的颜色）都会把文字
 *     对比度拉到 4.5:1 以下 —— 实测 opacity-35 只有 2.17，opacity-60 也只有约 4.0。
 * 改成不交互、不带文字的占位后，两条指标都不再适用，而且这也是常见做法。
 * 想看相邻月份的日子，左右切换一个月即可。
 */
function DayCellView({
  cell,
  selected,
  events,
  onSelect,
}: {
  cell: DayCell;
  selected: boolean;
  events: Array<{ id: string; tone: CalendarTone }>;
  onSelect: () => void;
}) {
  if (!cell.inMonth) {
    return <div data-calendar-cell={cell.iso} data-in-month="false" className="min-h-11" aria-hidden />;
  }

  const major = cell.festivals.some((f) => f.major);
  /*
   * 小字的颜色与字号都受审计约束，别随手改小改淡：
   *   · 字号必须 ≥10px（0.6rem=9.6px 会被判「字号过小」，实测 6 条）
   *   · 必须用全对比的 text；text-secondary 在这个背景上只有 3.3~3.9:1
   *
   * 强调色的文字必须用 --accent-on-soft，不能用 --accent：
   * 后者是给「底」用的，当文字用在卡片上只有 3.1~4.5:1。
   * 项目早就为此派生了一个文字安全的强调色令牌（选中态文字就是它）。
   */
  const labelTone = major ? 'text-[var(--accent-on-soft)]' : 'text-[var(--text)]';

  return (
    <button
      type="button"
      data-calendar-cell={cell.iso}
      data-in-month="true"
      data-has-event={String(events.length > 0)}
      aria-label={`${cell.date.getMonth() + 1} 月 ${cell.day} 日${cell.subLabel ? ` ${cell.subLabel}` : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        // 触控下限 44px：宽度靠「卡片通栏 + 网格抵消内边距」保证，高度用 min-h-11
        'relative flex min-h-11 flex-col items-center justify-start rounded-lg px-0.5 pb-1 pt-1.5 transition-colors',
        selected
          ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]'
          : 'hover:bg-[var(--surface-sunken)]',
      )}
    >
      <span
        className={cx(
          'tnum grid size-6 place-items-center rounded-full text-[0.82rem] leading-none',
          cell.isToday && 'bg-[var(--accent)] font-semibold text-[var(--on-accent)]',
          /*
           * 周末原本用 accent-on-soft 给数字上色，但半透明玻璃主题下
           * 背景可能正好是亮区，实测只有 4.0:1（不够 4.5）。
           * 数字保持正文色，周末由表头的强调色和下方小字体现，不再靠数字染色硬扛。
           */
          !cell.isToday && 'text-[var(--text)]',
        )}
      >
        {cell.day}
      </span>
      <span className={cx('mt-0.5 w-full truncate text-center text-[0.7rem] leading-tight', labelTone)}>
        {cell.subLabel}
      </span>
      {events.length > 0 && (
        <span className="absolute bottom-0.5 flex gap-0.5" aria-hidden>
          {events.slice(0, 3).map((e) => (
            <span key={e.id} className={cx('size-1 rounded-full', TONE_CLASS[e.tone])} />
          ))}
        </span>
      )}
    </button>
  );
}
