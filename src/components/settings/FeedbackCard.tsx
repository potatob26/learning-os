import { useEffect, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { useStore } from '../../lib/store';
import {
  buildFeedbackPayload,
  clearDraft,
  feedbackConfigured,
  readDraft,
  saveDraft,
  sendFeedback,
} from '../../lib/feedback';
import { APP_VERSION_LABEL } from '../../lib/version';

/*
 * 意见箱卡片。
 *
 * 三条不能违背的：
 *   1. **没配置接收地址时整块不出现** —— 不给灰按钮、不给点了没反应的按钮
 *   2. **失败时一个字都不能丢**：文案之外的状态一律不动，草稿每次输入都落盘
 *   3. **默认只带版本与平台**；学习数据的统计量要用户主动勾选，并写清带的是什么
 */
export function FeedbackCard() {
  // 没配置接收地址 = 这个功能不存在（静默禁用，不是"假装有"）
  const configured = feedbackConfigured();
  const [text, setText] = useState(() => readDraft());
  const [includeDiag, setIncludeDiag] = useState(false);
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null);

  const sessions = useStore((s) => s.sessions.length);
  const goals = useStore((s) => s.goals.length);
  const theme = useStore((s) => s.settings.theme);
  // 背景是 'none' | 'scene:…' | 'img:…'，只上报「是不是图片背景」这一个布尔量
  const hasBackgroundImage = useStore((s) => (s.background?.current ?? '').startsWith('img:'));

  // 每次输入都落盘：哪怕用户直接关掉应用，回来时字还在
  useEffect(() => {
    saveDraft(text);
  }, [text]);

  if (!configured) return null;

  const send = async () => {
    if (sending || text.trim() === '') return;
    setSending(true);
    setResult(null);
    const payload = buildFeedbackPayload({
      message: text.trim(),
      includeDiagnostics: includeDiag,
      contact,
      diagnostics: { sessions, goals, theme, hasBackgroundImage },
    });
    const r = await sendFeedback(payload);
    setSending(false);
    if (r.ok) {
      // 只有服务器确认收下了才清空 —— 清空就等于"我们认定它收到了"
      clearDraft();
      setText('');
      setContact('');
      setResult({ ok: true });
    } else {
      // 失败：只显示原因，**不动用户写的字**
      setResult({ ok: false, reason: r.reason });
    }
  };

  return (
    <Card padding="md">
      <CardTitle
        icon={<MessageSquare />}
        title="意见箱"
        subtitle="直接发给我，我能看到内容"
      />

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-secondary">想说的</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="哪里不好用、哪里算错了、想要什么功能，都可以写。"
          aria-label="意见内容"
          className="field min-h-24 resize-y leading-relaxed"
        />
      </label>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <label className="flex items-center gap-2 text-[0.72rem] text-secondary">
          <input
            type="checkbox"
            checked={includeDiag}
            onChange={(e) => setIncludeDiag(e.target.checked)}
            aria-label="附带诊断信息"
            className="size-4 accent-[var(--accent)]"
          />
          附带诊断信息
        </label>
        <span className="tnum text-[0.7rem] text-tertiary">{text.trim().length} 字</span>
      </div>
      <p className="mt-1 text-[0.7rem] leading-relaxed text-tertiary">
        {includeDiag
          ? `会带上：学习记录 ${sessions} 条、目标 ${goals} 个、主题 ${theme}、是否有背景图 —— 只有数量和名称，不含你写的任何内容，也不含具体学了什么。`
          : '不勾选就只带版本号与平台（安卓或浏览器），不带任何学习数据。'}
      </p>

      <label className="mt-2 block">
        <span className="mb-1.5 block text-xs font-medium text-secondary">
          联系方式（可不填）
        </span>
        <input
          type="text"
          value={contact}
          onChange={(e) => setContact(e.target.value.slice(0, 60))}
          placeholder="想收到回复就留一个，比如邮箱"
          aria-label="联系方式"
          className="field min-h-12"
        />
      </label>

      <div className="mt-3">
        <Button
          block
          icon={<Send />}
          disabled={sending || text.trim() === ''}
          onClick={() => void send()}
        >
          {sending ? '发送中…' : '发送'}
        </Button>
      </div>

      {result?.ok === true && (
        <p className="mt-2 rounded-xl bg-[var(--ok-soft)] px-3 py-2 text-[0.72rem] leading-relaxed text-[var(--ok-text)]">
          已经发给我了。如果留了联系方式，我会尽量回复。
        </p>
      )}
      {result?.ok === false && (
        <p className="mt-2 rounded-xl bg-[var(--bad-soft)] px-3 py-2 text-[0.72rem] leading-relaxed text-[var(--bad-text)]">
          没发出去（{result.reason}）。你写的内容还在上面，可以直接重试。
        </p>
      )}

      <p className="mt-2 text-[0.7rem] leading-relaxed text-tertiary">
        发送时会带上 {APP_VERSION_LABEL} 与平台信息，方便我定位是哪个版本的问题。
        这条是唯一的例外：除了你在这里主动点发送，应用不会把你的内容发到任何地方。
      </p>
    </Card>
  );
}
