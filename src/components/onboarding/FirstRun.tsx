import { useState } from 'react';
import { ArrowRight, Moon, Sun, Sunrise } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useSystemDark } from '../../hooks/useTheme';
import { Button } from '../ui/Button';
import { cx } from '../../lib/utils';
import { detectLowEnd } from '../../hooks/useTheme';
import { Logo } from '../ui/Logo';

/**
 * 首次使用引导（3 步）
 * 只问必要的作息信息 —— 因为可支配时间、剩余时间都基于它计算。
 * 不写死任何学业数据，课程/目标由用户自己建立。
 */
export function FirstRun() {
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  const [step, setStep] = useState(0);
  const systemDark = useSystemDark();

  const next = () => setStep((s) => Math.min(2, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const finish = () => {
    // 依据设备能力给出更稳妥的默认性能档位
    patch({ onboarded: true, perf: detectLowEnd() ? 'balanced' : 'high' });
  };

  return (
    <div className="min-h-dvh-safe page-x mx-auto flex w-full max-w-lg flex-col justify-center py-8">
      <div className="mb-6">
        <div className="mb-5 flex items-center gap-3">
          <Logo className="size-11" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">学习 OS</h1>
            <p className="text-sm text-secondary">先花 30 秒设定作息，之后的计算才准</p>
          </div>
        </div>

        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cx(
                'h-1.5 flex-1 rounded-full transition-colors duration-300',
                i <= step ? 'bg-[var(--accent)]' : 'bg-[var(--surface-sunken)]',
              )}
            />
          ))}
        </div>
      </div>

      <div className="lg-surface liquid-glass liquid-glass--static rounded-[var(--radius-card)] p-5 anim-rise">
        {step === 0 && (
          <div className="space-y-5">
            <Header
              icon={<Sunrise className="size-4" />}
              title="你在学校的时间"
              desc="用来扣掉上课占用的时段"
            />
            <Field label="上课时间（第一节开始）">
              <TimeInput
                value={settings.schoolStart}
                onChange={(v) => patch({ schoolStart: v })}
              />
            </Field>
            <Field label="放学时间">
              <TimeInput value={settings.schoolEnd} onChange={(v) => patch({ schoolEnd: v })} />
            </Field>
            <p className="text-xs leading-relaxed text-tertiary">
              具体每一节课的时间后面可以在「设置 → 课程表」里逐节调整。
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <Header
              icon={<Moon className="size-4" />}
              title="你的学习窗口"
              desc="只有窗口内的时间才算作「可支配」"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="学习开始">
                <TimeInput value={settings.studyFrom} onChange={(v) => patch({ studyFrom: v })} />
              </Field>
              <Field label="学习结束">
                <TimeInput value={settings.studyTo} onChange={(v) => patch({ studyTo: v })} />
              </Field>
            </div>
            <Field label="每天计划学习时长">
              <MinutePicker
                value={settings.dailyGoalMinutes}
                onChange={(v) => patch({ dailyGoalMinutes: v })}
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Header
              icon={systemDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
              title="外观"
              desc="主题和浅色/深色之后都能随时改"
            />
            <div>
              <p className="mb-2 text-sm font-medium">深浅模式</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: 'light' as const, l: '浅色' },
                  { v: 'dark' as const, l: '深色' },
                  { v: 'system' as const, l: '跟随系统' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => patch({ colorMode: o.v })}
                    className={cx(
                      'min-h-11 rounded-xl border text-sm font-medium transition-colors duration-200',
                      settings.colorMode === o.v
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                        : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                    )}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">主题</p>
              <ThemeMiniGrid />
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex gap-2">
        {step > 0 && (
          <Button variant="secondary" size="lg" onClick={back} className="flex-1">
            上一步
          </Button>
        )}
        {step < 2 ? (
          <Button size="lg" onClick={next} trailing={<ArrowRight />} className="flex-[2]">
            继续
          </Button>
        ) : (
          <Button size="lg" onClick={finish} className="flex-[2]">
            开始使用
          </Button>
        )}
      </div>
    </div>
  );
}

function Header({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-on-soft)]">
        {icon}
      </span>
      <div>
        <h2 className="font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-secondary">{desc}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-secondary">{label}</span>
      {children}
    </label>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="field tnum min-h-12"
    />
  );
}

function MinutePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options = [60, 90, 120, 150, 180, 240, 300];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cx(
            'min-h-11 rounded-xl border px-3.5 text-sm font-medium transition-colors duration-200',
            value === m
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
              : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
          )}
        >
          {m >= 60 ? `${m / 60} 小时` : `${m} 分`}
        </button>
      ))}
    </div>
  );
}

function ThemeMiniGrid() {
  const theme = useStore((s) => s.settings.theme);
  const patch = useStore((s) => s.patchSettings);
  const themes = [
    { id: 'liquid-glass-wc' as const, label: '透明玻璃' },
    { id: 'liquid-glass' as const, label: '磨砂玻璃' },
    { id: 'pure-light' as const, label: '极简白' },
    { id: 'pure-dark' as const, label: '极简黑' },
    { id: 'soft' as const, label: '柔和浅色' },
    { id: 'immersive' as const, label: '沉浸式' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => patch({ theme: t.id })}
          className={cx(
            'min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors duration-200',
            theme === t.id
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
              : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
