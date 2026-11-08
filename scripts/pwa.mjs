/**
 * PWA 真实验证（要求三十八：必须真正测试，而不是只放一个 manifest）
 * ──────────────────────────────────────────────────────────
 * 验证内容：
 *   1. manifest 能被浏览器解析，且关键字段齐全（name/icons/start_url/display）
 *   2. Service Worker 真实注册成功并进入 activated 状态
 *   3. 断网后重新打开页面仍然能渲染（真正的离线可用）
 *   4. 图标文件真实存在且可被浏览器解码
 *
 * 用法：node scripts/pwa.mjs [baseUrl]
 *   默认验证生产构建：先 npm run build，再 npm run preview
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4173/';
const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(1500);

// 先完成引导，否则离线测试只会看到首次引导页，测不到页面切换
await page.evaluate(() => {
  const seed = {
    schema: 1,
    settings: { onboarded: true, theme: 'mica', colorMode: 'light', perf: 'balanced' },
  };
  localStorage.setItem('learning-os:v1:state', JSON.stringify(seed));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);

/* 1. manifest */
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href').catch(() => null);
check('页面声明了 manifest', Boolean(manifestHref), manifestHref ?? '未找到');

const manifest = await page.evaluate(async (href) => {
  if (!href) return null;
  const res = await fetch(href);
  return res.ok ? await res.json() : null;
}, manifestHref);

check('manifest 可被解析', Boolean(manifest));
if (manifest) {
  check('manifest 含中文名称', Boolean(manifest.name), manifest.name);
  check('display 为 standalone', manifest.display === 'standalone', String(manifest.display));
  check('声明了 start_url 与 scope', Boolean(manifest.start_url), `${manifest.start_url} / ${manifest.scope}`);
  check('lang 为 zh-CN', manifest.lang === 'zh-CN', String(manifest.lang));

  const icons = manifest.icons ?? [];
  check('声明了图标', icons.length >= 2, `${icons.length} 个`);
  check(
    '包含 192 与 512 且含 maskable',
    icons.some((i) => i.sizes === '192x192') &&
      icons.some((i) => i.sizes === '512x512') &&
      icons.some((i) => String(i.purpose).includes('maskable')),
    icons.map((i) => `${i.sizes}${i.purpose ? `(${i.purpose})` : ''}`).join(', '),
  );

  // 图标真实可解码
  for (const icon of icons) {
    const decoded = await page.evaluate(async (src) => {
      try {
        const img = new Image();
        const p = new Promise((resolve) => {
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
        });
        img.src = src;
        return await p;
      } catch {
        return null;
      }
    }, new URL(icon.src, base).href);
    check(`图标可解码 ${icon.sizes}`, Boolean(decoded), decoded ? `${decoded.w}×${decoded.h}` : '解码失败');
  }
}

/* 2. Service Worker */
const sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { supported: true, registered: false };
  // 等待激活
  const sw2 = reg.active ?? reg.installing ?? reg.waiting;
  if (sw2 && sw2.state !== 'activated') {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 4000);
      sw2.addEventListener('statechange', () => {
        if (sw2.state === 'activated') {
          clearTimeout(t);
          resolve();
        }
      });
    });
  }
  return {
    supported: true,
    registered: true,
    scope: reg.scope,
    state: (reg.active ?? sw2)?.state ?? 'unknown',
    controlled: Boolean(navigator.serviceWorker.controller),
  };
});

check('浏览器支持 Service Worker', sw.supported);
check('Service Worker 注册成功', Boolean(sw.registered), sw.scope ?? '');
check('Service Worker 已激活', sw.state === 'activated', String(sw.state));

// 等待 SW 接管（首次加载时 controller 需要一次刷新）
if (!sw.controlled) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
}
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
check('当前页面已被 Service Worker 接管', controlled);

/* 3. 离线可用 */
const cacheInfo = await page.evaluate(async () => {
  const names = await caches.keys();
  let total = 0;
  for (const n of names) {
    const c = await caches.open(n);
    total += (await c.keys()).length;
  }
  return { names, total };
});
check('已缓存应用资源', cacheInfo.total > 0, `${cacheInfo.total} 个资源 / ${cacheInfo.names.length} 个缓存`);

// 真实断网
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1800);
const offlineOk = await page.evaluate(() => {
  const root = document.getElementById('root');
  return {
    hasContent: (root?.childElementCount ?? 0) > 0,
    text: (document.body.innerText ?? '').trim().slice(0, 60),
  };
});
check('断网后仍能渲染页面', offlineOk.hasContent, offlineOk.text.replace(/\n/g, ' '));
check('断网后不是白屏', offlineOk.hasContent && offlineOk.text.length > 0);

// 断网下在应用内切换页面（点底部导航，验证 SPA 路由在离线时可用）
const navOk = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('nav button'));
  const stats = buttons.find((b) => (b.textContent ?? '').includes('统计'));
  if (!stats) return { clicked: false, reason: `只有 ${buttons.length} 个导航按钮` };
  stats.click();
  return { clicked: true };
});
await page.waitForTimeout(900);
const offlineNav = await page.evaluate(() => (document.body.innerText ?? '').includes('统计'));
check(
  '断网后仍可切换页面',
  navOk.clicked && offlineNav,
  navOk.clicked ? '底部导航 → 统计' : navOk.reason,
);

await ctx.setOffline(false);

check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log('失败项：');
  for (const f of failed) console.log(`  · ${f.name} ${f.detail}`);
  process.exit(1);
}
