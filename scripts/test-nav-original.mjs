import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium,acknowledgeReleaseNotes} from './browser.mjs';
// 独立组件原文件作为参考，不复制导航的曲线实现来生成期望值。
const original=readFileSync(new URL('../src/vendor/liquid-glass.original.js',import.meta.url),'utf8');
const b=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const p=await b.newPage({viewport:{width:640,height:700},deviceScaleFactor:2});
 await acknowledgeReleaseNotes(p);await p.goto('http://127.0.0.1:5188/#/goals');
 await p.waitForFunction(()=>window.__LOS__?.useStore.getState().hydrated);
 await p.evaluate(()=>window.__LOS__.useStore.getState().patchSettings({onboarded:true,theme:'liquid-glass-wc',perf:'high',glassBlur:true}));
 await p.waitForFunction(()=>document.querySelector('.nav-glass-stage')?.dataset.contentReady==='true');await p.waitForTimeout(800);
 await p.addScriptTag({content:original.replaceAll('LiquidGlass','ReferenceLiquidGlass').replaceAll("'liquid-glass'","'reference-liquid-glass'")});
 const result=await p.evaluate(()=>{
  const nav=document.querySelector('.nav-glass-stage liquid-glass'),stage=nav.parentElement,r=stage.getBoundingClientRect();
  const source=document.createElement('canvas');source.width=r.width*2;source.height=r.height*2;
  const ctx=source.getContext('2d'),data=ctx.createImageData(source.width,source.height);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const i=(y*source.width+x)*4;data.data[i]=100+Math.sin(x*.05)*60;data.data[i+1]=100+Math.sin(y*.05)*60;data.data[i+2]=80;data.data[i+3]=255;}ctx.putImageData(data,0,0);
  nav.source=source;nav.setAttribute('blur','1');nav.setAttribute('chromatic','');
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(host);
  const ref=document.createElement('reference-liquid-glass');ref.setAttribute('shape','capsule');ref.setAttribute('blur','1');ref.setAttribute('chromatic','');host.append(ref);
  const read=el=>{el.render();const gl=el._gl,c=el._canvas,d=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,d);return {d,w:c.width,h:c.height};};
  const results=[];
  for(const [w,h] of [[82,52],[126,42],[64,52]])for(const strength of [55,100]){
   const scale=h/240;host.style.width=`${r.width/scale}px`;host.style.height=`${r.height/scale}px`;
   ref.setAttribute('width',String(w/scale));ref.setAttribute('height','240');ref.setAttribute('refraction',String(strength));ref.source=source;ref.setPosition(170/scale,64/scale);
   nav.setGeometry(170,64,w,h);nav.setAttribute('refraction',String(strength));const a=read(nav),z=read(ref);
   const samples=[];
   // 左右边缘、上下边缘和中心分别对照真实原版 GPU 输出。
   for(const [x,y] of [[2,h/2],[4,h/2],[w-3,h/2],[w-5,h/2],[w/2,2],[w/2,h-3],[w/2,h/2]]){
    const ax=Math.floor(x/w*a.w),ay=Math.floor(y/h*a.h),zx=Math.floor((ax+.5)/a.w*z.w),zy=Math.floor((ay+.5)/a.h*z.h);
    const ai=(ay*a.w+ax)*4,zi=(zy*z.w+zx)*4;let diff=0;for(let c=0;c<3;c++)diff+=Math.abs(a.d[ai+c]-z.d[zi+c]);samples.push(diff/3);
   }
   results.push({w,h,strength,maxError:Math.max(...samples),meanError:samples.reduce((a,b)=>a+b)/samples.length});
  }
  ref.remove();host.remove();return results;
 });
 for(const r of result){console.log(r);assert.ok(r.maxError<8&&r.meanError<3,'导航光学输出应与等比原组件一致');}
 console.log('6/6 原组件光学对照通过');
}finally{await b.close();}
