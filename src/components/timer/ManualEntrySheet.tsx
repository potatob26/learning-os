import { useEffect, useMemo, useState } from 'react';
import { PenLine } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { useStore } from '../../lib/store';
import { cx } from '../../lib/utils';

const COMMON = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];

/**
 * 时长预设：只是"快捷填数"。真正的值由下面那个输入框持有，
 * 所以预设按钮与自由填写不会出现两个真相。
 */
const DURATION_PRESETS = [10, 15, 20, 30, 45, 60, 90, 120];
/** 上限 24 小时：再长就不是"补录一段学习"，多半是把日期填错了 */
const MAX_MINUTES = 24 * 60;

/**
 * 手动补录学习时间
 * ──────────────────────────────────────────────
 * 现实里经常忘记开计时器。没有补录，数据就不可信，
 * 统计也就失去意义。所以这是「真实可用」的必需品，不是装饰功能。
 * 补录的记录会明确标记为「手动」，与计时器记录区分开。
 */
/** 把时间戳格式化成 <input type="datetime-local"> 要的值（本地时区） */
function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ManualEntrySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const courses = useStore((s) => s.courses);
  const goals = useStore((s) => s.goals);
  const manualSession = useStore((s) => s.manualSession);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const c of courses) if (c.subject) set.add(c.subject);
    for (const g of goals) if (g.subject) set.add(g.subject);
    return [...set, ...COMMON.filter((s) => !set.has(s))].slice(0, 10);
  }, [courses, goals]);

  const [subject, setSubject] = useState(subjects[0] ?? '数学');
  const [minutes, setMinutes] = useState(30);
  /*
   * 自由填写时长时输入框的草稿值：null = 直接显示已提交的 minutes。
   * 必须允许"中途为空"（用户正在删掉重打），否则每次 onChange 都会被强行塞回旧值，
   * 结果是数字打不进去 —— 这类"受控输入框打不了字"的坑很容易被当成输入法问题。
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [review, setReview] = useState('');
  const [when, setWhen] = useState<'now' | 'earlier'>('now');
  /*
   * 补录时刻（datetime-local 的值，形如 2026-10-05T20:00）。
   * 原先是 type="time"（只有时刻、没有日期）→ 补不了前几天的记录。
   */
  const [at, setAt] = useState('');

  useEffect(() => {
    if (!open) return;
    setSubject(subjects[0] ?? '数学');
    setMinutes(30);
    setDraft(null);
    setGoalId(null);
    setReview('');
    setWhen('now');
    setAt(toLocalInput(Date.now()));
  }, [open, subjects]);

  const activeGoals = goals.filter((g) => g.status !== 'done');

  /** 预设按钮 = 往输入框里填数（不是另一套状态） */
  const pickPreset = (m: number) => {
    setMinutes(m);
    setDraft(null);
  };

  /**
   * 自由填写分钟数。判空必须只看**去除空白后是否为空**，
   * 不能看 Number('') === 0 —— 那样"删光"会被当成 0 再钳成 1，用户就删不掉了。
   */
  const onMinutesInput = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setMinutes(Math.min(MAX_MINUTES, Math.max(1, Math.round(n))));
  };

  /** 失焦后回到"已提交值"显示：把 1.5 / 99999 这类中间态收敛掉 */
  const commitDraft = () => setDraft(null);

  const save = () => {
    let ts: number;
    if (when === 'now') {
      ts = Date.now();
    } else {
      const parsed = at ? new Date(at).getTime() : Date.now();
      // 未来时间钳到当前时刻，避免出现「未来学习记录」（原有约束保留）
      ts = Number.isFinite(parsed) && parsed <= Date.now() ? parsed : Date.now();
    }
    manualSession({ subject, goalId, minutes, at: ts, review: review.trim() || undefined });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="补录学习时间"
      description="忘记开计时器时使用，会标记为手动记录"
      footer={
        <Button block size="lg" icon={<PenLine />} onClick={save}>
          保存记录
        </Button>
      }
    >
      <div className="space-y-4 pb-1">
        <div>
          <span className="mb-2 block text-xs font-medium text-secondary">科目</span>
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSubject(s)}
                className={cx(
                  'min-h-10 rounded-full border px-3.5 text-[0.85rem] font-medium transition-colors duration-200',
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

        <div>
          <span className="mb-2 block text-xs font-medium text-secondary">时长</span>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pickPreset(m)}
                className={cx(
                  'min-h-10 rounded-full border px-3.5 text-[0.85rem] font-medium transition-colors duration-200',
                  minutes === m && draft === null
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {m >= 60 ? `${m / 60} 小时` : `${m} 分`}
              </button>
            ))}
          </div>
          {/*
            自由填写：预设只有 8 档，学了 37 分钟这种就没法录。
            与上面那排预设是同一个值（预设只是快捷填数），所以不会出现
            "按钮亮着 30 分、输入框里却是 37" 这种两个真相的情况。
          */}
          <label className="mt-2 flex min-h-11 items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_MINUTES}
              step={1}
              value={draft ?? String(minutes)}
              onChange={(e) => onMinutesInput(e.target.value)}
              onBlur={commitDraft}
              aria-label="自定义时长（分钟）"
              className="field tnum min-h-12 flex-1"
            />
            <span className="shrink-0 text-[0.82rem] text-secondary">分钟</span>
          </label>
        </div>

        <div>
          <span className="mb-2 block text-xs font-medium text-secondary">时间</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setWhen('now')}
              className={cx(
                'min-h-11 flex-1 rounded-xl border text-[0.85rem] font-medium transition-colors duration-200',
                when === 'now'
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
              )}
            >
              刚刚结束
            </button>
            <button
              type="button"
              onClick={() => setWhen('earlier')}
              className={cx(
                'min-h-11 flex-1 rounded-xl border text-[0.85rem] font-medium transition-colors duration-200',
                when === 'earlier'
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
              )}
            >
              指定时间
            </button>
          </div>
          {when === 'earlier' && (
            <div className="mt-2">
              <input
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                className="field tnum min-h-12"
              />
              <p className="mt-1.5 text-[0.7rem] text-tertiary">
                {at ? `记为 ${at.replace('T', ' ')} 结束` : '选择一个时间'}
              </p>
            </div>
          )}
        </div>

        {activeGoals.length > 0 && (
          <div>
            <span className="mb-2 block text-xs font-medium text-secondary">关联目标（可选）</span>
            <select
              value={goalId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                setGoalId(id);
                const g = activeGoals.find((x) => x.id === id);
                if (g) setSubject(g.subject);
              }}
              className="field min-h-12"
            >
              <option value="">不关联</option>
              {activeGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">学了什么（可选）</span>
          <input
            value={review}
            onChange={(e) => setReview(e.target.value)}
            placeholder="例如：错题整理"
            className="field min-h-12"
          />
        </label>
      </div>
    </Sheet>
  );
}
