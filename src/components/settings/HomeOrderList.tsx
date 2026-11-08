import { ArrowDown, ArrowUp } from 'lucide-react';
import { useStore } from '../../lib/store';
import { Card, CardTitle } from '../ui/Card';
import { DEFAULT_HOME_ORDER, HOME_MODULE_LABELS, isModuleId, type HomeModuleId } from '../../lib/homeModules';

/**
 * 首页排序（键盘 / 读屏用户的替代入口）
 * ──────────────────────────────────────────────────────────────
 * 首页本来是**长按拖动**排序，只有指针路径 —— 键盘和读屏用户完全改不了。
 * 这里用同一份 homeOrder 提供上移 / 下移按钮，顺序与首页保持一致。
 */
export function HomeOrderList() {
  const homeOrder = useStore((s) => s.settings.homeOrder);
  const patchSettings = useStore((s) => s.patchSettings);

  const stored = (homeOrder ?? []).filter(isModuleId);
  const order: HomeModuleId[] = [...stored, ...DEFAULT_HOME_ORDER.filter((id) => !stored.includes(id))];

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    patchSettings({ homeOrder: next });
  };

  return (
    <Card padding="md">
      <CardTitle
        title="首页排序"
        subtitle="效果和首页长按拖动一样；键盘用户用这两个按钮调整"
      />
      <ul className="space-y-1.5">
        {order.map((id, i) => (
          <li
            key={id}
            data-module={id}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--surface-sunken)] px-3"
          >
            <span className="tnum w-5 shrink-0 text-[0.72rem] text-tertiary">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[0.84rem] font-medium">
              {HOME_MODULE_LABELS[id]}
            </span>
            <button
              type="button"
              aria-label={`上移「${HOME_MODULE_LABELS[id]}」`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="grid size-11 shrink-0 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`下移「${HOME_MODULE_LABELS[id]}」`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
              className="grid size-11 shrink-0 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              <ArrowDown className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
