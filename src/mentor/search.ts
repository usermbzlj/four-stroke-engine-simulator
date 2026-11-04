/**
 * 老周 working towards a brief: change one thing, run the acceptance
 * schedule on a private engine, keep it if the build got closer.
 *
 * A pattern search over the knobs that matter for the goals. Each knob has
 * its own step: it grows after a win (keep pushing that way) and halves
 * after both directions lose. Several builds run at once, one per worker.
 *
 * Every number comes out of the same solver the bench runs; nothing here
 * knows what a "good" cam is.
 */

import type { AcceptancePlan, AcceptanceResult } from '../game/acceptance';
import { buildCost, PART_OF, PARTS, type PartId } from '../game/parts';
import { RACE_EVENTS, type RaceEventId, type RaceResult } from '../sim/race';
import { clampVehicle, VEHICLE_LIMITS, VEHICLE_PARTS, vehicleCost, type VehicleConfig, type VehiclePartId } from '../sim/vehicle';
import { CONFIG_LIMITS, clampConfig, clampEcu, safeLimiterRpm, type EcuConfig, type EngineConfig, type MufflerType } from '../sim/config';
import { effectiveGoals, eventsFor, gap, goalText, GOALS, planFor, quickPlanFor, score, type Brief, type Goal, type GoalCtx, type GoalKind, type Score } from './goals';

export interface Build {
  config: EngineConfig;
  ecu: EcuConfig;
  vehicle: VehicleConfig;
  /** Limiter 老周 would like; the fitted one never exceeds what the parts survive. */
  wish: number;
}

export interface Tried extends Build {
  result: AcceptanceResult;
  races: Partial<Record<RaceEventId, RaceResult>>;
  cost: number;
  score: Score;
}

export interface EvalJob {
  config: EngineConfig;
  ecu: EcuConfig;
  vehicle: VehicleConfig;
  plan: AcceptancePlan;
  /** Timed runs to do as well. */
  events: RaceEventId[];
  /** Reuse this acceptance result: only the timed runs changed. */
  reuse?: AcceptanceResult;
}

export interface EvalOut {
  result: AcceptanceResult;
  races: Partial<Record<RaceEventId, RaceResult>>;
}

export interface SearchHooks {
  /** Run these builds (in parallel if possible), results in the same order. */
  evaluate: (jobs: EvalJob[]) => Promise<EvalOut[]>;
  /** How many builds to try at once. */
  width: number;
  log: (text: string) => void;
  stage: (text: string) => void;
  /** Called whenever the best build changes, and after every batch. */
  progress: (best: Tried, tried: number, budget: number) => void;
  stopped: () => boolean;
}

export interface SearchOutcome {
  best: Tried;
  start: Tried;
  /** The best build re-run on the full schedule. */
  verified: Tried;
  tried: number;
  stoppedEarly: boolean;
}

type Side = 'config' | 'ecu' | 'vehicle';

interface Knob {
  side: Side;
  key: string;
  name: string;
  unit: string;
  digits: number;
  /** Numeric knobs: first and finest step. */
  step?: [number, number];
  /** Discrete knobs: the values to try. */
  values?: readonly (number | string | boolean)[];
  part?: PartId | VehiclePartId;
  /** How far a long jump goes when the search is stuck. */
  jump?: number;
  /** Only worth trying when this holds (a turbo fitted, a phaser fitted...). */
  when?: (b: Build) => boolean;
}

const V = (key: keyof typeof VEHICLE_LIMITS, name: string, unit: string, digits: number, step: [number, number], part?: VehiclePartId): Knob => ({
  side: 'vehicle',
  key,
  name,
  unit,
  digits,
  step,
  ...(part ? { part } : {}),
});
const turbo = (b: Build): boolean => b.config.turboSize > 0;

const N = (key: keyof EngineConfig, name: string, unit: string, digits: number, step: [number, number]): Knob => ({
  side: 'config',
  key,
  name,
  unit,
  digits,
  step,
  part: PART_OF[key].id,
});

const KNOBS: Knob[] = [
  N('bore', '缸径', 'mm', 1, [6, 0.5]),
  N('stroke', '行程', 'mm', 1, [6, 0.4]),
  N('rodLength', '连杆中心距', 'mm', 0, [10, 1]),
  N('compressionRatio', '压缩比', '', 1, [1, 0.1]),
  {
    side: 'config',
    key: 'intakeValves',
    name: '进气门数',
    unit: '个',
    digits: 0,
    values: [1, 2],
    part: 'head',
  },
  {
    side: 'config',
    key: 'exhaustValves',
    name: '排气门数',
    unit: '个',
    digits: 0,
    values: [1, 2],
    part: 'head',
  },
  N('intakeValveDiameter', '进气门直径', 'mm', 1, [3, 0.5]),
  N('exhaustValveDiameter', '排气门直径', 'mm', 1, [3, 0.5]),
  N('intakeDuration', '进气持续角', '°', 0, [16, 1]),
  N('exhaustDuration', '排气持续角', '°', 0, [16, 1]),
  N('intakeLift', '进气升程', 'mm', 1, [1.5, 0.1]),
  N('exhaustLift', '排气升程', 'mm', 1, [1.5, 0.1]),
  N('lobeSeparation', '凸轮夹角', '°', 1, [4, 0.5]),
  N('intakeCenterline', '进气中心角', '°', 1, [4, 0.5]),
  N('valveSpringForce', '弹簧力', 'N', 0, [150, 10]),
  N('throttleDiameter', '节气门直径', 'mm', 0, [5, 1]),
  N('intakeRunnerLength', '进气道长度', 'mm', 0, [80, 5]),
  N('intakeRunnerDiameter', '进气道直径', 'mm', 0, [5, 1]),
  N('exhaustHeaderLength', '排气头段长度', 'mm', 0, [150, 10]),
  N('exhaustHeaderDiameter', '排气头段直径', 'mm', 0, [5, 1]),
  {
    side: 'config',
    key: 'muffler',
    name: '消音器',
    unit: '',
    digits: 0,
    values: ['stock', 'sport', 'open'],
    part: 'muffler',
  },
  N('flywheelInertia', '飞轮惯量', 'kg·m²', 3, [0.01, 0.001]),
  N('reciprocatingMass', '往复质量', 'kg', 2, [0.05, 0.01]),
  N('rodStrength', '连杆强度', 'N', 0, [2500, 100]),
  N('fuelOctane', '燃油', '号', 0, [3, 1]),
  N('radiatorCapacity', '散热器', '×', 2, [0.2, 0.05]),
  N('plenumVolume', '稳压腔', '×排量', 1, [1, 0.1]),
  N('injectorFlow', '喷油嘴', 'cc/min', 0, [60, 10]),
  N('vvtRange', '相位器行程', '°', 0, [15, 1]),
  N('turboSize', '涡轮尺寸', '', 2, [0.3, 0.05]),
  { ...N('intercooler', '中冷效率', '', 2, [0.2, 0.05]), when: turbo },
  { side: 'ecu', key: 'boostAll', name: '增压目标', unit: 'kPa', digits: 0, step: [20, 5], jump: 60, when: turbo },
  { side: 'ecu', key: 'antiLag', name: '防迟滞', unit: '', digits: 0, values: [true, false], when: turbo },
  { side: 'ecu', key: 'overrunResumeAbove', name: '恢复供油转速', unit: 'rpm', digits: 0, step: [300, 50], jump: 900 },
  { side: 'ecu', key: 'dashpot', name: '节气门缓冲', unit: '', digits: 2, step: [0.1, 0.02] },
  { side: 'ecu', key: 'idleSparkReserve', name: '怠速点火储备', unit: '°', digits: 1, step: [4, 0.5] },
  { side: 'ecu', key: 'idleGain', name: '怠速控制力度', unit: '', digits: 2, step: [0.5, 0.05] },
  { side: 'ecu', key: 'accelEnrich', name: '加速加浓', unit: '', digits: 2, step: [0.3, 0.05] },
  { side: 'ecu', key: 'launchRpm', name: '弹射转速', unit: 'rpm', digits: 0, step: [1500, 100], jump: 3000 },
  { side: 'ecu', key: 'tractionControl', name: '牵引力控制', unit: '', digits: 2, step: [0.08, 0.01] },
  { side: 'ecu', key: 'wheelieControl', name: '防抬头', unit: '', digits: 0, values: [true, false] },
  { side: 'ecu', key: 'shiftAll', name: '换挡转速', unit: 'rpm', digits: 0, step: [800, 100], jump: 2000 },
  V('finalDrive', '主减速比', '', 2, [0.4, 0.02], 'sprocket'),
  { ...V('primary', '齿比间距', '', 2, [0.15, 0.02], 'gearbox'), key: 'gearSpread' },
  { ...V('primary', '一挡', '', 2, [0.3, 0.02], 'gearbox'), key: 'firstGear' },
  V('tireGrip', '轮胎抓地', 'μ', 2, [0.15, 0.02], 'tires'),
  V('mass', '整备质量', 'kg', 0, [15, 1], 'diet'),
  V('cgHeight', '重心高度', 'm', 2, [0.08, 0.01], 'geometry'),
  V('wheelbase', '轴距', 'm', 2, [0.08, 0.01], 'geometry'),
  V('cdA', '风阻面积', 'm²', 2, [0.08, 0.01], 'fairing'),
  V('clutchCapacity', '离合器传扭', 'Nm', 0, [30, 5], 'clutch'),
  V('clutchRelease', '放离合时间', '秒', 2, [0.25, 0.05]),
  { side: 'vehicle', key: 'quickshifter', name: '快排', unit: '', digits: 0, values: [true, false], part: 'quickshifter' },
  {
    side: 'ecu',
    key: 'advanceOffset',
    jump: 8,
    name: '点火修正',
    unit: '°',
    digits: 1,
    step: [3, 0.5],
  },
  {
    side: 'ecu',
    key: 'wotLambda',
    jump: 0.12,
    name: '全油门 λ',
    unit: '',
    digits: 2,
    step: [0.05, 0.01],
  },
  {
    side: 'ecu',
    key: 'cruiseLambda',
    jump: 0.12,
    name: '部分负荷 λ',
    unit: '',
    digits: 2,
    step: [0.06, 0.01],
  },
  {
    side: 'ecu',
    key: 'limiterRpm',
    jump: 1200,
    name: '断火转速',
    unit: 'rpm',
    digits: 0,
    step: [400, 50],
  },
  {
    side: 'ecu',
    key: 'idleRpm',
    jump: 400,
    name: '怠速目标',
    unit: 'rpm',
    digits: 0,
    step: [150, 25],
  },
  {
    side: 'ecu',
    key: 'limiterMode',
    name: '断火方式',
    unit: '',
    digits: 0,
    values: ['spark', 'fuel'],
  },
  {
    side: 'ecu',
    key: 'overrunFuelCut',
    name: '松油门断油',
    unit: '',
    digits: 0,
    values: [true, false],
  },
  {
    side: 'ecu',
    key: 'knockControl',
    name: '爆震控制',
    unit: '',
    digits: 0,
    values: [true, false],
  },
];

const CAM = ['intakeDuration', 'exhaustDuration', 'intakeLift', 'exhaustLift', 'lobeSeparation', 'intakeCenterline'];
const BREATHING = [
  ...CAM,
  'intakeValves',
  'exhaustValves',
  'intakeValveDiameter',
  'exhaustValveDiameter',
  'throttleDiameter',
  'intakeRunnerLength',
  'intakeRunnerDiameter',
  'exhaustHeaderLength',
  'exhaustHeaderDiameter',
  'muffler',
  'compressionRatio',
  'bore',
  'stroke',
  'fuelOctane',
  'advanceOffset',
  'wotLambda',
  'knockControl',
];
const TOP_END = ['valveSpringForce', 'reciprocatingMass', 'rodStrength', 'limiterRpm'];
const FORCED = ['injectorFlow', 'turboSize', 'intercooler', 'boostAll', 'plenumVolume', 'vvtRange', 'cruiseLambda'];
const IDLE = ['idleRpm', 'overrunResumeAbove', 'dashpot', 'idleSparkReserve', 'idleGain', 'flywheelInertia', 'overrunFuelCut', 'accelEnrich'];
const LAUNCH = ['launchRpm', 'tractionControl', 'wheelieControl', 'clutchRelease', 'firstGear', 'finalDrive', 'tireGrip', 'cgHeight', 'wheelbase', 'clutchCapacity', 'antiLag'];
const RUN = [...BREATHING, ...TOP_END, ...FORCED, 'shiftAll', 'gearSpread', 'finalDrive', 'mass', 'quickshifter', 'cdA', 'flywheelInertia', 'accelEnrich'];

/** Which knobs can move each goal. */
const RELEVANT: Record<GoalKind, string[]> = {
  peakHp: [...BREATHING, ...TOP_END, ...FORCED],
  hpAt: [...BREATHING, ...TOP_END, ...FORCED],
  peakTorque: [...BREATHING, ...FORCED],
  torqueAt: [...BREATHING, ...FORCED],
  limiterMin: [...TOP_END, 'rodLength'],
  limiterMax: ['limiterRpm'],
  idleMin: [...IDLE, 'cruiseLambda', 'lobeSeparation', 'intakeCenterline'],
  freeRev: ['flywheelInertia', 'idleRpm', 'throttleDiameter', 'reciprocatingMass'],
  pops: ['overrunFuelCut', 'wotLambda', 'limiterMode', 'muffler', 'exhaustHeaderLength', 'exhaustHeaderDiameter', 'cruiseLambda'],
  budget: [],
  ccMax: ['bore', 'stroke'],
  octaneMax: ['fuelOctane'],
  piston: ['advanceOffset', 'knockControl', 'compressionRatio', 'fuelOctane'],
  rod: ['limiterRpm', 'reciprocatingMass', 'rodStrength'],
  coolant: ['radiatorCapacity'],
  blipMin: IDLE,
  raceTime: [...RUN, ...LAUNCH],
  topSpeed: [...RUN.filter((k) => k !== 'firstGear')],
};

export function knobsFor(brief: Brief, start?: Tried): Knob[] {
  // The safety floor only brings its knobs in when it is actually broken.
  const live = effectiveGoals(brief.goals).filter((g) => brief.goals.includes(g) || !start || (gap(g, ctxOf(start)) ?? 0) > 0);
  const keys = new Set(live.flatMap((g) => RELEVANT[g.kind]));
  return KNOBS.filter((k) => {
    if (!keys.has(k.key)) return false;
    if (k.side === 'ecu') return brief.ecu && !(k.key in brief.lock);
    if (k.side === 'vehicle') return k.part === undefined || brief.vehicleParts.includes(k.part as VehiclePartId);
    return k.part !== undefined && brief.parts.includes(k.part as PartId);
  });
}

/** Gear ratios rebuilt from a first gear and a geometric spread to the others. */
function regear(v: VehicleConfig, first: number, spread: number): number[] {
  return v.gears.map((_, i) => first / Math.pow(spread, i));
}
function spreadOf(v: VehicleConfig): number {
  return Math.pow(v.gears[0]! / v.gears[v.gears.length - 1]!, 1 / (v.gears.length - 1));
}

/** Fit the build within the brief and what the parts survive. */
export function repair(b: Build, brief: Brief): Build {
  let config = clampConfig(b.config);
  const octane = brief.goals.find((g) => g.kind === 'octaneMax' && g.must);
  if (octane && config.fuelOctane > octane.value) config = { ...config, fuelOctane: octane.value };
  if (brief.mufflers && !brief.mufflers.includes(config.muffler)) config = { ...config, muffler: brief.mufflers[0]! };
  const safe = Math.floor(safeLimiterRpm(config) / 50) * 50;
  // The wish may pull the limiter up to a target as parts allow, never past
  // both the target and what the parts survive today.
  const floor = Math.max(safe, ...brief.goals.filter((g) => g.kind === 'limiterMin').map((g) => g.value));
  const wish = Math.max(2000, Math.min(16000, floor, b.wish));
  const ecu = clampEcu({
    ...b.ecu,
    ...brief.lock,
    limiterRpm: Math.min(wish, safe),
  });
  // Vehicle parts the brief does not allow stay as they were.
  let vehicle = clampVehicle(b.vehicle);
  for (const p of VEHICLE_PARTS) {
    if (brief.vehicleParts.includes(p.id)) continue;
    for (const k of p.keys) (vehicle as unknown as Record<string, unknown>)[k] = brief.vehicle[k];
  }
  vehicle = clampVehicle(vehicle);
  return { config, ecu, vehicle, wish };
}

function read(b: Build, k: Knob): number | string | boolean {
  if (k.key === 'boostAll') return Math.max(...b.ecu.boostTable);
  if (k.key === 'shiftAll') return b.ecu.shiftRpm[0]! > 0 ? b.ecu.shiftRpm[0]! : b.ecu.limiterRpm - 150;
  if (k.key === 'gearSpread') return Math.round(spreadOf(b.vehicle) * 100) / 100;
  if (k.key === 'firstGear') return b.vehicle.gears[0]!;
  const src = k.side === 'config' ? b.config : k.side === 'ecu' ? b.ecu : b.vehicle;
  return (src as unknown as Record<string, unknown>)[k.key] as number | string | boolean;
}

function write(b: Build, k: Knob, v: number | string | boolean): Build {
  if (k.side === 'ecu' && k.key === 'limiterRpm') return { ...b, wish: v as number };
  if (k.key === 'boostAll') {
    const top = Math.max(1, ...b.ecu.boostTable);
    const n = Math.max(0, Math.min(200, v as number));
    // Keep the shape, move the level; a flat table becomes a flat target.
    const t = Math.max(...b.ecu.boostTable) > 0 ? b.ecu.boostTable.map((x) => Math.round((x / top) * n)) : b.ecu.boostTable.map(() => n);
    return { ...b, ecu: { ...b.ecu, boostTable: t } };
  }
  if (k.key === 'shiftAll') return { ...b, ecu: { ...b.ecu, shiftRpm: b.ecu.shiftRpm.map(() => Math.max(2000, Math.round((v as number) / 50) * 50)) } };
  if (k.key === 'gearSpread') return { ...b, vehicle: { ...b.vehicle, gears: regear(b.vehicle, b.vehicle.gears[0]!, Math.max(1.05, v as number)) } };
  if (k.key === 'firstGear') return { ...b, vehicle: { ...b.vehicle, gears: regear(b.vehicle, v as number, spreadOf(b.vehicle)) } };
  if (k.side === 'config') return { ...b, config: { ...b.config, [k.key]: v } };
  if (k.side === 'ecu') return { ...b, ecu: { ...b.ecu, [k.key]: v } };
  return { ...b, vehicle: { ...b.vehicle, [k.key]: v } };
}

function show(k: Knob, v: number | string | boolean): string {
  if (typeof v === 'boolean') return v ? '开' : '关';
  if (typeof v === 'string')
    return (
      (
        {
          stock: '原厂',
          sport: '运动',
          open: '直通',
          spark: '断火',
          fuel: '断油',
        } as Record<string, string>
      )[v] ?? v
    );
  return `${k.digits === 0 ? Math.round(v).toLocaleString('en-US') : v.toFixed(k.digits)}${k.unit && k.unit !== '个' ? ` ${k.unit}` : k.unit}`;
}

interface Move {
  knob: Knob;
  /** +1 / −1 for numeric knobs; the value for discrete ones. */
  dir: number;
  value: number | string | boolean;
}

function snap(k: Knob, v: number): number {
  const fine = k.side === 'config' ? CONFIG_LIMITS[k.key as keyof typeof CONFIG_LIMITS][2] : k.step![1];
  return Math.round(v / fine) * fine;
}

const sig = (b: Build): string => JSON.stringify([b.config, b.ecu, b.vehicle]);

function sameBuild(a: Build, b: Build): boolean {
  return sig(a) === sig(b);
}

/** The one-line story of what a change did, in terms of the goal it moved most. */
function headline(goals: Goal[], before: Tried, after: Tried): string {
  let best: { g: Goal; d: number } | null = null;
  for (const g of effectiveGoals(goals)) {
    const a = gap(g, ctxOf(before));
    const b = gap(g, ctxOf(after));
    if (a === null || b === null) continue;
    const d = (Math.max(a, -0.08) - Math.max(b, -0.08)) * (g.must ? 3 : 1);
    if (!best || d > best.d) best = { g, d };
  }
  if (!best || best.d <= 0) return after.score.survived && !before.score.survived ? '不坏了' : '综合更好';
  const m = GOALS[best.g.kind];
  const v0 = m.measure(best.g, ctxOf(before));
  const v1 = m.measure(best.g, ctxOf(after));
  const name = goalName(best.g);
  const f = (v: number | null): string => (v === null ? '—' : m.digits === 0 ? Math.round(v).toLocaleString('en-US') : v.toFixed(m.digits));
  return `${name} ${f(v0)} → ${f(v1)}${best.g.kind === 'budget' ? '' : ` ${m.unit}`}`;
}

export function ctxOf(t: Tried): GoalCtx {
  return { config: t.config, ecu: t.ecu, cost: t.cost, result: t.result, races: t.races };
}

export function costOf(brief: Brief, b: Build): number {
  return buildCost(brief.baseline, b.config) + vehicleCost(brief.vehicleBaseline, b.vehicle);
}

function partsText(baseline: EngineConfig, config: EngineConfig): string {
  const parts = PARTS.filter((p) => p.keys.some((k) => baseline[k] !== config[k]));
  return parts.length ? parts.map((p) => p.name).join('、') : '不换零件';
}

/**
 * Work towards the brief from `from`. Resolves with the best build found,
 * re-run on the full schedule.
 */
export async function search(brief: Brief, from: Build, hooks: SearchHooks, budget = 300): Promise<SearchOutcome> {
  const goals = brief.goals;
  const quickPlan = quickPlanFor(effectiveGoals(goals), brief.plan);
  const events = eventsFor(goals);
  const fullPlan: AcceptancePlan = {
    ...planFor(effectiveGoals(goals), brief.plan),
  };
  let tried = 0;
  const seen = new Map<string, Tried>();
  /** The goals being scored: the brief's, raised if the screening runs read optimistic. */
  let aim: Goal[] = goals;
  // Every knob moved away from where the player had it costs a little, so
  // nothing gets changed for a gain that is only noise.
  const fromCfg = from.config as unknown as Record<string, unknown>;
  const fromEcu = from.ecu as unknown as Record<string, unknown>;
  const churn = (c: GoalCtx): number => {
    let n = 0;
    for (const [k, v] of Object.entries(c.config)) if (fromCfg[k] !== v) n++;
    for (const [k, v] of Object.entries(c.ecu)) if (k !== 'limiterRpm' && fromEcu[k] !== v) n++;
    return n * 0.08;
  };
  // Builds that sit right on the knock line read lucky in one run and
  // unlucky in the next; a little pressure keeps the search off that edge.
  const edge = (c: GoalCtx): number => Math.min(3, (c.result?.knockEvents ?? 0) * 0.03);
  const judge = (c: GoalCtx): Score => {
    const sc = score(aim, c);
    return { ...sc, loss: sc.loss + churn(c) + edge(c) };
  };

  const run = async (builds: Build[], plan: AcceptancePlan): Promise<Tried[]> => {
    const fixed = builds.map((b) => repair(b, brief));
    const todo = fixed.filter((b) => plan !== quickPlan || !seen.has(sig(b)));
    const results = todo.length ? await hooks.evaluate(todo.map((b) => ({ config: b.config, ecu: b.ecu, vehicle: b.vehicle, plan, events }))) : [];
    if (plan === quickPlan) tried += todo.length;
    const fresh = todo.map((b, i): Tried => {
      const cost = costOf(brief, b);
      const { result, races } = results[i]!;
      return {
        ...b,
        result,
        races,
        cost,
        score: judge({ config: b.config, ecu: b.ecu, cost, result, races }),
      };
    });
    if (plan !== quickPlan) return fresh;
    for (const t of fresh) seen.set(sig(t), t);
    return fixed.map((b) => seen.get(sig(b))!);
  };

  hooks.stage('先把原样跑一遍');
  const startWish = Math.max(from.wish, ...goals.filter((g) => g.kind === 'limiterMin').map((g) => g.value));
  const [start] = await run([{ ...from, wish: startWish }], quickPlan);
  let cur = start!;
  hooks.log(`原样：${summary(goals, cur)}`);
  if (cur.ecu.limiterRpm !== from.ecu.limiterRpm) {
    hooks.log(`断火转速按零件能扛的先定在 ${cur.ecu.limiterRpm.toLocaleString('en-US')}。`);
  }
  hooks.progress(cur, tried, budget);

  const knobs = knobsFor(brief, cur);
  const step = new Map<Knob, number>(knobs.filter((k) => k.step).map((k) => [k, k.step![0]]));
  const done = new Set<Knob>();
  /** Knobs in the order they get tried; winners move to the front. */
  let queue = [...knobs].sort((a, b) => (a.side === 'ecu' ? 0 : 1) - (b.side === 'ecu' ? 0 : 1));
  const lastDir = new Map<Knob, number>();
  let stoppedEarly = false;
  let metAt = -1;
  let verified: Tried;
  // Free things first (the ECU, the fuel); parts only when that is not enough.
  const isFree = (k: Knob): boolean => k.side === 'ecu' || (k.side === 'vehicle' && !k.part) || PARTS.find((p) => p.id === k.part)?.price === 0;
  const active = new Set(knobs.some(isFree) && knobs.some((k) => !isFree(k)) ? knobs.filter(isFree) : knobs);

  let shakes = 0;
  const jumpOf = (k: Knob): number => {
    if (k.jump) return k.jump;
    if (k.side === 'config') {
      const [lo, hi] = CONFIG_LIMITS[k.key as keyof typeof CONFIG_LIMITS];
      return (hi - lo) / 4;
    }
    const lim = VEHICLE_LIMITS[k.key as keyof typeof VEHICLE_LIMITS];
    return lim ? (lim[1] - lim[0]) / 4 : k.step![0] * 3;
  };
  /** Long jumps on every numeric knob; take the best if any helps. */
  const jump = async (): Promise<boolean> => {
    const moves: Move[] = [];
    for (const k of queue) {
      if (!k.step || !active.has(k) || (k.when && !k.when(cur))) continue;
      const base = k.key === 'limiterRpm' ? cur.wish : (read(cur, k) as number);
      for (const d of [1, -1]) {
        const m: Move = { knob: k, dir: d, value: snap(k, base + d * jumpOf(k)) };
        if (!sameBuild(repair(write(cur, k, m.value), brief), cur)) moves.push(m);
      }
    }
    for (let i = 0; i < moves.length && tried < budget; i += hooks.width) {
      if (hooks.stopped()) return false;
      const batch = moves.slice(i, i + hooks.width);
      const res = await run(
        batch.map((m) => write(cur, m.knob, m.value)),
        quickPlan,
      );
      let bi = -1;
      for (let j = 0; j < res.length; j++) if (res[j]!.score.loss < (bi < 0 ? cur.score.loss - 1e-6 : res[bi]!.score.loss)) bi = j;
      if (bi < 0) continue;
      const m = batch[bi]!;
      const next = res[bi]!;
      const f0 = m.knob.key === 'limiterRpm' ? cur.ecu.limiterRpm : read(cur, m.knob);
      const t0 = m.knob.key === 'limiterRpm' ? next.ecu.limiterRpm : read(next, m.knob);
      hooks.log(`跳一大步，${m.knob.name} ${show(m.knob, f0)} → ${show(m.knob, t0)}：${headline(aim, cur, next)}`);
      cur = next;
      done.clear();
      for (const k of knobs) if (k.step) step.set(k, k.step[0]);
      lastDir.clear();
      if (m.knob.step) lastDir.set(m.knob, m.dir);
      queue = [m.knob, ...queue.filter((k) => k !== m.knob)];
      hooks.progress(cur, tried, budget);
      return true;
    }
    return false;
  };

  hooks.stage(active.size < knobs.length ? '先调不花钱的' : `试改 ${knobs.length} 个地方`);
  for (let attempt = 0; ; attempt++) {
    while (tried < budget) {
      if (hooks.stopped()) {
        stoppedEarly = true;
        break;
      }
      const live = queue.filter((k) => active.has(k) && !done.has(k) && (!k.when || k.when(cur)));
      // The free phase gets a third of the tries at most.
      if (active.size < knobs.length && (live.length === 0 || tried > budget * 0.3)) {
        if (cur.score.allMet) break;
        for (const k of knobs) active.add(k);
        done.clear();
        hooks.log('不花钱的都调到头了，还不够。开始考虑换零件。');
        hooks.stage(`试改 ${knobs.length} 个地方`);
        continue;
      }
      if (live.length === 0) {
        // Converged. Small steps can sit on a flat stretch between two
        // resonances, so look further out once before calling it.
        if (shakes >= 2 || tried >= budget) break;
        shakes++;
        hooks.stage('小步试不动了，往远处试试');
        const jumped = await jump();
        if (!jumped) break;
        hooks.stage(`接着细调`);
        continue;
      }
      // Fill a batch with moves, each knob both ways unless it has a direction that worked.
      const moves: Move[] = [];
      const batchKnobs: Knob[] = [];
      for (const k of live) {
        if (moves.length >= hooks.width) break;
        const now = read(cur, k);
        const mine: Move[] = [];
        if (k.values) {
          for (const v of k.values) {
            if (v === now) continue;
            if (k.key === 'muffler' && brief.mufflers && !brief.mufflers.includes(v as MufflerType)) continue;
            mine.push({ knob: k, dir: 0, value: v });
          }
        } else {
          const s = step.get(k)!;
          const base = k.key === 'limiterRpm' ? cur.wish : (now as number);
          const pref = lastDir.get(k);
          const dirs = pref ? [pref] : [1, -1];
          for (const d of dirs) mine.push({ knob: k, dir: d, value: snap(k, base + d * s) });
        }
        const useful = mine.filter((m) => !sameBuild(repair(write(cur, k, m.value), brief), cur));
        if (useful.length === 0) {
          if (k.step && step.get(k)! > k.step[1] * 1.01) step.set(k, Math.max(k.step[1], step.get(k)! / 2));
          else done.add(k);
          lastDir.delete(k);
          continue;
        }
        moves.push(...useful);
        batchKnobs.push(k);
      }
      if (moves.length === 0) continue;

      const results = await run(
        moves.map((m) => write(cur, m.knob, m.value)),
        quickPlan,
      );
      if (hooks.stopped()) {
        stoppedEarly = true;
        break;
      }
      let bestI = -1;
      for (let i = 0; i < results.length; i++) if (results[i]!.score.loss < (bestI < 0 ? cur.score.loss - 1e-6 : results[bestI]!.score.loss)) bestI = i;

      const winners = new Set<Knob>();
      /** Each winning knob's best move. */
      const bestOf = new Map<Knob, number>();
      for (let i = 0; i < results.length; i++) {
        if (results[i]!.score.loss >= cur.score.loss - 1e-6) continue;
        const k = moves[i]!.knob;
        winners.add(k);
        const j = bestOf.get(k);
        if (j === undefined || results[i]!.score.loss < results[j]!.score.loss) bestOf.set(k, i);
      }

      // Several knobs helped on their own: try them all together.
      let combo: Tried | null = null;
      if (bestOf.size >= 2 && tried < budget) {
        let b: Build = cur;
        for (const i of bestOf.values()) b = write(b, moves[i]!.knob, moves[i]!.value);
        combo = (await run([b], quickPlan))[0] ?? null;
        if (combo && combo.score.loss >= results[bestI]!.score.loss) combo = null;
      }

      if (combo) {
        const names = [...bestOf.keys()].map((k) => k.name).join('、');
        hooks.log(`${names}一起改：${headline(aim, cur, combo)}`);
        cur = combo;
        for (const [k, i] of bestOf) {
          if (!k.step) continue;
          step.set(k, Math.min(k.step[0] * 2, step.get(k)! * 1.5));
          lastDir.set(k, moves[i]!.dir);
        }
        for (const k of done) if (k.step) step.set(k, Math.max(k.step[1], k.step[0] / 4));
        done.clear();
        hooks.progress(cur, tried, budget);
      } else if (bestI >= 0) {
        const m = moves[bestI]!;
        const next = results[bestI]!;
        const from0 = m.knob.key === 'limiterRpm' ? cur.ecu.limiterRpm : read(cur, m.knob);
        const to0 = m.knob.key === 'limiterRpm' ? next.ecu.limiterRpm : read(next, m.knob);
        hooks.log(`${m.knob.name} ${show(m.knob, from0)} → ${show(m.knob, to0)}：${headline(aim, cur, next)}`);
        cur = next;
        if (m.knob.step) {
          step.set(m.knob, Math.min(m.knob.step[0] * 2, step.get(m.knob)! * 1.5));
          lastDir.set(m.knob, m.dir);
        }
        // Everything else might have a new best value now.
        for (const k of done) if (k.step) step.set(k, Math.max(k.step[1], k.step[0] / 4));
        done.clear();
        hooks.progress(cur, tried, budget);
      }
      // Losers take a smaller step next time; winners go to the front.
      for (const k of batchKnobs) {
        if (winners.has(k) && k !== moves[bestI]?.knob) continue;
        if (k === moves[bestI]?.knob) continue;
        lastDir.delete(k);
        if (k.step && step.get(k)! > k.step[1] * 1.01) step.set(k, Math.max(k.step[1], step.get(k)! / 2));
        else done.add(k);
      }
      const front = queue.filter((k) => winners.has(k));
      queue = [...front, ...queue.filter((k) => !winners.has(k) && !batchKnobs.includes(k)), ...batchKnobs.filter((k) => !winners.has(k))];
      hooks.progress(cur, tried, budget);

      // Everything met: a few more rounds for headroom, then stop.
      if (cur.score.allMet && metAt < 0) {
        metAt = tried;
        hooks.log(attempt === 0 ? '要求全达到了。再抠几轮余量，然后看哪些零件可以不换。' : '这回留够余量了。');
      }
      if (metAt >= 0 && tried - metAt >= Math.max(24, hooks.width * 4)) break;
    }

    // Hand back parts that are not pulling their weight.
    if (!stoppedEarly && cur.score.mustMet && cur.cost > 0) {
      hooks.stage('看看哪些零件可以不换');
      for (;;) {
        if (hooks.stopped()) break;
        // Engine and vehicle parts alike, each with what putting it back means.
        const changed: { name: string; price: number; back: (b: Build) => Build }[] = [
          ...PARTS.filter((p) => p.price > 0 && p.keys.some((k) => brief.baseline[k] !== cur.config[k])).map((p) => ({
            name: p.name,
            price: p.price,
            back: (b: Build): Build => {
              const config = { ...b.config };
              for (const k of p.keys) (config as Record<string, unknown>)[k] = brief.baseline[k];
              return { ...b, config };
            },
          })),
          ...VEHICLE_PARTS.filter((p) => p.keys.some((k) => JSON.stringify(brief.vehicleBaseline[k]) !== JSON.stringify(cur.vehicle[k]))).map((p) => ({
            name: p.name,
            price: p.price,
            back: (b: Build): Build => {
              const vehicle = { ...b.vehicle };
              for (const k of p.keys) (vehicle as Record<string, unknown>)[k] = brief.vehicleBaseline[k];
              return { ...b, vehicle };
            },
          })),
        ];
        if (changed.length === 0) break;
        // Each part put back, with the spark re-found around it: a part
        // that changed the knock limit leaves the old spark wrong.
        const spark = knobs.find((k) => k.key === 'advanceOffset');
        const offsets = spark ? [0, -2, 2, -4] : [0];
        const owner: number[] = [];
        const trials: Build[] = [];
        changed.forEach((p, i) => {
          const back = p.back(cur);
          for (const o of offsets) {
            owner.push(i);
            trials.push({ ...back, ecu: { ...back.ecu, advanceOffset: Math.max(-20, Math.min(20, cur.ecu.advanceOffset + o)) } });
          }
        });
        const res = await run(trials, quickPlan);
        let pick = -1;
        for (let i = 0; i < res.length; i++) {
          const r = res[i]!;
          const keeps = cur.score.allMet ? r.score.allMet : r.score.mustMet && r.score.loss <= cur.score.loss + 0.5;
          if (!keeps) continue;
          const better = pick < 0 || changed[owner[i]!]!.price > changed[owner[pick]!]!.price || (owner[i] === owner[pick] && r.score.loss < res[pick]!.score.loss);
          if (better) pick = i;
        }
        if (pick < 0) break;
        hooks.log(`${changed[owner[pick]!]!.name}不换也够，退了，省 ¥${changed[owner[pick]!]!.price}。`);
        cur = res[pick]!;
        hooks.progress(cur, tried, budget);
      }
    }

    hooks.stage('按正式验收再跑一遍');
    verified = (await run([cur], fullPlan))[0]!;
    // Judge the real run against the real brief.
    verified = { ...verified, score: score(goals, ctxOf(verified)) };
    // Retry only if the real run lost something the screening run had.
    const lost = goals.some((g) => (gap(g, ctxOf(cur)) ?? 1) <= 0 && (gap(g, ctxOf(verified)) ?? 0) > 0);
    if (stoppedEarly || hooks.stopped() || attempt >= 2 || verified.score.allMet || !lost) break;

    // The screening run said yes, the real one no: raise the bar by the gap and keep going.
    const raised: Goal[] = aim.map((g) => {
      const real = gap(g, ctxOf(verified));
      const quick = GOALS[g.kind].measure(g, ctxOf(cur));
      const full = GOALS[g.kind].measure(g, ctxOf(verified));
      if (real === null || real <= 0 || quick === null || full === null) return g;
      const bump = Math.abs(quick - full) * 1.3 + GOALS[g.kind].scale(g.value) * 0.004;
      return {
        ...g,
        value: GOALS[g.kind].dir === 'min' ? g.value + bump : g.value - bump,
      };
    });
    hooks.log(`正式跑下来差一点（${summary(goals, verified)}）。快测偏乐观，目标往上提一点再找。`);
    aim = raised;
    for (const [k, t] of seen) seen.set(k, { ...t, score: judge(ctxOf(t)) });
    cur = { ...cur, score: judge(ctxOf(cur)) };
    metAt = -1;
    done.clear();
    for (const k of knobs) if (k.step) step.set(k, Math.max(k.step[1], k.step[0] / 2));
    budget = tried + Math.max(40, hooks.width * 8);
    hooks.stage('留余量，接着试');
  }
  return { best: cur, start: start!, verified, tried, stoppedEarly };
}

/** Short name of what a goal measures, for log lines. */
export function goalName(g: Goal): string {
  const m = GOALS[g.kind];
  if (m.hasRpm) return `${Math.round(g.rpm ?? 0)} rpm ${g.kind === 'torqueAt' ? '扭矩' : '功率'}`;
  if (g.kind === 'raceTime') return RACE_EVENTS[g.event ?? 'drag100'].name;
  return m.name.replace(/至多|至少|最低不掉到|上限|不低于/, '');
}

/** One line: every goal's value, ✔ or ✘. */
export function summary(goals: Goal[], t: Tried): string {
  const out: string[] = [];
  if (!t.score.survived) out.push(t.result.started ? `坏了（${t.result.failure?.title ?? ''}）` : '打不着');
  for (const g of goals) {
    const m = GOALS[g.kind];
    const v = m.measure(g, ctxOf(t));
    if (v === null) continue;
    const d = gap(g, ctxOf(t))!;
    const name = goalName(g);
    const f = m.digits === 0 ? Math.round(v).toLocaleString('en-US') : v.toFixed(m.digits);
    out.push(`${name} ${g.kind === 'budget' ? `¥${f}` : `${f} ${m.unit}`}${d <= 0 ? '✔' : '✘'}`);
  }
  return out.join('，');
}

export { goalText, partsText };
