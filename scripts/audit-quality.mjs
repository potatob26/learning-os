/**
 * 渲染质量审计
 * ──────────────────────────────────────────────────────────────
 * 覆盖用户提出的三类问题：
 *   ① 有没有错误      → 收集每个页面 × 主题下的 JS 报错
 *   ② 有没有渲染错误  → 横向溢出、元素超出视口、文字被截断、零尺寸可见元素
 *   ③ 文字显示不清楚  → 截取真实像素，量测文字与其背景的对比度
 *
 * 为什么对比度要测像素而不是读 CSS：
 *   应用大量使用半透明玻璃，元素自身 backgroundColor 常常是 rgba(0,0,0,0)，
 *   真正压在文字下面的是合成后的背景与玻璃层。只有读渲染结果才准确。
 */
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
import { existsSync, mkdirSync } from 'node:fs';

const flowAudit = process.argv.includes('--flow');
/*
 * 低对比文字从「只报数」升级成机器门禁：超过 --max-low 就 exit 1。
 * 1.4.x 令牌修复后实测 78 组合已经降到 **0**，默认值收紧到 0 —— 以后只许升不许降。
 * （旧基线 17 是 1.2.x 的旧实现/旧口径；1.3.0 玻璃重做后实际是 31，1.4.x 才真正清零。）
 */
const maxLowArg = process.argv.find((a) => a.startsWith('--max-low='));
const MAX_LOW = maxLowArg ? Number(maxLowArg.split('=')[1]) : 0;
const out = flowAudit ? '.preview/quality-flow' : '.preview/quality';
mkdirSync(out, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

const THEMES = [
  ['liquid-glass-wc', 'dark'],
  ['liquid-glass', 'dark'],
  ['pure-dark', 'dark'],
  ['pure-light', 'light'],
  ['soft', 'light'],
  ['immersive', 'dark'],
];

const ROUTES = [
  ['home', '#/'],
  ['goals', '#/goals'],
  ['timer', '#/timer'],
  ['stats', '#/stats'],
  ['set-appearance', '#/settings/appearance'],
  ['set-courses', '#/settings/courses'],
  ['set-background', '#/settings/background'],
  ['set-dates', '#/settings/dates'],
  ['set-data', '#/settings/data'],
  // 日历与作业清单是独立页面，同样要纳入质量审计
  ['calendar', '#/calendar'],
  ['checklist', '#/checklist'],
  // 火花独立页（1.4.1）
  ['streak', '#/streak'],
  // 作息页之前漏了；它有大量分段按钮与说明文字
  ['set-schedule', '#/settings/schedule'],
];

const seed = (theme, colorMode) => ({
  schema: 3,
  settings: {
    theme,
    colorMode,
    perf: 'high',
    glassBlur: true,
    dynamicBackground: false,
    onboarded: true,
    blocks: [],
    quoteSeed: 'x',
    dailyGoalMinutes: 180,
    studyFrom: '17:40',
    studyTo: '22:30',
    nickname: '',
  },
  periods: [
    { id: 'p1', name: '第 1 节', start: '08:00', end: '08:45', counts: true },
    { id: 'p2', name: '第 2 节', start: '08:55', end: '09:40', counts: true },
  ],
  courses: [
    { id: 'c1', subject: '数学', title: '数学', weekday: 0, periodId: 'p1', location: '高二(3)班' },
    { id: 'c2', subject: '英语', title: '英语晚辅导', weekday: 0, periodId: 'p2' },
  ],
  goals: [
    {
      id: 'g1',
      title: '完成一套数学试卷',
      subject: '数学',
      plannedMinutes: 60,
      actualMinutes: 24,
      status: 'doing',
      date: new Date().toISOString().slice(0, 10),
      createdAt: Date.now(),
    },
  ],
  tasks: [],
  sessions: [
    {
      id: 's1',
      subject: '数学',
      goalId: 'g1',
      startedAt: Date.now() - 3600_000,
      endedAt: Date.now() - 3600_000 + 24 * 60000,
      durationSec: 24 * 60,
      source: 'timer',
    },
  ],
  dates: [
    { id: 'd1', title: '中考', date: '2027-06-15', primary: true, hidden: false },
  ],
  background: {
    current: flowAudit ? 'scene:glass-flow' : 'scene:aurora',
    mode: 'fixed',
    rotateMinutes: 60,
    enabledIds: ['scene:aurora'],
    custom: [],
    dim: 0.35,
    dynamic: false,
    showVeil: true,
    grid: false,
  },
  timer: null,
  courseStatus: {},
});

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--force-color-profile=srgb'],
});

/** 在页面里做一次 DOM 层面的渲染检查 */
const RENDER_PROBE = () => {
  const issues = [];
  const vw = window.innerWidth;

  // ① 页面横向溢出
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) {
    issues.push({ kind: '页面横向溢出', detail: `scrollWidth ${de.scrollWidth} > 视口 ${vw}` });
  }

  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  /**
   * 超出视口的那部分是否本来就被祖先裁掉了。
   *
   * `.glass-liquid__blur` 是刻意的「外扩 24px 模糊层」（防止边缘出现透明空洞），
   * 它一定比卡片宽，但外层容器 `overflow:hidden` 会裁回卡片范围 —— 用户看不到，
   * 不算「元素宽于视口」。之前 1.3.0 换成 GlassLiquidPanel 后没跑过质量审计，
   * 于是 60 个组合里报了 40 条这类假溢出；这里按「裁剪祖先」判断，而不是把
   * 某个类名写进白名单（写死类名以后还会漏）。
   */
  const isClippedByAncestor = (el) => {
    let p = el.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      const clips =
        cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      if (clips) {
        const pr = p.getBoundingClientRect();
        if (pr.width > 0 && pr.width <= vw + 2) return true;
      }
      p = p.parentElement;
    }
    return false;
  };

  // ② 元素超出视口（排除刻意做成横向滚动的容器 + 被祖先裁掉的装饰层）
  for (const el of Array.from(document.querySelectorAll('main *'))) {
    if (!isVisible(el)) continue;
    if (el.closest('[data-allow-overflow]')) continue;
    if (isClippedByAncestor(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > vw + 2) {
      const cls = String(el.className).slice(0, 46);
      issues.push({ kind: '元素宽于视口', detail: `${el.tagName}.${cls} = ${Math.round(r.width)}px` });
      if (issues.length > 12) break;
    }
  }

  // ③ 文字被截断（有文本但内容宽度超出，且没有省略号处理）
  for (const el of Array.from(document.querySelectorAll('main *'))) {
    if (!isVisible(el)) continue;
    if (el.children.length > 0) continue; // 只看叶子节点
    const text = (el.textContent ?? '').trim();
    if (text.length < 2) continue;
    const cs = getComputedStyle(el);
    const clippedX = el.scrollWidth > el.clientWidth + 2;
    const clippedY = el.scrollHeight > el.clientHeight + 2;
    const ellipsis = cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden';
    if (clippedX && !ellipsis && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
      issues.push({ kind: '文字横向被切', detail: `"${text.slice(0, 18)}" ${el.scrollWidth}>${el.clientWidth}` });
    }
    if (clippedY && cs.overflowY === 'hidden' && !ellipsis) {
      issues.push({ kind: '文字纵向被切', detail: `"${text.slice(0, 18)}" ${el.scrollHeight}>${el.clientHeight}` });
    }
    if (issues.length > 24) break;
  }

  // ④ 字号过小（手机上看不清）
  const tiny = [];
  for (const el of Array.from(document.querySelectorAll('main *'))) {
    if (!isVisible(el) || el.children.length > 0) continue;
    const text = (el.textContent ?? '').trim();
    if (text.length < 2) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px > 0 && px < 10) tiny.push(`${px}px "${text.slice(0, 14)}"`);
  }
  if (tiny.length) issues.push({ kind: '字号过小(<10px)', detail: tiny.slice(0, 5).join(' / ') });

  return issues;
};

/** 用截图量测文字对比度 */
const measureContrast = async (page, shotBase64) => {
  return page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((res) => {
      img.onload = res;
      img.src = dataUrl;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const dpr = img.naturalWidth / window.innerWidth;
    const imgData = g.getImageData(0, 0, c.width, c.height).data;

    /**
     * WCAG 相对亮度。
     * 注意：必须先把 sRGB 分量线性化，否则对中间调会严重低估对比度 ——
     * 之前直接用 `0.2126R+0.7152G+0.0722B`（0-255 原始值）计算，
     * 把 0.56 透明度的三级文字（真实约 4.1:1）报成 2.0:1，
     * 于是整页文字都被误判为「低对比」（已踩过这个坑）。
     */
    const srgbToLinear = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lumAt = (x, y) => {
      const i = (y * c.width + x) * 4;
      return (
        0.2126 * srgbToLinear(imgData[i]) +
        0.7152 * srgbToLinear(imgData[i + 1]) +
        0.0722 * srgbToLinear(imgData[i + 2])
      );
    };

    const results = [];
    const els = Array.from(document.querySelectorAll('main *')).filter((el) => {
      if (el.children.length > 0) return false;
      const t = (el.textContent ?? '').trim();
      if (t.length < 2) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      /*
       * 祖先累积 opacity：禁用态常用 opacity-40 套在父容器上，
       * WCAG 1.4.3 对「禁用控件」豁免，不该算低对比。
       * 只看元素自身会漏掉祖先，于是把禁用态误报成真问题（之前 17 条里 3 条是这种）。
       */
      let op = 1;
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        const v = Number(getComputedStyle(p).opacity);
        op *= Number.isFinite(v) ? v : 1;
        if (op < 0.6) return false;
      }
      const r = el.getBoundingClientRect();
      if (r.width <= 8 || r.height <= 6 || r.top < 0 || r.bottom > window.innerHeight) return false;

      /**
       * 遮挡检测：用 elementFromPoint 判断这个位置真正显示的是谁。
       * 底部导航是 position: fixed，内容会从它下面滚过去；
       * 之前没做这一步，把被导航挡住的文字也当成「低对比」，
       * 量到的是导航自身的背景色，于是出现一堆不可能的 1:1（已踩过这个坑）。
       */
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) return false;

      return true;
    });

    /**
     * 取「紧贴文字」的包围盒，而不是元素框。
     * 块级元素即使只有两个字，宽度也是整行 —— 用元素框测会把大片背景
     * 算进来，文字像素占比过低，直接得出「对比度 1.4:1」这种假结果
     * （一开始就踩了这个坑）。用 Range 量文字本身才准。
     */
    const textRect = (el) => {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) return r;
      } catch {
        /* 忽略 */
      }
      return el.getBoundingClientRect();
    };

    for (const el of els.slice(0, 40)) {
      const r = textRect(el);
      const x0 = Math.max(0, Math.round(r.left * dpr));
      const y0 = Math.max(0, Math.round(r.top * dpr));
      const x1 = Math.min(c.width, Math.round(r.right * dpr));
      const y1 = Math.min(c.height, Math.round(r.bottom * dpr));
      if (x1 - x0 < 3 || y1 - y0 < 3) continue;

      const lums = [];
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) lums.push(lumAt(x, y));
      }
      if (lums.length < 12) continue;
      lums.sort((a, b) => a - b);

      // 用分位数而不是固定占比阈值：
      // 文字通常是最暗（或最亮）的那一小部分，取两端各 8% 的均值，
      // 即使文字只占很小比例也能稳定抓到。
      const n = lums.length;
      const k = Math.max(1, Math.floor(n * 0.08));
      const darkMean = lums.slice(0, k).reduce((a, b) => a + b, 0) / k;
      const lightMean = lums.slice(n - k).reduce((a, b) => a + b, 0) / k;
      // 相对亮度已归一到 0..1，偏移量用 WCAG 标准的 0.05
      const contrast = (lightMean + 0.05) / (darkMean + 0.05);

      const px = parseFloat(getComputedStyle(el).fontSize);
      const large = px >= 18.66;
      const need = large ? 3 : 4.5;
      if (contrast < need) {
        results.push({
          text: (el.textContent ?? '').trim().slice(0, 22),
          ratio: Math.round(contrast * 100) / 100,
          need,
          px: Math.round(px * 10) / 10,
        });
      }
    }
    return results;
  }, `data:image/png;base64,${shotBase64}`);
};

const report = [];
let fatal = 0;

for (const [theme, colorMode] of THEMES) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    colorScheme: colorMode,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await acknowledgeReleaseNotes(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 140)}`);
  });

  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), seed(theme, colorMode));

  for (const [name, hash] of ROUTES) {
    errors.length = 0;
    await page.goto(`http://127.0.0.1:5188/${hash}`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1300);

    /**
     * 冻结动画与过渡后再测量。
     * 页面上的卡片有入场动画（anim-rise + 逐张延迟），
     * 如果截图与读 DOM 坐标之间元素还在移动，两次位置就对不上，
     * 会量到空白区域并得出「对比度 1:1」这种不可能的结果（踩过这个坑）。
     */
    await page.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
    });
    await page.waitForTimeout(600);

    const issues = await page.evaluate(RENDER_PROBE);
    const shot = await page.screenshot();
    const lowContrast = await measureContrast(page, shot.toString('base64'));

    const jsErr = [...new Set(errors)];
    if (jsErr.length) fatal++;

    const entry = { theme, route: name, jsErr, issues, lowContrast };
    report.push(entry);

    const flag =
      jsErr.length || issues.length || lowContrast.length ? '⚠️ ' : '✓ ';
    console.log(
      `${flag}${theme.padEnd(13)} ${name.padEnd(15)} ` +
        `JS错误 ${jsErr.length} · 渲染问题 ${issues.length} · 低对比文字 ${lowContrast.length}`,
    );
    if (jsErr.length) jsErr.slice(0, 2).forEach((e) => console.log(`      JS: ${e}`));
    issues.slice(0, 3).forEach((i) => console.log(`      ${i.kind}: ${i.detail}`));
    lowContrast.slice(0, 3).forEach((c) =>
      console.log(`      低对比: "${c.text}" ${c.ratio}:1 (需 ${c.need}:1, ${c.px}px)`),
    );
  }
  await ctx.close();
}

const { writeFileSync } = await import('node:fs');
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));

const totalIssues = report.reduce((a, r) => a + r.issues.length, 0);
const totalLow = report.reduce((a, r) => a + r.lowContrast.length, 0);
const totalJs = report.reduce((a, r) => a + r.jsErr.length, 0);
console.log(
  `\n合计：JS 错误 ${totalJs} · 渲染问题 ${totalIssues} · 低对比文字 ${totalLow}（共 ${report.length} 个组合，上限 ${MAX_LOW}）`,
);
console.log(`明细: ${out}/report.json`);

await browser.close();
process.exit(totalJs === 0 && totalIssues === 0 && totalLow <= MAX_LOW ? 0 : 1);
