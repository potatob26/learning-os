/**
 * WebGL 不可用时的降级与提示
 * ──────────────────────────────────────────────────────────────────────────────
 * 真机排查时发现的坑：`reg.supported=false`（WebGL 渲染器初始化失败）时，
 * app 会**静默**把整套玻璃降级成云母 —— 用户只觉得"变丑了"，完全不知道原因。
 * 所以外观页补了一条说明。这里用 `--disable-webgl` 真的把 WebGL 关掉来验：
 *   · 玻璃主题下应出现"这台设备上没能启用玻璃渲染"的说明
 *   · 但**页面仍然正常渲染**（不能白屏、不能崩）—— 这是降级路径的底线
 *   · 非玻璃主题下不出现这条说明（它只跟折射主题有关）
 */
import assert from 'node:assert/strict';
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';

let n = 0;
function check(name, ok, detail = '') {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  n++;
}

const b = await chromium.launch({
  headless: true,
  args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'],
});

try {
  /* ---------- 玻璃主题（wc）：应给出说明，且页面照常 ---------- */
  {
    const p = await b.newPage({ viewport: { width: 412, height: 915 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await acknowledgeReleaseNotes(p);
    await p.goto('http://127.0.0.1:5188/#/');
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await p.evaluate(() => {
      window.__LOS__.useStore.getState().patchSettings({ onboarded: true, theme: 'liquid-glass-wc', colorMode: 'dark', glassBlur: true, perf: 'high', motion: 'off' });
    });
    await p.reload();
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await new Promise((r) => setTimeout(r, 1200));

    const webglOk = await p.evaluate(() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch {
        return false;
      }
    });
    check('已把 WebGL 关掉（构造失败场景）', webglOk === false, `webgl 可用=${webglOk}`);

    await p.goto('http://127.0.0.1:5188/#/settings/appearance');
    await new Promise((r) => setTimeout(r, 1500));
    await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('知道了'))?.click());
    await new Promise((r) => setTimeout(r, 500));
    const mainText = await p.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));

    check('玻璃主题下出现"没能启用玻璃渲染"的说明', mainText.includes('没能启用玻璃渲染'), mainText.slice(0, 70));
    check('说明里讲清了后果（降级为磨砂材质 + 数据不受影响）', mainText.includes('磨砂材质') && mainText.includes('不受影响'), '');
    check('说明里给出出路（换浏览器/设备可恢复）', mainText.includes('浏览器或设备'), '');
    check('区分了另一种原因（省电/暂停折射）不会被误报', !mainText.includes('当前已暂停折射效果'), '');

    /* 降级路径的底线：页面不能白屏、不能崩 */
    await p.goto('http://127.0.0.1:5188/#/');
    await new Promise((r) => setTimeout(r, 1400));
    const home = await p.evaluate(() => {
      const main = document.querySelector('main');
      return { len: (main?.textContent ?? '').replace(/\s+/g, ' ').trim().length, hasNav: !!document.querySelector('nav') };
    });
    check('WebGL 不可用时首页照常渲染（不白屏）', home.len > 60 && home.hasNav, `正文长度 ${home.len}`);
    check('降级过程中没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
    await p.screenshot({ path: '.preview/glass-fallback.png' });
    await p.close();
  }

  /* ---------- 非玻璃主题：不该出现这条说明 ---------- */
  {
    const p = await b.newPage({ viewport: { width: 412, height: 915 } });
    await acknowledgeReleaseNotes(p);
    await p.goto('http://127.0.0.1:5188/#/');
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await p.evaluate(() => {
      window.__LOS__.useStore.getState().patchSettings({ onboarded: true, theme: 'soft', glassBlur: true, perf: 'high' });
    });
    await p.reload();
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await new Promise((r) => setTimeout(r, 1000));
    await p.goto('http://127.0.0.1:5188/#/settings/appearance');
    await new Promise((r) => setTimeout(r, 1300));
    await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('知道了'))?.click());
    await new Promise((r) => setTimeout(r, 400));
    const txt = await p.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
    check('非玻璃主题下不出现这条说明（它只跟折射主题有关）', !txt.includes('没能启用玻璃渲染'), '');
    await p.close();
  }

  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
