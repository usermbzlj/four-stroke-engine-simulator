/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Career: a tiered ladder of contracts that gates the shop and gives every
 * session a next thing to chase.
 *
 * Passing any contract of tier T promotes the garage to tier T+1, which is what
 * puts the next rung of parts on the shelf. Rewards drop to a fraction on
 * repeat runs so grinding the tutorial is not a strategy.
 */

import type { Contract, ContractRun, ComponentWear, EngineSpec, GarageState } from '../types';
import { EngineState } from '../types';
import { ECONOMY, THERMAL, WEAR } from './constants';
import { starterOwned } from './parts';

export const CONTRACTS: Contract[] = [
  // --- Tier 0: get it running -------------------------------------------
  {
    id: 'first-fire',
    kind: 'idle',
    tier: 0,
    name: '首次点火',
    brief: '把这台发动机叫醒，并让它稳稳地怠速。',
    how: '按住 S 起动，松手后用油门把转速吊在怠速窗口内累计 12 秒。',
    target: 12,
    stretch: 20,
    reward: 150,
    unlocks: [],
  },
  {
    id: 'bed-in',
    kind: 'endurance',
    tier: 0,
    name: '磨合运转',
    brief: '新机需要磨合：持续运转一分钟，任何部件都不许出现损耗报警。',
    how: '保持运转 60 秒，别超转、别过热、注意机油。',
    target: 60,
    stretch: 120,
    reward: 220,
    unlocks: ['ecu-tuner'],
  },

  // --- Tier 1: learn the dyno and the rev range --------------------------
  {
    id: 'baseline-pull',
    kind: 'dyno',
    tier: 1,
    name: '基准拉力',
    brief: '上测功台，量出这台车的真实底子。',
    how: '在「测功机」页跑一次完整拉力测试，峰值马力达到 11 HP。',
    target: 11,
    stretch: 13,
    reward: 260,
    unlocks: [],
  },
  {
    id: 'sprint-1',
    kind: 'redline',
    tier: 1,
    name: '红线冲刺',
    brief: '从怠速一脚到底，看它多快能摸到红线。',
    how: '全油门从怠速冲到红线前 200rpm，用时 9 秒以内。',
    target: 9,
    stretch: 6,
    reward: 240,
    unlocks: [],
  },
  {
    id: 'thermal-1',
    kind: 'thermal',
    tier: 1,
    name: '散热考核',
    brief: '客户抱怨高负载会开锅。上测功台，证明它压得住。',
    how: `暖机到 ${THERMAL.thermostatTemp}°C 以上再上台，完整跑完一次拉力，全程最高水温不超过 100°C。把冷却泵开大，必要时加装散热器。`,
    target: 100,
    stretch: 92,
    reward: 300,
    unlocks: [],
  },

  // --- Tier 2: real tuning ------------------------------------------------
  {
    id: 'dyno-2',
    kind: 'dyno',
    tier: 2,
    name: '改装认证 · 18 匹',
    brief: '客户要一台明显更快的街车。',
    how: '升级进排气与凸轮，把点火曲线调出来，跑到 18 HP。',
    target: 18,
    stretch: 22,
    reward: 460,
    unlocks: [],
  },
  {
    id: 'powerband-1',
    kind: 'powerband',
    tier: 2,
    name: '扭矩平台控制',
    brief: '赛道教练要求学员能把转速死死压在扭矩峰上。',
    how: '用油门把转速稳定在扭矩峰 ±300rpm，累计 20 秒。',
    target: 20,
    stretch: 35,
    reward: 400,
    unlocks: [],
  },
  {
    id: 'endurance-2',
    kind: 'endurance',
    tier: 2,
    name: '耐久 150 秒',
    brief: '跑得快没用，得跑得久。',
    how: '保持运转 150 秒，零部件不得出现异常损耗。',
    target: 150,
    stretch: 240,
    reward: 480,
    unlocks: [],
  },

  // --- Tier 3: serious builds --------------------------------------------
  {
    id: 'dyno-3',
    kind: 'dyno',
    tier: 3,
    name: '改装认证 · 28 匹',
    brief: '这一步开始，原厂缸盖和活塞已经不够用了。',
    how: '高压缩 + 赛用凸轮 + 缸盖，配合分段点火标定，跑到 28 HP。',
    target: 28,
    stretch: 34,
    reward: 780,
    unlocks: [],
  },
  {
    id: 'sprint-2',
    kind: 'redline',
    tier: 3,
    name: '轻量化冲刺',
    brief: '看看减轻转动惯量到底值多少钱。',
    how: '全油门冲到红线前 200rpm，用时 5.5 秒以内。',
    target: 5.5,
    stretch: 4,
    reward: 660,
    unlocks: [],
  },
  {
    id: 'clean-power',
    kind: 'dyno',
    tier: 3,
    name: '零爆震认证',
    brief: '客户要的是能天天开的马力，不是听着要炸的马力。',
    how: '一次拉力同时做到：峰值 ≥ 26 HP，且全程爆震读数为 0。散热与点火曲线都得到位。',
    target: 26,
    stretch: 31,
    knockLimit: 0.001,
    reward: 780,
    unlocks: [],
  },

  // --- Tier 4+: the big stuff ---------------------------------------------
  {
    id: 'dyno-4',
    kind: 'dyno',
    tier: 4,
    name: '改装认证 · 45 匹',
    brief: '换缸体或者上增压，你自己选。',
    how: '跑到 45 HP。低压缩活塞 + 增压是最稳的一条路。',
    target: 45,
    stretch: 55,
    reward: 1300,
    unlocks: [],
  },
  {
    id: 'endurance-3',
    kind: 'endurance',
    tier: 4,
    name: '五分钟耐久',
    brief: '大马力容易，大马力还不坏很难。',
    how: '保持运转 300 秒，零部件不得出现异常损耗。',
    target: 300,
    stretch: 420,
    reward: 1150,
    unlocks: [],
  },
  {
    id: 'dyno-5',
    kind: 'dyno',
    tier: 5,
    name: '车间纪录 · 68 匹',
    brief: '车间墙上那块牌子，写着 68。至今没人破。',
    how: '大排量缸体 + 全套改装 + 增压，跑到 68 HP。手调点火曲线是唯一的路。',
    target: 68,
    stretch: 80,
    reward: 2200,
    unlocks: [],
  },
];

export function getContract(id: string): Contract | undefined {
  return CONTRACTS.find((c) => c.id === id);
}

export const INITIAL_GARAGE: GarageState = {
  credits: ECONOMY.startingCredits,
  runtimeHours: 0,
  score: 0,
  tier: 0,
  stars: {},
  best: {},
  owned: starterOwned(),
};

export const IDLE_RUN: ContractRun = {
  id: null,
  startedAt: 0,
  elapsed: 0,
  metricLabel: '',
  metricValue: 0,
  targetValue: 0,
  stretchValue: 0,
  status: 'idle',
  message: '',
  hint: '',
};

/** Contracts the player can see, given their tier. One tier of look-ahead. */
export function visibleContracts(garage: GarageState): Contract[] {
  return CONTRACTS.filter((c) => c.tier <= garage.tier + 1);
}

export function isLocked(contract: Contract, garage: GarageState): boolean {
  return contract.tier > garage.tier;
}

/** Lower-is-better metrics are ranked in the opposite direction. */
export const lowerIsBetter = (kind: Contract['kind']): boolean => kind === 'redline' || kind === 'thermal';

/** Contracts that only a completed dyno pull can resolve. */
export const isDynoResolved = (kind: Contract['kind']): boolean => kind === 'dyno' || kind === 'thermal';

/** 0 (failed) to 3 (met the stretch goal). */
export function starsFor(contract: Contract, value: number, passed: boolean): number {
  if (!passed) return 0;
  const { target, stretch } = contract;
  if (lowerIsBetter(contract.kind)) {
    if (value <= stretch) return 3;
    return value <= target - (target - stretch) * 0.5 ? 2 : 1;
  }
  if (value >= stretch) return 3;
  return value >= target + (stretch - target) * 0.5 ? 2 : 1;
}

/** Whether a metric value clears a contract's pass mark, in whichever direction counts. */
export function meetsTarget(contract: Contract, value: number): boolean {
  return lowerIsBetter(contract.kind) ? value <= contract.target : value >= contract.target;
}

/**
 * Best star rating recorded for a contract, accounting for its best metric.
 * Older saves also stored the metric of failed runs, so a best that never
 * cleared the pass mark earns nothing.
 */
export function contractStars(garage: GarageState, contract: Contract): number {
  const recorded = garage.stars[contract.id] ?? 0;
  const best = garage.best[contract.id];
  if (best === undefined) return recorded;
  return Math.max(recorded, starsFor(contract, best, meetsTarget(contract, best)));
}

/** Credits paid out, discounted heavily for a result you have already beaten. */
export function rewardFor(contract: Contract, stars: number, previousStars: number): number {
  if (stars <= 0) return 0;
  const base = contract.reward * (0.7 + 0.15 * stars);
  const factor = stars > previousStars ? 1 : ECONOMY.repeatRewardFactor;
  return Math.round(base * factor);
}

export function scoreFor(contract: Contract, stars: number): number {
  return stars * (contract.tier + 1) * 25;
}

const dead = (st: EngineState): boolean => st === EngineState.EXPLODED || st === EngineState.SEIZED;

/** An endurance run tolerates this multiple of each component's base wear rate. */
const ENDURANCE_WEAR_MARGIN = 3;
/** Health points of slack on top, so a brief blip is not an instant fail. */
const ENDURANCE_WEAR_GRACE = 0.5;
/** Redline sprint: how far above idle the engine may sit and still count as "at idle". */
const SPRINT_IDLE_BAND = 400;
/** Redline sprint: a launch that has not reached the target by now has failed. */
const SPRINT_TIMEOUT_SECONDS = 30;

/**
 * Whether any component has lost more health since `start` than ordinary
 * running would cost. Healthy running still wears the bearings by roughly a
 * point a minute, so endurance has to judge abuse, not the mere presence of wear.
 */
function abnormalWear(start: ComponentWear, now: ComponentWear, elapsed: number): boolean {
  const keys = Object.keys(start) as (keyof ComponentWear)[];
  return keys.some((key) => {
    const allowance = ENDURANCE_WEAR_GRACE + elapsed * WEAR[key] * ENDURANCE_WEAR_MARGIN;
    return start[key] - now[key] > allowance;
  });
}

/** Start a contract run against the current build. */
export function beginContract(contract: Contract, spec: EngineSpec, now: number): ContractRun {
  const labels: Record<Contract['kind'], string> = {
    idle: '怠速稳定累计 (s)',
    dyno: '峰值马力 (HP)',
    redline: '冲线用时 (s，越低越好)',
    endurance: '无损耗运转 (s)',
    powerband: '扭矩平台累计 (s)',
    thermal: '拉力全程最高水温 (°C，越低越好)',
  };

  const messages: Record<Contract['kind'], string> = {
    idle: `把转速压在 ${Math.round(spec.idleRpm - 150)}–${Math.round(spec.idleRpm + 150)} RPM`,
    dyno: '去「测功机」页跑一次完整拉力',
    redline: `回到怠速后全油门冲到 ${Math.round(spec.redlineRpm - 200)} RPM，离开怠速才开始计时`,
    endurance: '保持运转，别让任何部件异常掉血',
    powerband: `把转速稳在 ${Math.round(spec.torquePeakRpm - 300)}–${Math.round(spec.torquePeakRpm + 300)} RPM`,
    thermal: `暖机到 ${THERMAL.thermostatTemp}°C 以上，去「测功机」跑一次完整拉力，全程水温压在 ${contract.target}°C 以内`,
  };

  return {
    id: contract.id,
    startedAt: now,
    elapsed: 0,
    metricLabel: labels[contract.kind],
    metricValue: 0,
    targetValue: contract.target,
    stretchValue: contract.stretch,
    status: 'running',
    message: messages[contract.kind],
    hint: '',
  };
}

export interface ContractTickInput {
  run: ContractRun;
  contract: Contract;
  /** Seconds accumulated inside the scoring window, carried across ticks. */
  accumulator: number;
  dt: number;
  rpm: number;
  wear: ComponentWear;
  engineState: EngineState;
  spec: EngineSpec;
  now: number;
}

export interface ContractTickResult {
  run: ContractRun;
  accumulator: number;
  finished?: { passed: boolean; value: number };
}

/**
 * Advance an in-flight contract by one tick. Pure — returns the next run state
 * and, when the contract resolves, the outcome.
 */
export function tickContract(input: ContractTickInput): ContractTickResult {
  const { run, contract, dt, rpm, wear, engineState, spec, now } = input;
  let accumulator = input.accumulator;

  if (!run.id || run.status !== 'running') return { run, accumulator };

  const elapsed = (now - run.startedAt) / 1000;
  const isDead = dead(engineState);
  const stopped = engineState === EngineState.OFF || engineState === EngineState.STALLED;

  const withProgress = (value: number, hint: string): ContractRun => ({ ...run, metricValue: value, elapsed, hint });

  switch (contract.kind) {
    case 'idle': {
      const lo = spec.idleRpm - 150;
      const hi = spec.idleRpm + 150;
      const inWindow = rpm >= lo && rpm <= hi;
      accumulator = inWindow ? accumulator + dt : Math.max(0, accumulator - dt * 1.5);
      const hint = inWindow ? '✅ 保持住' : rpm < lo ? '转速偏低，轻补油门' : '转速偏高，收一点油门';
      const next = withProgress(accumulator, hint);
      if (accumulator >= contract.target) return { run: next, accumulator: 0, finished: { passed: true, value: accumulator } };
      if (isDead) return { run: next, accumulator: 0, finished: { passed: false, value: accumulator } };
      return { run: next, accumulator };
    }

    case 'powerband': {
      const lo = spec.torquePeakRpm - 300;
      const hi = spec.torquePeakRpm + 300;
      const inWindow = rpm >= lo && rpm <= hi;
      accumulator = inWindow ? accumulator + dt : Math.max(0, accumulator - dt * 1.2);
      const hint = inWindow ? '✅ 就在扭矩峰上' : rpm < lo ? '再给一点油' : '收油，冲过头了';
      const next = withProgress(accumulator, hint);
      if (accumulator >= contract.target) return { run: next, accumulator: 0, finished: { passed: true, value: accumulator } };
      if (isDead) return { run: next, accumulator: 0, finished: { passed: false, value: accumulator } };
      return { run: next, accumulator };
    }

    case 'redline': {
      // The clock is the accumulator, and it only starts once the engine has been
      // seen at idle and then leaves it — otherwise a run accepted at redline would
      // finish in zero seconds.
      const targetRpm = spec.redlineRpm - 200;
      const idleCeiling = spec.idleRpm + SPRINT_IDLE_BAND;
      const atIdle = engineState === EngineState.RUNNING && rpm <= idleCeiling;
      const armed = run.armed === true || atIdle;
      const sprinting = armed && (accumulator > 0 || rpm > idleCeiling);
      if (sprinting) accumulator += dt;

      const hint = !armed
        ? `先回到怠速（≤ ${Math.round(idleCeiling)} RPM）再起跑`
        : !sprinting
        ? '就绪：一脚油门到底，离开怠速即开始计时'
        : `还差 ${Math.max(0, Math.round(targetRpm - rpm))} RPM`;
      const next: ContractRun = { ...withProgress(accumulator, hint), armed };

      if (sprinting && rpm >= targetRpm) {
        return { run: next, accumulator: 0, finished: { passed: accumulator <= contract.target, value: accumulator } };
      }
      if (isDead || accumulator > SPRINT_TIMEOUT_SECONDS) {
        return { run: next, accumulator: 0, finished: { passed: false, value: accumulator } };
      }
      return { run: next, accumulator };
    }

    case 'endurance': {
      const startWear = run.startWear ?? wear;
      const worn = abnormalWear(startWear, wear, elapsed);
      const hint = worn ? '部件出现异常损耗' : stopped ? '发动机已停转' : '✅ 一切正常';
      const next: ContractRun = { ...withProgress(Math.min(contract.stretch, elapsed), hint), startWear };
      // Ending early still passes once the target is behind you; the stretch is for stars.
      if (worn || isDead || stopped) {
        return { run: next, accumulator: 0, finished: { passed: elapsed >= contract.target, value: elapsed } };
      }
      if (elapsed >= contract.stretch) return { run: next, accumulator: 0, finished: { passed: true, value: elapsed } };
      return { run: next, accumulator };
    }

    case 'dyno':
    case 'thermal':
    default:
      // Resolved by the dyno pull itself — a loaded sweep is the only condition
      // where power and heat are both meaningful and comparable.
      return { run: { ...run, elapsed, hint: '在「测功机」页开始拉力测试 (D)' }, accumulator };
  }
}

/** Apply a finished contract to the garage: credits, stars, tier, unlocks. */
export function settleContract(
  garage: GarageState,
  contract: Contract,
  passed: boolean,
  value: number
): { garage: GarageState; stars: number; reward: number; score: number; promoted: boolean; gifts: string[] } {
  const stars = starsFor(contract, value, passed);
  const previousStars = garage.stars[contract.id] ?? 0;
  const reward = rewardFor(contract, stars, previousStars);
  const score = stars > previousStars ? scoreFor(contract, stars) : 0;

  // Only a passing run sets a record; a failed one must not read as a score later.
  const previousBest = garage.best[contract.id];
  const better =
    passed &&
    (previousBest === undefined || (lowerIsBetter(contract.kind) ? value < previousBest : value > previousBest));

  const promoted = passed && contract.tier >= garage.tier;
  const gifts = passed && previousStars === 0 ? contract.unlocks : [];

  return {
    garage: {
      ...garage,
      credits: garage.credits + reward,
      score: garage.score + score,
      tier: promoted ? contract.tier + 1 : garage.tier,
      stars: { ...garage.stars, [contract.id]: Math.max(previousStars, stars) },
      best: better ? { ...garage.best, [contract.id]: value } : garage.best,
      owned: gifts.length ? Array.from(new Set([...garage.owned, ...gifts])) : garage.owned,
    },
    stars,
    reward,
    score,
    promoted,
    gifts,
  };
}

/** Credits paid for a dyno pull, on top of any contract it satisfies. */
export const dynoCreditReward = (peakPowerHp: number): number =>
  Math.round(peakPowerHp * ECONOMY.dynoCreditPerHp);

export const dynoScoreGain = (peakPowerHp: number): number => Math.round(peakPowerHp);
