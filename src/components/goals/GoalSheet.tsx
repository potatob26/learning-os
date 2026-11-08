import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { useStore } from '../../lib/store';
import type { Goal, GoalKind, Priority } from '../../lib/types';
import { hasPlannedMinutes } from '../../lib/types';
import { outcomeBreakdown } from '../../lib/stats';
import { fmtDuration } from '../../lib/time';
import { cx } from '../../lib/utils';

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '其他'];

/** 新建 / 编辑目标：一个表单同时承担两种职责 */
export function GoalSheet({
  open,
  goal,
  onClose,
}: {
  open: boolean;
  goal?: Goal;
  onClose: () => void;
}) {
  const addGoal = useStore((s) => s.addGoal);
  const updateGoal = useStore((s) => s.updateGoal);
  const removeGoal = useStore((s) => s.removeGoal);

  const editing = Boolean(goal);

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('数学');
  const [description, setDescription] = useState('');
  const [planned, setPlanned] = useState(60);
  /*
   * 「不限时长」：计时目标也可以不设预计要多久（例如「整理错题」——
   * 知道要做、也愿意计时，但说不出需要多少分钟）。
   * 用独立布尔的理由：`planned` 是受控输入的数字，把"不限"塞进它会让输入框显示错值。
   */
  const [noPlan, setNoPlan] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('23:59');
  const [priority, setPriority] = useState<Priority>('normal');
  // 删除采用两段式：第一下只进入待确认态，再点一下才真的删
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /* 成果目标（不计时）：只记数值进度。当前值/目标值用字符串存，
     这样输入过程中「-」「1.」这类中间态不会被 Number() 吃掉。 */
  const [kind, setKind] = useState<GoalKind>('time');
  const [cur, setCur] = useState('');
  /*
   * 起始值（成果目标专有）：进度 = (当前 − 起始) / (目标 − 起始)。
   * 正常情况由创建时的「当前值」自动记录，**编辑时允许修改**（1.3.0）——
   * 用户报「名次进度 80% 看不懂」的根因就是起始值可能记错了；
   * 创建时只能记一次、改不了的话，记错就永久错，只能删了重建（会丢进度）。
   * 建目标时不显示这一栏（那时起始值就等于当前值，多一个栏位只会让人犹豫）。
   */
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');

  const outcome = kind === 'outcome';
  /*
   * 滑块上限：常用区间是 4 小时，但计划时长**没有上限**。
   * 一旦数字框填了更长的值，滑块上限就跟着抬到整小时，保证滑块不会失真
   * （范围写死 240 时，超过它的值滑块根本表达不出来）。
   */
  const sliderMax = Math.max(240, Math.ceil((planned || 0) / 60) * 60);
  const curN = Number(cur);
  const targetN = Number(target);
  // 目标值等于当前值跨度为 0，算不出进度（store 里也会兜底，但表单先拦住更清楚）
  const progressReady =
    cur.trim() !== '' && target.trim() !== '' &&
    Number.isFinite(curN) && Number.isFinite(targetN) && targetN !== curN;

  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      return;
    }
    if (goal) {
      setTitle(goal.title);
      setSubject(goal.subject || '其他');
      setDescription(goal.description ?? '');
      // 有预计时长就把数字填进输入框；不限时长（null）则打开"不限"开关，数字给个合理默认值备用
      setNoPlan(goal.kind !== 'outcome' && !hasPlannedMinutes(goal));
      setPlanned(hasPlannedMinutes(goal) ? (goal.plannedMinutes ?? 60) : 60);
      setPriority(goal.priority);
      setKind(goal.kind === 'outcome' ? 'outcome' : 'time');
      setCur(goal.progress ? String(goal.progress.current) : '');
      setTarget(goal.progress ? String(goal.progress.target) : '');
      setUnit(goal.progress?.unit ?? '');
      setStart(goal.progress ? String(goal.progress.start) : '');
      if (goal.dueAt) {
        const [d, t] = goal.dueAt.split(' ');
        setDueDate(d ?? '');
        setDueTime(t ?? '23:59');
      } else {
        setDueDate('');
        setDueTime('23:59');
      }
    } else {
      setTitle('');
      setSubject('数学');
      setDescription('');
      setPlanned(60);
      setNoPlan(false);
      setPriority('normal');
      setKind('time');
      setCur('');
      setTarget('');
      setUnit('');
      setStart('');
      setDueDate('');
      setDueTime('23:59');
    }
  }, [open, goal]);

  const save = () => {
    const dueAt = dueDate ? `${dueDate} ${dueTime || '23:59'}` : null;
    /*
     * 起始值：**编辑时以表单里填的为准**（1.3.0 起可改），没填就沿用原来的；
     * 新建时取当前值 —— 那时"起点"就等于"现在"。
     *
     * 为什么不再无条件沿用旧 start：用户报「名次进度 80% 看不懂」，
     * 根因就是起始值可能记错了，而原来它只能创建时记录一次、永远改不了，
     * 记错就只能删掉重建（会丢已有进度）。现在能在表单里改。
     * 注意"不改当前值却把 start 改小"会让进度变大 —— 这是**正确**的：
     * 说明起点更低（一开始更差），同样的现状确实前进得更多。
     */
    const startN = Number(start);
    const startValue =
      goal?.progress
        ? start.trim() !== '' && Number.isFinite(startN)
          ? startN
          : goal.progress.start
        : curN;
    // 成果目标：计划与实际时长都置 0（不参与计时），只带数值进度
    const shape = outcome
      ? {
          kind: 'outcome' as const,
          plannedMinutes: 0,
          progress: {
            start: startValue,
            current: curN,
            target: targetN,
            unit: unit.trim() || undefined,
          },
        }
      : {
          kind: 'time' as const,
          // 「不限」→ null（不是 0：0 是成果目标的约定，混用会让统计把它们当成同一回事）
          plannedMinutes: noPlan ? null : Math.max(5, Math.round(planned)),
          progress: null,
        };

    if (goal) {
      updateGoal(goal.id, {
        title: title.trim() || goal.title,
        subject,
        description: description.trim() || undefined,
        dueAt,
        priority,
        ...shape,
      });
    } else {
      addGoal({
        title: title.trim(),
        subject,
        description: description.trim() || undefined,
        dueAt,
        priority,
        ...shape,
      });
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? '编辑目标' : '新建目标'}
      footer={
        <div className="flex gap-2">
          {editing && (
            <Button
              variant={confirmingDelete ? 'danger' : 'secondary'}
              size="lg"
              icon={<Trash2 />}
              onClick={() => {
                if (!goal) return;
                if (!confirmingDelete) {
                  setConfirmingDelete(true);
                  return;
                }
                removeGoal(goal.id);
                onClose();
              }}
              className={cx(!confirmingDelete && 'text-[var(--bad-text)]')}
            >
              {confirmingDelete ? '确认删除' : '删除'}
            </Button>
          )}
          <Button size="lg" block disabled={!title.trim() || (outcome && !progressReady)} onClick={save}>
            {editing ? '保存' : '创建目标'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">目标名称</span>
          <input
            autoFocus={!editing}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：完成一套数学试卷"
            className="field min-h-12"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">科目</span>
          <div className="flex flex-wrap gap-1.5">
            {SUBJECTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSubject(s)}
                className={cx(
                  'min-h-11 rounded-full border px-3.5 text-[0.82rem] font-medium transition-colors duration-200',
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

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">描述（可选）</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="具体做哪些内容、从哪一章开始…"
            className="field resize-none"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">目标类型</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { v: 'time' as const, l: '计时目标', d: '按时长推进' },
                { v: 'outcome' as const, l: '成果目标', d: '只记数值进度' },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setKind(o.v)}
                className={cx(
                  'min-h-14 rounded-xl border px-3 py-2 text-left transition-colors duration-200',
                  kind === o.v
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                <span className="block text-[0.82rem] font-medium">{o.l}</span>
                <span className="mt-0.5 block text-[0.7rem] opacity-80">{o.d}</span>
              </button>
            ))}
          </div>
          {outcome && (
            <p className="mt-1.5 text-[0.7rem] leading-relaxed text-secondary">
              适合「期中到达班级多少名」这类没法定时长的事。它不计时，也不会写成学习时长。
            </p>
          )}
        </div>

        {outcome ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-secondary">当前值</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={cur}
                  onChange={(e) => setCur(e.target.value)}
                  placeholder="比如 25"
                  className="field tnum min-h-12"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-secondary">目标值</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="比如 10"
                  className="field tnum min-h-12"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-secondary">
                单位（可不填）
              </span>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value.slice(0, 4))}
                placeholder="名 / 套 / 分 / 个"
                className="field min-h-12"
              />
            </label>
            {/* 方向不设开关：由两个数的大小自动决定，少一个选错的机会 */}
            {progressReady && (
              <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
                {targetN < curN ? '越小越好' : '越大越好'}：从 {curN} 到 {targetN}
                {unit.trim() ? ` ${unit.trim()}` : ''}。创建后进度从 0% 开始算。
              </p>
            )}
            {cur.trim() !== '' && target.trim() !== '' && targetN === curN && (
              <p className="rounded-xl bg-[var(--bad-soft)] px-3 py-2 text-[0.72rem] leading-relaxed text-[var(--bad-text)]">
                目标值不能和当前值一样，否则算不出进度。
              </p>
            )}
            {/*
              起始值：**只在编辑已有目标时显示**。
              新建时它必然等于当前值，多一栏只会让人犹豫要不要填。
            */}
            {!!goal?.progress && (
              <div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-secondary">
                    起始值（进度从哪算起）
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    aria-label="起始值"
                    className="field tnum min-h-12"
                  />
                </label>
                <p className="mt-1.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
                  进度 = （当前 − 起始）÷（目标 − 起始）。
                  {(() => {
                    const b = outcomeBreakdown(goal);
                    if (!b || b.span === 0) return ' 当前算式还缺一个有效的起始/目标值。';
                    const better = b.lowerIsBetter;
                    return ` 现在：(${b.start} − ${b.current}) ÷ (${b.start} − ${b.target}) = ${Math.round(
                      ((better ? b.start - b.current : b.current - b.start) / b.span) * 100,
                    )}%。`;
                  })()}
                  <span className="mt-1 block">
                    起始值本来是创建时自动记下的。<b>只有发现它记错了才改</b> ——
                    改小会让百分比变大（说明一开始更差，同样是前进得更多）。
                  </span>
                </p>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-secondary">计划时长</span>
              <span className="tnum text-xs font-semibold text-secondary">
                {noPlan ? '不限时长' : planned > 0 ? fmtDuration(planned, 'long') : '未填写'}
              </span>
            </div>
            {/*
              「不限」开关：计时目标也可以不设预计要多久（例如「整理错题」）。
              关掉时下面才出现滑块与数字框 —— 不限的时候还给输入框会让人以为还要填。
            */}
            <button
              type="button"
              aria-pressed={noPlan}
              onClick={() => setNoPlan((v) => !v)}
              className={cx(
                'mb-2 min-h-10 rounded-full px-3.5 text-[0.72rem] font-medium transition-colors duration-200',
                noPlan
                  ? 'bg-[var(--text)] text-[var(--text-invert)]'
                  : 'bg-[var(--surface-sunken)] text-secondary',
              )}
            >
              不限时长
            </button>
            {noPlan ? (
              <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
                不设预计时长。计时照常记录，但计时器不再显示「还剩多久」，推荐时长按今天剩余时间算，
                目标页的「计划 X」也不会把它算进去。
              </p>
            ) : (
            <>
            <div className="flex items-center gap-2">
              {/*
                滑块只能覆盖一个有限区间，所以它不再当上限用：
                常用区间（5 分钟 ~ 4 小时）照样拖，想要更长的目标直接在右边填分钟数，
                填超过 4 小时后滑块的上限会跟着长上去，滑块本身也不会失真。
                （原来 max 固定 240，等于给计划时长设了 4 小时硬上限。）
              */}
              <input
                type="range"
                min={5}
                max={sliderMax}
                step={5}
                value={Math.min(Math.max(planned || 5, 5), sliderMax)}
                onChange={(e) => setPlanned(Number(e.target.value))}
                aria-label="计划时长滑块"
                className="h-11 flex-1 accent-[var(--accent)]"
              />
              <input
                type="number"
                inputMode="numeric"
                min={5}
                step={5}
                value={planned > 0 ? planned : ''}
                onChange={(e) => {
                  // 只留数字：允许中途清空重输，清空时记为 0，失焦再补回最小值
                  const raw = e.target.value.replace(/[^\d]/g, '');
                  setPlanned(raw === '' ? 0 : Math.min(99999, Number(raw)));
                }}
                onBlur={() => { if (planned < 5) setPlanned(5); }}
                aria-label="计划时长（分钟）"
                className="field tnum min-h-11 w-[4.6rem] shrink-0 text-center"
              />
              <span className="shrink-0 text-xs text-secondary">分钟</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPlanned(m)}
                  className={cx(
                    'min-h-10 rounded-full px-3.5 text-[0.72rem] font-medium transition-colors duration-200',
                    planned === m
                      ? 'bg-[var(--text)] text-[var(--text-invert)]'
                      : 'bg-[var(--surface-sunken)] text-secondary',
                  )}
                >
                  {m >= 60 ? `${m / 60} 小时` : `${m} 分`}
                </button>
              ))}
            </div>
            </>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">截止日期</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="field tnum min-h-12"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">截止时间</span>
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              disabled={!dueDate}
              className="field tnum min-h-12 disabled:opacity-50"
            />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">优先级</span>
          <div className="grid grid-cols-3 gap-1.5">
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
                  'min-h-11 rounded-xl border text-[0.82rem] font-medium transition-colors duration-200',
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

        {editing && goal && (
          <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.72rem] leading-relaxed text-secondary">
            {goal.kind === 'outcome'
              ? `起始值 ${goal.progress?.start ?? '—'}（创建时记录，用于算进度）。成果目标不计时，不会写入学习时长。`
              : `已累计学习 ${Math.round(goal.actualMinutes)} 分钟（由计时器自动写入，不可手动修改）`}
          </p>
        )}
      </div>
    </Sheet>
  );
}
