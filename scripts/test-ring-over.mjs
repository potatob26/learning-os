/**
 * 首页百分比可超 100% + 超额部分第二圈用另一种颜色（1.3.0 新需求）
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户原话：「首页百分比可超百分百（比如百分之两百），涂层颜色不一样
 * （百分百后第二圈颜色不一样），百分百圆圈的进度条颜色可自定义」。
 *
 * 这个用例守四件事：
 *   ① 数字真的能超过 100（以前 pct() 与 todayProgress 都封在 100，超额被抹掉）
 *   ② >100% 时**画出第二圈**，颜色与外圈**不同**
 *   ③ 第二圈颜色可在设置里改，且刷新后还在
 *   ④ **小组件载荷与首页数字一致**（这条最容易漏：首页改了、桌面小组件还是 100%）
 *
 * 判据用 SVG 的几何量：外圈半径 r=(size−stroke)/2=41.5，内圈 r=41.5−9=32.5。
 * 所以"有没有第二圈"= 有没有 r="32.5" 的圆；"第二圈画到几分"= 它的 stroke-dashoffset。
 */
import assert from 'node:assert/strict';
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';

const b = await chromium.launch({ headless: true });
let n = 0;
const check = (name, ok, detail = '') => {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  n++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await acknowledgeReleaseNotes(p);
  await p.goto('http://127.0.0.1:5188/#/');
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);

  /** 首页那个环的几何与颜色 */
  const ring = () =>
    p.evaluate(() => {
      const label = [...document.querySelectorAll('p')].find((x) => (x.textContent || '').trim() === '今日目标');
      if (!label) return null;
      const wrap = label.closest('div.relative');
      const svg = wrap?.querySelector('svg');
      if (!svg) return null;
      const circles = [...svg.querySelectorAll('circle')].map((c) => ({
        r: Number(c.getAttribute('r')),
        stroke: c.getAttribute('stroke'),
        // ⚠️ SVG 属性名带连字符且**大小写敏感**：必须读 'stroke-dasharray'，
        // 写 'strokeDasharray' 会拿到 null → Number(null) = 0（第一版就这么假失败过）
        dash: Number(c.getAttribute('stroke-dasharray')),
        offset: Number(c.getAttribute('stroke-dashoffset')),
      }));
      return { text: (label.parentElement?.textContent ?? '').replace(/\s+/g, ' '), circles };
    });

  const widgetPercent = () =>
    p.evaluate(async () => {
      const m = await import('/src/lib/widgetBridge.ts');
      return JSON.parse(m.buildWidgetPayload()).percent.percent;
    });

  /** 种数据：今天学了 minutes 分钟，目标 goal 分钟 */
  const seed = async (minutes, goal, ringOverflow = null) => {
    await p.evaluate(
      ({ minutes, goal, ringOverflow }) => {
        const s = window.__LOS__.useStore.getState();
        s.patchSettings({ onboarded: true, theme: 'pure-light', colorMode: 'light', byWeekday: null, dailyGoalMinutes: goal, ringOverflow });
        s.patchBackground({ current: 'none' });
        s.sessions.forEach((x) => s.removeSession(x.id));
        if (minutes > 0) {
          const now = Date.now();
          s.addSession({ subject: '数学', startedAt: now - minutes * 60000, endedAt: now, durationSec: minutes * 60, source: 'manual' });
        }
      },
      { minutes, goal, ringOverflow },
    );
    await sleep(1000);
  };

  /* ---------- 1. 50%：不该有第二圈 ---------- */
  await seed(30, 60);
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1300);
  let r = await ring();
  check('50% 时没有第二圈（没有 r=32.5 的圆）',
    r !== null && !r.circles.some((c) => c.r === 32.5), JSON.stringify(r?.circles.map((c) => c.r)));
  check('50% 显示 50%', !!r && r.text.includes('50%'), r?.text ?? '');

  /* ---------- 2. 200%：数字超 100，且画出第二圈 ---------- */
  await seed(120, 60);
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1300);
  r = await ring();
  check('200% 时显示 200%（不是被压成 100%）', !!r && r.text.includes('200%'), r?.text ?? '');
  const innerCircles = r?.circles.filter((c) => c.r === 32.5) ?? [];
  check('200% 时画出了第二圈', innerCircles.length >= 2, `内圈圆数 ${innerCircles.length}`);
  const innerProgress = innerCircles[innerCircles.length - 1];
  check('200% 时第二圈画满（dashoffset ≈ 0）',
    !!innerProgress && Math.abs(innerProgress.offset) < 1, JSON.stringify(innerProgress));
  const outerProgress = r?.circles[r.circles.length - 1];
  check('外圈在 200% 时也是满的',
    !!outerProgress && Math.abs(outerProgress.offset) < 1, JSON.stringify(outerProgress));
  check('第二圈颜色与外圈**不同**（"涂层颜色不一样"）',
    !!outerProgress && !!innerProgress && outerProgress.stroke !== innerProgress.stroke,
    `外 ${outerProgress?.stroke} / 内 ${innerProgress?.stroke}`);

  /* ---------- 3. 小组件载荷与首页一致 ---------- */
  check('小组件载荷的百分比也是 200（与首页一致，没被封顶）',
    (await widgetPercent()) === 200, String(await widgetPercent()));

  /* ---------- 4. 150%：第二圈画一半 ---------- */
  await seed(90, 60);
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1300);
  r = await ring();
  const half = r?.circles.filter((c) => c.r === 32.5) ?? [];
  const hp = half[half.length - 1];
  check('150% 显示 150%', !!r && r.text.includes('150%'), r?.text ?? '');
  check('150% 时第二圈画到一半（offset ≈ 周长的一半）',
    !!hp && Math.abs(hp.offset / hp.dash - 0.5) < 0.03,
    `offset=${hp?.offset?.toFixed(1)} dash=${hp?.dash?.toFixed(1)} 比例=${(hp ? hp.offset / hp.dash : 0).toFixed(3)}`);

  /* ---------- 5. 第二圈颜色可自定义 + 持久化 ---------- */
  await seed(120, 60, '#f97316');
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1300);
  r = await ring();
  const custom = r?.circles.filter((c) => c.r === 32.5) ?? [];
  check('设置里的自定义颜色生效在第二圈上',
    custom.length > 0 && custom[custom.length - 1].stroke === '#f97316',
    `内圈 stroke = ${custom[custom.length - 1]?.stroke}`);

  await p.goto('http://127.0.0.1:5188/#/settings/appearance');
  await sleep(1200);
  check('设置→外观里有「进度环颜色」卡片（两圈并列）',
    (await p.locator('main').innerText()).includes('进度环颜色'));
  check('自定义颜色输入框回显当前值',
    (await p.getByLabel('自定义超额部分颜色').inputValue()) === '#f97316',
    await p.getByLabel('自定义超额部分颜色').inputValue());

  // 通过界面改成另一个颜色（走真实交互，而不是直接改 store）
  await p.getByLabel('自定义超额部分颜色').fill('#ec4899');
  await sleep(800);
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1200);
  const persisted = await p.evaluate(() => window.__LOS__.useStore.getState().settings.ringOverflow);
  check('界面改的颜色刷新后还在', persisted === '#ec4899', String(persisted));
  await p.goto('http://127.0.0.1:5188/#/');
  await sleep(1300);
  r = await ring();
  const after = r?.circles.filter((c) => c.r === 32.5) ?? [];
  check('刷新后首页第二圈用的是新颜色',
    after.length > 0 && after[after.length - 1].stroke === '#ec4899',
    `内圈 stroke = ${after[after.length - 1]?.stroke}`);

  /* ---------- 6. 恢复默认 → 第二圈跟随强调色 ---------- */
  await p.evaluate(() => window.__LOS__.useStore.getState().patchSettings({ ringOverflow: null, accent: null }));
  await sleep(900);
  r = await ring();
  const def = r?.circles.filter((c) => c.r === 32.5) ?? [];
  check('恢复默认后第二圈跟随强调色（var(--accent)）',
    def.length > 0 && def[def.length - 1].stroke === 'var(--accent)',
    `内圈 stroke = ${def[def.length - 1]?.stroke}`);

  /* ---------- 7. 正常那一圈（未超过 100%）的颜色也可自定义 ---------- */
  // 先造一个 <100% 的状态：30/60 = 50%
  await seed(30, 60);
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1300);
  r = await ring();
  const outerBefore = r?.circles[r.circles.length - 1];
  check('未设自定义色时，正常那一圈跟随强调色（var(--accent)）',
    outerBefore?.stroke === 'var(--accent)', `外圈 stroke = ${outerBefore?.stroke}`);

  await p.evaluate(() => window.__LOS__.useStore.getState().patchSettings({ ringColor: '#8b5cf6', accent: null }));
  await sleep(900);
  r = await ring();
  const outerCustom = r?.circles[r.circles.length - 1];
  check('给「正常进度」选了颜色后，未超过 100% 时那一圈用它',
    outerCustom?.stroke === '#8b5cf6', `外圈 stroke = ${outerCustom?.stroke}`);
  check('50% 时依旧没有第二圈（自定义色不影响结构）',
    !(r?.circles.some((c) => c.r === 32.5)));

  /* ---------- 8. 达成（>100%）时，自定义的正常色不被成功色盖掉 ---------- */
  await seed(120, 60);
  await sleep(900);
  r = await ring();
  const outerAt200 = r?.circles[r.circles.length - 1];
  check('超过 100% 时外圈仍是用户选的颜色（不被成功色盖掉）',
    outerAt200?.stroke === '#8b5cf6', `外圈 stroke = ${outerAt200?.stroke}`);
  const innerAt200 = (r?.circles.filter((c) => c.r === 32.5) ?? []).slice(-1)[0];
  check('此时两圈颜色不同（正常色 vs 超额色）',
    !!innerAt200 && innerAt200.stroke !== outerAt200?.stroke,
    `外 ${outerAt200?.stroke} / 内 ${innerAt200?.stroke}`);

  /* ---------- 9. 界面里两个颜色项都能改、都能恢复默认 ---------- */
  await p.goto('http://127.0.0.1:5188/#/settings/appearance');
  await sleep(1200);
  const appearanceText = await p.locator('main').innerText();
  check('外观页两个颜色项都在（正常进度 / 超额部分）',
    appearanceText.includes('正常进度') && appearanceText.includes('超额部分'));
  await p.getByLabel('自定义正常进度颜色').fill('#ef4444');
  await sleep(700);
  check('界面改「正常进度」颜色会写进设置',
    (await p.evaluate(() => window.__LOS__.useStore.getState().settings.ringColor)) === '#ef4444');
  await p.getByLabel('自定义超额部分颜色').fill('#eab308');
  await sleep(700);
  check('界面改「超额部分」颜色会写进设置',
    (await p.evaluate(() => window.__LOS__.useStore.getState().settings.ringOverflow)) === '#eab308');
  await p.reload();
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await sleep(1200);
  const both = await p.evaluate(() => {
    const s = window.__LOS__.useStore.getState().settings;
    return { ringColor: s.ringColor, ringOverflow: s.ringOverflow };
  });
  check('两个颜色刷新后都在', both.ringColor === '#ef4444' && both.ringOverflow === '#eab308', JSON.stringify(both));

  check('无运行时错误', errors.length === 0, errors.slice(0, 1).join(' | '));
  await p.screenshot({ path: '.preview/ring-over-200.png' });
  console.log(`\n===== ${n}/${n} 通过 =====`);
} finally {
  await b.close();
}
