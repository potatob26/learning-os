/**
 * 语句库自检：总数、各语气分布、重复、长度异常
 */
import { QUOTES, QUOTE_COUNT } from '../src/lib/quotes.ts';

const tones = ['gentle', 'calm', 'plain', 'useful', 'humor', 'drive'];

console.log('=== 各语气数量 ===');
for (const t of tones) {
  const n = QUOTES.filter((q) => q.tone === t).length;
  console.log(`  ${t.padEnd(8)} ${String(n).padStart(3)} 句`);
  if (n === 0) console.log(`    ⚠️  语气 ${t} 没有语句`);
}
console.log(`\n合计 ${QUOTE_COUNT} 句`);

// id 唯一性
const ids = new Set(QUOTES.map((q) => q.id));
console.log(`id 唯一: ${ids.size === QUOTES.length ? '是' : `否（${QUOTES.length - ids.size} 个重复）`}`);

// 文本重复
const seen = new Map();
const dups = [];
for (const q of QUOTES) {
  if (seen.has(q.text)) dups.push(q.text);
  else seen.set(q.text, q.id);
}
console.log(`文本重复: ${dups.length === 0 ? '无' : dups.length + ' 条'}`);
if (dups.length) dups.slice(0, 5).forEach((d) => console.log(`   · ${d}`));

// 长度异常。
// plain（简洁）语气本来就该是一两个词，例如「继续。」「现在。」，
// 所以只对其它语气检查长度下限。
const tooShort = QUOTES.filter(
  (q) => q.tone !== 'plain' && q.text.replace(/[，。！？、；：""'']/g, '').length < 4,
);
const tooLong = QUOTES.filter((q) => q.text.length > 34);
console.log(`过短（非简洁语气，<4 字）: ${tooShort.length}`);
tooShort.slice(0, 5).forEach((q) => console.log(`   · [${q.tone}] ${q.text}`));
console.log(`过长（>34 字）: ${tooLong.length}`);
tooLong.slice(0, 5).forEach((q) => console.log(`   · ${q.text}`));
const shortest = [...QUOTES].sort((a, b) => a.text.length - b.text.length)[0];
console.log(`最短一句: ${shortest.text}`);

// 含感叹号（基调是克制，不该靠感叹号堆情绪）
const bangs = QUOTES.filter((q) => /[!！]/.test(q.text));
console.log(`含感叹号: ${bangs.length}`);
bangs.slice(0, 8).forEach((q) => console.log(`   · ${q.text}`));

// 语气分布是否均衡（轮换时不应长期偏向某一种）
const counts = tones.map((t) => QUOTES.filter((q) => q.tone === t).length);
const min = Math.min(...counts);
const max = Math.max(...counts);
console.log(`\n分布均衡度: 最少 ${min} / 最多 ${max}（差值 ${max - min}）`);

const ok = dups.length === 0 && ids.size === QUOTES.length && tooShort.length === 0;
console.log(`\n===== ${ok ? '全部检查通过' : '存在问题'} =====`);
process.exit(ok ? 0 : 1);
