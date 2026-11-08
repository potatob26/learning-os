import { chromium as playwrightChromium } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';

/** 保留显式浏览器配置，缺省时兼容本机 Chrome / Edge。 */
export const chromium = {
  launch(options = {}) {
    const executablePath = options.executablePath || [
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find((path) => path && existsSync(path));
    return playwrightChromium.launch({ ...options, executablePath });
  },
};

/**
 * 既有功能检查的前置条件：用户已经阅读本轮公告。公告本身由 test-update.mjs 验证。
 *
 * ⚠️ 这里的 key 里带版本号（`learning-os:release-notes:<version>`），**不能写死**。
 * 之前写死 `1.2.11`，应用升到 1.2.14 之后这个弹窗就不再被压掉，
 * 而它是覆盖整页的 `[role="dialog"]`，会盖住所有弹层的按钮 ——
 * 于是 test-sheets 从 111/111 掉到 57/111，看起来像「弹层全坏了」。
 * 版本号的唯一来源是 package.json（应用侧 vite 构建期注入的也是它），这里读同一份。
 */
export async function acknowledgeReleaseNotes(page) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  await page.addInitScript(
    (key) => {
      try {
        localStorage.setItem(key, 'read');
      } catch {
        /* 隐私模式下写不进去也无妨，用例自己会因此报错 */
      }
    },
    `learning-os:release-notes:${pkg.version}`,
  );
}
