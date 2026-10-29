/**
 * 老周's voice. Jokes live here; anything that matters (numbers, causes,
 * fixes) is built by the callers and never randomised.
 */

const lastPick = new Map<string[], number>();

/** Random line from a pool, never the same one twice in a row. */
export function pick(pool: string[]): string {
  if (pool.length === 1) return pool[0]!;
  const prev = lastPick.get(pool) ?? -1;
  let i = Math.floor(Math.random() * (pool.length - 1));
  if (i >= prev) i++;
  lastPick.set(pool, i);
  return pool[i]!;
}

/** Pick from the tier matching how far gone the user is (0 = fresh, 4 = beyond help). */
export function byDespair(tiers: string[][], despair: number): string {
  const i = Math.max(0, Math.min(tiers.length - 1, Math.floor(despair)));
  return pick(tiers[i]!);
}

export const TITLES = ['台架老师傅', '台架老师傅（还有耐心）', '台架老师傅（在找降压药）', '台架老师傅（已放弃治疗）', '台架老师傅（正在写辞职信）'];

export const GREET = [
  '我是老周，在台架边上站了三十年。你随便拧，我盯着；拧坏了算我的——零件钱算你的。',
  '老周。干了三十年台架，见过的连杆比你吃过的油条多。开始吧，别客气，我血压还行。',
];

export const GREET_BACK = [
  '又来了？好，台架热着呢。',
  '回来啦。上次那台的零件我还没扫干净。',
  '来了就好。今天争取让它活过十分钟。',
];

export const CHAOS = [
  [
    '一次动一个！你这么拧，出了好结果也不知道该谢谁。',
    '慢点。调发动机不是调电视音量，一次拧一个，看清楚再拧下一个。',
  ],
  [
    '你不是在调发动机，你是在调我的血压。',
    '这手速，玩音游应该挺有前途的。',
  ],
  [
    '行，你拧你的，我去泡杯茶。茶泡好之前别让它炸。',
    '我年轻时也这样——后来厂长扣了我三个月奖金。',
  ],
  [
    '你这是在给发动机做随机数测试吧。',
    '我已经看不懂你在干什么了。我猜你自己也没看懂。',
  ],
  ['我不说了。我就看着。', '……（老周默默把灭火器挪近了一点）'],
];

export const FAIL_TAIL = [
  ['第一台，交学费，正常。谁都炸过。'],
  ['第二台了。学费交得挺积极。', '两台了。没事，零件商今晚能睡个好觉。'],
  ['第三台。我开始怀疑你是零件商派来的。', '三台了。我把你的名字写在仓库门口了，提醒他们备货。'],
  ['这人没救了。来，零件咱们批量订吧，有折扣。', '零件商刚给我发消息，问你是不是新开了个厂。'],
  ['我已经不想说话了。你自己看拆机报告吧。', '这台台架跟着你，是真的受苦了。'],
];

export const IGNORED = ['我刚刚说过的。', '我说过的吧？我是不是说过？', '……行，下次我写在你手上。'];

export const REVIVE = [
  '新零件装好了。这次温柔点。',
  '换好了。崭新的，像你的承诺一样。',
  '装好了。按住 S，咱们重新做人。',
];

export const LIMITER = [
  '断火转速不是用来顶着听响的……好吧，确实挺好听。适可而止。',
  '它在断火上打嗝，你在旁边笑。我都看见了。',
  '一直顶着断火，扭矩是零，你知道吧？就图个响。',
];

export const POPS_FIRST =
  '听到噼啪声没有？那是没烧完的混合气冲进滚烫的排气管自己点着了。好听，但烧的是你的油，也是排气管的寿命。';
export const POPS = ['又放炮了。你是不是故意的？……我懂，我年轻时也故意。', '噼里啪啦的，过年呢？'];

export const STALL = [
  '熄火了。松油门太快，ECU 还没来得及把旁通气门打开。',
  '它自己停了。不是你的错——好吧，一半是。',
];

export const PRAISE = [
  '看到没？动脑子比动手管用。',
  '可以，这一刀切对了。',
  '这才像话。我收回刚才心里骂你的那句。',
];

export const WORSE = ['掉了。退回去？', '这一刀切歪了。', '扭矩不会骗人，它说你改错了。'];
