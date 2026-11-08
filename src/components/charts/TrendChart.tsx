import { useEffect, useRef, useState } from 'react';
import type { SubjectScoreSummary, ExamTrendPoint } from '../../lib/examScores';

/* ==========================================================================
   考试成绩图表（手写 SVG，不引图表库）
   ──────────────────────────────────────────────────────────────────────────
   · y 轴固定 0–100（折合百分制），不同满分制才能放在一起比；
   · x 轴按记录序号等距 —— 考试日期不规则，按真实时间比例会在手机上挤成一团；
   · 目标是一条虚线（不是柱、不是点），与折线区分开；
   · 空态不画假坐标系。
   颜色只走语义令牌（铁律 15）。
   ========================================================================== */

interface TrendChartProps {
  points: ExamTrendPoint[];
  /** 0..1；null = 没设目标，不画目标线 */
  targetRate: number | null;
  targetLabel: string | null;
  height?: number;
}

export function TrendChart({ points, targetRate, targetLabel, height = 176 }: TrendChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const set = () => setWidth(Math.max(180, Math.round(el.getBoundingClientRect().width)));
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-tertiary">
        还没有这一科的成绩，录一次就能看到趋势。
      </p>
    );
  }

  const pad = { left: 32, right: 12, top: 12, bottom: 24 };
  const w = Math.max(180, width);
  const innerW = Math.max(1, w - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const y = (rate: number) => pad.top + innerH * (1 - Math.min(1, Math.max(0, rate)));
  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (innerW * i) / (points.length - 1));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ');
  const ticks = [0, 25, 50, 75, 100];

  return (
    <div ref={boxRef} className="w-full">
      <svg width={w} height={height} role="img" aria-label={`成绩趋势，共 ${points.length} 次记录`}>
        {/* y 轴刻度与网格 */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              y1={y(t / 100)}
              x2={w - pad.right}
              y2={y(t / 100)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text x={4} y={y(t / 100) + 3.5} fontSize={10} fill="var(--text-tertiary)">
              {t}
            </text>
          </g>
        ))}

        {/* 目标线 */}
        {targetRate !== null && (
          <line
            x1={pad.left}
            y1={y(targetRate)}
            x2={w - pad.right}
            y2={y(targetRate)}
            stroke="var(--warn)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        )}

        {/* 折线 */}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.key} cx={x(i)} cy={y(p.rate)} r={3} fill="var(--accent)" />
        ))}

        {/* x 轴标签：点多时只标首尾与中间 */}
        {points.map((p, i) => {
          const show = points.length <= 6 || i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2);
          if (!show) return null;
          return (
            <text key={`t-${p.key}`} x={x(i)} y={height - 6} fontSize={10} fill="var(--text-tertiary)" textAnchor="middle">
              {p.label}
            </text>
          );
        })}
      </svg>
      {targetLabel && (
        <p className="mt-1 flex items-center gap-1.5 text-[0.7rem] text-tertiary">
          <i className="inline-block h-0 w-4 border-t border-dashed border-[var(--warn)]" aria-hidden />
          {targetLabel}
        </p>
      )}
    </div>
  );
}

/* ---------------- 各科「最近一次 vs 目标」横条 ---------------- */

interface ScoreBarsProps {
  rows: SubjectScoreSummary[];
  selected: string;
  onPick: (subject: string) => void;
}

export function ScoreBars({ rows, selected, onPick }: ScoreBarsProps) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const ratePct = r.rate !== null ? Math.round(r.rate * 100) : 0;
        const targetPct = r.targetRate !== null ? Math.round(r.targetRate * 100) : null;
        const latestText =
          r.latest && r.latest.score !== null
            ? `${trimNum(r.latest.score)} / ${trimNum(r.latest.fullScore)} · ${ratePct}%`
            : '还没有有效成绩';
        const gap = (() => {
          if (!r.latest || r.latest.score === null) return '缺考或没有记录';
          if (!r.target) return '未设目标';
          if (r.gapScore !== null) {
            return r.gapScore > 0 ? `距目标还差 ${trimNum(r.gapScore)} 分` : r.gapScore < 0 ? `已超出目标 ${trimNum(-r.gapScore)} 分` : '刚好达到目标';
          }
          if (r.met === true) return '已达目标（按折合率）';
          return `距目标还差 ${Math.max(0, Math.round(((r.targetRate ?? 0) - (r.rate ?? 0)) * 100))}%`;
        })();
        return (
          <li key={r.subject}>
            <button
              type="button"
              onClick={() => onPick(r.subject)}
              aria-pressed={r.subject === selected}
              className={
                r.subject === selected
                  ? 'w-full rounded-xl bg-[var(--surface-sunken)] px-2.5 py-2 text-left'
                  : 'w-full rounded-xl px-2.5 py-2 text-left'
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[0.85rem] font-semibold">{r.subject}</span>
                <span className="tnum shrink-0 text-[0.72rem] text-secondary">{latestText}</span>
              </div>
              <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                <div
                  className={r.met ? 'h-full rounded-full bg-[var(--ok)]' : 'h-full rounded-full bg-[var(--accent)]'}
                  style={{ width: `${ratePct}%` }}
                />
                {targetPct !== null && (
                  <span
                    className="absolute top-0 h-full w-[2px] bg-[var(--warn)]"
                    style={{ left: `calc(${targetPct}% - 1px)` }}
                    title={`目标 ${targetPct}%`}
                  />
                )}
              </div>
              <p className="mt-1 text-[0.7rem] text-tertiary">
                {gap}
                {r.count > 0 ? ` · ${r.count} 次成绩` : ''}
                {r.avgRate !== null ? ` · 均值 ${Math.round(r.avgRate * 100)}%` : ''}
                {r.trendDeltaRate !== null
                  ? ` · 比上次 ${r.trendDeltaRate >= 0 ? '+' : ''}${Math.round(r.trendDeltaRate * 100)}%`
                  : ''}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function trimNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}
