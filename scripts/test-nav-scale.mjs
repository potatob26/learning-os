import assert from 'node:assert/strict';
import {chromium,acknowledgeReleaseNotes} from './browser.mjs';
import {mkdirSync} from 'node:fs';
const b=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let count=0;const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+name);count++;};
mkdirSync('.preview/nav-scale',{recursive:true});
try{
 for(const dpr of [1,1.5,2]){
  const p=await b.newPage({viewport:{width:640,height:605},deviceScaleFactor:dpr});
  await acknowledgeReleaseNotes(p);await p.goto('http://127.0.0.1:5188/#/goals');
  await p.waitForFunction(()=>window.__LOS__?.useStore.getState().hydrated);
  await p.evaluate(()=>{const s=window.__LOS__.useStore.getState();s.patchSettings({onboarded:true,theme:'liquid-glass-wc',perf:'high',motion:true,glassBlur:true});s.patchBackground({current:'scene:glass-flow',grid:false});});
  await p.waitForFunction(()=>document.querySelector('.nav-glass-stage')?.dataset.contentReady==='true');
  await p.locator('.app-nav-material').evaluate(e=>e.style.width='439.375px');await p.waitForTimeout(900);
  const result=await p.evaluate(()=>{
   const el=document.querySelector('.nav-glass-stage liquid-glass'),gl=el._gl,stage=el.parentElement,r=stage.getBoundingClientRect();
   const scene=Array.from(gl.getUniform(el._program,el._uniforms.scene));
   // 用坐标渐变代替纹理，在真实 GPU 输出中测量边缘采样跳变。
   const source=document.createElement('canvas');source.width=Math.round(r.width*2);source.height=Math.round(r.height*2);
   const ctx=source.getContext('2d'),pixels=ctx.createImageData(source.width,source.height);
   for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const i=(y*source.width+x)*4;pixels.data[i]=x/source.width*255;pixels.data[i+1]=y/source.height*255;pixels.data[i+2]=0;pixels.data[i+3]=255;}
   ctx.putImageData(pixels,0,0);el.source=source;el.setAttribute('blur','0');el.removeAttribute('chromatic');
   const read=()=>{el.render();const c=el._canvas,data=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return {data,w:c.width,h:c.height};};
   const cases=[];
   for(const [w,h] of [[82,52],[126,42],[64,52]]){
    el.setGeometry(170,64,w,h);el.setAttribute('refraction','0');const plain=read();el.setAttribute('refraction','100');const bent=read();
    let edge=0,inside=0;
    for(let y=1;y<bent.h-1;y++){
     const i=(y*bent.w+Math.floor(bent.w/2))*4;
     const change=Math.abs(plain.data[i+1]-bent.data[i+1])*r.height/255/.975;
     if(y<2*devicePixelRatio||y>bent.h-2*devicePixelRatio-1)edge=Math.max(edge,change);else inside=Math.max(inside,change);
    }
    cases.push({w,h,edge,inside});
   }
   return {scene,rect:[r.width,r.height],cases};
  });console.log('DPR',dpr,result);
  check(`DPR ${dpr} 小数尺寸精确对应纹理`,result.scene.every((n,i)=>Math.abs(n-result.rect[i])<.001));
  // 用户要求恢复原组件的强边缘折射，替代 v1.2.10 的边缘归零目标。
  check(`DPR ${dpr} 强折射及拉伸状态的边缘确实弯折`,result.cases.every(c=>c.edge>3&&c.edge<16));
  check(`DPR ${dpr} 折射在边缘最强`,result.cases.every(c=>c.edge>c.inside));
  await p.reload();await p.waitForFunction(()=>document.querySelector('.nav-glass-stage')?.dataset.contentReady==='true');await p.waitForTimeout(1000);
  await p.locator('.app-nav-material').screenshot({path:`.preview/nav-scale/after-${dpr}.png`});
  if(dpr===1.5){const box=await p.locator('.nav-glass-stage liquid-glass').boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2+32,box.y+box.height/2+2,{steps:8});await p.locator('.app-nav-material').screenshot({path:'.preview/nav-scale/after-drag.png'});await p.mouse.up();}
  await p.close();
 }
 console.log(`${count}/${count} 通过`);
}finally{await b.close();}
