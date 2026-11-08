(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 走底部导航进设置（直接改 hash 有时被路由吃回去，点击更稳）
  const navTab = Array.from(document.querySelectorAll('nav button')).find((b) => (b.textContent || '').includes('设置'));
  if (navTab) navTab.click();
  await sleep(1600);
  const dateTab = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '日期');
  if (dateTab) dateTab.click();
  await sleep(1600);

  const findEditor = () =>
    Array.from(document.querySelectorAll('div')).find((e) => (e.textContent || '').includes('显示范围（只调这块卡片）'));

  let pickedImage = false;
  if (!findEditor()) {
    // 编辑器只在「模块背景」选了图时才出现：先选中第一张图（缩略图 → 大图 → 使用这张）
    const thumb = document.querySelector('button[aria-label^="放大查看"]');
    if (thumb) {
      thumb.click();
      await sleep(900);
      const use = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '使用这张');
      if (use) {
        use.click();
        pickedImage = true;
        await sleep(900);
      }
    }
  }

  const el = findEditor();
  if (el) el.scrollIntoView({ block: 'center' });
  await sleep(700);
  return {
    hash: location.hash,
    navTab: Boolean(navTab),
    dateTab: Boolean(dateTab),
    pickedImage,
    editorFound: Boolean(el),
    preview: Boolean(document.querySelector('[aria-label="拖动调整「重要日期」模块背景的显示范围"]')),
    zoomSlider: Boolean(document.querySelector('[aria-label="重要日期模块背景放大倍数"]')),
    resetBtn: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === '复位'),
  };
})();
