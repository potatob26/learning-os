import { RotateCcw, Sparkles } from 'lucide-react';
import { useStore } from '../../lib/store';
import { DEFAULT_REFRACT, refractSettings } from '../../glass/refract-settings';
import { Card, CardTitle } from '../ui/Card';
import { GlassSurface } from '../ui/GlassSurface';
import { Switch } from '../ui/Switch';

export function RefractSettings() {
  const settings=useStore(s=>s.settings);
  const patch=useStore(s=>s.patchSettings);
  const value=refractSettings(settings);
  const set=(v:Partial<typeof value>)=>patch({refract:{...value,...v}});
  const suspended=settings.perf==='saver'||!settings.glassBlur;
  return <div className="space-y-3" data-refract-settings>
    <section className="p-4">
      <CardTitle icon={<Sparkles />} title="透明玻璃预览" subtitle="与底栏、重点卡片和弹层使用同一套折射效果" />
      <GlassSurface tier="refract" radius={24} contentClassName="px-5 py-6">
        <p className="text-2xl font-semibold">透明玻璃</p>
        <p className="mt-1 text-xs text-secondary">当前背景 · 实时预览</p>
      </GlassSurface>
      {suspended&&<p className="mt-3 text-xs text-secondary">当前为实色预览。退出省电并开启玻璃模糊后，可看到保存的参数效果。</p>}
    </section>
    <Card tier="solid" padding="md">
      <CardTitle title="透明玻璃参数" subtitle="立即应用到当前页面和底栏，并保存到本机" action={
        <button type="button" onClick={()=>patch({refract:{...DEFAULT_REFRACT}})} className="flex min-h-11 items-center gap-1 rounded-full bg-[var(--surface-sunken)] px-3 text-xs text-secondary">
          <RotateCcw className="size-4" />恢复默认
        </button>} />
      <div className="space-y-4">
        {([
          {key:'strength',label:'折射强度',max:100,step:1,desc:'控制边缘弯折；背景有纹理或色带时更明显。'},
          {key:'blur',label:'折射模糊',max:8,step:.25,desc:'0 最清澈，数值越大越柔和。'},
          {key:'elasticity',label:'拖动弹性',max:1.5,step:.05,desc:'控制底栏移动时的拉伸和小幅上下回弹；停下即恢复。'},
        ] as const).map(item=><label key={item.key} className="block text-sm font-medium">
          <span className="flex justify-between gap-3"><span>{item.label}</span><span className="tnum text-secondary">{value[item.key]}{item.key==='blur'?'px':''}</span></span>
          <input aria-label={item.label} type="range" min={0} max={item.max} step={item.step} value={value[item.key]} onChange={e=>set({[item.key]:Number(e.target.value)})} className="h-11 w-full accent-[var(--accent)]" />
          <span className="block text-xs font-normal leading-relaxed text-secondary">{item.desc}</span>
        </label>)}
        <Switch label="边缘色散" desc="在玻璃边缘显示轻微色彩分离" checked={value.chromatic} onChange={chromatic=>set({chromatic})} />
      </div>
    </Card>
  </div>;
}
