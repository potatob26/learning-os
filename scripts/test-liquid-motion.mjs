import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';

const out='.preview/liquid-motion'; mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:412,height:915},colorScheme:'dark'});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
let count=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log(`PASS ${name}`);count++;};
const patch=(value)=>page.evaluate(value=>window.__LOS__.useStore.getState().patchSettings(value),value);
const nav=(name)=>page.locator('nav').getByRole('button',{name,exact:true});
const settle=()=>page.waitForTimeout(750);
const aligned=()=>page.evaluate(()=>{
  const lens=document.querySelector('.nav-glass-position').getBoundingClientRect();
  const tab=document.querySelector('nav [aria-current="page"]').getBoundingClientRect();
  return Math.abs(lens.x+lens.width/2-tab.x-tab.width/2)<1;
});
try {
  await acknowledgeReleaseNotes(page);
  await page.goto('http://127.0.0.1:5188/#/timer');
  await page.waitForFunction(()=>window.__LOS__?.useStore.getState().hydrated);
  await patch({onboarded:true,theme:'liquid-glass-wc',perf:'high',motion:true,glassBlur:true});
  await settle();
  await nav('计时').click(); await settle();
  check('计时主卡片真正渲染 WebGL',await page.locator('.refract-layer liquid-glass').evaluateAll(els=>els.length>0&&els.every(el=>el.shadowRoot.querySelector('.surface.rendered'))));
  check('折射层实际可见且不使用浏览器保留属性',await page.locator('.refract-layer liquid-glass').evaluateAll(els=>els.every(el=>getComputedStyle(el).visibility==='visible'&&!el.hasAttribute('unbounded'))));
  const kernel=s=>s.slice(s.indexOf('const fragment ='),s.indexOf('const shapes='));
  check('实际折射着色器与独立演示逐字一致',kernel(readFileSync('src/vendor/liquid-glass.js','utf8'))===kernel(readFileSync('src/vendor/liquid-glass.original.js','utf8')));
  await page.screenshot({path:`${out}/timer-glass.png`});
  await page.evaluate(()=>{
    window.__navFrames=[]; let start=performance.now();
    const tick=()=>{window.__navFrames.push(document.querySelector('.nav-glass-position').getBoundingClientRect().x);if(performance.now()-start<1100)requestAnimationFrame(tick);};tick();
  });
  await nav('目标').click(); await page.waitForTimeout(1200);
  const positions=await page.evaluate(()=>window.__navFrames);
  const start=positions[0],end=positions.at(-1);
  check('玻璃块经过中间位置而不是直接跳转',Math.abs(start-end)>20&&positions.some(x=>x>Math.min(start,end)+2&&x<Math.max(start,end)-2));
  check('最终对齐选中入口',await aligned());
  await nav('设置').click(); await page.waitForTimeout(70); await nav('目标').click(); await settle();
  check('快速反向切页只保留一个玻璃块且正确对齐',await page.locator('.nav-glass-position').count()===1&&await aligned());
  await page.goBack(); await settle(); check('浏览器返回同步选中块',await aligned());
  await page.setViewportSize({width:320,height:568}); await settle();
  check('窄屏入口至少44像素且没有横向溢出',await page.locator('nav button').evaluateAll(els=>els.every(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;}) )&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check('窗口变化后仍对齐',await aligned());
  await page.screenshot({path:`${out}/nav-small.png`});
  await page.emulateMedia({reducedMotion:'reduce'}); await settle();
  check('系统减少动画关闭滑动过渡',await page.locator('.nav-glass-position').evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration)<.001));
  await nav('计时').click(); await settle();
  check('减少动画仍能切页并保持对齐',await aligned());
  await patch({perf:'saver'}); await settle();
  check('省电模式释放全部 WebGL 且关闭模糊',await page.locator('liquid-glass').count()===0&&await page.locator('.nav-glass-body').evaluate(el=>getComputedStyle(el).backdropFilter==='none'));
  check('无运行时异常',errors.length===0);
  console.log(`\n${count}/${count} 通过`);
} finally { await browser.close(); }
