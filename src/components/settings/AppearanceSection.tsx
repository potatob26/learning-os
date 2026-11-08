import { useMemo, useState } from 'react';
import { Moon, Monitor, Palette, Sparkles, Sun, TrendingUp, X, Zap } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { useStore } from '../../lib/store';
import { COLOR_MODES, PERF_LEVELS, THEMES, detectLowEnd, useSystemDark } from '../../hooks/useTheme';
import { DARK_ONLY_THEMES } from '../../lib/types';
import { cx } from '../../lib/utils';
import { Switch } from '../ui/Switch';
import {
  MAX_CUSTOM_LENGTH,
  MAX_CUSTOM_QUOTES,
  QUOTE_COUNT,
} from '../../lib/quotes';

const MODE_ICON = {
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
  system: <Monitor className="size-4" />,
} as const;

export function AppearanceSection() {
  /*
   * 直接探测 WebGL 能力。
   * ⚠️ 不要改用 useGlassSupport()：它跟踪自研的 webgl-glass 渲染器（休眠管线），
   *    而真正渲染折射的是 vendor 的 <liquid-glass>；实测 WebGL 关掉后它一直是 null，
   *    玻璃层却照样渲染 —— 用它判断会得出错误结论。
   */
  const webglAvailable = useMemo(() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }, []);
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  const systemDark = useSystemDark();
  const lowEnd = detectLowEnd();

  return (
    <div className="space-y-3">
      <Card padding="md">
        <CardTitle
          icon={<Palette />}
          title="主题"
          subtitle="选择你喜欢的颜色与质感"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => patch({ theme: t.id })}
              className={cx(
                'rounded-2xl border p-2.5 text-left transition-colors duration-200 active:scale-[0.98]',
                settings.theme === t.id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)]',
              )}
            >
              <span className="mb-2 flex gap-1">
                {t.swatch.map((c, i) => (
                  <span
                    key={i}
                    className="size-5 rounded-full border border-black/10"
                    style={{ background: c }}
                  />
                ))}
              </span>
              {/* 选中态靠边框与浅底表达；主题名用正文色，保证玻璃主题下也够清楚 */}
              <span className="block text-[0.82rem] font-semibold">{t.label}</span>
              <span className="block text-[0.7rem] leading-snug text-tertiary">{t.desc}</span>
            </button>
          ))}
        </div>
        {/*
          这段提示原来挂在「透明玻璃主题」开关下面。那个开关删了（主题网格里本来就能
          直接选透明玻璃），但这条信息有用 —— 省电模式会暂停折射，用户会以为主题坏了。
          所以挪到主题卡片里，按当前主题条件显示，信息不跟着开关一起丢。
        */}
        {settings.theme === 'liquid-glass-wc' && (settings.perf === 'saver' || !settings.glassBlur) && (
          <p className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.7rem] leading-relaxed text-secondary">
            当前已暂停折射效果，使用清晰的实色表面。恢复玻璃模糊并退出省电模式后，效果会自动恢复。
          </p>
        )}
        {/*
          另一种"看不见玻璃"的原因：这台设备/浏览器没有可用的 WebGL。
          真机排查时发现的坑：原来想用 `useGlassSupport()` 判断，但实测它**反映不了真实情况** ——
          它跟踪的是自研的 webgl-glass 渲染器（协作者报告 A6 里的"休眠管线"），
          而实际在渲染折射的是 vendor 那套 <liquid-glass>。把 WebGL 关掉实测：
          `data-glass` 从未被设置、`reg.supported` 一直是 null，可玻璃层照样渲染了 5 个元素。
          所以改成**直接探测能力**；两套管线并存这件事写在这里，免得后人再误判。
          局限（如实标注）：vendor 元素自身的初始化失败无法从这里观测到，
          这条提示只能覆盖"环境根本没有 WebGL"这一类。
        */}
        {settings.theme === 'liquid-glass-wc' && settings.perf !== 'saver' && settings.glassBlur && !webglAvailable && (
          <p className="mt-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.7rem] leading-relaxed text-secondary">
            这台设备上没能启用玻璃渲染（WebGL 不可用），卡片已自动降级为磨砂材质 ——
            数据与功能都不受影响。换一个浏览器或设备可以恢复折射效果。
          </p>
        )}
      </Card>

      <AccentCard />
      <RingColorCard />
      <QuoteCard />

      <Card padding="md">
        <CardTitle
          title="浅色 / 深色"
          subtitle={`跟随系统时，安卓切换深色后网站会立即同步${systemDark ? '（当前系统为深色）' : '（当前系统为浅色）'}`}
        />
        {DARK_ONLY_THEMES.includes(settings.theme) && (
          <p className="mb-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.7rem] leading-relaxed text-secondary">
            当前主题「{THEMES.find((t) => t.id === settings.theme)?.label}」本身固定为深色，
            这一项对它不生效 —— 否则会出现浅色背景配浅色文字、字看不见的情况。
            想随明暗切换外观，请选择磨砂玻璃、极简白、柔和浅色或沉浸式。
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {COLOR_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => patch({ colorMode: m.id })}
              className={cx(
                'flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border text-[0.8rem] font-medium transition-colors duration-200',
                settings.colorMode === m.id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
              )}
            >
              {MODE_ICON[m.id]}
              {m.label}
            </button>
          ))}
        </div>
      </Card>

      <Card padding="md">
        <CardTitle
          icon={<Zap />}
          title="性能"
          subtitle="安卓优先。省电档位会自动关闭动态背景与玻璃模糊"
        />
        {lowEnd && (
          <p className="mb-2.5 rounded-xl bg-[var(--info-soft)] px-3 py-2 text-[0.72rem] leading-relaxed text-[var(--info-text)]">
            检测到设备性能一般，建议使用「平衡」或「省电」档位。
          </p>
        )}
        <div className="space-y-2">
          {PERF_LEVELS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => patch({ perf: p.id })}
              className={cx(
                'flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors duration-200',
                settings.perf === p.id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)]',
              )}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={cx(
                    'block text-[0.88rem] font-semibold',
                    settings.perf === p.id && 'text-[var(--accent-on-soft)]',
                  )}
                >
                  {p.label}
                </span>
                <span className="block text-[0.7rem] leading-snug text-tertiary">{p.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card padding="md">
        <CardTitle icon={<Sparkles />} title="动效" subtitle="全部可以关闭，关掉后更省电也更安静" />
        <div className="space-y-1">
          <Switch
            label="页面与卡片动画"
            desc="进入、进度增长等过渡效果"
            checked={settings.motion}
            onChange={(v) => patch({ motion: v })}
            disabled={settings.perf === 'saver'}
          />
          <Switch
            label="玻璃模糊"
            desc="磨砂玻璃的背景模糊，关闭后改用实色卡片"
            checked={settings.glassBlur}
            onChange={(v) => patch({ glassBlur: v })}
            disabled={settings.perf === 'saver'}
          />
          <Switch
            label="动态背景"
            desc="背景缓慢流动"
            checked={settings.dynamicBackground}
            onChange={(v) => patch({ dynamicBackground: v })}
            disabled={settings.perf === 'saver'}
          />
        </div>
        <p className="mt-2 text-[0.7rem] leading-relaxed text-tertiary">
          系统开启「减少动画」时，应用会自动跟随，无需手动设置。
        </p>
      </Card>
    </div>
  );
}

/* ───────────────────────── 强调色 ───────────────────────── */

/** 预设色：覆盖冷暖与常见偏好，避免用户自己去调色板里找 */
const ACCENT_PRESETS: Array<{ hex: string; name: string }> = [
  { hex: '#3b82f6', name: '蓝' },
  { hex: '#6366f1', name: '靛' },
  { hex: '#8b5cf6', name: '紫' },
  { hex: '#ec4899', name: '粉' },
  { hex: '#ef4444', name: '红' },
  { hex: '#f97316', name: '橙' },
  { hex: '#eab308', name: '黄' },
  { hex: '#22c55e', name: '绿' },
  { hex: '#14b8a6', name: '青' },
  { hex: '#64748b', name: '灰' },
];

function AccentCard() {
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  // 透明玻璃主题不使用自定义强调色：它的观感由玻璃折射主导
  const disabled = settings.theme === 'liquid-glass-wc';
  const current = settings.accent ?? null;

  return (
    <Card padding="md">
      <CardTitle
        icon={<Palette />}
        title="按钮颜色"
        subtitle="按钮、进度环、选中态与图表会一起变色"
      />

      {disabled && (
        <p className="mb-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.7rem] leading-relaxed text-secondary">
          透明玻璃主题沿用自带配色，不适用自定义颜色。换到其他主题即可调整。
        </p>
      )}

      <div className={cx('flex flex-wrap gap-2', disabled && 'pointer-events-none opacity-40')}>
        {ACCENT_PRESETS.map((p) => {
          const on = current === p.hex;
          return (
            <button
              key={p.hex}
              type="button"
              aria-label={p.name}
              aria-pressed={on}
              onClick={() => patch({ accent: on ? null : p.hex })}
              className={cx(
                'grid size-11 place-items-center rounded-full border-2 transition-transform active:scale-95',
                on ? 'border-[var(--text)]' : 'border-transparent',
              )}
              style={{ background: p.hex }}
            />
          );
        })}
      </div>

      <div className={cx('mt-3 flex items-center gap-3', disabled && 'pointer-events-none opacity-40')}>
        <label className="flex min-h-11 flex-1 items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-sunken)] px-3">
          <span className="text-[0.75rem] text-secondary">自定义</span>
          <input
            type="color"
            value={current ?? '#3b82f6'}
            onChange={(e) => patch({ accent: e.target.value })}
            className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label="自定义按钮颜色"
          />
          <span className="tnum text-[0.72rem] text-tertiary">{current ?? '主题默认'}</span>
        </label>
        <Button
          variant="secondary"
          size="sm"
          disabled={current === null}
          onClick={() => patch({ accent: null })}
        >
          恢复默认
        </Button>
      </div>

      <p className="mt-2 text-[0.7rem] leading-relaxed text-tertiary">
        按钮上的文字与选中态文字都是从这个颜色按比例算出来的，
        所以选任何颜色都不会出现看不清的字。
      </p>
    </Card>
  );
}

/* ───────────────────────── 进度环颜色（两圈各自可调）───────────────────────── */

/**
 * 首页进度环有两个状态，颜色各自独立可调：
 *   · 正常那一圈（0–100%）：缺省跟随按钮颜色；达成时按原逻辑转成功色
 *   · 超额那一圈（>100% 多出来的）：缺省也跟随按钮颜色
 *
 * 为什么合成一张卡而不是两张：两个设置是同一件事的两个状态，
 * 分成两张卡既占屏又容易让人以为它们是无关的开关。
 *
 * 语义（写在这里，免得以后被改乱）：
 *   一旦用户给「正常那一圈」选了颜色，这一圈就**恒用该颜色** ——
 *   达成时也不再被成功色盖掉。否则会出现"我设的颜色达成后就没了"。
 *   没设的时候行为与以前完全一致，不会造成视觉回归。
 */
function RingColorCard() {
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  const disabled = settings.theme === 'liquid-glass-wc';

  const rows: Array<{
    key: 'ringColor' | 'ringOverflow';
    label: string;
    hint: string;
    fallback: string;
    fallbackHex: string;
  }> = [
    {
      key: 'ringColor',
      label: '正常进度',
      hint: '还没到 100% 时那一圈',
      fallback: '跟随按钮颜色',
      fallbackHex: '#3b82f6',
    },
    {
      key: 'ringOverflow',
      label: '超额部分',
      hint: '超过 100% 后多出来的那一圈',
      fallback: '跟随按钮颜色',
      fallbackHex: '#22c55e',
    },
  ];

  return (
    <Card padding="md">
      <CardTitle
        icon={<TrendingUp />}
        title="进度环颜色"
        subtitle="两圈可以分别调：正常进度与超额部分"
      />

      {disabled && (
        <p className="mb-2.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-[0.7rem] leading-relaxed text-secondary">
          透明玻璃主题沿用自带配色，不适用自定义颜色。换到其他主题即可调整。
        </p>
      )}

      <div className="space-y-4">
        {rows.map((row) => {
          const current = settings[row.key] ?? null;
          return (
            <div key={row.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-secondary">{row.label}</span>
                <span className="text-[0.7rem] text-tertiary">{row.hint}</span>
              </div>
              <div className={cx('flex flex-wrap gap-2', disabled && 'pointer-events-none opacity-40')}>
                {ACCENT_PRESETS.map((p) => {
                  const on = current === p.hex;
                  return (
                    <button
                      key={p.hex}
                      type="button"
                      aria-label={`${row.label} ${p.name}`}
                      aria-pressed={on}
                      onClick={() => patch({ [row.key]: on ? null : p.hex })}
                      className={cx(
                        'grid size-11 place-items-center rounded-full border-2 transition-transform active:scale-95',
                        on ? 'border-[var(--text)]' : 'border-transparent',
                      )}
                      style={{ background: p.hex }}
                    />
                  );
                })}
              </div>
              <div className={cx('mt-2 flex items-center gap-3', disabled && 'pointer-events-none opacity-40')}>
                <label className="flex min-h-11 flex-1 items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-sunken)] px-3">
                  <span className="text-[0.75rem] text-secondary">自定义</span>
                  <input
                    type="color"
                    value={current ?? row.fallbackHex}
                    onChange={(e) => patch({ [row.key]: e.target.value })}
                    className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
                    aria-label={`自定义${row.label}颜色`}
                  />
                  <span className="tnum text-[0.72rem] text-tertiary">{current ?? row.fallback}</span>
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={current === null}
                  onClick={() => patch({ [row.key]: null })}
                >
                  恢复默认
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[0.7rem] leading-relaxed text-tertiary">
        首页那个百分比不封顶：学到目标的两倍就显示 200%。正常那一圈满圈表示已达成，
        里面那一圈表示超出的部分 —— 一圈最多再画满 100%。
        给「正常进度」选了颜色之后，这一圈就一直是它，达成时也不会被系统换成别的颜色。
      </p>
    </Card>
  );
}

/* ───────────────────────── 自定义鼓励语 ───────────────────────── */

function QuoteCard() {
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  const [draft, setDraft] = useState('');
  const list = settings.customQuotes ?? [];
  const useBuiltin = settings.useBuiltinQuotes !== false;

  const add = () => {
    const t = draft.trim().slice(0, MAX_CUSTOM_LENGTH);
    if (!t) return;
    if (list.includes(t)) {
      setDraft('');
      return;
    }
    if (list.length >= MAX_CUSTOM_QUOTES) return;
    patch({ customQuotes: [...list, t] });
    setDraft('');
  };

  const remove = (i: number) => {
    patch({ customQuotes: list.filter((_, idx) => idx !== i) });
  };

  return (
    <Card padding="md">
      <CardTitle
        icon={<Sparkles />}
        title="鼓励语句"
        subtitle="首页那句可以换成你自己的话"
      />

      <Switch
        label="使用内置语句库"
        desc={`${QUOTE_COUNT} 条内置语句，与你自己添加的一起随机`}
        checked={useBuiltin}
        onChange={(v) => patch({ useBuiltinQuotes: v })}
      />

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          maxLength={MAX_CUSTOM_LENGTH}
          placeholder="写一句给自己的话"
          aria-label="给自己的话"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-sunken)] px-3 text-[0.82rem] outline-none focus:border-[var(--accent)]"
        />
        <Button onClick={add} disabled={!draft.trim() || list.length >= MAX_CUSTOM_QUOTES}>
          添加
        </Button>
      </div>

      {list.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {list.map((q, i) => (
            <li
              key={`${q}-${i}`}
              className="flex items-center gap-2 rounded-xl bg-[var(--surface-sunken)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-[0.78rem] leading-relaxed">{q}</span>
              <button
                type="button"
                aria-label="删除这一条"
                onClick={() => remove(i)}
                className="grid size-9 shrink-0 place-items-center rounded-full text-tertiary transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--bad-text)]"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[0.7rem] leading-relaxed text-tertiary">
          还没有自定义语句。加上之后，首页那句会从「内置 + 你的」里一起随机；
          也可以点首页那句话右边的按钮手动换一句。
        </p>
      )}

      {!useBuiltin && list.length === 0 && (
        <p className="mt-2 rounded-xl bg-[var(--warn-soft)] px-3 py-2 text-[0.7rem] leading-relaxed text-[var(--warn-text)]">
          内置语句已关闭，且还没有自定义语句 —— 首页会显示一句默认占位。
        </p>
      )}
    </Card>
  );
}
