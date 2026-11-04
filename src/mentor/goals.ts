/**
 * Targets the player hands to 老周, and how far a build is from them.
 *
 * Every goal turns a build + acceptance result into one number, and says
 * which way is better. The search only ever sees `loss()`.
 */

import { hpOf, torqueAt, type AcceptancePlan, type AcceptanceResult } from '../game/acceptance';
import type { Job } from '../game/jobs';
import { PARTS, type PartId } from '../game/parts';
import { displacementCc, type EcuConfig, type EngineConfig, type MufflerType } from '../sim/config';
import { RACE_EVENTS, type RaceEventId, type RaceResult } from '../sim/race';
import { VEHICLE_PARTS, clampVehicle, type VehicleConfig, type VehiclePartId } from '../sim/vehicle';

export type GoalKind =
  | 'peakHp'
  | 'peakTorque'
  | 'torqueAt'
  | 'hpAt'
  | 'limiterMin'
  | 'limiterMax'
  | 'idleMin'
  | 'freeRev'
  | 'pops'
  | 'budget'
  | 'ccMax'
  | 'octaneMax'
  | 'piston'
  | 'rod'
  | 'coolant'
  | 'blipMin'
  | 'raceTime'
  | 'topSpeed';

export interface Goal {
  kind: GoalKind;
  value: number;
  /** For the at-rpm goals. */
  rpm?: number;
  /** For timed-run goals. */
  event?: RaceEventId;
  /** A must counts three times a nice-to-have. */
  must: boolean;
}

export interface GoalCtx {
  config: EngineConfig;
  ecu: EcuConfig;
  cost: number;
  result: AcceptanceResult | null;
  /** Timed runs, when the goals need them. */
  races?: Partial<Record<RaceEventId, RaceResult>>;
}

interface GoalMeta {
  name: string;
  unit: string;
  /** 'min': at least the value; 'max': at most. */
  dir: 'min' | 'max';
  digits: number;
  /** Shortfalls are divided by this, so goals of different units weigh alike. */
  scale: (v: number) => number;
  measure: (g: Goal, c: GoalCtx) => number | null;
  /** Typical first value when the player adds this goal. */
  suggest: (c: GoalCtx) => number;
  hasRpm?: boolean;
  /** Needs a timed run on the strip. */
  hasEvent?: boolean;
}

/** A timed run's number; a run that did not finish counts as far off. */
function raceValue(g: Goal, c: GoalCtx): number | null {
  if (!c.races) return null;
  const r = c.races[g.event ?? 'drag100'];
  if (!r) return null;
  if (r.dnf) return g.kind === 'topSpeed' ? r.topKmh * 0.7 : Math.max(g.value * 1.6, (r.time ?? RACE_EVENTS[r.event].timeLimit) * 1.2);
  return g.kind === 'topSpeed' ? r.topKmh : r.time!;
}

const r50 = (v: number): number => Math.round(v / 50) * 50;

export const GOALS: Record<GoalKind, GoalMeta> = {
  peakHp: {
    name: '最大功率',
    unit: 'hp',
    dir: 'min',
    digits: 1,
    scale: (v) => Math.max(1, v),
    measure: (_g, c) => c.result?.peakHp ?? null,
    suggest: (c) => Math.ceil((c.result?.peakHp ?? 20) * 1.1),
  },
  peakTorque: {
    name: '最大扭矩',
    unit: 'Nm',
    dir: 'min',
    digits: 1,
    scale: (v) => Math.max(1, v),
    measure: (_g, c) => c.result?.peakTorque ?? null,
    suggest: (c) => Math.ceil((c.result?.peakTorque ?? 25) * 1.08),
  },
  torqueAt: {
    name: '指定转速扭矩',
    unit: 'Nm',
    dir: 'min',
    digits: 1,
    hasRpm: true,
    scale: (v) => Math.max(1, v),
    measure: (g, c) => (c.result ? torqueAt(c.result.curve, g.rpm ?? 3000) : null),
    suggest: (c) => Math.ceil((c.result?.peakTorque ?? 25) * 1.0),
  },
  hpAt: {
    name: '指定转速功率',
    unit: 'hp',
    dir: 'min',
    digits: 1,
    hasRpm: true,
    scale: (v) => Math.max(1, v),
    measure: (g, c) => (c.result ? hpOf(g.rpm ?? 6000, torqueAt(c.result.curve, g.rpm ?? 6000)) : null),
    suggest: (c) => Math.ceil((c.result?.peakHp ?? 20) * 0.95),
  },
  limiterMin: {
    name: '断火转速至少',
    unit: 'rpm',
    dir: 'min',
    digits: 0,
    scale: (v) => Math.max(500, v * 0.25),
    measure: (_g, c) => c.ecu.limiterRpm,
    suggest: (c) => r50(c.ecu.limiterRpm + 500),
  },
  limiterMax: {
    name: '断火转速至多',
    unit: 'rpm',
    dir: 'max',
    digits: 0,
    scale: (v) => Math.max(500, v * 0.25),
    measure: (_g, c) => c.ecu.limiterRpm,
    suggest: (c) => r50(c.ecu.limiterRpm),
  },
  idleMin: {
    name: '怠速最低不掉到',
    unit: 'rpm',
    dir: 'min',
    digits: 0,
    scale: (v) => Math.max(300, v * 0.5),
    measure: (_g, c) => (c.result ? (c.result.idle?.min ?? 0) : null),
    suggest: (c) => r50(Math.max(900, c.ecu.idleRpm - 300)),
  },
  freeRev: {
    name: '空轰到红线',
    unit: '秒',
    dir: 'max',
    digits: 2,
    scale: (v) => Math.max(0.1, v),
    // Never got there: count it as three seconds.
    measure: (_g, c) => (c.result ? (c.result.freeRevTime ?? 3) : null),
    suggest: () => 0.55,
  },
  pops: {
    name: '收油放炮',
    unit: '响',
    dir: 'min',
    digits: 0,
    scale: (v) => Math.max(30, v),
    measure: (_g, c) => c.result?.pops ?? null,
    suggest: () => 250,
  },
  budget: {
    name: '零件预算',
    unit: '¥',
    dir: 'max',
    digits: 0,
    scale: (v) => Math.max(800, v),
    measure: (_g, c) => c.cost,
    suggest: () => 1500,
  },
  ccMax: {
    name: '排量上限',
    unit: 'cc',
    dir: 'max',
    digits: 0,
    scale: (v) => Math.max(50, v * 0.2),
    measure: (_g, c) => displacementCc(c.config),
    suggest: (c) => Math.round(displacementCc(c.config)),
  },
  octaneMax: {
    name: '燃油标号至多',
    unit: '号',
    dir: 'max',
    digits: 0,
    scale: () => 5,
    measure: (_g, c) => c.config.fuelOctane,
    suggest: (c) => c.config.fuelOctane,
  },
  piston: {
    name: '活塞损伤至多',
    unit: '%',
    dir: 'max',
    digits: 1,
    scale: () => 3,
    measure: (_g, c) => (c.result ? c.result.pistonDamage * 100 : null),
    suggest: () => 2,
  },
  rod: {
    name: '连杆疲劳至多',
    unit: '%',
    dir: 'max',
    digits: 1,
    scale: () => 5,
    measure: (_g, c) => (c.result ? c.result.rodFatigue * 100 : null),
    suggest: () => 2,
  },
  blipMin: {
    name: '轰油回怠速不低于',
    unit: 'rpm',
    dir: 'min',
    digits: 0,
    scale: (v) => Math.max(300, v * 0.5),
    measure: (_g, c) => (c.result ? (c.result.blip ? c.result.blip.min : (c.result.idle?.min ?? 0)) : null),
    suggest: (c) => r50(Math.max(800, c.ecu.idleRpm * 0.7)),
  },
  raceTime: {
    name: '比赛用时',
    unit: '秒',
    dir: 'max',
    digits: 2,
    hasEvent: true,
    scale: (v) => Math.max(0.5, v * 0.12),
    measure: (g, c) => raceValue(g, c),
    suggest: (c) => {
      const r = c.races?.drag100;
      return r?.time ? Math.round(r.time * 0.9 * 10) / 10 : 8;
    },
  },
  topSpeed: {
    name: '极速',
    unit: 'km/h',
    dir: 'min',
    digits: 1,
    hasEvent: true,
    scale: (v) => Math.max(10, v * 0.1),
    measure: (g, c) => raceValue({ ...g, event: 'top' }, c),
    suggest: (c) => Math.ceil((c.races?.top?.topKmh ?? 120) * 1.08),
  },
  coolant: {
    name: '水温至多',
    unit: '°C',
    dir: 'max',
    digits: 0,
    scale: () => 20,
    measure: (_g, c) => c.result?.coolantMax ?? null,
    suggest: () => 110,
  },
};

/** The order goals are offered in the picker. */
export const GOAL_ORDER: GoalKind[] = [
  'peakHp',
  'peakTorque',
  'torqueAt',
  'hpAt',
  'limiterMin',
  'idleMin',
  'freeRev',
  'pops',
  'budget',
  'ccMax',
  'octaneMax',
  'piston',
  'rod',
  'limiterMax',
  'coolant',
  'blipMin',
  'raceTime',
  'topSpeed',
];

export function fmtGoalValue(kind: GoalKind, v: number): string {
  const m = GOALS[kind];
  if (kind === 'budget') return `¥${Math.round(v).toLocaleString('en-US')}`;
  const text = m.digits === 0 ? Math.round(v).toLocaleString('en-US') : v.toFixed(m.digits);
  return `${text} ${m.unit}`;
}

export function goalText(g: Goal): string {
  const m = GOALS[g.kind];
  if (g.kind === 'raceTime') return `${RACE_EVENTS[g.event ?? 'drag100'].name} ≤ ${g.value.toFixed(2)} 秒`;
  if (g.kind === 'topSpeed') return `极速 ≥ ${g.value.toFixed(0)} km/h`;
  const at = m.hasRpm ? `${Math.round(g.rpm ?? 0).toLocaleString('en-US')} rpm ` : '';
  const name = m.hasRpm ? (g.kind === 'torqueAt' ? '扭矩' : '功率') : m.name;
  return `${at}${name} ${m.dir === 'min' ? '≥' : '≤'} ${fmtGoalValue(g.kind, g.value)}`;
}

/** How far short of the goal, as a fraction of its scale; 0 when met. Negative: slack. */
export function gap(g: Goal, c: GoalCtx): number | null {
  const v = GOALS[g.kind].measure(g, c);
  if (v === null) return null;
  const d = GOALS[g.kind].dir === 'min' ? g.value - v : v - g.value;
  return d / GOALS[g.kind].scale(g.value);
}

/**
 * The whole brief: goals, what may be touched, and how a build is tested.
 */
export interface Brief {
  goals: Goal[];
  /** Parts 老周 may change. */
  parts: PartId[];
  /** May he touch the ECU at all. */
  ecu: boolean;
  /** ECU settings that are fixed. */
  lock: Partial<EcuConfig>;
  mufflers: MufflerType[] | null;
  plan: AcceptancePlan;
  /** The cost zero. */
  baseline: EngineConfig;
  /** The machine for timed-run goals, and its cost zero. */
  vehicle: VehicleConfig;
  vehicleBaseline: VehicleConfig;
  /** Vehicle parts 老周 may change. */
  vehicleParts: VehiclePartId[];
}

/** Timed runs a set of goals needs. */
export function eventsFor(goals: Goal[]): RaceEventId[] {
  const out = new Set<RaceEventId>();
  for (const g of goals) {
    if (g.kind === 'raceTime') out.add(g.event ?? 'drag100');
    if (g.kind === 'topSpeed') out.add('top');
  }
  return [...out];
}

/** Things nobody wants, whether they asked or not. */
export const SAFETY: Goal[] = [
  { kind: 'piston', value: 3, must: true },
  { kind: 'rod', value: 5, must: true },
  // Blip it and let go: it must come back to idle, not stall.
  { kind: 'blipMin', value: 500, must: true },
];

/** Goals in effect: the player's, plus the safety floor where they did not set one. */
export function effectiveGoals(goals: Goal[]): Goal[] {
  const out = [...goals];
  for (const s of SAFETY) if (!goals.some((g) => g.kind === s.kind)) out.push(s);
  return out;
}

export interface Score {
  loss: number;
  /** Every goal (must and nice) met and the engine survived. */
  allMet: boolean;
  mustMet: boolean;
  survived: boolean;
}

/**
 * Lower is better. Shortfalls dominate; once everything is met, a little
 * headroom is worth having (the screening run is not the real one), and
 * money spent breaks ties.
 */
export function score(goals: Goal[], c: GoalCtx): Score {
  const r = c.result;
  const survived = r !== null && r.started && !r.failure;
  let short = 0;
  let slack = 0;
  let allMet = survived;
  let mustMet = survived;
  const all = effectiveGoals(goals);
  // A nice-to-have budget weighs lightly, and always the same: heavy, a
  // weak part bought early blocks the one that is needed later; switched on
  // only once the musts are met, meeting them would look like a loss. The
  // refund pass hands waste back at the end.
  const soft = (g: Goal): boolean => g.kind === 'budget' && !g.must;
  const tally = (g: Goal, w: number): void => {
    const d = gap(g, c);
    if (d === null) return;
    if (d > 0) {
      short += w * d;
      allMet = false;
      if (g.must) mustMet = false;
    } else slack += w * Math.min(-d, 0.08);
  };
  for (const g of all) if (!soft(g)) tally(g, g.must ? 3 : 1);
  for (const g of all) if (soft(g)) tally(g, 0.08);
  const loss = (survived ? 0 : 200) + short * 100 - slack * 4 + c.cost * 2e-5;
  return { loss, allMet, mustMet, survived };
}

/** What the run has to include for these goals to be measured. */
export function planFor(goals: Goal[], base: AcceptancePlan): AcceptancePlan {
  const plan: AcceptancePlan = { ...base };
  if (goals.some((g) => g.kind === 'freeRev')) plan.freeRev = true;
  if (goals.some((g) => g.kind === 'pops')) plan.overrun = true;
  const extra = goals.filter((g) => GOALS[g.kind].hasRpm && g.rpm).map((g) => Math.round(g.rpm!));
  if (extra.length) plan.extraPoints = extra;
  return plan;
}

/**
 * The cheaper run used while searching. Only measures what the goals look
 * at; the final build is always re-run on the full schedule.
 */
export function quickPlanFor(goals: Goal[], base: AcceptancePlan): AcceptancePlan {
  const plan = planFor(goals, base);
  // Pops depend on how hot the sweep left the header: keep the whole schedule.
  if (goals.some((g) => g.kind === 'pops')) return plan;
  plan.quick = true;
  const curve = goals.some((g) => g.kind === 'peakHp' || g.kind === 'peakTorque');
  if (!curve) plan.onlyPoints = plan.extraPoints ?? [];
  return plan;
}

/** The brief a work order implies. */
export function briefForJob(job: Job, baseline: EngineConfig): Brief {
  const goals: Goal[] = [];
  let lock: Partial<EcuConfig> = {};
  let mufflers: MufflerType[] | null = null;
  const take = (spec: Job['rules'][number]['spec'], must: boolean): void => {
    if (!spec) return;
    if (spec.goal) goals.push({ ...spec.goal, must });
    if (spec.lock) lock = { ...lock, ...spec.lock };
    if (spec.mufflers) mufflers = spec.mufflers;
  };
  for (const c of job.rules) take(c.spec, true);
  take(job.bonus.spec, false);
  goals.push({ kind: 'budget', value: job.budget, must: false });
  const vehicle = clampVehicle(job.vehicle);
  return {
    vehicle,
    vehicleBaseline: vehicle,
    vehicleParts: VEHICLE_PARTS.filter((p) => !job.locked?.includes(p.id as never)).map((p) => p.id),
    goals,
    parts: PARTS.filter((p) => !job.locked?.includes(p.id)).map((p) => p.id),
    ecu: true,
    lock,
    mufflers,
    plan: job.plan,
    baseline,
  };
}
