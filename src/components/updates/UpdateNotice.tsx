import { useState } from 'react';
import { Download } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { useUpdateStore } from '../../lib/updateStore';
import { markSeen, localVersion } from '../../lib/updateCheck';

/*
 * 「发现新版本」弹层。
 *
 * 三条不能违背的：
 *
 * 1. **不假装能自动更新**。安卓不经过应用商店**无法静默自更新**，
 *    所以这里只有「去下载」——点开浏览器由系统安装器接手。
 *    绝不出现「立即更新」这类会让人以为点一下就装好的措辞。
 * 2. **不假装成功**：APK 地址缺失时按钮不可用并说明原因，而不是给个点了没反应的按钮。
 * 3. **不阻止用户使用**：「以后再说」永远可用 —— 学习工具不该被更新弹层挡住。
 *    记住这个 versionCode（markSeen），同一个版本不再提；出现更大版本才会再提。
 *
 * 下载用普通 `<a target="_blank">`：安卓 WebView 会把外部链接交给系统浏览器打开，
 * **不需要任何新权限**。这条路要等真机验证（浏览器里就是开个新标签页）。
 */
export function UpdateNotice() {
  const pending = useUpdateStore((s) => s.pending);
  const required = useUpdateStore((s) => s.required);
  const clear = useUpdateStore((s) => s.clear);
  const [open, setOpen] = useState(true);

  if (!pending) return null;

  const local = localVersion();
  const apk = typeof pending.apk === 'string' && /^https?:\/\//i.test(pending.apk) ? pending.apk : null;
  const notes = Array.isArray(pending.notes) ? pending.notes.filter((x) => typeof x === 'string' && x.trim()) : [];

  const dismiss = () => {
    markSeen(pending.versionCode);
    setOpen(false);
    clear();
  };

  return (
    <Sheet
      open={open}
      onClose={dismiss}
      title={`发现新版本 v${pending.versionName}`}
      description={
        required
          ? `当前版本 v${local.name} 已低于最低支持版本，建议尽快更新`
          : `当前 v${local.name}，新版是 v${pending.versionName}`
      }
      footer={
        <div className="flex w-full gap-2">
          <Button onClick={dismiss} className="flex-1">
            以后再说
          </Button>
          {apk ? (
            <a
              href={apk}
              target="_blank"
              rel="noreferrer"
              onClick={dismiss}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-bg)] px-3.5 text-sm font-medium text-[var(--on-accent)] active:scale-[0.98]"
            >
              <Download className="size-4" />
              下载并安装
            </a>
          ) : (
            <Button disabled className="flex-1">
              暂无下载地址
            </Button>
          )}
        </div>
      }
    >
      {notes.length > 0 ? (
        <ul className="space-y-4">
          {notes.map((t) => (
            <li key={t} className="text-xs leading-relaxed text-secondary">
              {t}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-relaxed text-secondary">这次没有附更新说明。</p>
      )}
      <p className="mt-5 text-xs leading-relaxed text-secondary">
        点「下载并安装」会打开浏览器开始下载安装包，下载完成后在<b>通知栏点一下</b>，
        系统会弹出安装确认 —— 安卓不允许应用跳过这一步自己装，所以这里没法替你一键装完。
        <br />
        选「以后再说」的话，同一个版本不会再提醒（出现更新的版本时会再提一次）。
      </p>
    </Sheet>
  );
}
