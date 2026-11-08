import { useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { APP_VERSION } from '../../lib/version';

/*
 * 「本次更新」公告。
 *
 * ⚠️ 版本号**不要手写**：key 与标题都从 APP_VERSION 算（它由 vite 在构建期从
 * package.json 注入，是版本号的唯一来源）。
 *
 * 之前这里是写死的字符串，发版时忘了改，于是公告标题停在旧版本、而 key 是新的：
 * 直接导致 test-update 超时，browser.mjs 里「压掉更新说明弹窗」的助手也失效
 * （它认的是写死的旧 key），test-sheets 从 111/111 掉到 57/111。
 * 根因是同一个版本号存在多个副本 —— 所以这里把副本彻底去掉。
 */
export const RELEASE_NOTES_KEY = `learning-os:release-notes:${APP_VERSION}`;

/*
 * 本次更新的内容。
 *
 * 写作要求（与项目基调一致）：**只写用户真正能得到的东西**，不用感叹号、不吹。
 * 每条第一句说"多了什么"，第二句说"什么时候用得上"。
 * ⚠️ 版本号不要手写：key 与标题都从 APP_VERSION 算（见文件顶部说明）。
 */
const changes = [
  ['进入软件会自动检查更新', '打开 App 后会安静地看一眼 GitHub 上有没有新版本（6 小时最多一次，没网也不打扰）。有新版本时弹出提示，点「下载并安装」会打开浏览器下载 APK，再由系统确认安装——安卓侧载不允许应用自己静默装完，这一步得你点一下。'],
];

export function ReleaseNotes() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(RELEASE_NOTES_KEY) !== 'read'; }
    catch { return true; }
  });
  const dismiss = () => {
    try { localStorage.setItem(RELEASE_NOTES_KEY, 'read'); } catch { /* 本次仍可关闭 */ }
    setOpen(false);
  };
  return (
    <Sheet open={open} onClose={dismiss} title={`本次更新 · v${APP_VERSION}`}
      description="这次为你做了这些改进"
      footer={<Button onClick={dismiss} className="w-full">知道了，开始使用</Button>}>
      <ul className="space-y-4">
        {changes.map(([title, detail]) => (
          <li key={title}>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">{detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs leading-relaxed text-secondary">关闭后，本轮更新不再重复提示。</p>
    </Sheet>
  );
}
