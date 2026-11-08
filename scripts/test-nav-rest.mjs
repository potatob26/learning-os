import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium,acknowledgeReleaseNotes} from './browser.mjs';
const out='.preview/nav-rest';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:625,height:700},hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));let n=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+name);n++;};
const glass=()=>page.locator('.nav-glass-stage liquid-glass');
const settle=()=>page.waitForTimeout(1100);
const icons=()=>page.locator('nav button > svg').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
try{
  await acknowledgeReleaseNotes(page);await page.goto('http://127.0.0.1:5188/#/timer');
  await page.waitForFunction(()=>window.__LOS__?.useStore.getState().hydrated);
  await page.evaluate(()=>{const s=window.__LOS__.useStore.getState();s.patchSettings({onboarded:true,theme:'liquid-glass-wc',perf:'high',motion:true,glassBlur:true});s.patchBackground({current:'scene:glass-flow',mode:'fixed',showVeil:true,grid:false});});
  await settle();
  check('内容纹理已就绪且使用导航专用小幅折射',await glass().evaluate(el=>el.parentElement.dataset.contentReady==='true'&&el.hasAttribute('navigation-content')));
  check('折射覆盖原图但原按钮仍可交互',await glass().evaluate(el=>getComputedStyle(el.parentElement).zIndex==='2'&&getComputedStyle(el.parentElement).pointerEvents==='none'&&getComputedStyle(document.querySelector('.nav-tab')).zIndex==='1'));
  // 选择跨越流光色带的大卡片做光学像素对照；底栏所在的深色平滑区不应凭空制造纹理。
  const pixels=await page.locator('.refract-layer liquid-glass').first().evaluate(el=>{
    const read=()=>{el.render();const gl=el._gl,canvas=el.shadowRoot.querySelector('canvas'),data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
    const refracted=read();el.setAttribute('refraction','0');el.removeAttribute('chromatic');const plain=read();el.setAttribute('refraction','55');el.setAttribute('chromatic','');
    let changed=0;for(let i=0;i<plain.length;i+=4)if(plain[i+3]>250&&Math.abs(plain[i]-refracted[i])+Math.abs(plain[i+1]-refracted[i+1])+Math.abs(plain[i+2]-refracted[i+2])>6)changed++;
    return changed;
  });
  check('原版折射确实改变流光背景像素',pixels>50);console.log('PIXELS '+pixels);
  await page.screenshot({path:`${out}/flow-timer.png`});
  const marker=await page.locator('.nav-glass-position').boundingBox(),x=marker.x+marker.width/2,y=marker.y+marker.height/2;
  const initialIcons=JSON.stringify(await icons());const widths=[];
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(250);
  check('只按住不移动时不拉伸',Math.abs((await glass().boundingBox()).width-marker.width+4)<1);
  for(let i=1;i<=8;i++){await page.mouse.move(x+marker.width*1.2*i/8,y);widths.push((await glass().boundingBox()).width);}
  check('移动过程中明显拉伸',Math.max(...widths)>(marker.width-4)*1.15);
  await page.locator('nav').screenshot({path:`${out}/moving.png`});
  await page.waitForTimeout(650);
  check('仍按住鼠标，停下后恢复原尺寸',Math.abs((await glass().boundingBox()).width-marker.width+4)<1);
  check('按住停顿不提前切页',await page.evaluate(()=>location.hash==='#/timer')&&await page.locator('.liquid-nav-track').getAttribute('data-dragging')==='true');
  await page.locator('nav').screenshot({path:`${out}/held-still.png`});
  const reverse=[];
  for(let i=1;i<=8;i++){await page.mouse.move(x+marker.width*1.2-marker.width*1.6*i/8,y);reverse.push((await glass().boundingBox()).width);}
  check('停顿后反向继续拖动重新拉伸',Math.max(...reverse)>(marker.width-4)*1.15);
  check('正反向拖动时五个图标位置完全固定',JSON.stringify(await icons())===initialIcons);
  await page.locator('nav').screenshot({path:`${out}/reverse.png`});
  await page.mouse.up();await settle();
  const cdp=await page.context().newCDPSession(page),r=await page.locator('.nav-glass-position').boundingBox(),tx=r.x+r.width/2,ty=r.y+r.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx-r.width*i/8,y:ty}]});
  await page.waitForTimeout(650);
  check('手指仍按住，停下后也恢复原尺寸',Math.abs((await glass().boundingBox()).width-r.width+4)<1);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
  check('触屏停顿后松开仍正常切页',await page.evaluate(()=>location.hash==='#/goals'));
  await glass().evaluate(el=>{el.__draws=0;const render=el.render.bind(el);el.render=()=>{el.__draws++;render();};});await page.waitForTimeout(1200);
  check('静止时不持续绘制',await glass().evaluate(el=>el.__draws)===0);
  await page.goto('http://127.0.0.1:5188/#/settings/background');await settle();
  await page.getByRole('button',{name:'流光',exact:true}).click();await page.reload();await settle();
  check('流光背景选择可保存并刷新恢复',await page.evaluate(()=>window.__LOS__.useStore.getState().background.current==='scene:glass-flow'));
  await page.screenshot({path:`${out}/flow-settings.png`});
  check('无运行时错误',errors.length===0);
  console.log(`${n}/${n} 通过`);
}finally{await browser.close();}
