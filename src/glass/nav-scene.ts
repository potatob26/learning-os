/** 固定在底栏坐标系内的背景、图标和文字；移动的是透镜，不是纹理。 */
const icons = new Map<string, Promise<HTMLImageElement>>();
function rasterIcon(el: SVGSVGElement) {
  const clone = el.cloneNode(true) as SVGSVGElement;
  const source = [el, ...el.querySelectorAll('*')];
  const target = [clone, ...clone.querySelectorAll('*')];
  source.forEach((node, i) => {
    const style = getComputedStyle(node);
    for (const key of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity']) target[i].setAttribute(key, style.getPropertyValue(key));
    target[i].removeAttribute('class'); target[i].removeAttribute('style');
  });
  const r = el.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  clone.setAttribute('width', String(r.width * dpr)); clone.setAttribute('height', String(r.height * dpr));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const svg = new XMLSerializer().serializeToString(clone);
  if (!icons.has(svg)) {
    if (icons.size > 40) icons.clear();
    icons.set(svg, new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }));
  }
  return icons.get(svg)!;
}

export async function paintNavScene(canvas: HTMLCanvasElement, stage: HTMLElement) {
  const bg = document.querySelector<HTMLCanvasElement>('.bg-canvas');
  const material = stage.closest<HTMLElement>('.app-nav-material');
  const rect = stage.getBoundingClientRect();
  if (!bg || !material || rect.width < 1 || rect.height < 1) return false;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const frame = document.createElement('canvas');
  frame.width = Math.round(rect.width * dpr); frame.height = Math.round(rect.height * dpr);
  const ctx = frame.getContext('2d'); if (!ctx) return false;
  ctx.setTransform(frame.width / rect.width, 0, 0, frame.height / rect.height, 0, 0);
  // 用画布的实际显示范围换算，兼容滚动条和浏览器缩放。
  const br = bg.getBoundingClientRect();
  ctx.drawImage(bg, (rect.left - br.left) * bg.width / br.width, (rect.top - br.top) * bg.height / br.height,
    rect.width * bg.width / br.width, rect.height * bg.height / br.height, 0, 0, rect.width, rect.height);
  const mr = material.getBoundingClientRect(), ms = getComputedStyle(material);
  ctx.fillStyle = ms.backgroundColor;
  ctx.beginPath(); ctx.roundRect(mr.left - rect.left, mr.top - rect.top, mr.width, mr.height, parseFloat(ms.borderRadius)); ctx.fill();
  const draws: (() => void)[] = [];
  await Promise.all(Array.from(material.querySelectorAll<SVGSVGElement>('.nav-tab > svg')).map(async el => {
    const r = el.getBoundingClientRect(), image = await rasterIcon(el);
    draws.push(() => ctx.drawImage(image, r.left - rect.left, r.top - rect.top, r.width, r.height));
  }));
  if (!stage.isConnected) return false;
  draws.forEach(draw => draw());
  for (const el of material.querySelectorAll<HTMLElement>('.nav-tab-label, .nav-timer-badge')) {
    const style = getComputedStyle(el), range = document.createRange(); range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (el.classList.contains('nav-timer-badge')) {
      const box = el.getBoundingClientRect(); ctx.fillStyle = style.backgroundColor;
      ctx.beginPath();ctx.roundRect(box.left - rect.left, box.top - rect.top, box.width, box.height, box.height / 2);ctx.fill();
    }
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    ctx.fillStyle = style.color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const text = el.textContent ?? '', metrics = ctx.measureText(text);
    const ascent = metrics.fontBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent;
    const y = r.top - rect.top + (r.height - ascent - descent) / 2 + ascent;
    ctx.fillText(text, r.left - rect.left + r.width / 2, y);
  }
  // 完整纹理一次提交，避免异步图标解码时显示只有背景的一帧。
  canvas.width = frame.width; canvas.height = frame.height;
  canvas.getContext('2d')!.drawImage(frame, 0, 0);
  return true;
}
