/**
 * Work orders. Each one starts from a specific engine, states what the
 * customer wants, and is judged by the acceptance run.
 *
 *   ★   every requirement met
 *   ★★  the stretch goal too
 *   ★★★ and spent no more than the budget on parts
 */

import {
  PRESETS,
  clampConfig,
  clampEcu,
  displacementCc,
  type EcuConfig,
  type EngineConfig,
  type MufflerType,
} from '../sim/config';
import { type AcceptancePlan, type AcceptanceResult, hpOf, torqueAt } from './acceptance';
import type { PartId } from './parts';
import { DNF_TEXT, RACE_EVENTS, type RaceEventId, type RaceResult } from '../sim/race';
import type { VehicleConfig } from '../sim/vehicle';
import type { GoalKind } from '../mentor/goals';

/** What a check asks for, in a form 老周's search can aim at. */
export interface CheckSpec {
  goal?: { kind: GoalKind; value: number; rpm?: number; event?: RaceEventId };
  /** ECU settings the customer fixed. */
  lock?: Partial<EcuConfig>;
  mufflers?: MufflerType[];
}

export interface CheckCtx {
  config: EngineConfig;
  ecu: EcuConfig;
  cost: number;
  result: AcceptanceResult | null;
  races?: Partial<Record<RaceEventId, RaceResult>>;
}

export interface CheckOutcome {
  /** null: needs an acceptance run to know. */
  pass: boolean | null;
  /** What the engine actually did, for display. */
  actual: string;
}

export interface Check {
  label: string;
  needsTest: boolean;
  eval: (ctx: CheckCtx) => CheckOutcome;
  /** Where the target sits on a dyno chart, if it is a curve target. */
  mark?: { rpm?: number; torque?: number; hp?: number };
  spec?: CheckSpec;
}

const f1 = (v: number): string => v.toFixed(1);
/** Measured values round down, so a miss never displays as the target. */
const m1 = (v: number): string => (Math.floor(v * 10 + 1e-9) / 10).toFixed(1);
/** For lower-is-better limits: round up, for the same reason. */
const c1 = (v: number): string => (Math.ceil(v * 10 - 1e-9) / 10).toFixed(1);
const rpmText = (v: number): string => Math.round(v).toLocaleString('en-US');

function test(label: string, judge: (r: AcceptanceResult) => CheckOutcome, mark?: Check['mark'], spec?: CheckSpec): Check {
  return {
    label,
    needsTest: true,
    eval: ({ result }) => (result ? judge(result) : { pass: null, actual: '待验收' }),
    ...(mark ? { mark } : {}),
    ...(spec ? { spec } : {}),
  };
}

function rule(label: string, judge: (ctx: CheckCtx) => CheckOutcome, spec?: CheckSpec): Check {
  return { label, needsTest: false, eval: judge, ...(spec ? { spec } : {}) };
}

export const C = {
  survive: (): Check =>
    test('验收全程不坏', (r) => ({
      pass: r.started && !r.failure,
      actual: !r.started ? '没打着' : r.failure ? r.failure.title : '完好',
    })),
  idle: (minRpm: number): Check =>
    test(`怠速稳，最低不掉到 ${rpmText(minRpm)} rpm 以下`, (r) => ({
      pass: r.started && r.idle !== null && r.idle.min >= minRpm,
      actual: r.idle ? (r.idle.min <= 0 ? '熄火了' : `最低 ${rpmText(r.idle.min)}`) : '—',
    }), undefined, { goal: { kind: 'idleMin', value: minRpm } }),
  peakHp: (hp: number): Check =>
    test(`最大功率 ≥ ${f1(hp)} hp`, (r) => ({ pass: r.peakHp >= hp, actual: `${m1(r.peakHp)} hp` }), { hp }, { goal: { kind: 'peakHp', value: hp } }),
  peakTorque: (nm: number): Check =>
    test(`最大扭矩 ≥ ${f1(nm)} Nm`, (r) => ({ pass: r.peakTorque >= nm, actual: `${m1(r.peakTorque)} Nm` }), { torque: nm }, { goal: { kind: 'peakTorque', value: nm } }),
  torqueAt: (rpm: number, nm: number): Check =>
    test(`${rpmText(rpm)} rpm 扭矩 ≥ ${f1(nm)} Nm`, (r) => {
      const v = torqueAt(r.curve, rpm);
      return { pass: v >= nm, actual: `${m1(v)} Nm` };
    }, { rpm, torque: nm }, { goal: { kind: 'torqueAt', value: nm, rpm } }),
  hpAt: (rpm: number, hp: number): Check =>
    test(`${rpmText(rpm)} rpm 功率 ≥ ${f1(hp)} hp`, (r) => {
      const v = hpOf(rpm, torqueAt(r.curve, rpm));
      return { pass: v >= hp, actual: `${m1(v)} hp` };
    }, { rpm, hp }, { goal: { kind: 'hpAt', value: hp, rpm } }),
  freeRev: (seconds: number): Check =>
    test(`空轰到红线 ≤ ${seconds.toFixed(2)} 秒`, (r) => ({
      pass: r.freeRevTime !== null && r.freeRevTime <= seconds,
      // Lower is better here, so round up for display.
      actual: r.freeRevTime === null ? '没轰上去' : `${(Math.ceil(r.freeRevTime * 100 - 1e-9) / 100).toFixed(2)} 秒`,
    }), undefined, { goal: { kind: 'freeRev', value: seconds } }),
  pops: (n: number): Check => test(`收油放炮 ≥ ${n} 响`, (r) => ({ pass: r.pops >= n, actual: `${r.pops} 响` }), undefined, { goal: { kind: 'pops', value: n } }),
  piston: (maxPct: number): Check =>
    test(`活塞损伤 ≤ ${maxPct}%`, (r) => ({
      pass: r.pistonDamage * 100 <= maxPct,
      actual: `${c1(r.pistonDamage * 100)}%`,
    }), undefined, { goal: { kind: 'piston', value: maxPct } }),
  coolant: (maxC: number): Check =>
    test(`水温不超过 ${maxC} °C`, (r) => ({ pass: r.coolantMax <= maxC, actual: `最高 ${r.coolantMax.toFixed(0)} °C` }), undefined, { goal: { kind: 'coolant', value: maxC } }),
  rodFatigue: (maxPct: number): Check =>
    test(`连杆疲劳 ≤ ${maxPct}%`, (r) => ({
      pass: r.rodFatigue * 100 <= maxPct,
      actual: `${c1(r.rodFatigue * 100)}%`,
    }), undefined, { goal: { kind: 'rod', value: maxPct } }),
  knockSensorOff: (): Check =>
    rule('爆震控制保持关闭（传感器坏了）', ({ ecu }) => ({ pass: !ecu.knockControl, actual: ecu.knockControl ? '开着' : '关' }), { lock: { knockControl: false } }),
  octaneMax: (ron: number): Check =>
    rule(`只加 ${ron} 号油（或更低）`, ({ config }) => ({ pass: config.fuelOctane <= ron, actual: `${config.fuelOctane} 号` }), { goal: { kind: 'octaneMax', value: ron } }),
  muffler: (allowed: MufflerType[]): Check =>
    rule(`消音器：${allowed.map((m) => MUFFLER_TEXT[m]).join(' 或 ')}`, ({ config }) => ({
      pass: allowed.includes(config.muffler),
      actual: MUFFLER_TEXT[config.muffler],
    }), { mufflers: allowed }),
  limiterMin: (rpm: number): Check =>
    rule(`断火转速 ≥ ${rpmText(rpm)}`, ({ ecu }) => ({ pass: ecu.limiterRpm >= rpm, actual: rpmText(ecu.limiterRpm) }), { goal: { kind: 'limiterMin', value: rpm } }),
  limiterMax: (rpm: number): Check =>
    rule(`断火转速 ≤ ${rpmText(rpm)}`, ({ ecu }) => ({ pass: ecu.limiterRpm <= rpm, actual: rpmText(ecu.limiterRpm) }), { goal: { kind: 'limiterMax', value: rpm } }),
  ccMax: (cc: number): Check =>
    rule(`排量 ≤ ${cc} cc`, ({ config }) => {
      const v = displacementCc(config);
      return { pass: v <= cc + 0.5, actual: `${v.toFixed(0)} cc` };
    }, { goal: { kind: 'ccMax', value: cc } }),
};

/** A timed run's verdict from the acceptance's races. */
function raced(label: string, event: RaceEventId, judge: (r: RaceResult) => CheckOutcome, spec: CheckSpec): Check {
  return {
    label,
    needsTest: true,
    eval: ({ result, races }) => {
      const r = races?.[event];
      if (!result || !r) return { pass: null, actual: '待验收' };
      if (r.dnf) return { pass: false, actual: DNF_TEXT[r.dnf] };
      return judge(r);
    },
    spec,
  };
}

export const RACE_CHECKS = {
  time: (event: RaceEventId, sec: number): Check =>
    raced(`${RACE_EVENTS[event].name} ≤ ${sec.toFixed(2)} 秒`, event, (r) => ({ pass: (r.time ?? Infinity) <= sec, actual: `${(Math.ceil((r.time ?? 0) * 100 - 1e-9) / 100).toFixed(2)} 秒` }), {
      goal: { kind: 'raceTime', value: sec, event },
    }),
  top: (kmh: number): Check =>
    raced(`极速 ≥ ${kmh} km/h`, 'top', (r) => ({ pass: r.topKmh >= kmh, actual: `${(Math.floor(r.topKmh * 10) / 10).toFixed(1)} km/h` }), { goal: { kind: 'topSpeed', value: kmh } }),
};

export const MUFFLER_TEXT: Record<MufflerType, string> = { stock: '原厂', sport: '运动', open: '直通' };

export interface Job {
  id: string;
  title: string;
  client: string;
  /** What the customer says. */
  brief: string;
  /** 老周's nudge, shown on request. */
  tip: string;
  presetId: string;
  config?: Partial<EngineConfig>;
  ecu?: Partial<EcuConfig>;
  plan: AcceptancePlan;
  rules: Check[];
  bonus: Check;
  budget: number;
  /** Parts the job forbids touching. */
  locked?: PartId[];
  /** The customer's bike, for jobs judged on the strip. */
  vehicle?: Partial<VehicleConfig>;
  /** Timed runs the acceptance includes. */
  races?: RaceEventId[];
}

export interface JobStart {
  config: EngineConfig;
  ecu: EcuConfig;
}

export function jobStart(job: Job): JobStart {
  const p = PRESETS.find((x) => x.id === job.presetId) ?? PRESETS[0]!;
  return {
    config: clampConfig({ ...p.engine, ...job.config }),
    ecu: clampEcu({ ...p.ecu, ...job.ecu }),
  };
}

export const JOBS: Job[] = [
  {
    id: 'stall',
    title: '一松油门就灭',
    client: '快递站 · 马师傅',
    brief: '这台 250 上礼拜别人刷过电脑，现在等红灯就熄火。我不要它多快，能稳稳怠速就行。',
    tip: '打开 ECU，看看「怠速目标」被人调到了多少。原厂是 1400。改 ECU 不花零件钱。',
    presetId: 'street-250',
    ecu: { idleRpm: 800, cruiseLambda: 1.22 },
    plan: {},
    rules: [C.survive(), C.idle(1100)],
    bonus: C.peakTorque(23.5),
    budget: 0,
  },
  {
    id: 'timid',
    title: '胆小的点火图',
    client: '跑山的 · 阿飞',
    brief: '爆震传感器坏了，车行没货，就把点火往后退了一大截了事。现在骑起来肉得要命。帮我把劲找回来，但别给我打出爆震，活塞很贵。',
    tip: '「点火角修正」现在是 −20°，往回加。盯着示波器上峰值压力落在上止点后哪里：12–16° 最出力；再早就开始爆震（缸压曲线上出现毛刺，事件栏会报）。没有爆震控制兜底，加过头活塞会被打坏。',
    presetId: 'street-250',
    ecu: { advanceOffset: -20, knockControl: false },
    plan: {},
    rules: [C.survive(), C.knockSensorOff(), C.peakHp(15.8), C.piston(2)],
    bonus: C.peakHp(16.1),
    budget: 0,
  },
  {
    id: 'courier',
    title: '外卖要快',
    client: '外卖骑手 · 小刘',
    brief: '送单就是抢时间。马力给我加上去，但消音器不能换，被交警逮到要罚；加油站只有 92。',
    tip: '这单不许动缸体。凸轮轴、排气头段、进气道、节气门都是便宜又有效的地方。改一样，拉一遍测功，看曲线往哪边动。',
    presetId: 'street-250',
    plan: {},
    rules: [C.survive(), C.peakHp(18), C.muffler(['stock']), C.octaneMax(92)],
    bonus: C.peakHp(20),
    budget: 1500,
    locked: ['bore', 'crank', 'head', 'piston', 'rod'],
  },
  {
    id: 'tractor',
    title: '低转要扛得住',
    client: '果园 · 杨老板',
    brief: '我拿这台 650 带水泵和小拖车，整天在两三千转干活。高转我用不着，低转扭矩越厚越好。',
    tip: '把进气道加长，气柱的共振会落到更低的转速；凸轮持续角收短一点，低转不倒灌。别忘了在 2500 附近钉住测功机对比。',
    presetId: 'thumper-650',
    plan: {},
    rules: [C.survive(), C.torqueAt(2500, 69), C.limiterMin(5500)],
    bonus: C.torqueAt(2000, 64),
    budget: 1150,
  },
  {
    id: 'octane',
    title: '只能加 92',
    client: '高原车队 · 次仁',
    brief: '这台 450 赛机我们拉去山里跑，那边只有 92 号油。上次一个下午打穿了两个活塞。要能跑完，也别太肉。',
    tip: '92 号油抗爆差。降压缩比（换活塞）最根本，退点火角不花钱。验收时爆震控制如果开着会帮你，但它退角也会掉扭矩。',
    presetId: 'race-450',
    config: { fuelOctane: 92 },
    ecu: { advanceOffset: -4, knockControl: false },
    plan: { endurance: { seconds: 5 } },
    rules: [C.survive(), C.octaneMax(92), C.piston(3), C.peakHp(36)],
    bonus: C.peakHp(38.5),
    budget: 700,
  },
  {
    id: 'flames',
    title: '要那种噼啪声',
    client: '短视频博主 · 大雄',
    brief: '粉丝就爱听收油时排气管噼里啪啦。帮我调出来，越响越好。当然别把车搞坏，我还要骑回去。',
    tip: '断火限转时油照喷，没烧的混合气冲进热排气管就会炸。关掉「松油门断油」，全油门 λ 加浓，原厂消音器背压大反而更容易响。',
    presetId: 'street-250',
    plan: { overrun: true },
    rules: [C.survive(), C.pops(260)],
    bonus: C.pops(420),
    budget: 0,
  },
  {
    id: 'snappy',
    title: '油门要跟脚',
    client: '越野爱好者 · 小周',
    brief: '在烂路上要一拧就窜，现在这台 250 拧下去要愣一下才上来。但我经常慢慢爬坡，怠速不能抖到熄火。',
    tip: '升速快慢主要看飞轮惯量。飞轮太轻怠速会晃，可以把怠速目标稍微抬高来补偿。',
    presetId: 'street-250',
    plan: { freeRev: true },
    rules: [C.survive(), C.freeRev(0.6), C.idle(1000)],
    bonus: C.freeRev(0.48),
    budget: 500,
  },
  {
    id: 'redline',
    title: '红线再高一点',
    client: '场地赛车手 · 艾米',
    brief: '这台 450 的断火我已经让人设到 12,500 了，换挡点能晚一点。验收时要在红线上顶住几秒。',
    tip: '先看转速表外圈两个标记：紫色是气门飘浮，红色是连杆拉断。两个都得推到断火转速之上。弹簧便宜，连杆和活塞贵。',
    presetId: 'race-450',
    ecu: { limiterRpm: 12500 },
    plan: { endurance: { seconds: 6 } },
    rules: [C.survive(), C.limiterMin(12500), C.hpAt(11500, 30)],
    bonus: C.hpAt(11500, 32),
    budget: 1300,
  },
  {
    id: 'durable',
    title: '耐用第一',
    client: '赛车培训学校 · 王校长',
    brief: '学员天天把这台 450 顶在断火上，三个月换了两根连杆。换挡点我不想降太多，断火至少留 11,000。要扛得住长时间撞红线。',
    tip: '连杆疲劳从「连杆拉断」转速的九成左右开始累积。要么把断火降到安全线下，要么让连杆轻松：更轻的活塞（往复质量）或更结实的连杆。转速表外圈红色标记就是拉断转速。',
    presetId: 'race-450',
    plan: { endurance: { seconds: 10 } },
    rules: [C.survive(), C.limiterMin(11000), C.rodFatigue(2), C.peakHp(38)],
    bonus: C.limiterMin(11500),
    budget: 700,
  },
  {
    id: 'class250',
    title: '250 组别',
    client: '青训车队 · 林教练',
    brief: '比赛规定排量不能超过 250，油可以加 98。给孩子们一台能拿名次的发动机。',
    tip: '排量卡死了，只能靠转速换功率：大凸轮、大气门、短进气道，再配上结实的弹簧和连杆把红线抬上去。大缸径短行程也是办法，但总排量不能超。',
    presetId: 'street-250',
    plan: { endurance: { seconds: 5 } },
    rules: [C.survive(), C.ccMax(250), C.octaneMax(98), C.peakHp(24)],
    bonus: C.peakHp(27),
    budget: 5000,
  },
  {
    id: 'king',
    title: '单缸之王',
    client: '老周自己',
    brief: '我年轻时候搞过一台单缸，测功机上拉出过六十匹。你要是能超过我，这个台架以后归你。',
    tip: '没有捷径。排量、转速、充气效率，三样都要。红线上得顶住八秒。',
    presetId: 'thumper-650',
    plan: { endurance: { seconds: 8 } },
    rules: [C.survive(), C.octaneMax(98), C.peakHp(55)],
    bonus: C.peakHp(62),
    budget: 7000,
  },
  {
    id: 'launch',
    title: '起步总打滑',
    client: '直线加速队 · 小黑',
    brief: '450 装在赛道车上，一放离合后轮就冒烟，有时候还抬头。零百进不了 4.7 秒，比赛没法跑。',
    tip: '到「整车」里看：弹射起步转速、放离合的快慢、牵引力控制和防抬头都不要钱。先上赛道看它是打滑还是抬头，再对症。',
    presetId: 'race-450',
    plan: {},
    vehicle: { chassis: 'race' },
    races: ['drag100'],
    rules: [C.survive(), RACE_CHECKS.time('drag100', 4.7)],
    bonus: RACE_CHECKS.time('drag100', 4.45),
    budget: 800,
  },
  {
    id: 'hillclimb',
    title: '爬坡赛',
    client: '山里的车队 · 老韩',
    brief: '一公里、12% 的坡。这台 650 劲够大，可一换挡就掉出扭矩带，跑 40 秒，我要 37 秒以内。',
    tip: '画「整车」里的各挡车速：每次换挡转速掉到哪？650 转不高，挡位要排得紧，换挡点要按扭矩曲线来，不是撞到断火才换。',
    presetId: 'thumper-650',
    plan: {},
    vehicle: { chassis: 'street' },
    races: ['hill'],
    rules: [C.survive(), RACE_CHECKS.time('hill', 37)],
    bonus: RACE_CHECKS.time('hill', 35),
    budget: 1500,
  },
  {
    id: 'topspeed',
    title: '跑得再快点',
    client: '送外卖的 · 小周',
    brief: '跑高速太慢了，这台 250 拧到底也就 115。上 125，能再多就更好。',
    tip: '极速是功率和风阻的平衡，也是末挡齿比的事：末挡要让发动机正好在功率峰附近顶住。整流罩比你想的管用。',
    presetId: 'street-250',
    plan: {},
    vehicle: { chassis: 'street' },
    races: ['top'],
    rules: [C.survive(), RACE_CHECKS.top(125)],
    bonus: RACE_CHECKS.top(131),
    budget: 1500,
  },
  {
    id: 'turbo250',
    title: '涡轮小钢炮',
    client: '改装店老板 · 阿杰',
    brief: '我想要一台四百米跑进 16 秒的 250。不准换缸，用涡轮。活塞要活着。',
    tip: '涡轮、中冷、喷油嘴是一套。压缩比降下来，点火退下来，然后让老周逐点找点火和增压。别忘了起步：涡轮车起步要先把增压憋起来。',
    presetId: 'street-250',
    plan: {},
    vehicle: { chassis: 'street' },
    races: ['quarter'],
    rules: [C.survive(), C.piston(3), RACE_CHECKS.time('quarter', 16)],
    bonus: RACE_CHECKS.time('quarter', 15.3),
    budget: 9000,
    locked: ['bore', 'crank'],
  },
];

export function jobById(id: string | null | undefined): Job | undefined {
  return JOBS.find((j) => j.id === id);
}

export interface Grade {
  rules: CheckOutcome[];
  bonus: CheckOutcome;
  withinBudget: boolean;
  passed: boolean;
  stars: number;
}

export function grade(job: Job, ctx: CheckCtx): Grade {
  const rules = job.rules.map((c) => c.eval(ctx));
  const bonus = job.bonus.eval(ctx);
  const passed = rules.every((r) => r.pass === true);
  const withinBudget = ctx.cost <= job.budget;
  const stars = passed ? 1 + (bonus.pass === true ? 1 : 0) + (withinBudget ? 1 : 0) : 0;
  return { rules, bonus, withinBudget, passed, stars };
}
