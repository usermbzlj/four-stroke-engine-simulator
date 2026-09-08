/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ComponentWear, EngineParameters, EngineSpec, EngineState, StrokeType } from '../types';
import {
  ChamberState,
  Rng,
  calculatePistonTorque,
  estimateBrakeTorque,
  getChamberState,
  oilPressureBar,
  rotationalDragTorque,
  smoothThrottle,
} from './physics';
import { smoothMetric } from '../utils/telemetrySmoothing';
import {
  COMBUSTION,
  DRIVE,
  FRICTION,
  INTEGRATOR,
  LIMITER,
  RPM,
  STARTER,
  THERMAL,
  WEAR,
} from './constants';

const TWO_PI = Math.PI * 2;
const FOUR_PI = Math.PI * 4;

/**
 * Complete mutable physics state of the engine. This is intentionally a plain
 * data object (no React, no DOM) so the integrator is pure and unit-testable.
 */
export interface EngineSimState {
  /** Engine lifecycle state. */
  engineState: EngineState;
  /** Crank angle in radians within the 0..4π four-stroke cycle. */
  angle: number;
  /** Engine speed (RPM). */
  rpm: number;
  /** Coolant / cylinder temperature (°C). */
  coolantTemp: number;
  /** Oil temperature, lags coolant (°C). */
  oilTemp: number;
  /** Oil pressure (bar). */
  oilPressure: number;
  /** Butterfly position after inertia lag (0..MAX_THROTTLE). */
  actualThrottle: number;
  /** Component health. */
  wear: ComponentWear;
  /** Smoothed crank-drive torque the combustion contributes (Nm). */
  crankDriveTorque: number;

  // --- transient flags / edge-detection helpers ---
  /** Starter motor engaged this step. */
  cranking: boolean;
  /** Ignition hard cutoff (kill switch). */
  ignitionCut: boolean;
  /** Edge-detect: spark already fired in the current window. */
  sparkFired: boolean;
  /** Edge-detect: backfire already played in the current limiter window. */
  backfired: boolean;
}

/** Domain events emitted by a simulation step (logs, sounds, transitions). */
export type EngineEvent =
  | { kind: 'stateChange'; from: EngineState; to: EngineState; reason: string }
  | { kind: 'log'; level: 'info' | 'success' | 'warning' | 'error' | 'critical'; message: string }
  | { kind: 'spark' }
  | { kind: 'combustion'; rpm: number; throttle: number; knocking: boolean }
  | { kind: 'backfire' }
  | { kind: 'explosion' }
  | { kind: 'failure'; state: EngineState; reason: string };

/** Read-only outputs a step computes for display / audio (not persisted in state). */
export interface StepDerived {
  stroke: StrokeType;
  chamber: ChamberState;
  /** Representative steady-state brake torque at the operating point (Nm). */
  meanBrakeTorque: number;
  /** Instantaneous gas-pressure torque on the crankpin (Nm). */
  pistonForceTorque: number;
  /** Rev-limiter torque scaling currently applied (0..1). */
  limiterTorqueScale: number;
  /** True while the engine is self-sustaining or trying to (RUNNING/STARTING). */
  selfSustained: boolean;
}

export interface StepResult {
  state: EngineSimState;
  derived: StepDerived;
  events: EngineEvent[];
}

export const INITIAL_WEAR: ComponentWear = {
  pistonRings: 100,
  cylinderWall: 100,
  conrodBearings: 100,
  crankshaftJournal: 100,
  sparkPlug: 100,
  valves: 100,
};

/** Build a fresh engine state at a given cold-start coolant temperature. */
export function createEngineState(coolantTemp = 40, throttle = 0.2): EngineSimState {
  return {
    engineState: EngineState.OFF,
    angle: 0,
    rpm: 0,
    coolantTemp,
    oilTemp: coolantTemp - 5,
    oilPressure: 0,
    actualThrottle: throttle,
    wear: { ...INITIAL_WEAR },
    crankDriveTorque: 0,
    cranking: false,
    ignitionCut: false,
    sparkFired: false,
    backfired: false,
  };
}

function strokeFromCycleDeg(thetaDeg: number): StrokeType {
  if (thetaDeg < 180) return StrokeType.INTAKE;
  if (thetaDeg < 360) return StrokeType.COMPRESSION;
  if (thetaDeg < 540) return StrokeType.POWER;
  return StrokeType.EXHAUST;
}

const isDeadState = (s: EngineState): boolean => s === EngineState.EXPLODED || s === EngineState.SEIZED;

/**
 * Advance the engine physics by `dt` seconds. Pure: returns a brand-new state
 * plus the list of domain events that occurred (state transitions, logs, audio
 * cues, failures). The caller is responsible for turning events into React
 * state / audio / logs.
 *
 * `timestampMs` drives the rev-limiter spark-cut oscillation (kept identical to
 * the original `performance.now()`-based behaviour). `rng` is injectable so the
 * stochastic parts (misfire, knock-log probability) are deterministic in tests.
 */
export function stepEngine(
  prev: EngineSimState,
  params: EngineParameters,
  spec: EngineSpec,
  dtRaw: number,
  timestampMs: number,
  rng: Rng = Math.random
): StepResult {
  const events: EngineEvent[] = [];
  // Restrict dt leaps when the tab is inactive.
  const dt = Math.min(INTEGRATOR.maxDt, Math.max(0, dtRaw));

  // Work on a shallow copy; wear is replaced immutably below when it changes.
  const s: EngineSimState = { ...prev };

  const curState = s.engineState;
  const isDead = isDeadState(curState);
  const curRpm = s.rpm;
  const angle = s.angle;

  const transitionTo = (to: EngineState, reason: string, log?: EngineEvent) => {
    events.push({ kind: 'stateChange', from: s.engineState, to, reason });
    if (log) events.push(log);
    s.engineState = to;
  };

  // Throttle butterfly inertia (commanded -> actual)
  s.actualThrottle = smoothThrottle(s.actualThrottle, params.throttle, dt);
  const actualThrottle = s.actualThrottle;

  // Oil pressure derived from rpm/oil/temp/wear
  s.oilPressure = oilPressureBar(curRpm, params.oilLevel, s.oilTemp, s.wear);

  // 1. STARTER MOTOR TORQUE (heavier flywheels are harder to spin up)
  let starterTorque = 0;
  if (s.cranking && !isDead) {
    const starterStrength = STARTER.baseStrength * (spec.rotatingInertia / STARTER.referenceInertia);
    starterTorque = Math.max(0, (STARTER.driveSpeedCeiling - (curRpm * TWO_PI) / 60) * starterStrength);
  }

  // 2. RECIPROCATING FRICTION TORQUE
  const normalViscosity =
    FRICTION.baseViscosity +
    (s.oilTemp < FRICTION.coldOilTemp ? (FRICTION.coldOilTemp - s.oilTemp) * FRICTION.coldOilViscosityPerDeg : 0);
  let wearFrictionMultiplier = 1.0;
  if (params.oilLevel < FRICTION.lowOilLevel) {
    wearFrictionMultiplier += Math.pow(FRICTION.lowOilLevel - params.oilLevel, 1.3) * 0.06;
  }
  // Low oil pressure = metal-to-metal contact = big friction spike
  if (s.oilPressure < FRICTION.lowOilPressure && curRpm > 200) {
    wearFrictionMultiplier += (FRICTION.lowOilPressure - s.oilPressure) * 2.5;
  }
  wearFrictionMultiplier += (100 - s.wear.crankshaftJournal) * 0.015;
  if (s.coolantTemp > FRICTION.hotFrictionTemp) {
    wearFrictionMultiplier += (s.coolantTemp - FRICTION.hotFrictionTemp) * 0.04;
  }

  const kineticFrictionTorque = curRpm * FRICTION.kineticPerRpm * normalViscosity * wearFrictionMultiplier;
  const staticFrictionTorque = FRICTION.staticTorque * wearFrictionMultiplier;
  const totalDecelFriction = staticFrictionTorque + kineticFrictionTorque;

  // 3. THERMODYNAMICS & CYLINDER PRESSURE FORCE
  const cycleRad = angle % FOUR_PI;
  const thetaDeg = (cycleRad * 180) / Math.PI;
  const strokeType = strokeFromCycleDeg(thetaDeg);

  const selfSustained = curState === EngineState.RUNNING || curState === EngineState.STARTING;
  const chamber = getChamberState(
    cycleRad,
    actualThrottle,
    params.fuelAirRatio,
    selfSustained,
    s.wear,
    params.hasNitrous,
    params.ignitionTiming,
    curRpm,
    spec,
    s.coolantTemp,
    params.choke,
    rng
  );

  if (chamber.knockSeverity > 0.12 && rng() < 0.02) {
    events.push({
      kind: 'log',
      level: 'critical',
      message: `🚨 探测到发动机敲缸 (Knocking ${Math.round(
        chamber.knockSeverity * 100
      )}%)！高温/高压缩/点火过早导致异常爆震！建议延迟点火角或降温。`,
    });
  }
  if (chamber.misfire && selfSustained && rng() < 0.03) {
    events.push({
      kind: 'log',
      level: 'warning',
      message: `⚠️ 气缸失火 (Misfire)！空燃比 λ:${params.fuelAirRatio.toFixed(2)} 已超越稳定燃烧极限！`,
    });
  }

  const sparkThresholdDeg = 360 - params.ignitionTiming;
  const isWithinSparkWindow = thetaDeg >= sparkThresholdDeg && thetaDeg < sparkThresholdDeg + 12;

  let triggeredIgnitedState = chamber.ignited;
  let limiterCut = false;

  // Rev limiter spark cut (bounces off the limiter with backfires)
  if (params.hasLimiter && curRpm > params.limiterRpm) {
    triggeredIgnitedState = false;
    limiterCut = true;
    if (isWithinSparkWindow && Math.sin(timestampMs * LIMITER.cutFrequency) > 0) {
      triggeredIgnitedState = true;
    }
  }

  if (s.ignitionCut) triggeredIgnitedState = false;

  // Worn spark plug random misfire
  if (triggeredIgnitedState && rng() > s.wear.sparkPlug / 100) {
    triggeredIgnitedState = false;
  }

  // Spark + combustion edge-triggered events at the spark point
  if (isWithinSparkWindow && !s.sparkFired && !isDead) {
    s.sparkFired = true;
    events.push({ kind: 'spark' });

    if (triggeredIgnitedState) {
      const knockingPing =
        chamber.knockSeverity > 0.2 ||
        s.wear.conrodBearings < 30 ||
        (params.ignitionTiming > 25 && params.fuelAirRatio > 1.25);
      events.push({ kind: 'combustion', rpm: curRpm, throttle: actualThrottle, knocking: knockingPing });
      if (params.hasNitrous && rng() < 0.2) {
        events.push({ kind: 'log', level: 'critical', message: 'NOS 笑气爆燃！产生极致燃烧功！' });
      }
    } else if (limiterCut) {
      if (!s.backfired) {
        events.push({ kind: 'backfire' });
        s.backfired = true;
      }
    } else if (selfSustained && rng() < 0.12) {
      events.push({ kind: 'log', level: 'warning', message: '缺火 (Misfire): 火花塞电极碳化或混合气未点燃' });
    }
  }

  if (!isWithinSparkWindow) {
    s.sparkFired = false;
    s.backfired = false;
  }

  // Torque from gas pressure on the piston crown
  let pistonForceTorque: number;
  if (triggeredIgnitedState && strokeType === StrokeType.POWER) {
    pistonForceTorque = calculatePistonTorque(cycleRad, chamber.pressure, spec);
  } else {
    const effectivePressure = chamber.ignited && !triggeredIgnitedState ? 1.2 : chamber.pressure;
    pistonForceTorque = calculatePistonTorque(cycleRad, effectivePressure, spec);
  }

  const onLimiter = params.hasLimiter && curRpm > params.limiterRpm;
  const limiterTorqueScale = onLimiter
    ? LIMITER.torqueScaleBase + LIMITER.torqueScaleSwing * Math.max(0, Math.sin(timestampMs * LIMITER.cutFrequency))
    : 1.0;
  const combustionDriveAvailable =
    selfSustained &&
    !s.ignitionCut &&
    s.wear.sparkPlug > COMBUSTION.minSparkPlug &&
    params.fuelAirRatio >= COMBUSTION.lambdaRich &&
    params.fuelAirRatio <= COMBUSTION.lambdaLean;
  const meanBrakeTorque = combustionDriveAvailable
    ? estimateBrakeTorque(curRpm, actualThrottle, params.fuelAirRatio, params.ignitionTiming, spec, s.wear, params.hasNitrous) *
      limiterTorqueScale
    : 0;
  const targetDriveTorque = meanBrakeTorque > 0 ? meanBrakeTorque + totalDecelFriction : 0;
  const torqueResponseTau = DRIVE.baseTau + spec.rotatingInertia * DRIVE.inertiaTauFactor;
  s.crankDriveTorque = smoothMetric(s.crankDriveTorque, targetDriveTorque, dt, {
    timeConstant: torqueResponseTau,
    maxDeltaPerSecond: spec.peakTorque * DRIVE.maxDeltaFactor,
  });

  const pulseTrim = Math.max(
    -DRIVE.pulseTrimClamp,
    Math.min(DRIVE.pulseTrimClamp, pistonForceTorque / Math.max(1, spec.peakTorque * 12))
  );
  const externalLoadDrag = params.load;
  const rotationalDamping = rotationalDragTorque(curRpm);
  const netTorque =
    s.crankDriveTorque * (1 + pulseTrim) + starterTorque - totalDecelFriction - externalLoadDrag - rotationalDamping;

  // 4. ANGULAR ROTATION ACCELERATION (spec-driven inertia)
  let angularVelocity = (curRpm * TWO_PI) / 60;
  if (!isDead) {
    angularVelocity += (netTorque / spec.rotatingInertia) * dt;
  } else {
    angularVelocity = 0;
  }
  if (angularVelocity < 0) angularVelocity = 0;

  const newRpm = (angularVelocity * 60) / TWO_PI;

  // Self-sustained state transitions
  if (curState === EngineState.STARTING && newRpm > RPM.catch && !isDead) {
    transitionTo(EngineState.RUNNING, 'caught', {
      kind: 'log',
      level: 'success',
      message: '缸内点火连续自持！发动机正常运转运行。',
    });
  }
  if (curState === EngineState.RUNNING && newRpm < RPM.stall && !isDead) {
    transitionTo(EngineState.STALLED, 'stalled', {
      kind: 'log',
      level: 'warning',
      message: '怠速转速偏低，发动机发生失速熄火。 (STALLED)',
    });
  }
  if (curState === EngineState.STARTING && !s.cranking && newRpm < RPM.failedStart && !isDead) {
    transitionTo(EngineState.OFF, 'failedStart', {
      kind: 'log',
      level: 'warning',
      message: '释放起动电机，拖动终止，未能成功点火启动。',
    });
  }

  // 5. TEMPERATURE INTEGRATION (coolant + oil, spec thermal mass + coolant pump)
  const combustionHeatRate =
    (triggeredIgnitedState ? THERMAL.combustionHeat : 0) *
    (curRpm / THERMAL.heatReferenceRpm) *
    (0.3 + 0.7 * actualThrottle) *
    (params.hasNitrous ? THERMAL.nitrousHeatFactor : 1.0);
  const scoringFrictionHeatRate = (curRpm / 600) * Math.max(0, FRICTION.lowOilLevel - params.oilLevel) * 0.15;
  const radiatorCooling =
    (s.coolantTemp - THERMAL.ambient) *
    THERMAL.radiatorBase *
    (1.0 + (curRpm / 1000) * 0.55) *
    (0.45 + 0.9 * params.coolantPump);
  const netTempChange = ((combustionHeatRate + scoringFrictionHeatRate - radiatorCooling) / spec.thermalMass) * dt;
  s.coolantTemp = Math.max(THERMAL.ambient, s.coolantTemp + netTempChange);

  // Oil temp lags coolant temp and rises with rpm
  const oilTarget = s.coolantTemp + THERMAL.oilOffset + curRpm * 0.002;
  s.oilTemp += (oilTarget - s.oilTemp) * Math.min(1, dt * THERMAL.oilResponseRate);

  if (s.coolantTemp > THERMAL.warnTemp && rng() < 0.02) {
    events.push({
      kind: 'log',
      level: 'critical',
      message: '警告：水温过高！金属热膨胀，拉缸损坏加剧！请增大冷却泵或减小油门。',
    });
  }
  if (s.oilPressure < 0.6 && curRpm > 1500 && rng() < 0.015) {
    events.push({
      kind: 'log',
      level: 'error',
      message: '机油压力过低！轴瓦润滑不足，磨损急剧上升。请补充机油或降低转速。',
    });
  }

  // 6. COMPONENT WEAR DEGRADATION
  if (!isDead && curRpm > RPM.wearFloor) {
    const oilWearMultiplier =
      params.oilLevel < FRICTION.lowOilLevel ? 1 + Math.pow(FRICTION.lowOilLevel - params.oilLevel, 1.6) * 0.4 : 1;
    const pressureWearMultiplier = s.oilPressure < 1.0 ? 1 + (1.0 - s.oilPressure) * 6 : 1;
    const knockWearMultiplier = 1.0 + chamber.knockSeverity * WEAR.knockFactor;
    const overRev = newRpm > spec.redlineRpm;

    const pistonRingWearDt = dt * WEAR.pistonRings * oilWearMultiplier * knockWearMultiplier * (s.coolantTemp > 110 ? 25 : 1);
    const wallWearDt = dt * WEAR.cylinderWall * oilWearMultiplier * (s.coolantTemp > 115 ? 40 : 1);
    const bearingsWearDt =
      dt *
      WEAR.conrodBearings *
      oilWearMultiplier *
      pressureWearMultiplier *
      knockWearMultiplier *
      (overRev ? 12 : 1) *
      (params.hasNitrous ? WEAR.nitrousBearingFactor : 1);
    const crankshaftWearDt = dt * WEAR.crankshaftJournal * oilWearMultiplier * pressureWearMultiplier * (overRev ? 8 : 1);
    const sparkPlugWearDt = dt * WEAR.sparkPlug * (triggeredIgnitedState ? 1.5 : 0.2);
    const valvesWearDt = dt * WEAR.valves * (s.coolantTemp > 110 ? 5 : 1);

    const prevWear = s.wear;
    const nextWear: ComponentWear = {
      pistonRings: Math.max(0, prevWear.pistonRings - pistonRingWearDt),
      cylinderWall: Math.max(0, prevWear.cylinderWall - wallWearDt),
      conrodBearings: Math.max(0, prevWear.conrodBearings - bearingsWearDt),
      crankshaftJournal: Math.max(0, prevWear.crankshaftJournal - crankshaftWearDt),
      sparkPlug: Math.max(0, prevWear.sparkPlug - sparkPlugWearDt),
      valves: Math.max(0, prevWear.valves - valvesWearDt),
    };
    s.wear = nextWear;

    if (nextWear.pistonRings === 0 && prevWear.pistonRings > 0) {
      events.push({
        kind: 'log',
        level: 'critical',
        message: '活塞环熔断！气缸失去气密压缩，发动机永久熄火。',
      });
      transitionTo(EngineState.STALLED, 'pistonRingsFailed');
      s.rpm = 0;
    }
    if (nextWear.conrodBearings === 0 && prevWear.conrodBearings > 0) {
      events.push({ kind: 'failure', state: EngineState.EXPLODED, reason: '活塞连杆轴瓦烧毁，连杆断裂，飞出击穿气缸缸体！发动机彻底报废！' });
    }
    if (nextWear.cylinderWall === 0 && prevWear.cylinderWall > 0) {
      events.push({ kind: 'failure', state: EngineState.SEIZED, reason: '由于干摩擦与高温，活塞与汽缸完全融结抱死，发动机抱死阻断转动。' });
    }
  }

  // 7. CRITICAL STRESS THRESHOLDS (spec-driven destruct rpm)
  if (newRpm > spec.destructRpm && !isDead) {
    events.push({
      kind: 'failure',
      state: EngineState.EXPLODED,
      reason: `转速超越物理极限 ${spec.destructRpm} RPM！高机械惯性拉断连杆，机械碎裂爆炸！`,
    });
  }
  if (s.coolantTemp > THERMAL.seizeTemp && !isDead) {
    events.push({ kind: 'failure', state: EngineState.SEIZED, reason: '极其严重之高温过热！金属烧熔卡死，曲轴抱死 (SEIZED)。' });
  }
  if (params.hasNitrous && s.coolantTemp > 120 && rng() < 0.06 && !isDead) {
    events.push({
      kind: 'failure',
      state: EngineState.EXPLODED,
      reason: '在高温过热状态下不当施加笑气 (NOS)，混合气剧烈回火引发缸体瞬时爆震！',
    });
  }

  // Apply the first failure event (if any) authoritatively.
  const failure = events.find((e): e is Extract<EngineEvent, { kind: 'failure' }> => e.kind === 'failure');
  if (failure && !isDeadState(s.engineState)) {
    s.engineState = failure.state;
    s.rpm = 0;
    angularVelocity = 0;
    if (failure.state === EngineState.EXPLODED) {
      events.push({ kind: 'explosion' });
      events.push({ kind: 'log', level: 'critical', message: `🚨 CATASTROPHIC BLAST: ${failure.reason}` });
    } else {
      events.push({ kind: 'log', level: 'critical', message: `🚨 MECHANICAL SEIZE: ${failure.reason}` });
    }
  }

  // Save physics state updates (unless a failure forced rpm/angle to a halt).
  if (!isDeadState(s.engineState)) {
    s.rpm = newRpm;
    s.angle = (angle + angularVelocity * dt) % FOUR_PI;
  }

  return {
    state: s,
    derived: {
      stroke: strokeType,
      chamber,
      meanBrakeTorque,
      pistonForceTorque,
      limiterTorqueScale,
      selfSustained,
    },
    events,
  };
}
