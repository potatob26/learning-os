(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = (txt, sel) => {
    const list = Array.from(document.querySelectorAll(sel || 'button'));
    const b = list.find((x) => (x.textContent || '').trim().includes(txt));
    if (b) b.click();
    return Boolean(b);
  };

  // 关掉会挡住截图的全局弹层（更新说明 / 时钟校准提示）
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    const t = d.textContent || '';
    if (/本次更新|校准|更新说明/.test(t)) {
      const b = Array.from(d.querySelectorAll('button')).find((x) =>
        /知道了|以后再说|关闭|稍后|确定/.test(x.textContent || ''),
      );
      if (b) b.click();
    }
  }
  await sleep(600);

  // 换掉用户自己上传的壁纸（那张图是第三方版权作品，不能出现在说明书/商店截图里）
  const toSettings = clickText('设置', 'nav button');
  await sleep(1600);
  const toBgTab = clickText('背景');
  await sleep(1600);
  const fixedMode = clickText('固定');
  await sleep(400);
  const aurora = clickText('极光');
  await sleep(1600);

  // 回首页
  const toHome = clickText('首页', 'nav button');
  await sleep(2200);

  // 滚到顶，保证截图是最上面那一屏
  window.scrollTo(0, 0);
  const scrollers = [document.scrollingElement, ...document.querySelectorAll('main, [class*="overflow-y"]')];
  for (const s of scrollers) if (s && s.scrollTop) s.scrollTop = 0;
  await sleep(900);

  return {
    hash: location.hash,
    toSettings, toBgTab, fixedMode, aurora, toHome,
    canvas: Boolean(document.querySelector('.bg-canvas')),
    theme: document.documentElement.getAttribute('data-theme'),
    innerText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 90),
  };
})();
