import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from './browser.mjs';

const out = '.preview/update'; mkdirSync(out, { recursive: true });

/*
 * 公告的版本号与条目数**都从源码算**，不写死。
 *
 * 之前这里写死了 `本次更新 · v1.2.11` 和「必须 22 条」：
 * 版本升到 1.2.14、公告内容换成新的 9 条之后，这个用例就一直超时 ——
 * 而它本来要验的是「公告能弹出、且**条目没有被截断**」，
 * 不是「必须是 22 条」、更不是「版本必须停在 1.2.11」。
 * 版本号的唯一来源是 package.json；条目数直接从 ReleaseNotes.tsx 数，
 * 这样以后改公告内容，用例会跟着走，不会再次腐烂。
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const notesSrc = readFileSync(new URL('../src/components/updates/ReleaseNotes.tsx', import.meta.url), 'utf8');
const expectedItems = (notesSrc.match(/^\s*\['/gm) ?? []).length;

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light' });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let checks = 0;
const check = (name, ok, detail = '') => { assert.ok(ok, `${name}: ${detail}`); checks++; console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const patch = (settings) => page.evaluate((value) => window.__LOS__.useStore.getState().patchSettings(value), settings);
const settle = () => page.waitForTimeout(500);
try {
  await page.goto('http://127.0.0.1:5188/');
  await page.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await patch({ onboarded: true, theme: 'pure-light', perf: 'high', motion: true, glassBlur: true });
  const notice = page.getByRole('dialog', { name: `本次更新 · v${pkg.version}` });
  await notice.waitFor(); await settle();
  const renderedItems = await notice.locator('li').count();
  check('首次进入显示完整更新内容', renderedItems === expectedItems,
    `渲染 ${renderedItems} 条 / 源码 ${expectedItems} 条`);
  check('公告期间底层界面不可操作', await page.locator('#root').evaluate((el) => el.inert));
  await page.setViewportSize({ width: 320, height: 568 }); await settle();
  const footer = page.getByRole('button', { name: '知道了，开始使用' });
  const bounds = await footer.boundingBox();
  check('小屏公告确认按钮在视口内', bounds && bounds.y >= 0 && bounds.y + bounds.height <= 568);
  await page.screenshot({ path: `${out}/notice-small.png` });
  await footer.click(); await page.reload(); await settle();
  check('关闭并刷新后公告不再重复', await notice.count() === 0);
  check('关闭后恢复页面操作', !(await page.locator('#root').evaluate((el) => el.inert)));
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('http://127.0.0.1:5188/#/settings/appearance'); await settle();
  /*
   * 「液态玻璃主题」那个开关已从设置里删除（用户反馈多余 —— 主题网格里本来就能直接选）。
   * 这个用例真正要验的是「切主题时有过渡、主题真的落下、且渲染出玻璃」，
   * 所以改成点网格里的液态玻璃卡片，而不是找那个开关。
   */
  const glassTheme = page.getByRole('button', { name: /^液态玻璃/ });
  await page.evaluate(()=>{
    window.__themeTransitionSeen=false;
    const observer=new MutationObserver(()=>{if(document.documentElement.dataset.themeTransition==='on'){window.__themeTransitionSeen=true;observer.disconnect();}});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme-transition']});
  });
  await glassTheme.click();
  check('切换主题时有主题过渡', await page.evaluate(() => window.__themeTransitionSeen));
  await settle();
  check('主题网格可直接选中液态玻璃（多余开关已删除）', await page.evaluate(() => {
    const s = window.__LOS__.useStore.getState().settings;
    // previousTheme 也一并删了：它本来就是给那个开关还原用的，现在没人读
    return s.theme === 'liquid-glass-wc' && s.previousTheme === undefined;
  }));
  const rendered = () => page.evaluate(() => { const els = [...document.querySelectorAll('.refract-layer liquid-glass')]; return els.length > 0 && els.length <= 6 && els.every((el) => el.shadowRoot.querySelector('.surface').classList.contains('rendered')); });
  check('真实玻璃渲染成功且预算不超过六块', await rendered());
  const sourceHash = () => page.evaluate(() => document.querySelector('.bg-canvas').toDataURL());
  const lightHash = await sourceHash(); await patch({ colorMode: 'dark' }); await settle();
  check('固定深色主题不再采样浅色背景', lightHash === await sourceHash());
  await page.screenshot({ path: `${out}/glass-settings.png` });
  await page.evaluate(() => scrollTo(0, 330)); await settle();
  const geometry = await page.evaluate(async () => {
    const { pickRenderableTargets } = await import('/src/glass/key-glass.ts');
    const targets = pickRenderableTargets().map((t) => t.rect);
    const panels = [...document.querySelectorAll('.refract-layer liquid-glass')].map((el) => el.getBoundingClientRect());
    return { partial: targets.some((r) => r.top < 0 || r.bottom > innerHeight), aligned: panels.length === targets.length && targets.every((r) => panels.some((p) => Math.abs(r.x-p.x) <= 1 && Math.abs(r.y-p.y) <= 1 && Math.abs(r.width-p.width) <= 1 && Math.abs(r.height-p.height) <= 1)) };
  });
  check('滚出视口的玻璃仍与卡片对齐', geometry.partial && geometry.aligned, JSON.stringify(geometry));
  await page.screenshot({ path: `${out}/glass-scrolled.png` });
  for (let i = 0; i < 4; i++) {
    await patch({ perf: 'saver' }); await settle();
    check(`省电模式释放 WebGL（第 ${i+1} 次）`, await page.locator('liquid-glass').count() === 0);
    await patch({ perf: 'high' }); await settle();
    check(`退出省电后恢复玻璃（第 ${i+1} 次）`, await rendered());
  }
  await patch({ glassBlur: false }); await settle();
  check('关闭模糊时使用实色表面', await page.locator('liquid-glass').count() === 0);
  await patch({ glassBlur: true }); await settle();
  check('恢复模糊时重新渲染', await rendered());
  await page.evaluate(() => scrollTo(0, 0));
  /*
   * 下面几项原来靠「液态玻璃主题」开关切进切出，现在开关没了。
   * 用主题网格表达同一件事：能切回去、选择能持久化、减少动画时不放动画。
   */
  const lightTheme = page.getByRole('button', { name: /^极简白/ });
  await lightTheme.click(); await settle();
  check('从主题网格切回极简白', await page.evaluate(() => window.__LOS__.useStore.getState().settings.theme === 'pure-light'));
  await page.reload(); await settle();
  check('主题选择已持久化', await page.evaluate(() => window.__LOS__.useStore.getState().settings.theme === 'pure-light'));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await glassTheme.click(); await settle();
  check('遵循系统减少动画', await page.evaluate(() => document.documentElement.dataset.motion === 'off' && getComputedStyle(document.querySelector('.refract-layer')).animationName === 'none'));
  await page.goto('http://127.0.0.1:5188/#/settings/schedule'); await settle();
  check('作息标签显示正确内容', await page.getByText('学习窗口', { exact: true }).count() > 0);
  check('设置子页导航保持选中', await page.locator('nav button[aria-current="page"]').innerText() === '设置');
  await page.goto('http://127.0.0.1:5188/#/goals'); await settle();
  const trigger = page.getByRole('button', { name: '新建', exact: true }); await trigger.click(); await settle();
  check('表单弹层隔离底层界面', await page.locator('#root').evaluate((el) => el.inert));
  for (let i = 0; i < 24; i++) await page.keyboard.press('Tab');
  check('Tab 焦点保持在弹层内', await page.evaluate(() => Boolean(document.activeElement.closest('[data-sheet]'))));
  await page.screenshot({ path: `${out}/glass-sheet.png` });
  await page.keyboard.press('Escape'); await settle();
  check('关闭弹层恢复焦点与滚动', await trigger.evaluate((el) => document.activeElement === el) && await page.evaluate(() => document.body.style.overflow !== 'hidden' && !document.querySelector('#root').inert));
  const boundary = await page.evaluate(async () => {
    const { suggestNext } = await import('/src/lib/suggest.ts');
    const base = { goals: [], todaySessions: [], todayMinutes: 0, remainingMinutes: 2, dailyGoalMinutes: 180, nowTs: Date.now() };
    const samples = [0, 0.5, 1, 2, 4.9, 5, 6, 37, 89, 999];
    return { two: suggestNext(base)[0]?.minutes, exhausted: suggestNext({...base,remainingMinutes:0}).length,
      bounded: samples.every((remainingMinutes) => suggestNext({...base,remainingMinutes}).every((s) => s.minutes > 0 && s.minutes <= remainingMinutes && s.minutes <= 90)) };
  });
  check('只剩两分钟就推荐两分钟', boundary.two === 2);
  check('时间耗尽不再推荐，所有时长遵守上限', boundary.exhausted === 0 && boundary.bounded);
  check('无运行时错误', errors.length === 0, errors.join(' | '));
  console.log(`\n${checks}/${checks} 通过`);
} finally { await browser.close(); }
