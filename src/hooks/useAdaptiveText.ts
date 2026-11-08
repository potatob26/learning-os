import { useEffect } from 'react';

/**
 * 按文字下方的背景与卡片实底选色；不反转整页，不改按钮的成对强调色。
 *
 * **恒常开启，没有开关**：原来挂在设置里的「字体随背景改变」已删除
 * （用户反馈那个开关多余，深浅跟着背景走本来就该是默认行为）。
 * 所以这里不再读 settings，也就没有「关掉之后卡在关掉状态」的问题 ——
 * 若保留字段而只删 UI，之前手动关过的用户会永远开不回来。
 */
export function useAdaptiveText() {
  useEffect(() => {
    const saved = new Map<HTMLElement, [string, string]>();
    const sample = document.createElement('canvas'); sample.width = 64; sample.height = 64;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    const swatch = document.createElement('canvas'); swatch.width = swatch.height = 1;
    const paint = swatch.getContext('2d', { willReadFrequently: true });
    if (!ctx || !paint) return;
    let timer = 0;
    const restore = () => {
      saved.forEach(([value, priority], el) => {
        if (value) el.style.setProperty('color', value, priority); else el.style.removeProperty('color');
      });
      saved.clear();
    };
    const update = () => {
      timer = 0; restore();
      const bg = document.querySelector<HTMLCanvasElement>('.bg-canvas');
      if (!bg || !bg.width) return;
      let pixels: Uint8ClampedArray;
      try { ctx.drawImage(bg, 0, 0, 64, 64); pixels = ctx.getImageData(0, 0, 64, 64).data; }
      catch { return; }
      const cache = new Map<string, number[]>();
      const rgba = (color: string) => {
        if (!cache.has(color)) {
          paint.clearRect(0, 0, 1, 1); paint.fillStyle = color; paint.fillRect(0, 0, 1, 1);
          cache.set(color, Array.from(paint.getImageData(0, 0, 1, 1).data));
        }
        return cache.get(color)!;
      };
      const root = getComputedStyle(document.documentElement);
      const neutral = ['--text', '--text-secondary', '--text-tertiary'].map(v => rgba(root.getPropertyValue(v).trim()).join(','));
      const dark = rgba(root.getPropertyValue('--adaptive-ink-dark').trim());
      const light = rgba(root.getPropertyValue('--adaptive-ink-light').trim());
      const luminance = (c: number[]) => c.slice(0, 3).reduce((sum, n, i) => {
        const s = n / 255; return sum + (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
      }, 0);
      const contrast = (a: number, b: number) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const elements = new Set<HTMLElement>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.trim()) {
          const el = walker.currentNode.parentElement;
          if (el instanceof HTMLElement) elements.add(el);
        }
      }
      const changes: [HTMLElement, string][] = [];
      for (const el of elements) {
        if (el.closest('script,style,svg,[inert],[aria-hidden="true"]')) continue;
        const range = document.createRange(); range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        const style = getComputedStyle(el);
        if (!neutral.includes(rgba(style.color).join(','))) continue;
        const layers: number[][] = [];
        for (let parent: HTMLElement | null = el; parent && parent !== document.body; parent = parent.parentElement) {
          layers.unshift(rgba(getComputedStyle(parent).backgroundColor));
        }
        let darkScore = Infinity, lightScore = Infinity;
        // 取文字区域的多个点，按最弱对比选择，避免只读全屏平均亮度。
        for (const x of [.2, .5, .8]) {
          const px = Math.max(0, Math.min(63, Math.floor((r.left + r.width * x) / innerWidth * 64)));
          const py = Math.max(0, Math.min(63, Math.floor((r.top + r.height / 2) / innerHeight * 64)));
          const offset = (py * 64 + px) * 4;
          let color = Array.from(pixels.slice(offset, offset + 3));
          for (const layer of layers) color = color.map((n, i) => n * (1 - layer[3] / 255) + layer[i] * layer[3] / 255);
          const l = luminance(color);
          darkScore = Math.min(darkScore, contrast(l, luminance(dark)));
          lightScore = Math.min(lightScore, contrast(l, luminance(light)));
        }
        changes.push([el, darkScore >= lightScore ? 'var(--adaptive-ink-dark)' : 'var(--adaptive-ink-light)']);
      }
      // 先完成全部测量，再写入；避免父元素的新颜色影响下一条文字的判断。
      for (const [el, color] of changes) {
        saved.set(el, [el.style.getPropertyValue('color'), el.style.getPropertyPriority('color')]);
        el.style.setProperty('color', color);
      }
    };
    // 等主题颜色过渡结束后读令牌，避免首次刷新时把过渡色误判为强调色。
    const schedule = () => { if (!timer) timer = window.setTimeout(update, 450); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    window.addEventListener('glass-background-change', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      clearTimeout(timer); observer.disconnect(); themeObserver.disconnect(); restore();
      window.removeEventListener('glass-background-change', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, []);
}
