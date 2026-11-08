import { useMemo } from 'react';
import { CalendarDays, Clock3, Flame, Target, Timer, Trophy } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { useNow } from '../../hooks/useNow';
import { useStore } from '../../lib/store';
import { fmtDuration } from '../../lib/time';
import { achievementProgressList, type AchievementDef } from '../../lib/achievements';
import type { AchievementProgress } from '../../lib/achievements';

/**
 * 成就面板（统计页「成就」标签）
 * ──────────────────────────────────────────────────────────────
 * 只展示由真实记录派生的里程碑；不排名、不比较他人、不设领取按钮。
 * 锁定项显示真实进度，避免「只差一点点」被误解成随机解锁。
 */
export function AchievementsPanel() {
  const sessions = useStore((s) => s.sessions);
  const goals = useStore((s) => s.goals);
  const rescues = useStore((s) => s.streakRescues);
  const achievements = useStore((s) => s.achievements);
  const ts = useNow();

  const list = useMemo(
    () => achievementProgressList(sessions, goals, rescues, achievements, ts),
    [sessions, goals, rescues, achievements, ts],
  );
  const got = list.filter((a) => a.unlock !== null).length;

  return (
    <div className="space-y-3">
      <Card padding="md">
        <CardTitle
          icon={<Trophy />}
          title="成就"
          subtitle={`已获得 ${got} / ${list.length} · 只跟自己的记录比`}
        />
        <div className="flex items-end gap-2">
          <span className="tnum text-[2rem] font-semibold leading-none">{got}</span>
          <span className="pb-1 text-sm font-medium text-secondary">/ {list.length} 项</span>
        </div>
        <Progress className="mt-3" percent={list.length > 0 ? (got / list.length) * 100 : 0} />
        <p className="mt-2 text-[0.72rem] leading-relaxed text-secondary">
          成就全部由真实的计时与补录记录算出；只和自己的记录比，也没有领取按钮。
        </p>
      </Card>

      <div className="space-y-2.5">
        {list.map((item) => (
          <AchievementRow key={item.def.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function AchievementRow({ item }: { item: AchievementProgress }) {
  const { def, value, target, unlock, ratio } = item;
  const unlocked = unlock !== null;
  return (
    <Card padding="sm">
      <div className="flex items-start gap-3">
        <span
          className={
            unlocked
              ? 'grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
              : 'grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-tertiary)]'
          }
          aria-hidden
        >
          {iconFor(def)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[0.9rem] font-semibold">{def.name}</p>
            <span className="shrink-0 text-[0.7rem] font-medium text-secondary">
              {unlocked ? '已获得' : `${Math.round(ratio * 100)}%`}
            </span>
          </div>
          <p className="mt-0.5 text-[0.7rem] leading-relaxed text-tertiary">{def.description}</p>
          {unlocked ? (
            <p className="mt-1 text-[0.72rem] text-secondary">
              {formatUnlocked(unlock.unlockedAt)} · 达成时 {formatValue(def, unlock.evidence)}
            </p>
          ) : (
            <>
              <Progress className="mt-2" size="sm" percent={ratio * 100} />
              <p className="mt-1 text-[0.7rem] text-tertiary">
                {formatValue(def, value)} / {formatValue(def, target)}
              </p>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function iconFor(def: AchievementDef) {
  const cls = 'size-[1.15rem]';
  switch (def.kind) {
    case 'minutes':
      return <Clock3 className={cls} />;
    case 'days':
      return <CalendarDays className={cls} />;
    case 'streak':
      return <Flame className={cls} />;
    case 'goals':
      return <Target className={cls} />;
    case 'session':
      return <Timer className={cls} />;
  }
}

/** 统一把「分钟 / 天 / 次」写成人能读的字面量 */
function formatValue(def: AchievementDef, raw: number): string {
  const v = Math.round(raw);
  switch (def.kind) {
    case 'minutes': {
      const hours = Math.floor(v / 60);
      const mins = v % 60;
      if (hours === 0) return `${v} 分钟`;
      return mins === 0 ? `${hours} 小时` : `${hours} 小时 ${mins} 分`;
    }
    case 'days':
    case 'streak':
      return `${v} 天`;
    case 'goals':
      return `${v} 个`;
    case 'session':
      return `${v} 分钟`;
  }
}

function formatUnlocked(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 供外部（如交接文档脚本）复用的格式化：时长用现有的 fmtDuration 口径 */
export function formatAchievementEvidence(def: AchievementDef, raw: number): string {
  if (def.kind === 'minutes') return fmtDuration(Math.round(raw));
  return formatValue(def, raw);
}
