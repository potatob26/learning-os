import assert from 'node:assert/strict';
import {chromium,acknowledgeReleaseNotes} from './browser.mjs';
import {mkdirSync} from 'node:fs';
const b=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
mkdirSync('.preview/nav-content',{recursive:true});let n=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+name);n++;};
try {
 const p=await b.newPage({viewport:{width:625,height:700},deviceScaleFactor:2,hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await acknowledgeReleaseNotes(p);await p.goto('http://127.0.0.1:5188/#/timer');
 await p.waitForFunction(()=>window.__LOS__?.useStore.getState().hydrated);
 await p.evaluate(()=>{const s=window.__LOS__.useStore.getState();s.patchSettings({onboarded:true,theme:'liquid-glass-wc',perf:'high',motion:true,glassBlur:true});s.patchBackground({current:'scene:glass-flow',grid:false,showVeil:true});});
 const lens=p.locator('.nav-glass-stage liquid-glass');
 await p.waitForFunction(()=>document.querySelector('.nav-glass-stage')?.dataset.contentReady==='true');await p.waitForTimeout(1000);
 check('五个原按钮保持可访问',await p.locator('nav .nav-tab').count()===5);
 check('固定底座没有添加折射实例',await p.locator('.nav-base-stage').count()===0&&await p.locator('nav liquid-glass').count()===1);
 const changes=await lens.evaluate(el=>{
  const read=()=>{el.render();const g=el._gl,c=el.shadowRoot.querySelector('canvas'),d=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,d);return {d,w:c.width,h:c.height};};
  const normal=read();el.setAttribute('refraction','0');const plain=read();el.setAttribute('refraction','55');
  const r=el.getBoundingClientRect(),scale=normal.w/r.width;
  return ['svg','.nav-tab-label'].map(selector=>{
   const box=document.querySelector('nav [aria-current="page"] '+selector).getBoundingClientRect();let changed=0,ink=0;
   for(let y=Math.max(2,Math.floor((box.top-r.top)*scale)-2);y<Math.min(normal.h-2,Math.ceil((box.bottom-r.top)*scale)+2);y++)for(let x=Math.max(2,Math.floor((box.left-r.left)*scale)-3);x<Math.min(normal.w-2,Math.ceil((box.right-r.left)*scale)+3);x++){
    const i=((normal.h-1-y)*normal.w+x)*4;
    if(plain.d[i+3]>250&&Math.max(plain.d[i],plain.d[i+1],plain.d[i+2])>140){ink++;if(Math.abs(normal.d[i]-plain.d[i])+Math.abs(normal.d[i+1]-plain.d[i+1])+Math.abs(normal.d[i+2]-plain.d[i+2])>24)changed++;}
   }return {selector,ink,changed};
  });
 });console.log(changes);
 check('纯流光背景下图标笔画实际发生折射',changes[0].changed>30);
 check('栏目文字笔画实际发生折射',changes[1].changed>30);
 await p.screenshot({path:'.preview/nav-content/rest.png'});
 const original=await lens.evaluate(e=>e.source.toDataURL());
 const before=await p.locator('.nav-tab > svg').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
 const r=await lens.boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+28,r.y+r.height/2,{steps:10});
 await p.screenshot({path:'.preview/nav-content/drag.png'});
 check('拖动时纹理固定，没有追着玻璃重排入口',await lens.evaluate((e,data)=>e.source.toDataURL()===data,original));
 check('玻璃外原始图标坐标保持不动',JSON.stringify(before)===JSON.stringify(await p.locator('.nav-tab > svg').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()))));
 check('折射层在原图上方且不拦截点击',await lens.evaluate(e=>getComputedStyle(e.parentElement).zIndex==='2'&&getComputedStyle(e.parentElement).pointerEvents==='none'));
 await p.mouse.up();await p.waitForTimeout(1000);
 await p.locator('nav').getByRole('button',{name:'设置',exact:true}).click();await p.waitForTimeout(1100);
 check('点击切页和纹理刷新正常',await p.locator('nav [aria-current="page"]').innerText()==='设置'&&await lens.evaluate(e=>e.parentElement.dataset.contentReady==='true'));
 check('无运行时错误',errors.length===0);console.log(n+'/'+n+' 通过');
}finally{await b.close();}
