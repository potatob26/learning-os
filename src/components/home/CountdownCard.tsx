import { useState } from 'react';
import { CalendarClock, Target } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ImageViewer } from '../ui/ImageViewer';
import { DateModuleBackground } from './DateModuleBackground';
import { useStore } from '../../lib/store';
import type { ImportantDate } from '../../lib/types';
import { diffDays, parseDateInput, timeLabel, addDaysTs, startOfDayTs } from '../../lib/time';
import { cx } from '../../lib/utils';

/**
 * 主倒计时
 * 数字是整屏视觉权重最高的元素（要求三十五：时间 / 目标 / 进度优先）
 */
export function CountdownCard({
  items,
  nowTs,
  onOpen,
  delay = 0,
}: {
  items: ImportantDate[];
  nowTs: number;
  onOpen?: () => void;
  delay?: number;
}) {
  const visible = items.filter((d) => d.visible && !d.primary);
  const primary = items.find((d) => d.primary && d.visible) ?? items.find((d) => d.visible) ?? null;

  /*
   * 这个模块套了自定义背景图时，「点一下」的含义改成分两种：
   *   有背景图 → 点开看大图（大图里再给一个「设置重要日期」入口）
   *   没背景图 → 老行为，直接去设置页
   * 之所以不做成长按/小按钮：整块卡片本来就是可点区域，
   * 背景图铺满它，用户想放大看图的直觉就是直接点它。
   */
  const bgCfg = useStore((s) => s.settings.dateModuleBackground);
  const custom = useStore((s) => s.background.custom);
  const bgImage = bgCfg?.imageId ? custom.find((c) => c.id === bgCfg.imageId) ?? null : null;
  const [viewing, setViewing] = useState(false);

  if (!primary && visible.length === 0) {
    return (
      <Card delay={delay} interactive className="text-left" onClick={onOpen}>
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-tertiary)]">
            <CalendarClock className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.95rem] font-medium">添加一个重要日期</p>
            <p className="text-xs text-secondary">中考、期末、生日…首页会显示倒计时</p>
          </div>
        </div>
      </Card>
    );
  }

  const primaryDays = primary ? daysUntil(primary, nowTs) : null;

  return (
    <>
    <DateModuleBackground>
      {/*
        ⚠️ 倒计时与下面那排小日期**必须在同一张玻璃卡里**。
        之前小日期条是卡外一个独立 div（类名 `glass` 其实早就没有对应样式了），
        于是设了模块背景图时，第 2 个开始的小日期会露在玻璃外面、直接压在背景图上
        —— 看起来就像「内容超出了毛玻璃覆盖的部分」。
        收进同一张卡后：1 个日期时外观不变，多个日期时它们仍在玻璃面内。
      */}
      <Card
        delay={delay}
        interactive
        tier="liquid"
        padding="lg"
        onClick={bgImage ? () => setViewing(true) : onOpen}
      >
        {primary && primaryDays !== null && (
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                <Target className="size-3.5" />
                距离 {primary.title}
              </p>
              <div className="mt-1.5 flex items-baseline gap-2">
                {primary.kind === 'birthday' ? (
                  <span className="num-hero text-[3.5rem] leading-none">{primary.title}</span>
                ) : (
                  <>
                    <span
                      className={cx('num-hero', 'text-[3.6rem]')}
                      style={{
                        color:
                          primaryDays <= 7
                            ? 'var(--bad)'
                            : primaryDays <= 30
                              ? 'var(--warn)'
                              : 'var(--text)',
                      }}
                    >
                      {primaryDays < 0 ? Math.abs(primaryDays) : primaryDays}
                    </span>
                    <span className="pb-1.5 text-sm font-medium text-secondary">
                      {primaryDays < 0 ? '天前' : '天'}
                    </span>
                  </>
                )}
              </div>
              <p className="mt-1 text-xs text-tertiary">
                {primary.allDay
                  ? formatDateLabel(primary, nowTs)
                  : `${formatDateLabel(primary, nowTs)} · ${timeLabel(parseDateInput(primary.date) ?? nowTs)}`}
              </p>
            </div>
            {primaryDays >= 0 && primaryDays <= 100 && (
              <MiniRing days={primaryDays} />
            )}
          </div>
        )}

        {visible.length > 0 && (
          <div
            className={cx(
              'scroll-x gap-2 pb-1',
              primary && primaryDays !== null && 'mt-4 border-t border-[var(--line)] pt-3',
            )}
          >
            {visible.map((d) => {
              const days = daysUntil(d, nowTs);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={(e) => {
                    // 整张卡本身也可点（看大图 / 进设置），小卡自己先拦住冒泡
                    e.stopPropagation();
                    onOpen?.();
                  }}
                  className="snap-item min-h-16 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-3.5 py-2.5 text-left active:scale-[0.98]"
                >
                  <p className="whitespace-nowrap text-[0.72rem] font-medium text-secondary">{d.title}</p>
                  <p className="tnum mt-0.5 text-lg font-semibold leading-tight">
                    {days < 0 ? `已过 ${Math.abs(days)}` : days}
                    <span className="ml-0.5 text-[0.7rem] font-medium text-tertiary">天</span>
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </DateModuleBackground>

    <ImageViewer
      open={viewing}
      onClose={() => setViewing(false)}
      src={bgImage?.dataUrl ?? null}
      title={bgImage?.name ?? '背景图'}
      caption={
        bgImage
          ? `${bgImage.width}×${bgImage.height} · 这是「重要日期」模块的背景`
          : undefined
      }
      actions={
        <Button
          block
          size="lg"
          onClick={() => {
            setViewing(false);
            onOpen?.();
          }}
        >
          设置重要日期
        </Button>
      }
    />
    </>
  );
}

function daysUntil(d: ImportantDate, nowTs: number): number {
  const t = parseDateInput(d.date);
  if (t === null) return 0;
  // 只显示天数时，按自然日算；跨过零点就是新的一天
  if (d.allDay) return diffDays(nowTs, t);
  return Math.ceil((t - nowTs) / 86400000);
}

function formatDateLabel(d: ImportantDate, nowTs: number): string {
  const t = parseDateInput(d.date);
  if (t === null) return d.date;
  const days = diffDays(nowTs, t);
  const label = `${new Date(t).getMonth() + 1} 月 ${new Date(t).getDate()} 日`;
  if (days === 0) return `就是今天 · ${label}`;
  if (days === 1) return `明天 · ${label}`;
  if (days === -1) return `昨天 · ${label}`;
  void startOfDayTs;
  void addDaysTs;
  return label;
}

/** 100 天以内的小圆环，给倒计时一点克制的紧迫感 */
function MiniRing({ days }: { days: number }) {
  const size = 52;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = Math.max(0, Math.min(1, days / 100));
  const color = days <= 7 ? 'var(--bad)' : days <= 30 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
        />
      </svg>
      <span className="absolute text-[0.7rem] font-semibold text-tertiary">100天</span>
    </div>
  );
}
