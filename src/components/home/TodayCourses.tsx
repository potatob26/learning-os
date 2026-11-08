import { BookOpen, Check, Circle, MapPin, Utensils } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import type { CourseInstance } from '../../hooks/useSchedule';
import type { BlockInstance } from '../../lib/time';
import type { CourseStatus } from '../../lib/types';
import { COURSE_STATUS_LABEL, WEEKDAY_LABELS } from '../../lib/types';
import type { ResolvedDay } from '../../lib/holidays';
import { cx } from '../../lib/utils';
import { fmtDuration } from '../../lib/time';

/* ==========================================================================
   今日课程
   ──────────────────────────────────────────────────────────────────────────
   重要：课程表只表示「学校今天的安排」，**不计入个人学习时长**。
   学习时长只来自计时器与补录。所以这一块的用词刻意与「学习」区分开：
   用「已上完 / 请假 / 调课」，而不是「已完成学习」。

   状态点击即切换：未确认 → 已上完 → 请假 → 调课 → 未确认。
   请假与调课表示「这节课没占用你的时间」，那段时间会还回到可支配时间里。
   ========================================================================== */

const CYCLE: CourseStatus[] = ['unconfirmed', 'attended', 'leave', 'rescheduled'];

export function nextStatus(current: CourseStatus): CourseStatus {
  const i = CYCLE.indexOf(current);
  return CYCLE[(i + 1) % CYCLE.length];
}

export function TodayCourses({
  instances,
  summary,
  classMinutes = 0,
  day,
  onSetStatus,
  onOpen,
  delay = 0,
}: {
  instances: CourseInstance[];
  summary: { total: number; attended: number; unconfirmed: number; cancelled: number; rate: number };
  /** 今天的上课占用（分钟），与自学时长分开统计 */
  classMinutes?: number;
  /** 今天怎么上课：放假 / 调休 / 正常（见 lib/holidays 的 resolveDay） */
  day: ResolvedDay;
  onSetStatus: (courseId: string, status: CourseStatus) => void;
  onOpen?: () => void;
  delay?: number;
}) {
  if (instances.length === 0) {
    // 假期 / 用户覆盖导致的空课表要说清原因，否则用户会以为课表没配
    // （例：法定假日当天，日历明明显示放假，这里却让人去加课表 —— 实拍时真实撞到）
    const empty = (() => {
      if (day.reason === 'holiday') {
        return { title: `今天放假（${day.label ?? '法定假日'}）`, sub: '这段时间已归入课后可支配时间' };
      }
      if (day.reason === 'user-off') {
        return { title: '今天已设为不上课', sub: '这段时间已归入课后可支配时间' };
      }
      return { title: '今天没有课程', sub: '去设置里添加你的课程表' };
    })();
    return (
      <Card delay={delay} interactive onClick={onOpen}>
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-tertiary)]">
            <BookOpen className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.95rem] font-medium">{empty.title}</p>
            <p className="text-xs text-secondary">{empty.sub}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card delay={delay} padding="md">
      <CardTitle
        icon={<BookOpen />}
        title="今日课程"
        subtitle={`${summary.attended} / ${summary.total - summary.cancelled} 已上完${
          summary.cancelled > 0 ? ` · ${summary.cancelled} 节请假或调课` : ''
        }`}
        action={
          onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="flex min-h-11 items-center px-1 text-xs font-semibold text-[var(--accent-text)]"
            >
              课程表
            </button>
          ) : undefined
        }
      />

      {/*
        上课占用单独列出来，与「今日自学」明确分开。
        两者是不同性质的时间：
          · 上课 = 学校安排的占用，从可支配时间里扣掉，**不计入学习时长**
          · 自学 = 自己计时学出来的，才是首页进度环与统计里的「学习时长」
        放假/调休的信息也在这里显示 —— 它直接决定今天上不上课。
      */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--text)]">
          上课占用 {classMinutes > 0 ? fmtDuration(classMinutes) : '无'}
        </span>
        {day.reason === 'holiday' && (
          <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--accent-on-soft)]">
            今天放假{day.label ? ` · ${day.label}` : ''}
          </span>
        )}
        {day.reason === 'makeup' && (
          <span className="rounded-full bg-[var(--warn-soft)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--warn-text)]">
            调休上课{day.label ? ` · ${day.label}` : ''}
          </span>
        )}
        {day.reason === 'user-off' && (
          <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--accent-on-soft)]">
            已设为不上课
          </span>
        )}
        {day.reason === 'user-makeup' && (
          <span className="rounded-full bg-[var(--warn-soft)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--warn-text)]">
            按{WEEKDAY_LABELS[day.weekday]}的课表
          </span>
        )}
      </div>

      <div className="space-y-1">
        {instances.map((inst, i) => (
          <CourseRow
            key={inst.key}
            inst={inst}
            index={i}
            onCycle={() => onSetStatus(inst.course.id, nextStatus(inst.status))}
          />
        ))}
      </div>

      <p className="mt-2.5 text-[0.7rem] leading-relaxed text-tertiary">
        点右侧状态可切换（未确认 → 已上完 → 请假 → 调课）。
        课程状态只记录你是否上了这节课，<span className="font-medium">不计入学习时长</span>；
        请假与调课占用的时间会还回到可支配时间里。
      </p>
    </Card>
  );
}

function CourseRow({
  inst,
  index,
  onCycle,
}: {
  inst: CourseInstance;
  index: number;
  onCycle: () => void;
}) {
  const cancelled = inst.cancelled;
  return (
    <div
      className={cx(
        'flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors duration-200',
        inst.relation === 'now' && !cancelled && 'bg-[var(--accent-soft)]',
        cancelled && 'opacity-60',
      )}
      style={{ animationDelay: `${Math.min(index, 6) * 0.035}s` }}
    >
      {/* 时间不折行：窄屏 360 上固定 4.1rem 会把 08:00–08:45 挤成两行，
          每行白高一行。让它按内容取宽，科目名本来就会 truncate。 */}
      <span className="tnum shrink-0 whitespace-nowrap text-[0.76rem] font-medium text-secondary">
        {inst.startLabel}
        <span className="text-tertiary">–</span>
        {inst.endLabel}
      </span>

      <span
        className={cx(
          'min-w-0 flex-1 truncate text-[0.92rem] font-medium',
          inst.relation === 'now' && !cancelled && 'text-[var(--accent-text)]',
          cancelled && 'line-through',
        )}
      >
        {inst.course.title || inst.course.subject}
        {inst.location && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[0.7rem] font-normal text-tertiary">
            <MapPin className="size-2.5" />
            {inst.location}
          </span>
        )}
      </span>

      {inst.relation === 'now' && !cancelled && (
        <span className="pill pill-accent shrink-0">还有 {fmtDuration(inst.minutesLeft)}</span>
      )}

      {/* 状态：点击即切换 */}
      <button
        type="button"
        onClick={onCycle}
        aria-label={`${inst.course.title || inst.course.subject} 的状态：${
          COURSE_STATUS_LABEL[inst.status]
        }，点击切换`}
        className={cx(
          'flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2.5 text-[0.72rem] font-semibold transition-colors duration-200',
          statusClass(inst.status),
        )}
      >
        <StatusIcon status={inst.status} />
        {COURSE_STATUS_LABEL[inst.status]}
        {!inst.explicit && inst.status === 'attended' && (
          <span className="text-[0.7rem] font-normal opacity-70">自动</span>
        )}
      </button>
    </div>
  );
}

function statusClass(status: CourseStatus): string {
  switch (status) {
    case 'attended':
      return 'bg-[var(--ok-soft)] text-[var(--ok-text)]';
    case 'leave':
      return 'bg-[var(--warn-soft)] text-[var(--warn-text)]';
    case 'rescheduled':
      return 'bg-[var(--info-soft)] text-[var(--info-text)]';
    default:
      return 'bg-[var(--surface-sunken)] text-[var(--text-secondary)]';
  }
}

function StatusIcon({ status }: { status: CourseStatus }) {
  if (status === 'attended') return <Check className="size-3.5" strokeWidth={3} />;
  return <Circle className="size-3.5" strokeWidth={2.5} />;
}

/** 固定活动（吃饭 / 运动 / 补课…）—— 用来解释可支配时间为什么是这个数 */
export function FixedBlocks({
  blocks,
  delay = 0,
  onOpen,
}: {
  blocks: BlockInstance[];
  delay?: number;
  /** 点击整张卡 → 跳设置-作息编辑固定活动 */
  onOpen?: () => void;
}) {
  if (blocks.length === 0) return null;
  return (
    <Card delay={delay} padding="md" interactive onClick={onOpen}>
      <CardTitle
        icon={<Utensils />}
        title="固定占用"
        subtitle="已从可支配时间里扣除"
        action={
          onOpen ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              className="flex min-h-11 min-w-11 items-center justify-center px-1 text-xs font-semibold text-[var(--accent-text)]"
            >
              编辑
            </button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-1.5">
        {blocks.map((b) => (
          <span key={b.block.id} className="pill pill-muted">
            {b.block.label}
            <span className="tnum font-semibold">
              {b.block.start}–{b.block.end}
            </span>
          </span>
        ))}
      </div>
    </Card>
  );
}
