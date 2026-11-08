import assert from 'node:assert/strict';
import {chromium, acknowledgeReleaseNotes} from './browser.mjs';
const b=await chromium.launch({headless:true});let n=0;
const check=(name,ok,detail='')=>{assert.ok(ok,`${name}${detail?' — '+detail:''}`);console.log('PASS '+name+(detail?' — '+detail:''));n++;};
try {
 const p=await b.newPage({viewport:{width:625,height:700}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await acknowledgeReleaseNotes(p);await p.goto('http://127.0.0.1:5188/#/goals');
 await p.waitForFunction(()=>window.__LOS__?.useStore.getState().hydrated);
 await p.evaluate(()=>{const s=window.__LOS__.useStore.getState();s.patchSettings({onboarded:true,theme:'pure-light',colorMode:'dark'});s.patchBackground({current:'none'});});
 await p.waitForTimeout(1300);
 check('极简白深色变体使用浅色正文和深色卡片',await p.evaluate(()=>{const s=getComputedStyle(document.documentElement);return s.getPropertyValue('--text').trim()==='#f2f5fa'&&s.getPropertyValue('--surface').includes('26 30 40');}));
 await p.screenshot({path:'.preview/pure-light-dark-after128.png'});
 await p.evaluate(()=>window.__LOS__.useStore.getState().patchSettings({colorMode:'light'}));await p.waitForTimeout(700);
 /*
  * 断言「是深色」而不是「等于某个令牌值」。
  * 字体自适应恒常开启后，浅色背景上标题会落成 --adaptive-ink-dark(#101828)，
  * 而不是主题令牌 --text(#0b1220) —— 两者都是深色、视觉几乎无差别，
  * 写死具体值会让这条用例在以后调墨色时无谓地失败。
  * 真正要守的是「不能变成浅色」（那才是看不见）。
  */
 check('浅色变体恢复深色正文与说明文字',await p.locator('h1').evaluate(e=>{
   const [r,g,b]=getComputedStyle(e).color.match(/\d+/g).map(Number);
   const lum=[r,g,b].map(n=>{const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;})
     .reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
   return lum<0.1;
 }));

 /* ---------- 设置页：那两个开关应当已经不存在 ---------- */
 await p.goto('http://127.0.0.1:5188/#/settings/appearance');
 await p.waitForTimeout(700);
 check('「字体随背景改变」开关已删除',
   await p.getByRole('switch',{name:/^字体随背景改变/}).count()===0);
 check('「液态玻璃主题」开关已删除',
   await p.getByRole('switch',{name:/^液态玻璃主题/}).count()===0);
 // 删掉开关不能把「能不能选液态玻璃」这个能力也删掉 —— 主题网格里必须还有它
 check('主题网格里仍能直接选到液态玻璃',
   await p.getByRole('button',{name:/液态玻璃/}).count()>0);
 check('设置里不再残留这两个字段',
   await p.evaluate(()=>{const s=window.__LOS__.useStore.getState().settings;return s.adaptiveText===undefined&&s.previousTheme===undefined;}));

 /*
  * 字体自适应现在是**恒常开启**：下面全程没有点过任何开关，
  * 直接换背景就应该跟着变 —— 这正是删掉开关后要保证的行为。
  */
 await p.goto('http://127.0.0.1:5188/#/goals');
 const image=async(color)=>{
  await p.evaluate(color=>{const c=document.createElement('canvas');c.width=625;c.height=700;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,625,700);const s=window.__LOS__.useStore.getState();s.patchBackground({mode:'fixed',current:'img:contrast-'+color,custom:[{id:'contrast-'+color,dataUrl:c.toDataURL(),name:'对比度测试'}],dim:0,dimAuto:false,showVeil:false,grid:false});},color);
  await p.waitForTimeout(1000);
 };
 await image('#000000');
 check('无需开关，暗背景上的标题自动变为浅色',await p.locator('h1').evaluate(e=>getComputedStyle(e).color==='rgb(248, 250, 252)'));
 check('浅色卡片上的说明保持深色',await p.getByText('今天还没有要做的目标',{exact:true}).evaluate(e=>getComputedStyle(e).color==='rgb(16, 24, 40)'));
 await p.screenshot({path:'.preview/adaptive-dark-background128.png'});
 await image('#ffffff');
 check('切换亮背景后标题自动变深',await p.locator('h1').evaluate(e=>getComputedStyle(e).color==='rgb(16, 24, 40)'));
 await p.screenshot({path:'.preview/adaptive-light-background128.png'});
 await p.reload();await p.waitForTimeout(1300);
 check('刷新后继续自适应（不再有开关可丢）',await p.locator('h1').evaluate(e=>getComputedStyle(e).color==='rgb(16, 24, 40)'));

 /* 那条「折射已暂停」提示原来挂在被删的开关下面，必须仍然看得到 */
 await p.evaluate(()=>window.__LOS__.useStore.getState().patchSettings({theme:'liquid-glass-wc',perf:'saver'}));
 await p.goto('http://127.0.0.1:5188/#/settings/appearance');
 await p.waitForTimeout(900);
 check('删除开关后「折射已暂停」提示仍在',
   await p.getByText(/当前已暂停折射效果/).count()>0);

 check('无运行时错误',errors.length===0);console.log(n+'/'+n+' 通过');
}finally{await b.close();}
