import { useRef, useState } from 'react';
import { CalendarClock, CalendarDays, Eye, EyeOff, Image as ImageIcon, ImagePlus, Plus, Star, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Sheet, ConfirmSheet } from '../ui/Sheet';
import { ImageViewer } from '../ui/ImageViewer';
import { DateModuleFocusEditor } from './DateModuleFocusEditor';
import { useStore } from '../../lib/store';
import { useNow } from '../../hooks/useNow';
import { dayKey, diffDays, parseDateInput } from '../../lib/time';
import { downscaleImage } from '../../lib/background';
import { cx } from '../../lib/utils';
import type { CustomBackground, ImportantDate } from '../../lib/types';

const KIND_LABEL: Record<ImportantDate['kind'], string> = {
  exam: '考试',
  holiday: '假期',
  birthday: '生日',
  custom: '自定义',
};

/** 重要日期：添加 / 修改 / 删除 / 设为主倒计时 / 显示隐藏（要求十八） */
export function DatesSection() {
  const dates = useStore((s) => s.dates);
  const addDate = useStore((s) => s.addDate);
  const updateDate = useStore((s) => s.updateDate);
  const removeDate = useStore((s) => s.removeDate);
  const setPrimary = useStore((s) => s.setPrimaryDate);
  const ts = useNow();

  const [editing, setEditing] = useState<ImportantDate | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ImportantDate | null>(null);

  const sorted = [...dates].sort((a, b) => {
    const ta = parseDateInput(a.date) ?? 0;
    const tb = parseDateInput(b.date) ?? 0;
    return ta - tb;
  });

  return (
    <div className="space-y-3">
      <Card padding="md">
        <CardTitle
          icon={<CalendarClock />}
          title="重要日期"
          subtitle="首页会显示主倒计时，其余以小卡片形式出现"
          action={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-11 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3.5 text-[0.72rem] font-semibold text-[var(--accent-on-soft)]"
            >
              <Plus className="size-3.5" />
              添加
            </button>
          }
        />

        {sorted.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-4 text-center text-[0.76rem] text-secondary">
            还没有重要日期。加上中考、期末、生日，首页就有倒计时了。
          </p>
        ) : (
          <div className="space-y-1.5">
            {sorted.map((d) => {
              const t = parseDateInput(d.date);
              const days =
                t === null ? 0 : d.allDay ? diffDays(ts, t) : Math.ceil((t - ts) / 86400000);
              const past = days < 0;
              return (
                <div
                  key={d.id}
                  className={cx(
                    'rounded-xl border px-3 py-2.5',
                    d.primary
                      ? 'border-[var(--accent-ring)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] bg-[var(--surface-sunken)]',
                    !d.visible && 'opacity-55',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditing(d)}
                      className="min-h-11 min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-[0.88rem] font-semibold">
                        {d.title}
                        <span className="ml-2 text-[0.7rem] font-normal text-tertiary">
                          {KIND_LABEL[d.kind]}
                        </span>
                      </p>
                      <p className="tnum text-[0.7rem] text-secondary">
                        {d.date.slice(0, 10)}
                        <span className="ml-2 font-semibold">
                          {past ? `已过 ${Math.abs(days)} 天` : `还有 ${days} 天`}
                        </span>
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={d.primary ? '已是主倒计时' : '设为主倒计时'}
                      onClick={() => setPrimary(d.id)}
                      className={cx(
                        'grid size-11 shrink-0 place-items-center rounded-full',
                        d.primary ? 'text-[var(--accent-text)]' : 'text-tertiary',
                      )}
                    >
                      <Star className={cx('size-4', d.primary && 'fill-current')} />
                    </button>
                    <button
                      type="button"
                      aria-label={d.visible ? '在首页隐藏' : '在首页显示'}
                      onClick={() => updateDate(d.id, { visible: !d.visible })}
                      className="grid size-11 shrink-0 place-items-center rounded-full text-tertiary"
                    >
                      {d.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={() => setConfirmDelete(d)}
                      className="grid size-11 shrink-0 place-items-center rounded-full text-tertiary hover:text-[var(--bad-text)]"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <DateModuleBackgroundCard />

      <DateSheet
        open={creating}
        onClose={() => setCreating(false)}
        onSave={(data) => {
          // 第一个添加的日期自动成为首页主倒计时
          addDate({ ...data, primary: dates.length === 0 });
          // 保存后必须关掉。Sheet 本身不会自动关（只有 onClose 一条路），
          // 漏掉这句就会出现「点了保存，表单还压在页面上、挡住后面的内容」。
          setCreating(false);
        }}
      />
      <DateSheet
        open={editing !== null}
        item={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSave={(data) => {
          if (editing) updateDate(editing.id, data);
          setEditing(null);
        }}
      />

      <ConfirmSheet
        open={confirmDelete !== null}
        title="删除这个日期？"
        message={confirmDelete ? `「${confirmDelete.title}」将从首页移除。` : undefined}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (confirmDelete) removeDate(confirmDelete.id);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function DateSheet({
  open,
  item,
  onClose,
  onSave,
}: {
  open: boolean;
  item?: ImportantDate;
  onClose: () => void;
  onSave: (data: Omit<ImportantDate, 'id' | 'createdAt' | 'primary'>) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [date, setDate] = useState(item?.date ?? dayKey(Date.now()));
  const [kind, setKind] = useState<ImportantDate['kind']>(item?.kind ?? 'exam');
  const [allDay, setAllDay] = useState(item?.allDay ?? true);

  const key = `${open}-${item?.id ?? 'new'}`;
  const [init, setInit] = useState<string | null>(null);
  if (open && init !== key) {
    setInit(key);
    setTitle(item?.title ?? '');
    setDate(item?.date ?? dayKey(Date.now()));
    setKind(item?.kind ?? 'exam');
    setAllDay(item?.allDay ?? true);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item ? '编辑日期' : '添加重要日期'}
      footer={
        <Button
          block
          size="lg"
          disabled={!title.trim() || !date}
          onClick={() =>
            onSave({
              title: title.trim(),
              date,
              kind,
              allDay,
              visible: item?.visible ?? true,
            })
          }
        >
          保存
        </Button>
      }
    >
      <div className="space-y-4 pb-1">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">名称</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="中考 / 期末考 / 生日 / 暑假"
            className="field min-h-12"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-secondary">日期</span>
          <input
            type="date"
            value={date.slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className="field tnum min-h-12"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-secondary">类型</span>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(KIND_LABEL) as ImportantDate['kind'][]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cx(
                  'min-h-11 rounded-xl border text-[0.82rem] font-medium transition-colors duration-200',
                  kind === k
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAllDay(!allDay)}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-[var(--surface-sunken)] px-3 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[0.85rem] font-medium">按整天计算</span>
            <span className="block text-[0.7rem] text-tertiary">
              生日、假期这类事件建议开启，倒计时只显示天数
            </span>
          </span>
          <span
            className={cx(
              'relative inline-block h-[1.65rem] w-[2.85rem] shrink-0 rounded-full transition-colors duration-200',
              allDay ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)]',
            )}
          >
            <span
              className="absolute top-[0.15rem] size-[1.35rem] rounded-full bg-white shadow-sm transition-[left] duration-200 ease-[var(--ease-soft)]"
              style={{ left: allDay ? '1.35rem' : '0.15rem' }}
            />
          </span>
        </button>
      </div>
    </Sheet>
  );
}

/* ───────────────────────── 模块背景 ───────────────────────── */

/**
 * 「重要日期」模块自己的背景。
 *
 * 只影响这一个模块，与全局背景无关：模块用自己的图、自己的压暗程度。
 * 图片复用「设置 → 背景」里已上传的图，不额外占存储；
 * 也可以在这里直接上传 —— 上传的图进的是同一个图库，两边都能用。
 *
 * 点缩略图 = 先放大看大图，大图里再点「使用这张」。
 * 缩略图只有 100 出头像素，直接点选很容易选错，看一眼原图更稳。
 */
function DateModuleBackgroundCard() {
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  const custom = useStore((s) => s.background.custom);
  const addCustom = useStore((s) => s.addCustomBackground);

  const cfg = settings.dateModuleBackground ?? { imageId: null, dim: 0.25 };
  const setCfg = (patchCfg: Partial<typeof cfg>) =>
    patch({ dateModuleBackground: { ...cfg, ...patchCfg } });

  const [viewing, setViewing] = useState<CustomBackground | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 走和「设置 → 背景」完全相同的压缩管线，参数不另起一套 */
  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        if (!file.type.startsWith('image/')) { setErr('只能选择图片文件'); continue; }
        if (file.size > 20 * 1024 * 1024) { setErr('图片太大（超过 20MB），请先压缩'); continue; }
        const r = await downscaleImage(file);
        const id = addCustom({
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || '我的背景',
          dataUrl: r.dataUrl,
          width: r.width,
          height: r.height,
          bytes: r.bytes,
        });
        // 刚传的图直接给这个模块用上，省掉一次来回
        setCfg({ imageId: id });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '图片处理失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const inUse = custom.find((c) => c.id === cfg.imageId) ?? null;

  return (
    <Card padding="md">
      {/*
        CardTitle 的 subtitle 是 12px 的 text-tertiary，实测比值 4.09、差一点到 4.5，
        会被 audit-quality 计为低对比（项目基线是 67，多一条就是退步）。
        所以这里不写 subtitle，把说明放进正文用 text-secondary ——
        信息一点没少，但不增加低对比条目。
      */}
      <CardTitle
        icon={<ImageIcon />}
        title="模块背景"
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
        onChange={(e) => void upload(e.target.files)}
      />
      <p className="mb-2.5 text-[0.74rem] leading-relaxed text-secondary">
        只改「重要日期」这一块，不影响全局背景。点图可以放大看。
      </p>

      {err && (
        <p className="mb-2 rounded-xl bg-[var(--bad-soft)] px-3 py-2 text-[0.72rem] text-[var(--bad-text)]">
          {err}
        </p>
      )}

      {custom.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-4 text-center text-[0.76rem] text-secondary">
          还没有可用的图片。点右上角「上传」传一张，或者去「设置 → 背景」里传。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {/* 「不使用」永远排第一，方便随时退回 */}
            <button
              type="button"
              onClick={() => setCfg({ imageId: null })}
              className={cx(
                'grid aspect-square place-items-center rounded-xl border text-[0.72rem] font-medium transition-colors',
                cfg.imageId === null
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-sunken)] text-secondary',
              )}
            >
              不使用
            </button>
            {custom.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={`放大查看 ${c.name}`}
                onClick={() => setViewing(c)}
                className={cx(
                  'relative aspect-square overflow-hidden rounded-xl border transition-colors',
                  cfg.imageId === c.id ? 'border-[var(--accent)]' : 'border-[var(--line)]',
                )}
              >
                <img src={c.dataUrl} alt="" className="size-full object-cover" />
                {cfg.imageId === c.id && (
                  <span className="absolute inset-x-0 bottom-0 bg-[var(--accent)] py-0.5 text-center text-[0.62rem] font-medium text-[var(--on-accent)]">
                    使用中
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 压暗：模块上面压着大号倒计时数字，不压暗字会被背景吃掉 */}
          {cfg.imageId !== null && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[0.82rem] font-medium">压暗程度</span>
                <span className="tnum text-[0.78rem] font-semibold text-secondary">
                  {Math.round(cfg.dim * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={cfg.dim}
                onChange={(e) => setCfg({ dim: Number(e.target.value) })}
                className="h-11 w-full accent-[var(--accent)]"
                aria-label="压暗程度"
              />
              <p className="text-[0.72rem] leading-relaxed text-secondary">
                压暗是为了保证卡片上的字始终看得清。背景很亮时调高一些。
              </p>
            </div>
          )}

          {/* 显示范围：模块自己的一份取景。
              不放在「设置 → 背景」里调 —— 那份是图库级的，一改会连全局背景一起改。 */}
          {cfg.imageId !== null && inUse && <DateModuleFocusEditor item={inUse} />}
        </>
      )}

      {/* 日历入口：与重要日期是两套数据，但放在这里用户最容易找到 */}
      <Link
        to="/calendar"
        className="mt-3 flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--surface-sunken)] text-[0.78rem] font-medium text-secondary transition-colors hover:bg-[var(--surface-hover)]"
      >
        <CalendarDays className="size-4" />
        打开日历
      </Link>

      {/* 放大看大图；确认要用再关掉，避免误触把模块背景换掉 */}
      <ImageViewer
        open={viewing !== null}
        onClose={() => setViewing(null)}
        src={viewing?.dataUrl ?? null}
        title={viewing?.name ?? '背景图'}
        caption={
          viewing
            ? `${viewing.width}×${viewing.height} · 点下面的按钮把它用到「重要日期」模块`
            : undefined
        }
        actions={
          <div className="flex gap-2">
            <Button
              block
              variant="ghost"
              size="lg"
              onClick={() => setViewing(null)}
            >
              取消
            </Button>
            <Button
              block
              size="lg"
              onClick={() => {
                if (viewing) setCfg({ imageId: viewing.id });
                setViewing(null);
              }}
            >
              {viewing && inUse && inUse.id === viewing.id ? '已在使用' : '使用这张'}
            </Button>
          </div>
        }
      />
    </Card>
  );
}
