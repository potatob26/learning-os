/**
 * 自定义背景图「显示范围」可调 + 实时预览
 * ──────────────────────────────────────────────────────────────────────────────
 * 用户要求：「加自定义图片位置可预览调节（调整显示范围）」。
 *
 * 验四件事：
 *  ① 默认不动 = 居中 cover（focusX/focusY/zoom 都是缺省）→ 零回归的前提
 *  ② 拖动预览框 → 设置里的 focusX/focusY 真的变了，且收在 0..1
 *  ③ **页面背景画布真的跟着变** —— 这才是"实时预览"的实质（不是只改那个小方框）
 *  ④ 点「复位」→ 回到缺省
 *
 * 注意：自定义图存在 settings 里（dataUrl），而 localStorage 装不下大图 ——
 * 所以这里用一张 4×4 的极小 PNG（几十字节），否则存档会被配额顶掉。
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';

const BASE = 'http://127.0.0.1:5188';
let n = 0;
let pass = 0;
function check(name, ok, detail = '') {
  n++;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * 测试图：240x480 的横向渐变 + 深色横条。
 * ⚠️ 不要用"4x4 单红点"那种图 —— 实测它被 cover 放大到 915x915 后，
 * 可见区域落在**透明部分**，于是焦点怎么改画面都不变，看起来像功能坏了（我踩过）。
 * 这张图横向有渐变、纵向有横条，任一方向改焦点都必然可见。
 */
async function makeTestImage(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 480;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 240, 0);
    grad.addColorStop(0, '#ff2d2d');
    grad.addColorStop(0.5, '#2dff6a');
    grad.addColorStop(1, '#2d6aff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 240, 480);
    for (let y = 0; y < 480; y += 40) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, y, 240, 12);
    }
    return c.toDataURL('image/png');
  });
}

const seed = () => ({
  version: 1,
  onboarded: true,
  settings: {
    theme: 'soft',
    colorMode: 'dark',
    motion: false,
    perf: 'high',
    background: {
      current: 'img:t1',
      mode: 'fixed',
      rotateMinutes: 30,
      enabledIds: ['img:t1'],
      custom: [
        { id: 't1', name: '测试图', dataUrl: TINY_PNG, width: 4, height: 4, bytes: TINY_PNG.length, createdAt: 1 },
      ],
      dim: 0,
      dynamic: false,
      showVeil: false,
      grid: true,
      dimAuto: true,
    },
  },
  goals: [],
  sessions: [],
  tasks: [],
  quotes: { custom: [], useBuiltin: true, lastIndex: 0 },
  notes: [],
});

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text().slice(0, 150);
  if (/net::ERR_|Failed to load resource|CORS/i.test(t)) return;
  errors.push(`[console] ${t}`);
});

try {
  await acknowledgeReleaseNotes(p);
  /*
   * 种数据：**用 store 自己的 API**，不要硬改 localStorage。
   * 我第一版硬写 localStorage 种不出图 —— 应用加载时会把存档重写回去，
   * 自定义背景就没了（`background.custom[0]` 变 undefined，测试直接崩）。
   * 项目里验证过的做法是 patchSettings + addCustomBackground + patchBackground。
   */
  await p.goto(BASE + '/#/settings/background', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  const testImg = await makeTestImage(p);
  await p.evaluate((png) => {
    const s = window.__LOS__.useStore.getState();
    s.patchSettings({ onboarded: true, theme: 'soft', colorMode: 'dark', motion: false, perf: 'high' });
    const id = s.addCustomBackground({ name: '测试图', dataUrl: png, width: 240, height: 480, bytes: png.length });
    s.patchBackground({ current: `img:${id}`, mode: 'fixed', enabledIds: [`img:${id}`], dim: 0, showVeil: false, grid: true });
  }, testImg);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await new Promise((r) => setTimeout(r, 2000));
  await p.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('知道了'))?.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  const seeded = await p.evaluate(() => {
    const bg = window.__LOS__.useStore.getState().background;
    return { current: bg.current, count: bg.custom.length };
  });
  check('自定义背景已种好（store API 写入并存活过刷新）', seeded.count === 1 && seeded.current.startsWith('img:'), JSON.stringify(seeded));

  /* ---------- ① 默认缺省 = 居中 cover ---------- */
  const before = await p.evaluate(() => {
    const c = window.__LOS__.useStore.getState().background.custom[0];
    const cv = document.querySelector('.bg-canvas');
    let sig = 0;
    if (cv) {
      // 整张画布：64x64 角落太小，拖动焦点时可能采不到变化（假失败过）
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 16) sig = (sig + d[i] * 7 + d[i + 1] * 13 + d[i + 2] * 17) % 2147483647;
    }
    return { focusX: c.focusX, focusY: c.focusY, zoom: c.zoom, sig };
  });
  check(
    '默认未设置显示范围（缺省即居中 cover，零回归的前提）',
    before.focusX === undefined && before.focusY === undefined && before.zoom === undefined,
    JSON.stringify(before),
  );

  /* ---------- ② 展开调节器并拖动 ---------- */
  const opened = await p.getByRole('button', { name: '调整显示范围' }).first().click().then(() => true).catch(() => false);
  await new Promise((r) => setTimeout(r, 500));
  const box = p.getByRole('application');
  const boxCount = await box.count();
  check('「调整显示范围」能展开出拖动区', opened && boxCount > 0, `拖动区 ${boxCount} 个`);

  const bb = await box.first().boundingBox();
  /*
   * ⚠️ 必须先滚动到可见再量坐标：Playwright 的 mouse 用的是**视口坐标**，
   * 而设置页很长，拖动框常常落在视口之外 —— 那样点到的就是空处（第一版就这么假失败）。
   */
  // 滚到视口**中间**：最小滚动的 scrollIntoViewIfNeeded 会把它停在视口底部，
  // 而底部导航是 fixed 的，会整块盖住它（实测点中心/点上部都命中导航里的 svg）。
  await box.first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await new Promise((r) => setTimeout(r, 500));
  const bb2 = await box.first().boundingBox();
  if (bb2) {
    /*
     * 抓框的**上半部分**，不是几何中心：底部导航是 fixed 的，设置页最后一张卡的下半部
     * 会被它盖住（实测框底 915.6 = 视口底）。点中心会点到导航栏上（事件计数 {0,0,0}）。
     * 这也是真人拖这个框时会抓的位置，所以测试按同样的抓法。
     */
    const ax = bb2.x + bb2.width / 2;
    const ay = bb2.y + Math.min(28, bb2.height / 3);
    await p.mouse.move(ax, ay);
    await p.mouse.down();
    await p.mouse.move(ax + 40, ay + 12, { steps: 8 });
    await p.mouse.up();
  }
  await new Promise((r) => setTimeout(r, 700));

  const after = await p.evaluate(() => {
    const c = window.__LOS__.useStore.getState().background.custom[0];
    const cv = document.querySelector('.bg-canvas');
    let sig = 0;
    if (cv) {
      // 整张画布：64x64 角落太小，拖动焦点时可能采不到变化（假失败过）
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 16) sig = (sig + d[i] * 7 + d[i + 1] * 13 + d[i + 2] * 17) % 2147483647;
    }
    return { focusX: c.focusX, focusY: c.focusY, sig };
  });

  check(
    '拖动后设置里真的记下了焦点（且收在 0..1）',
    typeof after.focusX === 'number' &&
      typeof after.focusY === 'number' &&
      after.focusX >= 0 &&
      after.focusX <= 1 &&
      after.focusY >= 0 &&
      after.focusY <= 1 &&
      (after.focusX !== 0.5 || after.focusY !== 0.5),
    `focus=(${after.focusX}, ${after.focusY})`,
  );
  check(
    '**页面背景画布真的跟着变了**（这才叫实时预览，不是只改小方框）',
    after.sig !== before.sig,
    `指纹 ${before.sig} → ${after.sig}`,
  );

  /* ---------- ③ 刷新后仍在（真的存下来了） ---------- */
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__LOS__?.useStore.getState().hydrated);
  await new Promise((r) => setTimeout(r, 1500));
  const persisted = await p.evaluate(() => {
    const c = window.__LOS__.useStore.getState().background.custom[0];
    return { focusX: c.focusX, focusY: c.focusY };
  });
  check(
    '刷新后焦点仍在（存进了本机存档）',
    persisted.focusX === after.focusX && persisted.focusY === after.focusY,
    JSON.stringify(persisted),
  );

  /* ---------- ④ 复位 ---------- */
  await p.getByRole('button', { name: '调整显示范围' }).first().click().catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  await p.getByRole('button', { name: '复位' }).first().click().catch(() => {});
  await new Promise((r) => setTimeout(r, 700));
  const reset = await p.evaluate(() => {
    const c = window.__LOS__.useStore.getState().background.custom[0];
    return { focusX: c.focusX, focusY: c.focusY, zoom: c.zoom };
  });
  check(
    '「复位」回到缺省（0.5 / 0.5 / 1 = 居中 cover）',
    reset.focusX === 0.5 && reset.focusY === 0.5 && reset.zoom === 1,
    JSON.stringify(reset),
  );

  check('无运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  await p.screenshot({ path: '.preview/bg-focus.png' });
  console.log(`\n===== ${pass}/${n} 通过 =====`);
} finally {
  await b.close();
}
process.exit(pass === n ? 0 : 1);
