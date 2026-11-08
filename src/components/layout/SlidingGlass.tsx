import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../../lib/store';
import '../../vendor/liquid-glass.js';
import type { LiquidGlass } from '../../vendor/liquid-glass.js';
import { paintNavScene } from '../../glass/nav-scene';
import { applyRefraction, refractSettings } from '../../glass/refract-settings';

/** 单个持久选中块。位置由路由驱动，快速切换时从当前显示位置继续移动。 */
export function SlidingGlass({ index, count, onSelect, children }: {
  index: number; count: number; onSelect: (index: number) => void; children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const paint = useRef<(duration?: number) => void>(() => {});
  const [position, setPosition] = useState<number | null>(null);
  const drag = useRef<{ id: number; start: number; startY: number; origin: number; moved: boolean; value: number; lastX: number; lastY: number; lastTime: number; velocity: number; velocityY: number } | null>(null);
  const suppressClick = useRef(false);
  const active = useStore((s) => s.settings.theme === 'liquid-glass-wc' && s.settings.perf !== 'saver' && s.settings.glassBlur);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const mq=matchMedia('(max-width: 1023px)');
    const update=()=>setMobile(mq.matches); mq.addEventListener('change', update);
    return ()=>mq.removeEventListener('change', update);
  }, []);
  const cancel = () => {
    const current=drag.current; drag.current=null; setPosition(null);
    paint.current(900);
    if(current && track.current?.hasPointerCapture(current.id)) track.current.releasePointerCapture(current.id);
  };
  useEffect(() => {
    window.addEventListener('resize', cancel); window.addEventListener('blur', cancel);
    return ()=>{window.removeEventListener('resize',cancel);window.removeEventListener('blur',cancel);};
  }, []);
  useEffect(() => { cancel(); }, [index]);
  useEffect(() => {
    const root=stage.current;
    if(!active || !mobile || !root) return;
    const glass=document.createElement('liquid-glass') as LiquidGlass;
    for(const [key,value] of Object.entries({draggable:'false','data-unbounded':'','navigation-content':'',shape:'capsule',refraction:'55',blur:'1',chromatic:'','aria-hidden':'true'}))glass.setAttribute(key,value);
    glass.tabIndex=-1; glass.style.pointerEvents='none';root.appendChild(glass);
    const source=document.createElement('canvas');
    let disposed=false, revision=0;
    let raf=0, until=0, last=0, stretch=0, speed=0, direction=0, lift=0, liftSpeed=0, dirty=true;
    let previousCenter: number | null=null;
    const draw=(now:number)=>{
      raf=0;
      if(dirty && track.current){
        dirty=false;
        applyRefraction(glass,useStore.getState().settings);
        // 取景留出折射余量，避免仅截取 52px 高底栏导致采样被边界截断。
        const request=++revision, frame=document.createElement('canvas');
        void paintNavScene(frame,root).then(ok=>{
          if(!ok||disposed||request!==revision)return;
          source.width=frame.width;source.height=frame.height;source.getContext('2d')!.drawImage(frame,0,0);
          glass.source=source;root.dataset.contentReady='true';kick(100);
        }).catch(()=>{if(!disposed)delete root.dataset.contentReady;});
      }
      const r=lens.current?.getBoundingClientRect(); const base=root.getBoundingClientRect();
      const dt=Math.min((now-(last||now-16))/1000,.032);last=now;
      const motion=document.documentElement.dataset.motion==='on'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
      const d=drag.current;
      // 只根据透镜的实际移动速度形变。停住（即使仍按下）也回到零形变。
      const age=d?now-d.lastTime:Infinity;
      const center=r?r.left+r.width/2:null;
      const slidingVelocity=center!==null&&previousCenter!==null?(center-previousCenter)/Math.max(8,dt*1000):0;
      previousCenter=center;
      // 点击切页时也按选中块的真实位移响应，轨迹结束后自动收敛。
      const velocity=d?(d.moved&&age<90?d.velocity*Math.exp(-age/90):0):slidingVelocity;
      const velocityY=d?.moved&&age<90?d.velocityY*Math.exp(-age/90):0;
      const elasticity=refractSettings(useStore.getState().settings).elasticity;
      const target=motion ? Math.min(.6,Math.abs(velocity)*.55)*elasticity : 0;
      // 二维速度带来很小的抬升与上下跟随；停住归零，不保留按压形变。
      const targetLift=motion ? (Math.tanh(velocityY*.8)*3-Math.min(2,Math.abs(velocity)*2))*elasticity : 0;
      if(motion){
        speed+=(target-stretch)*380*dt-speed*25*dt;stretch+=speed*dt;
        direction+=(Math.sign(velocity)-direction)*Math.min(1,dt*16);
        liftSpeed+=(targetLift-lift)*320*dt-liftSpeed*22*dt;lift+=liftSpeed*dt;
      }else{stretch=0;speed=0;direction=0;lift=0;liftSpeed=0;}
      if(r && base.width>0){
        const rest=r.width-4;
        const width=Math.max(1,rest*(1+stretch)),height=Math.max(1,r.height*(1-stretch*.26));
        const tail=(width-rest)*direction*.22;
        const x=Math.max(0,Math.min(base.width-width,r.left-base.left+r.width/2-width/2-tail));
        glass.setGeometry(x,r.top-base.top+(r.height-height)/2+lift,width,height);
      }
      const unsettled=Math.abs(target-stretch)>.0005||Math.abs(speed)>.005||Math.abs(targetLift-lift)>.005||Math.abs(liftSpeed)>.01;
      if(now<until||unsettled)raf=requestAnimationFrame(draw);else last=0;
    };
    const kick=(duration=0)=>{until=Math.max(until,performance.now()+duration);if(!raf)raf=requestAnimationFrame(draw);};
    paint.current=kick;
    const refresh=()=>{dirty=true;kick(300);};
    const ro=new ResizeObserver(refresh);ro.observe(root);
    // 不监听玻璃自身的逐帧尺寸，避免形成永久重绘循环。
    const observer=new MutationObserver(refresh);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','data-motion']});
    window.addEventListener('glass-background-change',refresh);
    const contentObserver=new MutationObserver(refresh);
    contentObserver.observe(root.parentElement!,{childList:true,characterData:true,subtree:true});
    for(const el of root.parentElement!.querySelectorAll('.nav-tab, .nav-tab-label'))
      contentObserver.observe(el,{attributes:true,attributeFilter:['aria-current','style','class']});
    const settled=(event:TransitionEvent)=>{if(event.propertyName==='color')refresh();};
    root.parentElement!.addEventListener('transitionend',settled);
    void document.fonts.ready.then(()=>{if(!disposed)refresh();});
    const unsubscribe=useStore.subscribe((state,prev)=>{if(state.settings.refract!==prev.settings.refract)refresh();});
    root.parentElement?.setAttribute('data-component-glass','true');
    kick(700);
    return ()=>{
      disposed=true;revision++;contentObserver.disconnect();root.parentElement?.removeEventListener('transitionend',settled);delete root.dataset.contentReady;
      cancelAnimationFrame(raf);ro.disconnect();observer.disconnect();unsubscribe();paint.current=()=>{};
      window.removeEventListener('glass-background-change',refresh);
      root.parentElement?.removeAttribute('data-component-glass');glass.remove();
    };
  }, [active,mobile]);
  useLayoutEffect(()=>{paint.current(position===null && document.documentElement.dataset.motion==='on' ? 700 : 0);},[index,position]);
  const down=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!e.isPrimary || e.button!==0 || drag.current)return;
    suppressClick.current=false;
    const r=e.currentTarget.getBoundingClientRect(), slot=r.width/count;
    const selected=lens.current!.getBoundingClientRect();
    const inSelected=e.clientX>=selected.left&&e.clientX<=selected.right;
    const origin=inSelected?(selected.left-r.left)/slot:Math.max(0,Math.min(count-1,Math.floor((e.clientX-r.left)/slot)));
    drag.current={id:e.pointerId,start:e.clientX,startY:e.clientY,origin,moved:false,value:origin,lastX:e.clientX,lastY:e.clientY,lastTime:performance.now(),velocity:0,velocityY:0};
  };
  const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=drag.current;if(!d||d.id!==e.pointerId)return;
    if(!d.moved && Math.hypot(e.clientX-d.start,e.clientY-d.startY)<5)return;
    if(!d.moved){d.moved=true;e.currentTarget.setPointerCapture(e.pointerId);}
    const slot=e.currentTarget.getBoundingClientRect().width/count;
    const now=performance.now();
    const next=Math.max(0,Math.min(count-1,d.origin+(e.clientX-d.start)/slot));
    const delta=(next-d.value)*slot;
    const deltaY=e.clientY-d.lastY;
    if(Math.abs(delta)>.01||Math.abs(deltaY)>.01){
      const elapsed=now-d.lastTime;
      d.velocity=(elapsed<90?d.velocity*.35:0)+delta/Math.max(8,elapsed)*.65;
      d.velocityY=(elapsed<90?d.velocityY*.35:0)+deltaY/Math.max(8,elapsed)*.65;
      d.lastTime=now;
    }
    d.lastX=e.clientX;d.lastY=e.clientY;d.value=next;
    setPosition(d.value);
    paint.current(450);
  };
  const up=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=drag.current;if(!d||d.id!==e.pointerId)return;
    const r=e.currentTarget.getBoundingClientRect();
    const commit=d.moved && e.clientY>=r.top-40&&e.clientY<=r.bottom+40;
    suppressClick.current=d.moved;cancel();
    if(commit)onSelect(Math.round(d.value));
  };
  return (
    <div ref={track} className="liquid-nav-track relative flex items-stretch" data-dragging={position!==null || undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={(e)=>{if(e.pointerId===drag.current?.id)cancel();}}
      onLostPointerCapture={(e)=>{if(e.target===e.currentTarget&&e.pointerId===drag.current?.id)cancel();}}
      onKeyDown={(e)=>{if(e.key==='Escape')cancel();}}
      onClickCapture={(e)=>{if(suppressClick.current&&e.detail!==0){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}}>
      <div ref={stage} aria-hidden className="nav-glass-stage pointer-events-none absolute inset-0" />
      <div ref={lens} aria-hidden className="nav-glass-position" data-active-index={index}
        style={{width:`${100/count}%`,transform:`translate3d(${(position??index)*100}%, 0, 0)`}}>
        <div className="nav-glass-body" />
      </div>
      {children}
    </div>
  );
}
