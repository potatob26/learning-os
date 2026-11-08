import type { EvalFacts, DurationLevel, TaskLevel, HabitLevel, ProgressLevel } from './evaluate';

/* ==========================================================================
   学习评价 · 语言模板层
   ──────────────────────────────────────────────────────────────────────────
   与规则引擎（evaluate.ts）**相互独立**：那边只出事实，这边只把事实说成人话。
   规格书对这一层的要求，逐条对应：
     · 组织为三段：今日表现 / 值得关注的地方 / 下一步建议
     · 多套语句模板 + 合理的组合策略；**同一组数据核心结论一致，只改表达方式**
     · 自然、简洁、真诚；不刻意煽情；不像考试评语
     · 避免反复使用「非常棒」「继续加油」「相信自己」等套话
     · 不把学习时长等同于学习效率
     · 不在缺乏证据时推测情绪、学习态度或学习能力
     · 不为追求多样性而牺牲准确性

   结构上怎么保证"重新生成只改措辞"：
     返回值里带一个 **conclusion**（完全由事实决定、与随机无关）。
     随机只作用于"从同一含义的多套说法里挑一句"。测试会锁死：
     换种子 → conclusion 不变、文字至少有一处不同。
   ========================================================================== */

export type EvalTone = 'concise' | 'detailed' | 'gentle' | 'objective';

export interface EvaluationConclusion {
  duration: DurationLevel;
  task: TaskLevel;
  habit: HabitLevel;
  progress: ProgressLevel;
  subjectTop: string | null;
}

export interface Evaluation {
  title: string;
  parts: { today: string; watch: string; next: string };
  tags: string[];
  tone: EvalTone;
  /** 与措辞无关的核心结论 —— 「重新生成」不会改它 */
  conclusion: EvaluationConclusion;
}

/* ---------------- 确定性随机（同样的种子必然同样的措辞） ---------------- */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(list: T[], rnd: () => number): T => list[Math.floor(rnd() * list.length)];

/* ---------------- 语句库：同一含义多套说法 ---------------- */

const TODAY: Record<DurationLevel, string[]> = {
  over: ['今天学了 {actual} 分钟，超过计划的 {planned} 分钟。', '今天的 {actual} 分钟比计划的 {planned} 分钟多出一截。'],
  met: ['今天学了 {actual} 分钟，正好把计划的 {planned} 分钟走完。', '计划的 {planned} 分钟今天完成了（{actual} 分钟）。'],
  near: ['今天 {actual} 分钟，离计划的 {planned} 分钟只差一点。', '今天完成 {actual} 分钟，接近计划的 {planned} 分钟。'],
  below: ['今天学了 {actual} 分钟，计划是 {planned} 分钟。', '今天记录 {actual} 分钟，与计划的 {planned} 分钟还有距离。'],
  'no-plan': ['今天没有设定学习目标，记录了 {actual} 分钟。', '今天没有计划时长，实际学了 {actual} 分钟。'],
  'no-record': ['今天还没有学习记录。', '今天暂时没有记录到学习时间。'],
};

const TASK: Record<TaskLevel, string[]> = {
  all: ['今天的 {taskDone} 项目标全部完成。', '{taskDone} 项任务一项没落下。'],
  most: ['今天完成了 {taskDone} / {taskTotal} 项目标。', '{taskTotal} 项目标里完成了 {taskDone} 项。'],
  few: ['今天完成了 {taskDone} / {taskTotal} 项目标。', '今天 {taskTotal} 项目标里完成 {taskDone} 项。'],
  none: [],
};

const HABIT: Record<HabitLevel, string[]> = {
  streak: ['已经连续 {streak} 天有学习记录。', '这是连续第 {streak} 天。'],
  steady: ['最近几天的学习时长比较稳定。', '最近几天的节奏基本没起伏。'],
  fluctuating: ['最近几天的时长起伏比较大。', '最近几天的学习时长时多时少。'],
  sparse: ['最近有记录的天数是 {activeDays7} 天。', '近七天里有 {activeDays7} 天留下了记录。'],
  unknown: [],
};

const PROGRESS_UP: string[] = ['比最近的平均水平多了一些。', '比最近几天的平均时长高一点。'];
const PROGRESS_DOWN: string[] = ['比最近的平均水平少了一些。', '低于最近几天的平均水平。'];
const PROGRESS_FLAT: string[] = ['和最近几天的平均水平差不多。'];

/* ---------------- 下一步建议：必须具体、可执行、且**贴合当下情境** ---------------- */

/*
 * 教训（第一版被自己的测试抓住）：原来把"时长建议/任务建议/习惯建议"都塞进一个候选池
 * 再随机挑 —— 于是超额那天可能随机挑到"再记录几天，就能看出节奏了"，与情境无关。
 * 规格书要求"避免过度鼓励无节制延长学习"，也要求"不要为追求多样性牺牲准确性"。
 * 所以改成：
 *   · **主建议**由"今天时长处于哪一档"唯一决定（多样性体现在同一档的多套说法里）
 *   · 次建议才是任务/习惯/科目那些补充，只在"详细"模式里追加
 */
const PRIMARY_ADVICE: Record<DurationLevel, string[]> = {
  over: [
    '已经够了，不用再往上加时长；把剩下的时间留给休息或明天的内容。',
    '今天不用再加量，保持这个节奏比多学一会更有价值。',
  ],
  met: [
    '计划已经走完，可以就此收工，明天同一时间再来。',
    '今天的目标达成了，剩下的时间不必再堆时长。',
  ],
  near: [
    '只差一点就够计划了，收个尾就行。',
    '离计划很近，如果还有空，补一小段就能画上句号。',
  ],
  below: [
    '离计划还有距离，如果现在还有空，可以再开一段计时。',
    '今天的时间还差一些，挑一段不被打扰的时间补上就好。',
  ],
  'no-plan': [
    '可以到【设置 → 作息】给今天设一个目标分钟数，之后就能看出"达没达成"。',
    '先给今天定个打算学多久（设置 → 作息），后面才有参照。',
  ],
  'no-record': [
    '今天还没有记录，可以先开一段 25 分钟的计时，把节奏起起来。',
    '如果今天还打算学，从一段短计时开始最容易进入状态。',
  ],
};

/** 次建议：补充性的，只在"详细"模式追加，不抢主建议的位置 */
function secondaryAdvice(f: EvalFacts): string[] {
  const out: string[] = [];
  if (f.taskLevel === 'few' && f.taskCountMeaningful) {
    out.push(`还剩 ${f.taskTotal - f.taskDone} 项目标没勾，挑一件最小的先做掉。`);
  } else if (f.taskLevel === 'most') {
    out.push(`剩下 ${f.taskTotal - f.taskDone} 项目标，今晚顺手清掉就不用留到明天。`);
  }
  if (f.habitLevel === 'fluctuating') {
    out.push('时长起伏大的时候，固定一个开始时间（比如晚饭后立刻开计时）通常比"今天多学一会"更有用。');
  } else if (f.habitLevel === 'streak') {
    out.push('连续天数已经起来了，明天保持同样的节奏就够，不必加量。');
  } else if (f.habitLevel === 'unknown' && f.actual > 0) {
    out.push('再记录几天，就能看出你的时长大致是什么节奏了。');
  }
  if (f.subjectTop === null && f.actual > 0) {
    out.push('下次计时时选上科目，之后就能看到各科的时间分布。');
  }
  return out;
}

/* ---------------- 值得关注的地方 ---------------- */

function watchFor(f: EvalFacts): string[] {
  const out: string[] = [];
  if (f.habitLevel === 'streak') out.push(...HABIT.streak);
  if (f.habitLevel === 'steady') out.push(...HABIT.steady);
  if (f.habitLevel === 'fluctuating') out.push(...HABIT.fluctuating);
  if (f.habitLevel === 'sparse') out.push(...HABIT.sparse);
  if (f.progressLevel === 'up') out.push(...PROGRESS_UP);
  if (f.progressLevel === 'down') out.push(...PROGRESS_DOWN);
  if (f.progressLevel === 'flat') out.push(...PROGRESS_FLAT);
  if (f.subjectShift) {
    const { subject, delta } = f.subjectShift;
    const pct = Math.abs(Math.round(delta * 100));
    out.push(delta > 0 ? `今天在${subject}上的占比比你平时高约 ${pct}%。` : `今天在${subject}上的占比比你平时低约 ${pct}%。`);
  } else if (f.subjectTop && f.subjectTop.share >= 0.5) {
    out.push(`今天的时间主要花在${f.subjectTop.subject}上（${f.subjectTop.minutes} 分钟）。`);
  }
  if (out.length === 0) out.push('今天的数据还不多，暂时没有特别需要留意的变化。');
  return out;
}

/* ---------------- 组装 ---------------- */

function fill(tpl: string, f: EvalFacts): string {
  return tpl
    .replace('{actual}', String(f.actual))
    .replace('{planned}', String(f.planned))
    .replace('{taskDone}', String(f.taskDone))
    .replace('{taskTotal}', String(f.taskTotal))
    .replace('{streak}', String(f.streak))
    .replace('{activeDays7}', String(f.activeDays7));
}

export function buildEvaluation(
  f: EvalFacts,
  opts: { tone?: EvalTone; seed?: number } = {},
): Evaluation {
  const tone: EvalTone = opts.tone ?? 'concise'; // 规格书：默认简洁
  const rnd = mulberry32(opts.seed ?? 1);

  /* 今日表现：时长 + 任务 */
  const todayBits = [pick(TODAY[f.durationLevel], rnd)];
  if (TASK[f.taskLevel].length > 0) todayBits.push(pick(TASK[f.taskLevel], rnd));
  const today = todayBits.map((t) => fill(t, f)).join('');

  const watch = fill(pick(watchFor(f), rnd), f);
  const next = fill(pick(PRIMARY_ADVICE[f.durationLevel], rnd), f);

  /*
   * 语气模式（规格书场景 14）：
   *   concise  简洁：就三段正文
   *   detailed 详细：三段都在，并在"今日表现"里补上节奏与占比的细节
   *   gentle   温和鼓励：措辞更正面，但**不能隐瞒明显问题**（所以问题段照留）
   *   objective 客观分析：去掉情绪化措辞，直接陈述事实与趋势
   * 注意：四种模式**共用同一批事实**，只有表达不同 —— 不能因为换了模式就改结论。
   */
  let parts = { today, watch, next };
  let title = '今日学习评价';

  if (tone === 'detailed') {
    const extra: string[] = [];
    const sec = secondaryAdvice(f);
    if (sec.length > 0) extra.push(pick(sec, rnd));
    if (f.habitLevel !== 'unknown') extra.push(fill(pick(HABIT[f.habitLevel], rnd), f));
    if (f.subjectTop) extra.push(`时间最多的科目是${f.subjectTop.subject}（${f.subjectTop.minutes} 分钟，占 ${Math.round(f.subjectTop.share * 100)}%）。`);
    if (f.fluctuation !== null) extra.push(`近七天时长的相对波动约 ${Math.round(f.fluctuation * 100)}%。`);
    parts = { ...parts, today: [today, ...extra].join('') };
    title = '今日学习评价（详细）';
  } else if (tone === 'gentle') {
    parts = {
      today: today.replace('。', '，这一点值得记下来。'),
      watch: watch.replace('起伏比较大', '还有调整空间').replace('时多时少', '可以更规律一些'),
      next,
    };
    title = '今日学习评价';
  } else if (tone === 'objective') {
    const factsOnly: string[] = [];
    factsOnly.push(`实际学习 ${f.actual} 分钟${f.planned > 0 ? `，计划 ${f.planned} 分钟` : '（今天未设计划）'}。`);
    if (f.taskTotal > 0) factsOnly.push(`目标完成 ${f.taskDone} / ${f.taskTotal}。`);
    if (f.activeDays7 > 0) factsOnly.push(`近七天有记录 ${f.activeDays7} 天，连续 ${f.streak} 天。`);
    parts = { today: factsOnly.join(''), watch, next };
    title = '今日学习评价（客观）';
  }

  const conclusion: EvaluationConclusion = {
    duration: f.durationLevel,
    task: f.taskLevel,
    habit: f.habitLevel,
    progress: f.progressLevel,
    subjectTop: f.subjectTop?.subject ?? null,
  };

  return { title, parts, tags: f.tags, tone, conclusion };
}
