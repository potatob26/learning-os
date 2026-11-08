import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium,acknowledgeReleaseNotes} from './browser.mjs';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const out='.preview/nav-material';mkdirSync(out,{recursive:true});
let n=0;const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+name);n++;};
try{
 const page=await browser.newPage({viewport:{width:625,height:700},hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await acknowledgeReleaseNotes(page);await page.goto('http://127.0.0.1:5188/#/timer');
 await page.waitForFunction(()=>window.__LOS__?.useStore.getState().hydrated);
 await page.evaluate(()=>{const s=window.__LOS__.useStore.getState();s.patchSettings({onboarded:true,theme:'liquid-glass-wc',perf:'high',glassBlur:true,motion:true});s.patchBackground({current:'scene:glass-flow',grid:true,showVeil:true});});
 await page.waitForTimeout(1200);
 const lens=page.locator('.nav-glass-stage liquid-glass'),base=lens;
 check('仅移动选中块为可见的原版折射组件',await page.locator('.app-nav-material liquid-glass').evaluateAll(els=>els.length===1&&els.every(e=>e.shadowRoot.querySelector('.surface.rendered')&&getComputedStyle(e).visibility==='visible')));
 check('底座恢复普通材质且没有第二块折射',await page.locator('.nav-base-stage').count()===0&&await page.locator('.app-nav-material').evaluate(e=>getComputedStyle(e).backdropFilter!=='none'));
 const changed=await base.evaluate(el=>{
  const read=()=>{el.render();const gl=el._gl,c=el.shadowRoot.querySelector('canvas'),d=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,d);return d;};
  const a=read();el.setAttribute('refraction','0');const b=read();el.setAttribute('refraction','55');
  let n=0;for(let i=0;i<a.length;i+=4)if(a[i+3]>250&&Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>5)n++;return n;
 });
 check('移动块折射实际改变带纹理背景像素',changed>100);console.log('PIXELS',changed);
 await page.evaluate(()=>{
  window.__clickY=0;const start=performance.now();
  const sample=()=>{const g=document.querySelector('.nav-glass-stage liquid-glass').getBoundingClientRect(),t=document.querySelector('.liquid-nav-track').getBoundingClientRect();window.__clickY=Math.max(window.__clickY,Math.abs(g.y+g.height/2-t.y-t.height/2));if(performance.now()-start<1000)requestAnimationFrame(sample);};requestAnimationFrame(sample);
 });
 await page.locator('nav').getByRole('button',{name:'首页',exact:true}).click();
 await page.waitForTimeout(1050);
 const clickY=await page.evaluate(()=>window.__clickY);
 console.log('CLICK_Y',clickY);
 check('点击切换也有轻微上下回弹',clickY>.2&&clickY<8);
 await page.locator('nav').getByRole('button',{name:'计时',exact:true}).click();await page.waitForTimeout(1400);
 const track=await page.locator('.liquid-nav-track').boundingBox();const r=await lens.boundingBox();
 const x=r.x+r.width/2,y=r.y+r.height/2;
 await page.mouse.move(x,y);await page.mouse.down();let maxY=0;
 for(let i=1;i<=10;i++){
  await page.mouse.move(x+i*5,y-i*2);await page.waitForTimeout(12);
  const g=await lens.boundingBox();maxY=Math.max(maxY,Math.abs(g.y+g.height/2-(track.y+track.height/2)));
 }
 check('斜向拖动有小幅上下跟随而非仅横向形变',maxY>.4&&maxY<8);console.log('Y',maxY);
 await page.screenshot({path:out+'/moving.png'});
 await page.waitForTimeout(800);const held=await lens.boundingBox();
 check('仍按住但停下后上下偏移和形变归零',Math.abs(held.y+held.height/2-(track.y+track.height/2))<.15&&Math.abs(held.height-r.height)<.2&&Math.abs(held.width-r.width)<.2);
 await page.mouse.up();await page.waitForTimeout(1000);
 await page.goto('http://127.0.0.1:5188/#/settings');
 const panel=page.locator('[data-refract-settings]');await panel.getByRole('slider',{name:'折射强度',exact:true}).press('End');
 await page.waitForTimeout(400);
 check('液态参数同时应用到预览和选中块',await page.locator('liquid-glass').evaluateAll(els=>els.length>=2&&els.every(e=>e.getAttribute('refraction')==='100')));
 await panel.getByRole('slider',{name:'折射模糊',exact:true}).press('Home');
 await panel.getByRole('switch',{name:/^边缘色散/}).click();await page.waitForTimeout(300);
 check('模糊和色散开关直接控制真实组件',await page.locator('liquid-glass').evaluateAll(els=>els.every(e=>e.getAttribute('blur')==='0'&&!e.hasAttribute('chromatic'))));
 await page.reload();await page.waitForTimeout(1200);
 check('刷新保留液态参数',await page.evaluate(()=>{const v=window.__LOS__.useStore.getState().settings.refract;return v.strength===100&&v.blur===0&&!v.chromatic;}));
 await panel.getByRole('button',{name:'恢复默认',exact:true}).click();await page.waitForTimeout(350);
 check('恢复默认同步还原全部实际组件',await page.locator('liquid-glass').evaluateAll(els=>els.every(e=>e.getAttribute('refraction')==='55'&&e.getAttribute('blur')==='1'&&e.hasAttribute('chromatic'))));
 await page.screenshot({path:out+'/settings.png'});
 check('设置页最多六个页面与底栏上下文',await page.locator('liquid-glass').count()<=6);
 /*
  * 原来是点「液态玻璃主题」开关来切进切出玻璃主题；那个开关已删除，
  * 改成在主题网格里选另一个主题再选回来 —— 验的还是同一件事：
  * 底栏折射跟着主题走，且重新选回时只恢复成一整块移动玻璃。
  */
 await page.getByRole('button',{name:/^极简白/}).click();await page.waitForTimeout(500);
 check('换到非玻璃主题同步移除底栏折射',await page.locator('.app-nav-material liquid-glass').count()===0);
 await page.getByRole('button',{name:/^液态玻璃/}).click();await page.waitForTimeout(1200);
 check('重新选回液态玻璃完整恢复单块移动玻璃',await page.locator('.app-nav-material liquid-glass').count()===1);
 check('没有运行时错误',errors.length===0);
 console.log(n+'/'+n+' 通过');
}finally{await browser.close();}
