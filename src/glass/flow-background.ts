/** 移植自独立液态玻璃演示 app.js 的 flow 背景；配色和曲线保持一致，省略演示标题。 */
export function paintGlassFlow(c: CanvasRenderingContext2D, w: number, h: number) {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => css.getPropertyValue(`--color-flow-${name}`).trim();
  const b = c.createLinearGradient(0, 0, w, h);
  b.addColorStop(0, color('ink')); b.addColorStop(.44, color('sea'));
  b.addColorStop(.7, color('teal')); b.addColorStop(1, color('deep'));
  c.fillStyle = b; c.fillRect(0, 0, w, h);
  c.save(); c.filter = 'blur(18px)';
  const g = c.createLinearGradient(w * .28, 0, w * .85, h);
  g.addColorStop(0, color('sand')); g.addColorStop(.34, color('cream'));
  g.addColorStop(.59, color('copper')); g.addColorStop(1, color('plum'));
  c.fillStyle = g; c.beginPath(); c.moveTo(w * .66, -80);
  c.bezierCurveTo(w * .72, h * .19, w * .12, h * .23, w * .39, h * .60);
  c.bezierCurveTo(w * .57, h * .9, w * .85, h * .75, w * 1.17, h * 1.2);
  c.lineTo(w * 1.25, h * .54);
  c.bezierCurveTo(w * .55, h * .60, w * .42, h * .42, w * .85, -80);
  c.closePath(); c.fill(); c.restore();
  c.save(); c.filter = 'blur(8px)';
  const glow = c.createLinearGradient(0, 0, w, h);
  glow.addColorStop(0, color('aqua')); glow.addColorStop(.55, color('foam')); glow.addColorStop(1, 'transparent');
  c.strokeStyle = glow; c.lineWidth = 28; c.beginPath(); c.moveTo(w * .58, -50);
  c.bezierCurveTo(w * .58, h * .26, w * .18, h * .29, w * .35, h * .62);
  c.bezierCurveTo(w * .43, h * .82, w * .9, h * .82, w * 1.15, h * 1.2);
  c.stroke(); c.restore();
  const shade = c.createRadialGradient(w * .52, h * .45, 50, w * .5, h * .5, w * .76);
  shade.addColorStop(0, 'transparent'); shade.addColorStop(1, color('shade'));
  c.fillStyle = shade; c.fillRect(0, 0, w, h);
}
