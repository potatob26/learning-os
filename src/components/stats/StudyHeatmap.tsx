import { useEffect, useMemo, useRef } from 'react';
import { dayCells, heatLevel, heatScale, indexByDay, type DayCell } from '../../lib/stats';
import type { Session } from '../../lib/types';

/**
 * 学习热力图
 * ──────────────────────────────────────────────────────────────
 * 用「周为列、星期为行」的方格铺出每天的学习量，深浅表示多少。
 *
 * 为什么做成**不可点击**的纯图示：
 *   半年有 180+ 格，每格只能做到十几像素 —— 做成按钮既点不准，
 *   也会低于项目 44px 的触控下限。逐日详情交给「日历」标签页，
 *   那里每格能做到 44×44 且可以点。
 *   宁可少一个交互，也不要一排点不中的假按钮。
 */

interface Props {
  sessions: Session[];
  nowTs: number;
  /** 显示多少周（每列一周） */
  weeks?: number;
}

/**
 * 热力档位对应的底色。
 * ──────────────────────────────────────────────────────────────
 * 刻意**不复用**日历的 --heat-* 令牌：那套为了保住日号的对比度把上限压得很低
 * （深色主题只到 34%），而热力图的格子上**没有文字**，不受这个约束。
 * 这里用更强的梯度，让「哪天学得多」一眼能看出来。
 * 0 档仍用中性底，与日历保持一致。
 */
const LEVEL_BG: Record<number, string> = {
  0: 'var(--surface-sunken)',
  1: 'color-mix(in srgb, var(--accent) 18%, transparent)',
  2: 'color-mix(in srgb, var(--accent) 38%, transparent)',
  3: 'color-mix(in srgb, var(--accent) 62%, transparent)',
  4: 'color-mix(in srgb, var(--accent) 88%, transparent)',
};

/**
 * 格子边长（rem）与间隙（px）。
 * 26 周在手机上放不下：26 ×(15.2+3) ≈ 473px，而卡片内容区只有约 296px。
 * 所以做成横向滚动（见下面 overflow-x-auto），并把格子略缩到 0.8rem
 * 让一屏能看到更多周。
 */
const CELL = '0.8rem';
const GAP = 2;

const WEEK_ROWS = ['一', '二', '三', '四', '五', '六', '日'];

export function StudyHeatmap({ sessions, nowTs, weeks = 26 }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { columns, scale, maxMinutes, totalMinutes, activeDays } = useMemo(() => {
    const index = indexByDay(sessions);
    // 多取一周用于对齐到「周一开头」，末尾对齐到本周
    const cells = dayCells(index, nowTs, weeks * 7);
    const sc = heatScale(cells);

    // cells 是「从早到晚」的一维数组；按周一开头切成列
    // 先找第一格是周几，把它之前的空位补上，使每一列都是 周一→周日
    const first = new Date(cells[0].ts).getDay(); // 0=周日
    const lead = (first + 6) % 7; // 转成「距离周一几天」
    const padded: (DayCell | null)[] = [...Array(lead).fill(null), ...cells];

    const cols: (DayCell | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      const col = padded.slice(i, i + 7);
      while (col.length < 7) col.push(null);
      cols.push(col);
    }

    let total = 0;
    let active = 0;
    let max = 0;
    for (const c of cells) {
      total += c.minutes;
      if (c.minutes > 0) active += 1;
      if (c.minutes > max) max = c.minutes;
    }

    return { columns: cols, scale: sc, maxMinutes: max, totalMinutes: total, activeDays: active };
  }, [sessions, nowTs, weeks]);

  /** 月份标签：某一列首次跨月时在这一列上方标出 */
  const monthLabels = useMemo(
    () =>
      columns.map((col, i) => {
        const firstReal = col.find((c) => c);
        if (!firstReal) return null;
        const d = new Date(firstReal.ts);
        if (i === 0) return `${d.getMonth() + 1}月`;
        const prev = columns[i - 1].find((c) => c);
        if (!prev) return null;
        return new Date(prev.ts).getMonth() !== d.getMonth() ? `${d.getMonth() + 1}月` : null;
      }),
    [columns],
  );

  // 初次渲染后滚到最右端：用户最关心最近几周，而不是半年前。
  // 依赖 columns.length，切换数据量时也会重新贴到右端。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [columns.length, weeks]);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-[0.8rem] text-secondary">
          近 {weeks} 周共 <span className="tnum font-semibold text-[var(--text)]">{Math.round(totalMinutes / 60)}</span> 小时
        </p>
        <p className="text-[0.72rem] text-tertiary">
          有记录 <span className="tnum">{activeDays}</span> 天
        </p>
      </div>

      {/* 月标签与方格必须一起滚动，所以放在同一个横向滚动容器里。
          外扩 12px（-mx-3）从卡片内边距里再借一点宽度。
          初次渲染后滚到最右端 —— 用户最关心的是最近几周。 */}
      <div ref={scrollRef} className="-mx-3 overflow-x-auto px-3 pb-1">
        <div className="w-max">
          {/* 月份标签 */}
          <div className="mb-1 flex" style={{ gap: `${GAP}px`, paddingLeft: '1.15rem' }}>
            {monthLabels.map((lb, i) => (
              <div
                key={i}
                className="shrink-0 text-[0.62rem] leading-none text-tertiary"
                style={{ width: CELL }}
              >
                {lb ?? ''}
              </div>
            ))}
          </div>

          <div className="flex" style={{ gap: `${GAP}px` }}>
            {/* 星期标签（只标一/三/五，避免拥挤） */}
            <div
              className="flex shrink-0 flex-col pr-1"
              style={{ gap: `${GAP}px` }}
            >
              {WEEK_ROWS.map((w, i) => (
                <div
                  key={w}
                  className="grid place-items-center text-[0.62rem] leading-none text-tertiary"
                  style={{ height: CELL, width: '0.9rem' }}
                >
                  {i % 2 === 0 ? w : ''}
                </div>
              ))}
            </div>

            {columns.map((col, ci) => (
              <div key={ci} className="flex shrink-0 flex-col" style={{ gap: `${GAP}px` }}>
                {col.map((cell, ri) => {
                  if (!cell) {
                    return <div key={ri} style={{ width: CELL, height: CELL }} />;
                  }
                  const lv = heatLevel(cell.minutes, scale);
                  return (
                    <div
                      key={ri}
                      className="rounded-[3px]"
                      style={{ width: CELL, height: CELL, background: LEVEL_BG[lv] }}
                      // 纯图示，不做交互；详情在「日历」里看
                      title={`${cell.key} · ${cell.minutes} 分钟`}
                      aria-label={`${cell.key} 学习 ${cell.minutes} 分钟`}
                      role="img"
                />
              );
            })}
          </div>
        ))}
          </div>
        </div>
      </div>

      {/* 图例 */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[0.7rem] text-tertiary">
          最多的一天 <span className="tnum">{maxMinutes}</span> 分钟
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[0.7rem] text-tertiary">少</span>
          {[0, 1, 2, 3, 4].map((lv) => (
            <div
              key={lv}
              className="size-[0.7rem] rounded-[2px]"
              style={{ background: LEVEL_BG[lv] }}
            />
          ))}
          <span className="text-[0.7rem] text-tertiary">多</span>
        </div>
      </div>
    </div>
  );
}
