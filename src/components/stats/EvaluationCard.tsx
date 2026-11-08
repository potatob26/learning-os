import { useMemo, useState } from 'react';
import { RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useNow } from '../../hooks/useNow';
import { useReducedMotion } from '../../hooks/useTheme';
import { buildEvaluation } from '../../lib/evaluateText';
import { canEvaluate, computeEvalFacts } from '../../lib/evaluate';
import { TypedText } from './TypedText';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { cx } from '../../lib/utils';

/**
 * 学习评价卡片
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户的 docx 规格书要求：把评价模块**融入现有统计或每日学习总结页面**，
 * 不要为了新增功能大幅改动整体结构；展示 评价标题 / 正文 / 关键表现标签 /
 * 可选的重新生成按钮。
 *
 * 两条必须守住的：
 *  1. **没有计划也没有记录时，不给评价** —— 规格书写得很明确：
 *     "没有计划或没有记录：不进行无依据的评价"。所以这里显示引导，绝不硬编一句话。
 *  2. **重新生成只改说法、不改结论** —— 按钮文案就把这话说出来，
 *     实现上也确实是只换随机种子（事实那层不参与）。
 *
 * 数据全部来自现有 store，规则引擎与模板层都是纯函数，这里不新增任何存储。
 */
export function EvaluationCard() {
  const sessions = useStore((s) => s.sessions);
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const dayOverrides = useStore((s) => s.dayOverrides);
  const ts = useNow();

  const [seed, setSeed] = useState(1);
  const reducedMotion = useReducedMotion();

  const facts = useMemo(
    () => computeEvalFacts({ sessions, goals, tasks, settings, dayOverrides, nowTs: ts }),
    [sessions, goals, tasks, settings, dayOverrides, ts],
  );

  const ev = useMemo(() => buildEvaluation(facts, { seed }), [facts, seed]);
  const ok = canEvaluate(facts);

  if (!ok) {
    return (
      <Card padding="md">
        <CardTitle icon={<Sparkles />} title="学习评价" subtitle="根据你的真实记录生成" />
        <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-4 text-center text-[0.78rem] leading-relaxed text-secondary">
          今天还没有计划，也没有学习记录 —— 没有依据就不编评价。
          <br />
          去记一段，或者到【设置 → 作息】给今天定个目标，这里就有内容了。
        </p>
      </Card>
    );
  }

  const baseParts: { key: string; label: string; text: string }[] = [
    { key: 'today', label: '今日表现', text: ev.parts.today },
    { key: 'watch', label: '值得关注的地方', text: ev.parts.watch },
    { key: 'next', label: '下一步建议', text: ev.parts.next },
  ];

  /*
   * 逐字的节奏：整段控制在约 2.4 秒内 —— 长文本按比例加快，短文本放慢一点，
   * 这样不会出现"三行字打了十几秒"的难受情况。
   * settings.motion 为 false（应用里关了动效）或系统"减少动画"时不打，直接完整显示。
   */
  const totalChars = baseParts.reduce((sum, p) => sum + p.text.length, 0);
  const stepMs = Math.max(12, Math.min(34, Math.round(2400 / Math.max(1, totalChars))));
  const typing = settings.motion !== false && !reducedMotion;

  // 三段串行：每段等到上一段打完再多留 180ms
  let acc = 0;
  const parts = baseParts.map((p) => {
    const delayMs = acc;
    acc += p.text.length * stepMs + 180;
    return { ...p, delayMs };
  });

  return (
    <Card padding="md">
      <div data-testid="evaluation-card">
        <CardTitle
          icon={<Sparkles />}
          title={ev.title}
          subtitle="根据你的真实记录生成，不用任何外部服务"
        />

        {ev.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {ev.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[0.7rem] font-medium text-[var(--text)]"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {parts.map((p) => (
            <div key={p.key} data-eval-part={p.key}>
              <h3 className="mb-0.5 text-[0.7rem] font-medium tracking-wide text-tertiary">{p.label}</h3>
              <TypedText
                text={p.text}
                enabled={typing}
                stepMs={stepMs}
                delayMs={p.delayMs}
                runKey={seed}
                className="text-[0.86rem] leading-relaxed text-[var(--text)]"
              />
            </div>
          ))}
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
          <span className={cx('flex items-center gap-1.5 text-[0.7rem] text-tertiary')}>
            <TrendingUp className="size-3.5" />
            换个说法而已，结论不变
          </span>
          <Button variant="secondary" size="sm" onClick={() => setSeed((s) => s + 1)}>
            <RefreshCw className="size-3.5" />
            重新生成
          </Button>
        </div>
      </div>
    </Card>
  );
}
