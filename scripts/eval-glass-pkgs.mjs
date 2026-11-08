/**
 * 评估候选 Liquid Glass 方案的真实元数据
 * 只看 npm 事实：维护状态、体积、依赖、是否有仓库
 */
const CANDIDATES = [
  'liquid-glass-react',
  '@dpawlikowski/liquid-glass',
  '@samasante/liquid-glass',
  '@real-human/liquid-glass',
  'simple-liquid-glass',
  '@tomagranate/liquid-glass',
  '@khoivudev/liquid-glass-react',
  'liquid-glass',
  'glass-ui',
  '@lollipopkit/liquid-glass',
];

const now = Date.now();

for (const name of CANDIDATES) {
  try {
    const meta = await (await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)).json();
    if (meta.error) {
      console.log(`✗ ${name.padEnd(32)} 不存在`);
      continue;
    }
    const latest = meta['dist-tags']?.latest;
    const v = meta.versions?.[latest] ?? {};
    const published = meta.time?.[latest] ? new Date(meta.time[latest]) : null;
    const days = published ? Math.round((now - published.getTime()) / 86400000) : null;
    const versions = Object.keys(meta.versions ?? {}).length;
    const size = v.dist?.unpackedSize ? (v.dist.unpackedSize / 1024).toFixed(0) + 'KB' : '?';
    const deps = Object.keys(v.dependencies ?? {}).length;
    const repo = v.repository?.url ? '有仓库' : '无仓库';

    // 周下载量
    let dl = '?';
    try {
      const d = await (await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`)).json();
      dl = d.downloads ?? '?';
    } catch { /* 忽略 */ }

    console.log(
      `${name.padEnd(32)} v${String(latest).padEnd(9)} ${String(days).padStart(5)}天前  ` +
        `${size.padStart(7)}  依赖${String(deps).padStart(2)}  版本${String(versions).padStart(3)}  ` +
        `周下载${String(dl).padStart(8)}  ${repo}`,
    );
    if (days !== null && days < 60 && Number(dl) > 500) {
      console.log(`      ↑ 近期活跃且有实际使用量`);
    }
  } catch (e) {
    console.log(`✗ ${name.padEnd(32)} 查询失败: ${String(e.message).slice(0, 40)}`);
  }
}
