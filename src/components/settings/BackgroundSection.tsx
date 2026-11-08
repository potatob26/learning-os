import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, ImagePlus, Palette, RefreshCw, Trash2 } from 'lucide-react';
import { Move } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { ConfirmSheet } from '../ui/Sheet';
import { useStore } from '../../lib/store';
import { SCENES, downscaleImage, analyzeImage, recommendDim } from '../../lib/background';
import { useSystemDark } from '../../hooks/useTheme';
import { cx, formatBytes } from '../../lib/utils';
import type { BackgroundMode, CustomBackground } from '../../lib/types';
import { BackgroundFocusEditor } from './BackgroundFocusEditor';
import { paintGlassFlow } from '../../glass/flow-background';

const MODES: { id: BackgroundMode; label: string; desc: string }[] = [
  { id: 'fixed', label: '固定', desc: '一直用同一张' },
  { id: 'daily', label: '每日更换', desc: '每天换一张' },
  { id: 'each-open', label: '每次打开', desc: '每次进入随机' },
  { id: 'random', label: '定时切换', desc: '按间隔自动轮换' },
];

const ROTATE_OPTIONS = [15, 30, 60, 120, 240];

export function BackgroundSection() {
  const bg = useStore((s) => s.background);
  const patchBackground = useStore((s) => s.patchBackground);
  const addCustom = useStore((s) => s.addCustomBackground);
  const removeCustom = useStore((s) => s.removeCustomBackground);
  const setBackground = useStore((s) => s.setBackground);
  const perf = useStore((s) => s.settings.perf);
  const systemDark = useSystemDark();

  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomBackground | null>(null);
  /** 正在调节「显示范围」的那张图（null = 全部收起，列表才不会被撑长） */
  const [focusFor, setFocusFor] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        if (!file.type.startsWith('image/')) {
          setError('只能选择图片文件');
          continue;
        }
        if (file.size > 20 * 1024 * 1024) {
          setError('图片太大（超过 20MB），请先压缩');
          continue;
        }
        const result = await downscaleImage(file);
        // 用亮度**分布**而不是平均值推荐暗化强度：
        // 平均值会漏掉「夜景里一块亮招牌」这类局部过亮/过暗的情况
        const tone = await analyzeImage(result.dataUrl);
        addCustom({
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || '我的背景',
          dataUrl: result.dataUrl,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        });
        // 自动调整暗化强度，保证文字始终可读；
        // dimAuto 置 true 表示"这个值由系统推荐"，之后切换浅色/深色会自动重算
        patchBackground({ dim: recommendDim(tone, systemDark), dimAuto: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片处理失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pool = bg.enabledIds;
  const toggleInPool = (id: string) => {
    const next = pool.includes(id) ? pool.filter((x) => x !== id) : [...pool, id];
    patchBackground({ enabledIds: next });
  };

  return (
    <div className="space-y-3">
      <Card padding="md">
        <CardTitle
          icon={<Palette />}
          title="内置背景"
          subtitle="程序生成，无需下载；流光来自液态玻璃演示"
        />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {SCENES.map((s) => {
            const id = `scene:${s.id}`;
            const active = bg.current === id;
            const inPool = pool.includes(id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setBackground(id);
                  if (!inPool) toggleInPool(id);
                }}
                className={cx(
                  'overflow-hidden rounded-2xl border p-0 text-left transition-colors duration-200 active:scale-[0.98]',
                  active ? 'border-[var(--accent)]' : 'border-[var(--line)]',
                )}
              >
                <span className="relative block h-16 w-full overflow-hidden bg-[var(--bg-base)]">
                  {s.id === 'glass-flow' ? <FlowPreview /> : <span
                    className={`bg-scene scene-${s.id}`}
                    style={{ inset: 0, position: 'absolute' }}
                  />}
                  <span className="bg-veil absolute inset-0" style={{ opacity: 0.35 }} />
                </span>
                <span className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span
                    className={cx(
                      'truncate text-[0.72rem] font-semibold',
                      active && 'text-[var(--accent-text)]',
                    )}
                  >
                    {s.label}
                  </span>
                  {inPool && <RefreshCw className="size-3 shrink-0 text-[var(--accent-text)]" />}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[0.7rem] leading-relaxed text-tertiary">
          带 ↻ 的会参与自动轮换。
          {perf === 'saver' && ' 当前为省电档位，动态背景已暂停。'}
        </p>
      </Card>

      <Card padding="md">
        <CardTitle
          icon={<ImageIcon />}
          title="我的背景"
          subtitle="上传的照片会自动压缩并计算合适的明暗补偿"
          action={
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex min-h-11 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3.5 text-[0.72rem] font-semibold text-[var(--accent-on-soft)] disabled:opacity-50"
            >
              <ImagePlus className="size-3.5" />
              {busy ? '处理中' : '上传'}
            </button>
          }
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />

        {error && (
          <p className="mb-2 rounded-xl bg-[var(--bad-soft)] px-3 py-2 text-[0.72rem] text-[var(--bad-text)]">
            {error}
          </p>
        )}

        {bg.custom.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-4 text-center text-[0.76rem] text-secondary">
            还没有上传图片。也可以一直用内置的渐变背景，更省电也更清晰。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {bg.custom.map((c) => {
              const id = `img:${c.id}`;
              const active = bg.current === id;
              const inPool = pool.includes(id);
              return (
                <div key={c.id} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setBackground(id);
                      if (!inPool) toggleInPool(id);
                    }}
                    className={cx(
                      'block w-full overflow-hidden rounded-2xl border',
                      active ? 'border-[var(--accent)]' : 'border-[var(--line)]',
                    )}
                  >
                    <img
                      src={c.dataUrl}
                      alt={c.name}
                      loading="lazy"
                      className="h-16 w-full object-cover"
                    />
                    <span className="block truncate px-2 py-1.5 text-[0.7rem] font-medium">
                      {c.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${c.name}`}
                    onClick={() => setConfirmDelete(c)}
                    className="absolute right-1 top-1 grid size-11 place-items-center rounded-full"
                  >
                    <span className="grid size-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                      <Trash2 className="size-3.5" />
                    </span>
                  </button>
                  {inPool && (
                    <span className="absolute left-1 top-1 grid size-6 place-items-center rounded-full bg-[var(--primary-bg)] text-[var(--on-accent)]">
                      <RefreshCw className="size-3" />
                    </span>
                  )}
                  {/*
                    显示范围调节：默认收起，一次只展开一个（列表才不会被撑得很长）。
                    展开后才能拖动 —— 用户要的是"可预览调节"，不在用的图没必要天天占屏。
                  */}
                  <button
                    type="button"
                    onClick={() => setFocusFor((cur) => (cur === c.id ? null : c.id))}
                    aria-expanded={focusFor === c.id}
                    className="mt-1 flex min-h-9 w-full items-center justify-center gap-1 rounded-lg text-[0.7rem] text-secondary transition-colors hover:text-[var(--text)]"
                  >
                    <Move className="size-3.5" />
                    {focusFor === c.id ? '收起' : '调整显示范围'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {focusFor && (() => {
          const c = bg.custom.find((x) => x.id === focusFor);
          return c ? <BackgroundFocusEditor item={c} /> : null;
        })()}
        {bg.custom.length > 0 && (
          <p className="mt-2 text-[0.7rem] text-tertiary">
            共 {bg.custom.length} 张 ·{' '}
            {formatBytes(bg.custom.reduce((a, c) => a + c.bytes, 0))}（已压缩，保存在本机）
          </p>
        )}
      </Card>

      <Card padding="md">
        <CardTitle title="显示方式" subtitle="背景怎么换、换多快" />
        <div className="mb-3 grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => patchBackground({ mode: m.id })}
              className={cx(
                'min-h-14 rounded-xl border px-3 py-2 text-left transition-colors duration-200',
                bg.mode === m.id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)]',
              )}
            >
              <span
                className={cx(
                  'block text-[0.82rem] font-semibold',
                  bg.mode === m.id && 'text-[var(--accent-text)]',
                )}
              >
                {m.label}
              </span>
              <span className="block text-[0.7rem] text-tertiary">{m.desc}</span>
            </button>
          ))}
        </div>

        {bg.mode === 'random' && (
          <div className="mb-3">
            <span className="mb-1.5 block text-xs font-medium text-secondary">切换间隔</span>
            <div className="flex flex-wrap gap-1.5">
              {ROTATE_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => patchBackground({ rotateMinutes: m })}
                  className={cx(
                    'min-h-11 rounded-full px-3.5 text-[0.76rem] font-medium transition-colors duration-200',
                    bg.rotateMinutes === m
                      ? 'bg-[var(--text)] text-[var(--text-invert)]'
                      : 'bg-[var(--surface-sunken)] text-secondary',
                  )}
                >
                  {m >= 60 ? `${m / 60} 小时` : `${m} 分钟`}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Switch
            label="背景网格"
            desc="背景上的微网格与细颗粒。关掉背景更干净；打开会让玻璃的折射更明显"
            checked={bg.grid}
            onChange={(v) => patchBackground({ grid: v })}
          />
          <Switch
            label="背景遮罩"
            desc="在背景上盖一层归一化遮罩，保证任何背景下文字都清晰"
            checked={bg.showVeil}
            onChange={(v) => patchBackground({ showVeil: v })}
          />
          <Switch
            label="背景流动"
            desc="关闭后背景完全静止，最省电"
            checked={bg.dynamic}
            onChange={(v) => patchBackground({ dynamic: v })}
          />
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-xs font-medium text-secondary">
              {systemDark ? '背景暗化强度' : '背景亮化强度'}
            </span>
            <span className="tnum text-xs font-semibold">{Math.round(bg.dim * 100)}%</span>
          </div>
          <input
            type="range"
            aria-label={systemDark ? '背景暗化强度' : '背景亮化强度'}
            min={0}
            max={90}
            value={Math.round(bg.dim * 100)}
            // 手动拖动即视为接管：之后切换浅色/深色不再自动覆盖用户的选择
            onChange={(e) => patchBackground({ dim: Number(e.target.value) / 100, dimAuto: false })}
            className="h-11 w-full accent-[var(--accent)]"
          />
          <p className="text-[0.7rem] leading-relaxed text-tertiary">
            {bg.dimAuto
              ? '上传图片后会按图片亮度自动设置，切换浅色/深色时也会自动重算。手动拖动即由你接管。'
              : '已由你手动设定，不再自动调整。'}
          </p>
        </div>
      </Card>

      <ConfirmSheet
        open={confirmDelete !== null}
        title="删除这张背景？"
        message={confirmDelete ? `「${confirmDelete.name}」会从本机移除。` : undefined}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (confirmDelete) removeCustom(confirmDelete.id);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function FlowPreview() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) paintGlassFlow(ctx, canvas.width, canvas.height);
  }, []);
  return <canvas ref={ref} width={400} height={260} aria-hidden className="absolute inset-0 h-full w-full" />;
}
