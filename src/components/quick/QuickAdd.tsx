import { useState } from 'react';
import { CalendarPlus, CheckSquare, ListTodo, Play, Target } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { useStore } from '../../lib/store';
import { dayKey } from '../../lib/time';
import { cx } from '../../lib/utils';

type Mode = 'menu' | 'task' | 'goal' | 'date';

/**
 * 快速添加（要求二十九）
 * 首页一步进入，尽量少的步骤完成「加任务 / 加目标 / 加日期 / 开始学习」。
 */
export function QuickAdd({
  open,
  onClose,
  onStartStudy,
}: {
  open: boolean;
  onClose: () => void;
  onStartStudy: () => void;
}) {
  const [mode, setMode] = useState<Mode>('menu');

  const close = () => {
    onClose();
    // 关闭后再重置，避免收起动画时内容突跳
    setTimeout(() => setMode('menu'), 240);
  };

  return (
    <Sheet open={open} onClose={close} title={mode === 'menu' ? '快速添加' : undefined}>
      {mode === 'menu' && (
        <div className="space-y-2 pb-2">
          <MenuItem
            icon={<Play className="size-5" />}
            title="开始学习"
            desc="选科目和目标，计时后自动记录"
            accent
            onClick={() => {
              onClose();
              onStartStudy();
            }}
          />
          <MenuItem
            icon={<Target className="size-5" />}
            title="添加目标"
            desc="计划时长、科目、截止时间"
            onClick={() => setMode('goal')}
          />
          <MenuItem
            icon={<CheckSquare className="size-5" />}
            title="添加任务"
            desc="一句话待办，勾掉即可"
            onClick={() => setMode('task')}
          />
          <MenuItem
            icon={<CalendarPlus className="size-5" />}
            title="添加重要日期"
            desc="中考、期末、生日倒数"
            onClick={() => setMode('date')}
          />
        </div>
      )}

      {mode === 'task' && <TaskForm onDone={close} onBack={() => setMode('menu')} />}
      {mode === 'goal' && <GoalForm onDone={close} onBack={() => setMode('menu')} />}
      {mode === 'date' && <DateForm onDone={close} onBack={() => setMode('menu')} />}
    </Sheet>
  );
}

function MenuItem({
  icon,
  title,
  desc,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex min-h-16 w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors duration-200 active:scale-[0.99]',
        accent
          ? 'border-[var(--accent-ring)] bg-[var(--accent-soft)]'
          : 'border-[var(--line)] bg-[var(--surface-sunken)]',
      )}
    >
      <span
        className={cx(
          'grid size-11 shrink-0 place-items-center rounded-full',
          accent
            ? 'bg-[var(--primary-bg)] text-[var(--on-accent)]'
            : 'bg-[var(--surface-strong)] text-[var(--text-secondary)]',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.95rem] font-semibold">{title}</span>
        <span className="block text-xs text-secondary">{desc}</span>
      </span>
    </button>
  );
}

/* ---------------- 表单 ---------------- */

function FormShell({
  title,
  onBack,
  children,
  footer,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="space-y-4 pb-1">
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-11 items-center pr-2 text-xs font-semibold text-[var(--accent-text)]"
      >
        ← 返回
      </button>
      <h3 className="-mt-1 text-lg font-semibold tracking-tight">{title}</h3>
      <div className="space-y-3">{children}</div>
      {footer}
    </div>
  );
}

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '其他'];

function SubjectChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SUBJECTS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cx(
            'min-h-11 rounded-full border px-3.5 text-[0.8rem] font-medium transition-colors duration-200',
            value === s
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
              : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function TaskForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const addTask = useStore((s) => s.addTask);
  const [title, setTitle] = useState('');
  return (
    <FormShell
      title="添加任务"
      onBack={onBack}
      footer={
        <Button
          block
          size="lg"
          disabled={!title.trim()}
          onClick={() => {
            addTask(title);
            onDone();
          }}
        >
          添加
        </Button>
      }
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="例如：背 30 个英语单词"
        aria-label="任务名称"
        className="field min-h-12"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim()) {
            addTask(title);
            onDone();
          }
        }}
      />
    </FormShell>
  );
}

function GoalForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const addGoal = useStore((s) => s.addGoal);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('数学');
  const [minutes, setMinutes] = useState(60);
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [dueDate, setDueDate] = useState(dayKey(Date.now()));

  return (
    <FormShell
      title="添加目标"
      onBack={onBack}
      footer={
        <Button
          block
          size="lg"
          disabled={!title.trim()}
          onClick={() => {
            addGoal({
              title,
              subject,
              plannedMinutes: minutes,
              priority,
              dueAt: dueDate ? `${dueDate} 23:59` : null,
            });
            onDone();
          }}
        >
          添加目标
        </Button>
      }
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-secondary">目标名称</span>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：完成一套数学试卷"
          aria-label="目标名称"
          className="field min-h-12"
        />
      </label>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-secondary">科目</span>
        <SubjectChips value={subject} onChange={setSubject} />
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-secondary">计划时长</span>
        <div className="flex flex-wrap gap-1.5">
          {[15, 30, 45, 60, 90, 120].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMinutes(m)}
              className={cx(
                'min-h-11 rounded-full border px-3.5 text-[0.8rem] font-medium transition-colors duration-200',
                minutes === m
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
              )}
            >
              {m >= 60 ? `${m / 60} 小时` : `${m} 分`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">截止日期</span>
          <input
            type="date"
            aria-label="截止日期"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="field tnum min-h-12"
          />
        </label>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">优先级</span>
          <div className="flex gap-1.5">
            {(
              [
                { v: 'low' as const, l: '低' },
                { v: 'normal' as const, l: '普通' },
                { v: 'high' as const, l: '重要' },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setPriority(o.v)}
                className={cx(
                  'min-h-12 flex-1 rounded-xl border text-[0.8rem] font-medium transition-colors duration-200',
                  priority === o.v
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </FormShell>
  );
}

function DateForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const addDate = useStore((s) => s.addDate);
  const dates = useStore((s) => s.dates);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dayKey(Date.now()));
  const [kind, setKind] = useState<'exam' | 'holiday' | 'birthday' | 'custom'>('exam');

  return (
    <FormShell
      title="添加重要日期"
      onBack={onBack}
      footer={
        <Button
          block
          size="lg"
          disabled={!title.trim() || !date}
          onClick={() => {
            addDate({
              title,
              date,
              allDay: true,
              primary: !dates.some((d) => d.primary),
              visible: true,
              kind,
            });
            onDone();
          }}
        >
          添加
        </Button>
      }
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-secondary">名称</span>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：中考 / 期末考 / 生日"
          aria-label="日期名称"
          className="field min-h-12"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">日期</span>
          <input
            type="date"
            aria-label="日期"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="field tnum min-h-12"
          />
        </label>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">类型</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="field min-h-12"
          >
            <option value="exam">考试</option>
            <option value="holiday">假期</option>
            <option value="birthday">生日</option>
            <option value="custom">自定义</option>
          </select>
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-tertiary">
        <ListTodo className="mt-0.5 size-3.5 shrink-0" />
        第一个添加的日期会自动成为首页主倒计时，之后可在设置里切换。
      </p>
    </FormShell>
  );
}
