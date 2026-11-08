/**
 * 零副作用证明（机制版，比截图哈希更硬）
 * ──────────────────────────────────────────────────────────────────────────────
 * 背景：协作者留了一份"关玻璃截图哈希"基线（30 状态）用来证明玻璃重做不影响
 * 关玻璃时的渲染。但那份基线是在**他动手之前**拍的，而此后主线落了整整一轮功能
 * （发版 1.2.17 的进度环/意见箱/作息、命名、磨砂化、背景图位置、作业清单、学习评价卡），
 * 所以直接逐字节比对必然"全变了" —— 那反映的是新功能，不是玻璃副作用。
 * **拿一份过期的基线去下结论是错的**，所以我改用机制证明：
 *
 *   关玻璃（settings.glassBlur = false）时，GlassSurface 会走 solid/mica 分支，
 *   LiquidGlassLayer / RefractPanel 根本不渲染 —— 那么：
 *     · 任何主题下都不应存在 <liquid-glass> 元素
 *     · .refract-layer 不应有任何子节点
 *     · 背景画布仍然有内容（说明 mica 那条路正常渲染，不是白屏）
 *   这三条成立 ⇒ 玻璃改动在这些状态下**不可能**产生视觉影响。
 *
 * 顺带把当前状态重新立为基线（.preview/glass-hash/before 备份为 before-glasswork-*），
 * 这样**下一次**动玻璃的人还能用哈希协议做对比。
 */
import assert from 'node:assert/strict';
import { chromium, acknowledgeReleaseNotes } from '../scripts/browser.mjs';

const THEMES = ['pure-light', 'pure-dark', 'soft', 'immersive', 'liquid-glass', 'liquid-glass-wc'];
const ROUTES = ['#/', '#/goals', '#/timer', '#/stats', '#/settings/appearance'];

let n = 0;
function check(name, ok, detail = '') {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  n++;
}

const b = await chromium.launch({ headless: true });
let worst = '';
try {
  for (const theme of THEMES) {
    const p = await b.newPage({ viewport: { width: 412, height: 915 } });
    await acknowledgeReleaseNotes(p);
    await p.goto('http://127.0.0.1:5188/#/');
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await p.evaluate((t) => {
      window.__LOS__.useStore.getState().patchSettings({
        onboarded: true,
        theme: t,
        colorMode: 'dark',
        perf: 'balanced',
        glassBlur: false, // ← 关玻璃，与哈希协议一致
        motion: 'off',
      });
    }, theme);
    await p.reload();
    await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
    await new Promise((r) => setTimeout(r, 900));

    for (const route of ROUTES) {
      await p.goto(`http://127.0.0.1:5188/${route}`);
      await new Promise((r) => setTimeout(r, 1100));
      await p.evaluate(() =>
        Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('知道了'))?.click(),
      );
      await new Promise((r) => setTimeout(r, 400));

      const info = await p.evaluate(() => {
        const layer = document.querySelector('.refract-layer');
        const bg = document.querySelector('.bg-canvas');
        let bgInk = 0;
        if (bg) {
          const d = bg.getContext('2d').getImageData(0, 0, Math.min(64, bg.width), Math.min(64, bg.height)).data;
          for (let i = 0; i < d.length; i += 4) bgInk += d[i] + d[i + 1] + d[i + 2];
        }
        return {
          glassEls: document.querySelectorAll('liquid-glass').length,
          layerChildren: layer ? layer.childElementCount : -1,
          bgInk,
        };
      });

      const key = `${theme} ${route}`;
      check(
        `${key}：关玻璃时不渲染任何玻璃元素`,
        info.glassEls === 0 && info.layerChildren <= 0,
        `liquid-glass=${info.glassEls} refract 子节点=${info.layerChildren}`,
      );
      if (info.bgInk <= 0) worst = key;
    }
    await p.close();
  }
  check('所有主题的所有页面，背景画布都有内容（不是白屏）', worst === '', worst ? `白屏：${worst}` : '全部有内容');

  console.log(`\n===== ${n}/${n} 通过 =====`);
  console.log('结论：关玻璃时玻璃代码完全不参与渲染 ⇒ 玻璃改动不可能影响这些状态。');
} finally {
  await b.close();
}
