import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../../lib/utils';
import { dayKey, fmtDuration, startOfDayTs, timeLabel } from '../../lib/time';
import { heatLevel, heatScale, indexByDay, monthGrid, type DayCell } from '../../lib/stats';
import { WEEKDAY_SHORT } from '../../lib/types';
import type { Session } from '../../lib/types';

/**
 * 学习日历
 * ──────────────────────────────────────────────────────────────
 * 一个自然月的网格，每格底色深浅表示当天学习量；点某天在下方展开当天详情。
 *
 * 日格的尺寸：7 列在 360px 屏上放不下 7×44，用与设置页星期行相同的做法 ——
 * 卡片左右各有 16px 内边距，让这一行外扩 12px、间隙收到 2px，
 * 实测正好 44×44，满足项目自己的触控下限。
 */

interface Props {
  sessions: Session[];
  nowTs: number;
}

/**
 * 热力档位对应的底色，走 index.css 里的 --heat-0..4 令牌。
 * 令牌里对深浅两种主题分别封顶 —— 直接把 accent 填到 90% 会让底色落到
 * 中间调，压在日号上的文字（深色主题实测 1.84:1）根本读不出来。
 */
const LEVEL_BG: Record<number, string> = {
  0: 'var(--heat-0)',
  1: 'var(--heat-1)',
  2: 'var(--heat-2)',
  3: 'var(--heat-3)',
  4: 'var(--heat-4)',
};

export function StudyCalendar({ sessions, nowTs }: Props) {
  const today = startOfDayTs(nowTs);
  const [cursor, setCursor] = useState(() => {
    const d = new Date(nowTs);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selected, setSelected] = useState<string>(() => dayKey(today));

  const index = useMemo(() => indexByDay(sessions), [sessions]);

  /** 热力参考值取「近 180 天」的分位，保证跨月切换时深浅口径一致 */
  const scale = useMemo(() => {
    const vals: DayCell[] = [];
    for (const c of index.values()) vals.push(c);
    return heatScale(vals);
  }, [index]);

  const grid = useMemo(() => monthGrid(index, cursor.year, cursor.month), [index, cursor]);

  // 1 号是周几（0=周日）→ 转成周一起始的补白格数
  const lead = (grid.firstWeekday + 6) % 7;
  const cells: (DayCell | null)[] = [
    ...Array<null>(lead).fill(null),
    ...grid.cells,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedCell = index.get(selected) ?? {
    key: selected,
    ts: startOfDayTs(new Date(selected).getTime()),
    minutes: 0,
    segments: 0,
    subjects: [],
  };
  const selectedSessions = sessions.filter((s) => dayKey(s.startedAt) === selected);

  const step = (delta: number) => {
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const isCurrentMonth =
    cursor.year === new Date(nowTs).getFullYear() && cursor.month === new Date(nowTs).getMonth();

  return (
    <div>
      {/* 月份切换 */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="上个月"
          onClick={() => step(-1)}
          className="grid size-11 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="text-center">
          <p className="text-[0.95rem] font-semibold">
            {cursor.year} 年 {cursor.month + 1} 月
          </p>
          <p className="text-[0.7rem] text-tertiary">
            有记录 <span className="tnum">{grid.activeDays}</span> 天 ·
            合计 <span className="tnum">{fmtDuration(grid.totalMinutes)}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label="下个月"
          onClick={() => step(1)}
          disabled={isCurrentMonth}
          className="grid size-11 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* 星期表头 */}
      <div className="-mx-3 mb-1 grid grid-cols-7 gap-0.5">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="grid h-7 place-items-center text-[0.7rem] text-tertiary">
            {w}
          </div>
        ))}
      </div>

      {/* 日格。外扩 12px + 2px 间隙，使每格正好 44px 宽（触控下限） */}
      <div className="-mx-3 grid grid-cols-7 gap-0.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`b${i}`} className="min-h-11" />;
          const lv = heatLevel(cell.minutes, scale);
          const isToday = cell.ts === today;
          const cellData = cell.minutes > 0;
          const isSel = cell.key === selected;
          const dayNum = new Date(cell.ts).getDate();
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => setSelected(cell.key)}
              aria-label={`${cell.key} 学习 ${cell.minutes} 分钟`}
              aria-pressed={isSel}
              style={{ background: LEVEL_BG[lv] }}
              className={cx(
                'relative grid min-h-11 place-items-center rounded-xl text-[0.78rem] transition-colors',
                'border',
                isSel
                  ? 'border-[var(--accent)] font-semibold text-[var(--accent-on-soft)]'
                  : isToday
                    ? 'border-[var(--line-strong)] font-semibold text-[var(--text)]'
                    : // 有记录的日期用主文字色：日号本身是主要内容，
                      // 用 secondary 压在 accent 浅底上实测只有 4.31:1（soft 主题）
                      cellData
                        ? 'border-transparent text-[var(--text)]'
                        : 'border-transparent text-secondary',
                !isSel && 'hover:border-[var(--line-strong)]',
              )}
            >
              {dayNum}
              {/* 有记录但不是今天：底部一个小点，方便快速扫读 */}
              {cell.minutes > 0 && !isSel && (
                <span
                  className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 当天详情 */}
      <div className="mt-4 border-t border-[var(--line)] pt-3">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[0.85rem] font-semibold">
            {selectedCell.key.replace(/-/g, '/')}
            {selectedCell.key === dayKey(today) && (
              <span className="ml-2 text-[0.7rem] font-normal text-tertiary">今天</span>
            )}
          </p>
          <p className="text-[0.8rem] text-secondary">
            {selectedCell.minutes > 0 ? (
              <>
                学习 <span className="tnum font-semibold text-[var(--text)]">{fmtDuration(selectedCell.minutes)}</span>
                 {' · '}
                <span className="tnum">{selectedCell.segments}</span> 段
              </>
            ) : (
              '没有学习记录'
            )}
          </p>
        </div>

        {selectedSessions.length > 0 ? (
          <ul className="space-y-1.5">
            {selectedSessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-xl bg-[var(--surface-sunken)] px-3 py-2"
              >
                <span className="truncate text-[0.8rem] font-medium">{s.subject}</span>
                <span className="tnum shrink-0 text-[0.72rem] text-secondary">
                  {timeLabel(s.startedAt)} · {fmtDuration(Math.round(s.durationSec / 60))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.72rem] leading-relaxed text-tertiary">
            这一天没有记录。学习时长只会由真实计时或补录产生，不会自动填充。
          </p>
        )}
      </div>
    </div>
  );
}
