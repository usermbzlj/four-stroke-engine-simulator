/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Challenge,
  ChallengeId,
  ChallengeProgress,
  ComponentWear,
  DynoCurvePoint,
  DynoResult,
  EngineSpec,
  EngineState,
  GarageState,
} from '../types';
import { ECONOMY } from './constants';
import { estimateBrakeTorque, torqueToPowerHp } from './physics';

export const CHALLENGES: Challenge[] = [
  {
    id: 'idle',
    name: '稳定怠速考验 (Idle Master)',
    subtitle: '把转速稳定在 1100±150 RPM 持续 10 秒',
    goal: '累计稳定 10s',
  },
  {
    id: 'dyno',
    name: '爆改马力赛 (Dyno King)',
    subtitle: '调校并跑一次测功机，追求最高峰值马力',
    goal: '峰值马力 ≥ 起步目标',
  },
  {
    id: 'redline',
    name: '红线冲刺 (Redline Sprint)',
    subtitle: '从怠速全油门冲到红线前 200rpm，越快越好',
    goal: '用时尽量短',
  },
  {
    id: 'endurance',
    name: '耐久挑战 (Endurance Run)',
    subtitle: '保持运转 60 秒且不损坏任何部件',
    goal: '存活 60s',
  },
];

export const INITIAL_CHALLENGE: ChallengeProgress = {
  active: null,
  startedAt: 0,
  elapsed: 0,
  metricLabel: '',
  metricValue: 0,
  targetValue: 0,
  best: { idle: 0, dyno: 0, endurance: 0, redline: 0 },
  status: 'idle',
  message: '',
};

export const INITIAL_GARAGE: GarageState = {
  credits: ECONOMY.startingCredits,
  runtimeHours: 0,
  score: 0,
};

/** Reward (credits) for passing a challenge. */
export function challengeReward(id: ChallengeId): number {
  switch (id) {
    case 'endurance':
      return 200;
    case 'redline':
      return 150;
    case 'idle':
      return 120;
    default:
      return 100;
  }
}

/** Score gain for passing a challenge. `value` is the final metric. */
export function challengeScore(id: ChallengeId, value: number): number {
  switch (id) {
    case 'endurance':
      return 120;
    case 'redline':
      return Math.round(200 / Math.max(0.5, value));
    default:
      return 80;
  }
}

const dead = (st: EngineState): boolean => st === EngineState.EXPLODED || st === EngineState.SEIZED;

const anyComponentBroken = (w: ComponentWear): boolean =>
  w.pistonRings < 99 ||
  w.cylinderWall < 99 ||
  w.conrodBearings < 99 ||
  w.crankshaftJournal < 99 ||
  w.sparkPlug < 99 ||
  w.valves < 99;

export interface ChallengeTickInput {
  progress: ChallengeProgress;
  /** Accumulated stable-idle seconds (carried by the caller across ticks). */
  idleStableSeconds: number;
  dt: number;
  rpm: number;
  wear: ComponentWear;
  engineState: EngineState;
  spec: EngineSpec;
  now: number;
}

export interface ChallengeTickResult {
  progress: ChallengeProgress;
  idleStableSeconds: number;
  /** Set when the challenge resolved this tick. */
  finished?: { passed: boolean; value: number };
}

/**
 * Advance an active challenge by one tick. Pure: returns the next progress and
 * any resolution. Mirrors the original per-frame challenge tracker exactly.
 */
export function tickChallenge(input: ChallengeTickInput): ChallengeTickResult {
  const { progress: cur, dt, rpm, wear, engineState: st, spec, now } = input;
  let idleStableSeconds = input.idleStableSeconds;

  if (!cur.active || cur.status !== 'running') {
    return { progress: cur, idleStableSeconds };
  }

  const elapsed = (now - cur.startedAt) / 1000;
  const isDead = dead(st);

  if (cur.active === 'idle') {
    if (rpm >= 950 && rpm <= 1250) idleStableSeconds += dt;
    else idleStableSeconds = Math.max(0, idleStableSeconds - dt * 1.5);
    const v = idleStableSeconds;
    const progress = { ...cur, metricValue: v, elapsed };
    if (v >= cur.targetValue) {
      idleStableSeconds = 0;
      return { progress, idleStableSeconds, finished: { passed: true, value: v } };
    }
    if (isDead) return { progress, idleStableSeconds, finished: { passed: false, value: v } };
    return { progress, idleStableSeconds };
  }

  if (cur.active === 'redline') {
    const targetRpm = spec.redlineRpm - 200;
    const progress = { ...cur, metricValue: elapsed, elapsed };
    if (rpm >= targetRpm) return { progress, idleStableSeconds, finished: { passed: true, value: elapsed } };
    if (isDead || elapsed > 30) return { progress, idleStableSeconds, finished: { passed: false, value: elapsed } };
    return { progress, idleStableSeconds };
  }

  if (cur.active === 'endurance') {
    const progress = { ...cur, metricValue: Math.min(cur.targetValue, elapsed), elapsed };
    if (anyComponentBroken(wear) || isDead) return { progress, idleStableSeconds, finished: { passed: false, value: elapsed } };
    if (elapsed >= cur.targetValue) return { progress, idleStableSeconds, finished: { passed: true, value: elapsed } };
    return { progress, idleStableSeconds };
  }

  // dyno — resolved when the dyno pull completes; just keep elapsed ticking.
  return { progress: { ...cur, elapsed }, idleStableSeconds };
}

/** Compute the full dyno curve + peaks for a steady-state WOT sweep. */
export function runDynoSweep(
  spec: EngineSpec,
  fuelAirRatio: number,
  ignitionTiming: number,
  wear: ComponentWear,
  steps = 40
): DynoResult {
  const startRpm = 1500;
  const endRpm = spec.redlineRpm;
  const curve: DynoCurvePoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const rpm = startRpm + ((endRpm - startRpm) * i) / steps;
    const torque = estimateBrakeTorque(rpm, 1.0, fuelAirRatio, ignitionTiming, spec, wear, false);
    const power = torqueToPowerHp(torque, rpm);
    curve.push({ rpm, torque, power });
  }

  let peakPowerHp = 0;
  let peakPowerRpm = 0;
  let peakTorqueNm = 0;
  let peakTorqueRpm = 0;
  for (const c of curve) {
    if (c.power > peakPowerHp) {
      peakPowerHp = c.power;
      peakPowerRpm = c.rpm;
    }
    if (c.torque > peakTorqueNm) {
      peakTorqueNm = c.torque;
      peakTorqueRpm = c.rpm;
    }
  }

  return {
    id: Math.random().toString(36).slice(2, 8),
    specName: spec.name,
    curve,
    peakPowerHp,
    peakPowerRpm,
    peakTorqueNm,
    peakTorqueRpm,
    timestamp: Date.now(),
  };
}

/** Dyno reward in credits, scaled to peak power. */
export const dynoCreditReward = (peakPowerHp: number): number => Math.round(peakPowerHp * 4);
/** Dyno score gain, scaled to peak power. */
export const dynoScoreGain = (peakPowerHp: number): number => Math.round(peakPowerHp * 2);
