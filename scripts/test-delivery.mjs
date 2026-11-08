import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, acknowledgeReleaseNotes } from './browser.mjs';
/*
 * 版本号从 package.json 算，不写死。
 * 原来这里写死 '本次更新 · v1.2.11' —— 版本升上去之后这个断言必然找不到弹窗，
 * 和 test-update 之前那次腐烂是同一个毛病。
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({ viewport: {width:412,height:915} });
  await page.goto('http://127.0.0.1:5189/');
  await page.getByRole('button', {name:'继续',exact:true}).click();
  await page.getByRole('button', {name:'继续',exact:true}).click();
  await page.getByRole('button', {name:'开始使用',exact:true}).click();
  const notice=page.getByRole('dialog', {name:`本次更新 · v${pkg.version}`});
  await notice.waitFor(); await page.waitForTimeout(700);
  await page.screenshot({path:'.preview/update/production-notice.png'});
  // 用标题文字的实际范围测量像素，防止透明弹层透出底页导致公告看不清。
  const clip = await notice.locator('h2').evaluate((el) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const r = range.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height };
  });
  const shot = await page.screenshot({clip});
  const contrast = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    const pixels=ctx.getImageData(0,0,img.width,img.height).data;const light=[];
    const linear=(n)=>{n/=255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;};
    for(let i=0;i<pixels.length;i+=4)light.push(.2126*linear(pixels[i])+.7152*linear(pixels[i+1])+.0722*linear(pixels[i+2]));
    light.sort((a,b)=>a-b);return (light[Math.floor(light.length*.9)]+.05)/(light[Math.floor(light.length*.1)]+.05);
  },`data:image/png;base64,${shot.toString('base64')}`);
  assert.ok(contrast>=4.5,`公告标题像素对比度 ${contrast}`);
  await page.getByRole('button', {name:'知道了，开始使用'}).click();
  await page.goto('http://127.0.0.1:5189/#/settings/appearance');
  // 「液态玻璃主题」开关已删除，改为在主题网格里直接选中液态玻璃
  await page.getByRole('button', {name:/^液态玻璃/}).click();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(()=>window.__LOS__.useStore.getState().settings.theme),'liquid-glass-wc');
  // 保存是异步的；持久化回归先确认两份存储完成，避免把保存中的快照当作完成状态。
  await page.waitForFunction(()=>new Promise(resolve=>{
    const request=indexedDB.open('learning-os-db');
    request.onerror=()=>resolve(false);
    request.onsuccess=()=>{const db=request.result,read=db.transaction('kv').objectStore('kv').get('learning-os:v1:state');
      read.onsuccess=()=>{const ok=read.result?.settings?.theme==='liquid-glass-wc';db.close();resolve(ok);};read.onerror=()=>{db.close();resolve(false);};};
  }),null,{timeout:10000});
  await page.reload();
  await page.waitForFunction(()=>[...document.querySelectorAll('liquid-glass')].some(el=>el.shadowRoot.querySelector('.surface.rendered')),null,{timeout:10000}).catch(async error=>{
    console.log('折射就绪诊断',await page.evaluate(()=>({theme:document.documentElement.dataset.theme,blur:document.documentElement.dataset.blur,glass:[...document.querySelectorAll('liquid-glass')].map(el=>({source:!!el.source,contextLost:el._gl?.isContextLost(),warned:el._warned})),text:document.body.innerText.slice(0,450)})));
    await page.screenshot({path:'.preview/update/production-render-failure.png'});throw error;
  });
  assert.equal(await notice.count(),0);
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('liquid-glass')].some(el=>el.shadowRoot.querySelector('.surface.rendered'))));
  await page.screenshot({path:'.preview/update/production-settings.png'});
  console.log('PASS 正式构建：引导、更新公告、开关持久化和真实折射渲染');
  const dev = await browser.newPage(); await acknowledgeReleaseNotes(dev);
  await dev.goto('http://127.0.0.1:5188/');
  const result = await dev.evaluate(async()=>{
    const {mountModal}=await import('/src/lib/modal-stack.ts');
    const app=document.querySelector('#root');
    const make=()=>{const root=document.createElement('div');const panel=document.createElement('div');panel.tabIndex=-1;root.append(panel);document.body.append(root);return {root,panel};};
    const first=make();let firstClosed=0;let secondClosed=0;
    const releaseFirst=mountModal(first.root,first.panel,()=>{firstClosed++;releaseFirst();first.root.remove();},null);
    const second=make();
    const releaseSecond=mountModal(second.root,second.panel,()=>{secondClosed++;releaseSecond();second.root.remove();},first.panel);
    const isolated=app.inert&&first.root.inert&&!second.root.inert&&first.root.style.visibility==='hidden';
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    const innerClosed=firstClosed===0&&secondClosed===1&&document.body.style.overflow==='hidden'&&!first.root.inert&&app.inert&&document.activeElement===first.panel;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    return {isolated,innerClosed,released:firstClosed===1&&!app.inert&&document.body.style.overflow!=='hidden'};
  });
  assert.ok(result.isolated&&result.innerClosed&&result.released,JSON.stringify(result));
  console.log('PASS 嵌套弹层：只显示顶层、Escape 逐层关闭、保持滚动锁并恢复焦点');
} finally {await browser.close();}
