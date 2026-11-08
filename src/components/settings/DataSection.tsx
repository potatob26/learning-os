import { useRef, useState } from 'react';
import {
  Database,
  Download,
  HardDrive,
  Info,
  RefreshCcw,
  ShieldCheck,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { ConfirmSheet } from '../ui/Sheet';
import { useStore } from '../../lib/store';
import { useTimeStore, SOURCE_LABEL } from '../../lib/netTime';
import { downloadJson, flushNow, hasLocalStorage, isPersistHealthy } from '../../lib/storage';
import { fmtDuration } from '../../lib/time';
import { formatBytes } from '../../lib/utils';
import { APP_VERSION_LABEL, formatBuildTime } from '../../lib/version';
import { SCHEMA_VERSION } from '../../lib/types';
import { QUOTE_COUNT } from '../../lib/quotes';
import { readEndpoints } from '../../lib/endpoints';

/** 数据与关于 */
export function DataSection() {
  const store = useStore();
  const time = useTimeStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  /* 隐私文案要按**实际开启的联网功能**生成：没配置的构建里不该出现对应描述 */
  const net = readEndpoints();

  const exportData = () => {
    const snapshot = store.exportSnapshot();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(snapshot, `学习OS备份-${stamp}.json`);
    setMessage({ ok: true, text: '备份已下载到本机' });
  };

  const importData = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = store.importSnapshot(text);
      setMessage({ ok: result.ok, text: result.message });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : '读取文件失败' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const storageOk = isPersistHealthy();
  const recordBytes =
    typeof Blob !== 'undefined'
      ? new Blob([JSON.stringify(store.sessions)]).size +
        new Blob([JSON.stringify(store.goals)]).size
      : 0;

  return (
    <div className="space-y-3">
      <Card padding="md">
        <CardTitle icon={<Database />} title="数据概览" subtitle="全部保存在这台设备上" />
        <div className="grid grid-cols-2 gap-2.5">
          <Metric label="学习记录" value={`${store.sessions.length} 段`} />
          <Metric label="目标" value={`${store.goals.length} 个`} />
          <Metric label="课程" value={`${store.courses.length} 门`} />
          <Metric label="重要日期" value={`${store.dates.length} 个`} />
          <Metric
            label="累计学习"
            value={fmtDuration(
              Math.round(store.sessions.reduce((a, s) => a + s.durationSec, 0) / 60),
            )}
          />
          <Metric label="记录体积" value={formatBytes(recordBytes)} />
        </div>

        <div className="mt-3 space-y-1.5 rounded-xl bg-[var(--surface-sunken)] px-3 py-2.5 text-[0.72rem]">
          <StatusRow
            icon={
              storageOk ? (
                <ShieldCheck className="size-3.5" />
              ) : (
                <TriangleAlert className="size-3.5" />
              )
            }
            tone={storageOk ? 'ok' : 'warn'}
            label="本地存储"
            value={
              hasLocalStorage
                ? storageOk
                  ? '正常'
                  : '写入受限（可能处于隐私模式）'
                : '不可用，仅本次会话有效'
            }
          />
          <StatusRow
            icon={<HardDrive className="size-3.5" />}
            label="图片背景"
            value={`${store.background.custom.length} 张，存在 IndexedDB`}
          />
          <StatusRow
            icon={<RefreshCcw className="size-3.5" />}
            label="时间校准"
            value={`${
              time.status === 'ok'
                ? '已校准'
                : time.status === 'failed'
                  ? '失败（用本机时间）'
                  : '校准中'
            } · ${SOURCE_LABEL[time.source]}`}
          />
        </div>

        {message && (
          <p
            className="mt-2.5 rounded-xl px-3 py-2 text-[0.72rem]"
            style={{
              background: message.ok ? 'var(--ok-soft)' : 'var(--bad-soft)',
              color: message.ok ? 'var(--ok)' : 'var(--bad)',
            }}
          >
            {message.text}
          </p>
        )}
      </Card>

      <Card padding="md">
        <CardTitle
          icon={<Download />}
          title="备份与恢复"
          subtitle="导出为 JSON 文件，可以随时导回任意设备"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" icon={<Download />} onClick={exportData} className="flex-1">
            导出备份
          </Button>
          <Button
            variant="secondary"
            icon={<Upload />}
            onClick={() => fileRef.current?.click()}
            className="flex-1"
          >
            导入备份
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void importData(e.target.files?.[0])}
        />
        <p className="mt-2 text-[0.7rem] leading-relaxed text-tertiary">
          导入会覆盖当前的课程、目标、记录与设置。建议先导出一份再导入。
        </p>
      </Card>

      <Card padding="md">
        <CardTitle title="个人偏好" subtitle="首页会用到的小设置" />
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">
              称呼（可留空，首页会问候你）
            </span>
            <input
              value={store.settings.nickname}
              onChange={(e) => store.patchSettings({ nickname: e.target.value.slice(0, 12) })}
              placeholder="例如：小陈"
              className="field min-h-12"
            />
          </label>
          {/*
            「每天计划学习时长」已搬到【设置 → 作息】。
            因为它现在能按星期几单独设，要和那里的「全周相同 / 按星期几」模式开关共用一套；
            留在数据页会出现两个标签页各有一套按星期几，很容易搞混。
          */}
          <Switch
            label="每次打开自动切换背景"
            desc="等价于把背景模式设为「每次打开」"
            checked={store.background.mode === 'each-open'}
            onChange={(v) => store.patchBackground({ mode: v ? 'each-open' : 'fixed' })}
          />
        </div>
      </Card>

      <Card padding="md">
        <CardTitle icon={<ShieldCheck />} title="隐私" subtitle="默认本地优先" />
        {/*
          ⚠️ 这段文案必须与**代码真实行为**逐条对应（1.3.0 加进入程序检测更新与意见箱后改写过）。
          原来写的是「唯一的网络请求是获取网络时间」—— 那时确实如此；
          加了联网功能之后这句话就不成立了，留着就是对用户说假话。
          规则：**每加一个联网功能，就在同一次提交里改这里**，保证任何一次提交的文案都是真的。
        */}
        <ul className="space-y-1.5 text-[0.75rem] leading-relaxed text-secondary">
          <li>· 没有账号系统，没有后端数据库，你的学习数据不会离开这台设备。</li>
          <li>
            · 学习记录本身**永远不会**被上传，也不会用来统计「有多少人在用」——
            应用里没有任何埋点、设备标识或使用统计。
          </li>
          <li>· 上传的背景图片只会保存在本机浏览器里，不会上传到任何服务器。</li>
          {/*
            下面两条**按实际开启的功能生成**。
            为什么不能写死：接收地址是构建期/运行时可配的，某个构建里可能根本没开这两个功能；
            写死就会出现"文案在描述一个不存在的东西"——同样是说假话。
          */}
          {net.manifestUrl && (
            <li>
              ·
              启动时会查一次新版本：只发出版本号与平台两个参数，服务端据此回答「有没有新版」，
              不携带任何个人数据；失败时静默跳过，离线完全可用。
            </li>
          )}
          {net.feedbackUrl && (
            <li>
              · 意见箱只在你**主动点发送**时才发出，内容是你在框里写的字，外加版本号与平台；
              学习数据的统计量要你自己勾选才带，且只有数量、没有内容。
            </li>
          )}
          {!net.manifestUrl && !net.feedbackUrl && (
            <li>· 应用只会在校准时发起一次网络请求（获取网络时间），不携带任何个人数据。</li>
          )}
          <li>· 未来如果加入云同步，会先明确告知存储位置与内容，并保持本地可用。</li>
        </ul>
      </Card>

      {/* 没配置接收地址时这个组件自己返回 null —— 这个功能就"不存在"，不给假按钮 */}

      <Card padding="md">
        <CardTitle icon={<Info />} title="关于" subtitle="这是一个什么样的工具" />

        {/* 应用介绍。
            放在版本信息之前：先说清「这是什么」，再给技术细节。
            文案遵循项目基调 —— 不吹、不用感叹号、只陈述真实做的事。 */}
        <div className="space-y-2.5 text-[0.78rem] leading-relaxed text-secondary">
          <p>
            <span className="font-semibold text-[var(--text)]">学习 OS</span>
            是一个只关心「今天」的学习工具。它想回答的始终是三个问题：
            今天学了多少、还能学多久、现在该做什么。
          </p>
          <p>
            不做排行榜，不做打卡炫耀，也不替你制定宏大计划 ——
            只把当下的进度如实呈现出来，让你知道下一步该做什么。
          </p>
        </div>

        <div className="mt-3 rounded-xl bg-[var(--surface-sunken)] px-3.5 py-3">
          <p className="mb-2 text-[0.72rem] font-semibold text-[var(--text)]">几条坚持</p>
          <ul className="space-y-1.5 text-[0.72rem] leading-relaxed text-secondary">
            <li className="flex gap-2">
              <span className="text-tertiary">·</span>
              <span>数据只存在这台设备上，不上传、不需要账号、没有服务器</span>
            </li>
            <li className="flex gap-2">
              <span className="text-tertiary">·</span>
              <span>学习时长只由真实计时或手动补录产生，不会自动填充</span>
            </li>
            <li className="flex gap-2">
              <span className="text-tertiary">·</span>
              <span>课程表记录「学校安排了什么」，不折算成学习时长</span>
            </li>
            <li className="flex gap-2">
              <span className="text-tertiary">·</span>
              <span>连续学习天数只和昨天的自己比，没有排行与竞争</span>
            </li>
          </ul>
        </div>

        <div className="mt-3.5 space-y-1.5 border-t border-[var(--line)] pt-3 text-[0.75rem] leading-relaxed">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-secondary">版本</span>
            <span className="tnum font-semibold">{APP_VERSION_LABEL}</span>
          </div>
          {formatBuildTime() && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-secondary">构建时间</span>
              <span className="tnum text-tertiary">{formatBuildTime()}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-secondary">数据格式版本</span>
            <span className="tnum text-tertiary">v{SCHEMA_VERSION}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-secondary">鼓励语句</span>
            <span className="tnum text-tertiary">{QUOTE_COUNT} 条</span>
          </div>
        </div>
        <p className="mt-2.5 text-[0.7rem] leading-relaxed text-tertiary">
          数据格式版本用于备份文件的兼容处理：更新后导入旧备份会自动升级，
          不会丢失内容。
        </p>
      </Card>

      <Card padding="md">
        <CardTitle icon={<TriangleAlert />} title="危险操作" subtitle="请谨慎使用" />
        <Button variant="danger" block icon={<TriangleAlert />} onClick={() => setConfirmReset(true)}>
          清空所有数据
        </Button>
        <p className="mt-2 text-[0.7rem] leading-relaxed text-tertiary">
          会删除所有课程、目标、学习记录、日期与设置，无法撤销。建议先导出备份。
        </p>
      </Card>

      <ConfirmSheet
        open={confirmReset}
        title="确定要清空所有数据吗？"
        message="课程、目标、学习记录、重要日期与设置都会被删除，且无法恢复。"
        confirmText="全部清空"
        danger
        onConfirm={() => {
          flushNow();
          void store.resetAll();
        }}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-sunken)] p-2.5">
      <p className="text-[0.7rem] font-medium text-tertiary">{label}</p>
      <p className="tnum mt-0.5 text-[0.95rem] font-semibold">{value}</p>
    </div>
  );
}

function StatusRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="shrink-0"
        style={{
          color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--text-tertiary)',
        }}
      >
        {icon}
      </span>
      <span className="text-secondary">{label}</span>
      <span className="ml-auto truncate text-right font-medium">{value}</span>
    </div>
  );
}
