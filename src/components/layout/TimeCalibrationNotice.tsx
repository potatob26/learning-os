import { useEffect, useState } from 'react';
import { CloudOff, ShieldCheck, X } from 'lucide-react';
import { SOURCE_LABEL, useTimeStore } from '../../lib/netTime';
import { IconButton } from '../ui/Button';

/**
 * 网络时间校准提示（要求十九）
 * 只在「确实存在差异」或「校准失败」时出现，不打扰用户。
 * 同一自然天最多出现一次：校准失败/时钟偏差通常短期不会自愈，
 * 每次启动都弹会变成习惯性弹窗；「知道了」与跨天逻辑分开，互不影响。
 */
const NOTICE_DAY_KEY = 'learning-os:v1:calnotice-day';
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const alreadyShownToday = () => {
  try {
    return localStorage.getItem(NOTICE_DAY_KEY) === todayKey();
  } catch {
    return false;
  }
};
const markShownToday = () => {
  try {
    localStorage.setItem(NOTICE_DAY_KEY, todayKey());
  } catch {
    /* 隐私模式下放弃记忆，行为退回「每次都提示」 */
  }
};

export function TimeCalibrationNotice() {
  const status = useTimeStore((s) => s.status);
  const drift = useTimeStore((s) => s.deviceDriftSec);
  const source = useTimeStore((s) => s.source);
  const sync = useTimeStore((s) => s.sync);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    const needDrift = status === 'ok' && Math.abs(drift) > 60;
    const needFallback = status === 'failed';
    if (needDrift || needFallback) {
      if (alreadyShownToday()) return;
      const t = setTimeout(() => {
        markShownToday();
        setVisible(true);
      }, 1400);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [status, drift, dismissed]);

  if (!visible || dismissed) return null;

  const isDrift = status === 'ok';

  return (
    <div
      className="fixed inset-x-3 top-3 z-50 mx-auto max-w-md anim-rise"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
      role="status"
    >
      <div className="lg-surface liquid-glass liquid-glass--static flex items-start gap-3 rounded-2xl p-3">
        <span
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full"
          style={{
            background: isDrift ? 'var(--info-soft)' : 'var(--warn-soft)',
            color: isDrift ? 'var(--info)' : 'var(--warn)',
          }}
        >
          {isDrift ? <ShieldCheck className="size-4" /> : <CloudOff className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.85rem] font-medium leading-snug">
            {isDrift
              ? '检测到设备时间与网络时间存在差异，已自动校准'
              : '网络时间校准失败，正在使用本机时间'}
          </p>
          <p className="mt-0.5 text-xs text-secondary">
            {isDrift
              ? `设备快了/慢了约 ${Math.abs(Math.round(drift / 60))} 分钟 · 来源 ${SOURCE_LABEL[source]}`
              : '学习记录会照常保存；网络恢复后会自动重试'}
          </p>
          {!isDrift && (
            <button
              type="button"
              onClick={() => void sync()}
              className="mt-1.5 text-xs font-semibold text-[var(--accent-text)]"
            >
              立即重试
            </button>
          )}
        </div>
        <IconButton label="知道了" size="sm" onClick={() => setDismissed(true)} className="-mr-1 -mt-1">
          <X className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
