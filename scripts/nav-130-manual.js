(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const navTab = Array.from(document.querySelectorAll('nav button')).find((b) => (b.textContent || '').includes('计时'));
  if (navTab) navTab.click();
  await sleep(1600);
  const btn = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '补录');
  if (btn) btn.click();
  for (let i = 0; i < 16 && !document.querySelector('[data-sheet]'); i++) await sleep(250);

  const inp = document.querySelector('input[aria-label="自定义时长（分钟）"]');
  // 顺手把它改成 37 分钟，验证「自由填写」不是摆设
  if (inp) {
    inp.scrollIntoView({ block: 'center' });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '37');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await sleep(500);
  return {
    hash: location.hash,
    timerTab: Boolean(navTab),
    manualBtn: Boolean(btn),
    sheet: Boolean(document.querySelector('[data-sheet]')),
    freeMinutesInput: Boolean(inp),
    value: inp ? inp.value : null,
    presetLit: Array.from(document.querySelectorAll('button'))
      .filter((b) => /^\d+\s*分|^\d+(\.\d+)?\s*小时$/.test((b.textContent || '').trim()))
      .map((b) => b.textContent.trim()),
  };
})();
