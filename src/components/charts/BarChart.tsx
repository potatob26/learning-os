import { useEffect, useMemo, useRef, useState } from 'react';
import type { BarDatum } from '../../lib/stats';
import { fmtDuration } from '../../lib/time';
import { cx } from '../../lib/utils';

interface BarChartProps {
  data: BarDatum[];
  /** 数值格式化（默认显示分钟） */
  format?: (v: number) => string;
  /** 计划值（可选，画成描边柱做对比） */
  planned?: boolean;
  height?: number;
  unit?: string;
  emptyHint?: string;
}

/**
 * 交互式条形图
 * ──────────────────────────────────────────────────────────
 * 为什么自己用 SVG 画，而不是引入图表库：
 *   移动优先 + 安卓性能优先。图表库通常 200–500KB，而这里只需要
 *   一种图表（柱状，含计划/实际对比）。自己画 ≈ 4KB，且能完全控制
 *   触摸交互与动画成本。
 *
 * 交互（要求十六）：
 *   · 鼠标悬停显示具体数字
 *   · 手机触摸 / 拖动也能查看
 *   · 键盘左右方向键可切换
 *   · 默认高亮今天
 */
export function BarChart({
  data,
  format = (v) => fmtDuration(Math.round(v)),
  planned = false,
  height = 168,
  unit = '小时',
  emptyHint = '这段时间还没有学习记录',
}: BarChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const dragging = useRef(false);

  // 容器宽度自适应（真实响应式，不写死 px）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 320;
      setWidth(Math.max(180, w));
    });
    ro.observe(el);
    setWidth(Math.max(180, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const max = useMemo(() => {
    const values = data.flatMap((d) => [d.minutes, planned ? (d.plannedMinutes ?? 0) : 0]);
    return Math.max(1, ...values);
  }, [data, planned]);

  const hasAny = data.some((d) => d.minutes > 0 || (planned && (d.plannedMinutes ?? 0) > 0));

  const padLeft = 34;
  const padRight = 6;
  const padTop = 14;
  const axisH = 22;
  const plotW = Math.max(40, width - padLeft - padRight);
  const plotH = Math.max(40, height - padTop - axisH);
  const step = plotW / Math.max(1, data.length);
  const barW = Math.min(30, Math.max(4, step * 0.58));

  const ticks = useMemo(() => niceTicks(max), [max]);
  const showEvery = data.length > 16 ? Math.ceil(data.length / 10) : 1;

  const activeDatum = active !== null ? data[active] : null;

  const pick = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - padLeft;
    const idx = Math.floor(x / step);
    if (idx < 0 || idx >= data.length) return setActive(null);
    setActive(idx);
  };

  return (
    <div className="select-none">
      {/* 数值读数：始终占位，避免出现/消失导致布局跳动 */}
      <div className="mb-2 flex items-baseline gap-2 px-1" style={{ minHeight: '2.4rem' }}>
        {activeDatum ? (
          <>
            <span className="tnum text-[1.35rem] font-semibold leading-none">
              {format(activeDatum.minutes)}
            </span>
            <span className="text-[0.72rem] text-secondary">
              {activeDatum.sublabel ?? activeDatum.label}
              {activeDatum.isToday ? ' · 今天' : ''}
            </span>
            {planned && (
              <span className="tnum ml-auto text-[0.72rem] text-tertiary">
                计划 {format(activeDatum.plannedMinutes ?? 0)}
              </span>
            )}
          </>
        ) : (
          <span className="text-[0.72rem] text-tertiary">按住或悬停查看每日数据</span>
        )}
      </div>

      <div
        ref={wrapRef}
        className="relative w-full touch-pan-y"
        style={{ height }}
        onMouseLeave={() => setActive(null)}
        onMouseMove={(e) => pick(e.clientX)}
        onTouchStart={(e) => {
          dragging.current = true;
          pick(e.touches[0].clientX);
        }}
        onTouchMove={(e) => {
          if (dragging.current) pick(e.touches[0].clientX);
        }}
        onTouchEnd={() => {
          dragging.current = false;
        }}
        role="img"
        aria-label={`条形图，共 ${data.length} 项，最大 ${format(max)}`}
      >
        <svg width={width} height={height} className="block">
          {/* 网格线 + 刻度 */}
          {ticks.map((t) => {
            const y = padTop + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="var(--line)"
                  strokeWidth={1}
                  strokeDasharray={t === 0 ? undefined : '3 4'}
                />
                <text
                  x={padLeft - 6}
                  y={y + 3.5}
                  textAnchor="end"
                  // 与全局最小字号保持一致（0.7rem = 11.2px），手机上 9.5px 太糊
                  fontSize="11.2"
                  fill="var(--text-tertiary)"
                >
                  {t >= 60 ? `${Math.round((t / 60) * 10) / 10}h` : `${Math.round(t)}`}
                </text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const x = padLeft + i * step + (step - barW) / 2;
            const h = (d.minutes / max) * plotH;
            const y = padTop + plotH - h;
            const isActive = active === i;
            const plannedVal = d.plannedMinutes ?? 0;
            const ph = (plannedVal / max) * plotH;
            const py = padTop + plotH - ph;

            return (
              <g key={d.key}>
                {/* 触摸热区：覆盖整列，保证手机上容易点中 */}
                <rect
                  x={padLeft + i * step}
                  y={padTop}
                  width={step}
                  height={plotH}
                  fill="transparent"
                />
                {isActive && (
                  <rect
                    x={padLeft + i * step + 1}
                    y={padTop}
                    width={Math.max(1, step - 2)}
                    height={plotH}
                    fill="var(--accent-soft)"
                    rx={4}
                  />
                )}

                {/* 计划值：描边空心柱 */}
                {planned && plannedVal > 0 && (
                  <rect
                    x={x}
                    y={py}
                    width={barW}
                    height={Math.max(1, ph)}
                    rx={Math.min(4, barW / 2)}
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth={1.2}
                    strokeDasharray="3 2"
                  />
                )}

                {/* 实际值：实心柱 */}
                {d.minutes > 0 && (
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(1.5, h)}
                    rx={Math.min(4, barW / 2)}
                    fill={
                      d.isToday
                        ? 'var(--accent)'
                        : d.isFuture
                          ? 'var(--surface-sunken)'
                          : isActive
                            ? 'var(--accent-strong)'
                            : 'color-mix(in srgb, var(--accent) 55%, var(--bg-base))'
                    }
                    style={{ transition: 'fill 160ms linear' }}
                  />
                )}

                {/* 零值：画一个小底座，表示「这天确实没有」而不是缺失 */}
                {d.minutes === 0 && !d.isFuture && (
                  <rect
                    x={x}
                    y={padTop + plotH - 2}
                    width={barW}
                    height={2}
                    rx={1}
                    fill="var(--line-strong)"
                  />
                )}

                {/* X 轴标签 */}
                {(i % showEvery === 0 || isActive) && (
                  <text
                    x={padLeft + i * step + step / 2}
                    y={height - 6}
                    textAnchor="middle"
                    fontSize="11.2"
                    fontWeight={d.isToday || isActive ? 700 : 400}
                    fill={d.isToday || isActive ? 'var(--accent)' : 'var(--text-tertiary)'}
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {!hasAny && (
        <p className="mt-1 rounded-xl bg-[var(--surface-sunken)] px-3 py-2.5 text-center text-[0.72rem] text-secondary">
          {emptyHint}
        </p>
      )}

      {planned && hasAny && (
        <div className="mt-2 flex items-center gap-3 px-1 text-[0.7rem] text-tertiary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" />
            实际
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-[var(--text-tertiary)]" />
            计划
          </span>
          <span className="ml-auto">单位：{unit}</span>
        </div>
      )}
    </div>
  );
}

/** 步长候选（分钟）：5/10/15/30 分钟或整小时，保证刻度读起来是 1h、1.5h、2h 这种整数 */
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200, 1440];

/** 生成好看的刻度：取能让刻度保持在 3~5 条的最小整刻度步长 */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const step = TICK_STEPS.find((s) => max / s <= 4) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** 各科目横向条形（比饼图在手机上更好读） */
export function SubjectBars({
  items,
  max,
}: {
  items: { subject: string; minutes: number; share: number }[];
  max: number;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2.5 text-center text-[0.72rem] text-secondary">
        这段时间还没有分科记录
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {items.map((s, i) => (
        <div key={s.subject}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-[0.82rem] font-medium">{s.subject}</span>
            <span className="tnum shrink-0 text-[0.72rem] text-secondary">
              {fmtDuration(Math.round(s.minutes))} · {Math.round(s.share)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease-soft)]"
              style={{
                width: `${Math.max(2, (s.minutes / Math.max(1, max)) * 100)}%`,
                background:
                  i === 0 ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 55%, var(--bg-base))',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'accent' | 'ok' | 'warn';
}) {
  return (
    <div className="stat-tile rounded-2xl border border-[var(--line)] bg-[var(--surface-sunken)] p-3">
      <p className="text-[0.7rem] font-medium text-tertiary">{label}</p>
      <p
        className={cx(
          'tnum mt-1 text-[1.15rem] font-semibold leading-tight',
          tone === 'accent' && 'text-[var(--accent-text)]',
          tone === 'ok' && 'text-[var(--ok-text)]',
          tone === 'warn' && 'text-[var(--warn-text)]',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[0.7rem] leading-snug text-tertiary">{sub}</p>}
    </div>
  );
}
