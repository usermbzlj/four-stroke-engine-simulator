/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The per-step integrator.
 *
 * `stepEngine` is pure: it takes the whole world (state, controls, build, tune)
 * and returns a brand-new state plus the domain events that happened. No React,
 * no DOM, no `performance.now()` — which is what lets the dyno re-use it
 * headlessly and lets the tests drive it deterministically.
 */

import type { ComponentWear, EngineParameters, EngineSpec, TuneMap, TuneSample } from '../types';
import { EngineState, StrokeType } from '../types';
import type {
  ChamberState,
  Rng} from './physics';
import {
  calculatePistonTorque,
  effectiveOilLevel,
  estimateBrakeTorque,
  getChamberState,
  knockSeverity,
  oilPressureBar,
  rotationalDragTorque,
  smoothThrottle,
} from './physics';
import { sampleTune, tuneBreakpoints } from './tune';
import { smoothMetric } from './smoothing';
import { COMBUSTION, DRIVE, FRICTION, IDLE, INTEGRATOR, LIMITER, RPM, SIM, STARTER, THERMAL, WEAR } from './constants';

const TWO_PI = Math.PI * 2;
const FOUR_PI = Math.PI * 4;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Complete mutable physics state of the engine (plain data, no framework). */
export interface EngineSimState {
  engineState: EngineState;
  /** Crank angle in radians within the 0..4π four-stroke cycle. */
  angle: number;
  rpm: number;
  coolantTemp: number;
  oilTemp: number;
  oilPressure: number;
  /** Butterfly position after inertia lag. */
  actualThrottle: number;
  wear: ComponentWear;
  /** Smoothed crank-drive torque the combustion contributes (Nm). */
  crankDriveTorque: number;
  /** Wind-up term of the idle-air controller. */
  idleIntegral: number;

  // --- transient flags / edge-detection helpers ---
  cranking: boolean;
  ignitionCut: boolean;
  sparkFired: boolean;
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

/** Read-only outputs a step computes for display / audio. */
export interface StepDerived {
  stroke: StrokeType;
  chamber: ChamberState;
  /** Representative steady-state brake torque at the operating point (Nm). */
  meanBrakeTorque: number;
  /** Instantaneous gas-pressure torque on the crankpin (Nm). */
  pistonForceTorque: number;
  limiterTorqueScale: number;
  selfSustained: boolean;
  /** Air actually admitted — the greater of the pedal and the idle bypass. */
  effectiveThrottle: number;
  /** Idle-air valve opening currently commanded. */
  idleBypass: number;
  /** Ignition/lambda the ECU map produced at this RPM. */
  tune: TuneSample;
}

export interface StepResult {
  state: EngineSimState;
  derived: StepDerived;
  events: EngineEvent[];
}

export interface StepInput {
  state: EngineSimState;
  params: EngineParameters;
  spec: EngineSpec;
  tune: TuneMap;
  dt: number;
  /** Drives the rev-limiter spark-cut oscillation. */
  timestampMs: number;
  rng?: Rng;
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
export function createEngineState(coolantTemp = 40, wear: ComponentWear = INITIAL_WEAR): EngineSimState {
  return {
    engineState: EngineState.OFF,
    angle: 0,
    rpm: 0,
    coolantTemp,
    oilTemp: coolantTemp - 5,
    oilPressure: 0,
    actualThrottle: 0,
    wear: { ...wear },
    crankDriveTorque: 0,
    idleIntegral: 0,
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
 * Idle-air bypass opening for the current speed. Behaves like a real idle valve:
 * always slightly open, corrected toward the target idle, and fully shut once
 * the engine is clearly off idle so lifting the throttle still engine-brakes.
 */
function idleBypassOpening(
  state: EngineSimState,
  spec: EngineSpec,
  choke: number,
  dt: number,
  isDead: boolean
): { opening: number; integral: number } {
  const fade = clamp01(1 - (state.rpm - spec.idleRpm) / IDLE.fadeSpanRpm);
  if (fade <= 0 || isDead) {
    return { opening: 0, integral: state.idleIntegral - state.idleIntegral * Math.min(1, dt * 2) };
  }

  const errorKrpm = (spec.idleRpm - state.rpm) / 1000;
  const integral = clamp(state.idleIntegral + errorKrpm * dt * IDLE.integralGain, -IDLE.maxBypass, IDLE.maxBypass);
  const opening =
    fade *
    clamp(
      IDLE.baseBypass + errorKrpm * IDLE.proportionalGain + integral + choke * IDLE.chokeBoost,
      0,
      IDLE.maxBypass
    );

  return { opening, integral };
}

/**
 * Advance the engine physics by `dt` seconds, returning a new state and the
 * domain events that occurred.
 */
export function stepEngine(input: StepInput): StepResult {
  const { params, spec, tune, timestampMs, rng = Math.random } = input;
  const prev = input.state;
  const events: EngineEvent[] = [];
  const dt = Math.min(INTEGRATOR.maxDt, Math.max(0, input.dt));

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

  // Only the first failure in a step is real: an engine that has just blown
  // apart cannot also seize, and a second event would be handled twice downstream.
  const fail = (state: EngineState, reason: string) => {
    if (!events.some((e) => e.kind === 'failure')) events.push({ kind: 'failure', state, reason });
  };

  // --- Airflow: pedal (with butterfly inertia) vs. idle-air bypass ---------
  s.actualThrottle = smoothThrottle(s.actualThrottle, params.throttle, dt);
  const idle = idleBypassOpening(s, spec, params.choke, dt, isDead);
  s.idleIntegral = idle.integral;
  const effectiveThrottle = Math.max(s.actualThrottle, idle.opening);

  // --- ECU map lookup at the current speed --------------------------------
  const breakpoints = tuneBreakpoints(spec);
  const tuneSample = sampleTune(tune, breakpoints, curRpm);

  const oilLevel = effectiveOilLevel(params.oilLevel, spec.oilCapacity);
  s.oilPressure = oilPressureBar(curRpm, params.oilLevel, s.oilTemp, s.wear, spec.oilCapacity);

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
  let wearFrictionMultiplier = spec.frictionMult;
  if (oilLevel < FRICTION.lowOilLevel) {
    wearFrictionMultiplier += Math.pow(FRICTION.lowOilLevel - oilLevel, 1.3) * 0.06;
  }
  if (s.oilPressure < FRICTION.lowOilPressure && curRpm > 200) {
    wearFrictionMultiplier += (FRICTION.lowOilPressure - s.oilPressure) * 2.5;
  }
  wearFrictionMultiplier += (100 - s.wear.crankshaftJournal) * 0.015;
  if (s.coolantTemp > FRICTION.hotFrictionTemp) {
    wearFrictionMultiplier += (s.coolantTemp - FRICTION.hotFrictionTemp) * 0.04;
  }

  const kineticFrictionTorque = curRpm * FRICTION.kineticPerRpm * normalViscosity * wearFrictionMultiplier;
  const staticFrictionTorque = FRICTION.staticTorque * wearFrictionMultiplier;
  // Pumping loss against a closed butterfly — this is what makes lifting off
  // actually engine-brake. Faded out with throttle so it does not double-count
  // the FMEP already inside `estimateBrakeTorque`.
  const pumpingTorque =
    curRpm * FRICTION.pumpingPerRpm * Math.max(0, 1 - effectiveThrottle) * (spec.peakTorque / 24);
  const totalDecelFriction = staticFrictionTorque + kineticFrictionTorque + pumpingTorque;

  // 3. THERMODYNAMICS & CYLINDER PRESSURE FORCE
  const cycleRad = angle % FOUR_PI;
  const thetaDeg = (cycleRad * 180) / Math.PI;
  const strokeType = strokeFromCycleDeg(thetaDeg);

  const selfSustained = curState === EngineState.RUNNING || curState === EngineState.STARTING;
  const chamber = getChamberState({
    angleRad: cycleRad,
    throttle: effectiveThrottle,
    lambda: tuneSample.lambda,
    ignition: tuneSample.ignition,
    rpm: curRpm,
    spec,
    wear: s.wear,
    isRunning: selfSustained,
    hasNitrous: params.hasNitrous,
    cylinderTemp: s.coolantTemp,
    choke: params.choke,
    rng,
  });

  if (chamber.knockSeverity > 0.12 && rng() < 0.02) {
    events.push({
      kind: 'log',
      level: 'critical',
      message: `🚨 探测到爆震 (Knock ${Math.round(chamber.knockSeverity * 100)}%) @ ${Math.round(
        curRpm
      )}rpm！请在 ECU 曲线上把该转速段的点火角回退，或加强散热。`,
    });
  }
  if (chamber.misfire && selfSustained && rng() < 0.03) {
    events.push({
      kind: 'log',
      level: 'warning',
      message: `⚠️ 失火 (Misfire)！λ:${tuneSample.lambda.toFixed(2)} @ ${Math.round(curRpm)}rpm 超出稳定燃烧极限。`,
    });
  }

  const sparkThresholdDeg = 360 - tuneSample.ignition;
  // The window is never narrower than the crank travel of one step, otherwise at
  // high RPM the shaft could jump clean over it and the cylinder would never fire.
  const crankTravelDeg = curRpm * 6 * dt;
  const sparkWindowDeg = Math.max(SIM.sparkWindowDeg, crankTravelDeg);
  const isWithinSparkWindow = thetaDeg >= sparkThresholdDeg && thetaDeg < sparkThresholdDeg + sparkWindowDeg;

  let triggeredIgnitedState = chamber.ignited;
  let limiterCut = false;

  if (params.hasLimiter && curRpm > params.limiterRpm) {
    triggeredIgnitedState = false;
    limiterCut = true;
    if (isWithinSparkWindow && Math.sin(timestampMs * LIMITER.cutFrequency) > 0) {
      triggeredIgnitedState = true;
    }
  }

  // Broken rings leave nothing to compress, so there is nothing for a spark to light.
  const compressionLost = s.wear.pistonRings <= 0;
  if (s.ignitionCut || compressionLost) triggeredIgnitedState = false;

  // Worn spark plug random misfire, mitigated by a hotter ignition system.
  const plugMisfireChance = (1 - s.wear.sparkPlug / 100) / (1 + spec.sparkEnergy);
  if (triggeredIgnitedState && rng() < plugMisfireChance) {
    triggeredIgnitedState = false;
  }

  const limits = { rich: COMBUSTION.lambdaRich, lean: COMBUSTION.lambdaLean };
  const combustionDriveAvailable =
    selfSustained &&
    !s.ignitionCut &&
    !compressionLost &&
    s.wear.sparkPlug > COMBUSTION.minSparkPlug &&
    tuneSample.lambda >= limits.rich &&
    tuneSample.lambda <= limits.lean;

  // The spark fires late in the compression stroke, where the chamber model has
  // not lit anything yet, so whether it lights the charge has to be judged from
  // the operating point rather than from `chamber.ignited`.
  if (isWithinSparkWindow && !s.sparkFired && !isDead && !s.ignitionCut) {
    s.sparkFired = true;
    events.push({ kind: 'spark' });

    const limiterAllowsSpark = !limiterCut || Math.sin(timestampMs * LIMITER.cutFrequency) > 0;
    const plugFouled = rng() < plugMisfireChance;

    if (combustionDriveAvailable && limiterAllowsSpark && !plugFouled) {
      const sparkKnock = knockSeverity({
        spec,
        ignition: tuneSample.ignition,
        lambda: tuneSample.lambda - params.choke * 0.18,
        rpm: curRpm,
        throttle: effectiveThrottle,
        cylinderTemp: s.coolantTemp,
      });
      const knockingPing =
        sparkKnock > 0.2 ||
        s.wear.conrodBearings < 30 ||
        (tuneSample.ignition > 25 && tuneSample.lambda > 1.25);
      events.push({ kind: 'combustion', rpm: curRpm, throttle: effectiveThrottle, knocking: knockingPing });
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

  const meanBrakeTorque = combustionDriveAvailable
    ? estimateBrakeTorque({
        rpm: curRpm,
        throttle: effectiveThrottle,
        lambda: tuneSample.lambda,
        ignition: tuneSample.ignition,
        spec,
        wear: s.wear,
        hasNitrous: params.hasNitrous,
        knock: chamber.knockSeverity,
      }) * limiterTorqueScale
    : 0;

  const targetDriveTorque = meanBrakeTorque > 0 ? meanBrakeTorque + totalDecelFriction : 0;
  const torqueResponseTau = DRIVE.baseTau + spec.rotatingInertia * DRIVE.inertiaTauFactor;
  s.crankDriveTorque = smoothMetric(s.crankDriveTorque, targetDriveTorque, dt, {
    timeConstant: torqueResponseTau,
    maxDeltaPerSecond: spec.peakTorque * DRIVE.maxDeltaFactor,
  });

  const pulseTrim = clamp(pistonForceTorque / Math.max(1, spec.peakTorque * 12), -DRIVE.pulseTrimClamp, DRIVE.pulseTrimClamp);
  const rotationalDamping = rotationalDragTorque(curRpm, spec.frictionMult);
  const netTorque =
    s.crankDriveTorque * (1 + pulseTrim) + starterTorque - totalDecelFriction - params.load - rotationalDamping;

  // 4. ANGULAR ACCELERATION (spec-driven inertia)
  let angularVelocity = (curRpm * TWO_PI) / 60;
  if (!isDead) {
    angularVelocity += (netTorque / spec.rotatingInertia) * dt;
  } else {
    angularVelocity = 0;
  }
  if (angularVelocity < 0) angularVelocity = 0;

  const newRpm = (angularVelocity * 60) / TWO_PI;

  // Self-sustained state transitions
  // The starter alone can spin past the catch speed, so catching also needs a charge that burns.
  if (curState === EngineState.STARTING && newRpm > RPM.catch && combustionDriveAvailable && !isDead) {
    transitionTo(EngineState.RUNNING, 'caught', {
      kind: 'log',
      level: 'success',
      message: '缸内点火连续自持，发动机进入运转状态。',
    });
  }
  if (curState === EngineState.RUNNING && newRpm < RPM.stall && !isDead) {
    transitionTo(EngineState.STALLED, 'stalled', {
      kind: 'log',
      level: 'warning',
      message: '转速跌破自持下限，发动机失速熄火 (STALLED)。',
    });
  }
  if (curState === EngineState.STARTING && !s.cranking && newRpm < RPM.failedStart && !isDead) {
    transitionTo(EngineState.OFF, 'failedStart', {
      kind: 'log',
      level: 'warning',
      message: '起动机脱开，未能成功点火起动。',
    });
  }

  // 5. TEMPERATURE INTEGRATION (coolant + oil)
  //
  // Heat scales with how much fuel the engine is actually burning: speed,
  // load, displacement (via peak torque), boost and detonation. Cooling is
  // gated by a thermostat so a cold engine warms up instead of sitting at
  // ambient, and only weakly by engine speed — this is a test bench, not a
  // vehicle with road speed forcing air through the core.
  const combustionHeatRate =
    (triggeredIgnitedState ? THERMAL.combustionHeat : 0) *
    (curRpm / THERMAL.heatReferenceRpm) *
    (spec.peakTorque / THERMAL.heatOutputReference) *
    (0.45 + 0.55 * effectiveThrottle) *
    (1 + spec.boostBar * 0.9) *
    (1 + chamber.knockSeverity * 0.6) *
    (params.hasNitrous ? THERMAL.nitrousHeatFactor : 1.0);
  const scoringFrictionHeatRate = (curRpm / 600) * Math.max(0, FRICTION.lowOilLevel - oilLevel) * 0.15;

  const thermostat = clamp01((s.coolantTemp - THERMAL.thermostatTemp) / THERMAL.thermostatSpan);
  const radiatorCapacity =
    THERMAL.bypassLeak +
    thermostat * (1.0 + (curRpm / 1000) * THERMAL.radiatorRpmFactor) * (0.45 + 0.9 * params.coolantPump);
  const radiatorCooling =
    (s.coolantTemp - THERMAL.ambient) * THERMAL.radiatorBase * spec.coolingFactor * radiatorCapacity;

  const netTempChange =
    ((combustionHeatRate + scoringFrictionHeatRate - radiatorCooling) / (spec.thermalMass * THERMAL.massScale)) * dt;
  s.coolantTemp = Math.max(THERMAL.ambient, s.coolantTemp + netTempChange);

  const oilTarget = s.coolantTemp + THERMAL.oilOffset + curRpm * 0.002;
  s.oilTemp += (oilTarget - s.oilTemp) * Math.min(1, dt * THERMAL.oilResponseRate);

  if (s.coolantTemp > THERMAL.warnTemp && rng() < 0.02) {
    events.push({
      kind: 'log',
      level: 'critical',
      message: '警告：水温过高！金属热膨胀，拉缸风险剧增。请加大冷却泵或收油。',
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
    const oilWearMultiplier = oilLevel < FRICTION.lowOilLevel ? 1 + Math.pow(FRICTION.lowOilLevel - oilLevel, 1.6) * 0.4 : 1;
    const pressureWearMultiplier = s.oilPressure < 1.0 ? 1 + (1.0 - s.oilPressure) * 6 : 1;
    const knockWearMultiplier = 1.0 + chamber.knockSeverity * WEAR.knockFactor;
    // Graduated over-rev damage: proportional to the fraction past redline.
    const overRevRatio = Math.max(0, (newRpm - spec.redlineRpm) / spec.redlineRpm);
    const bearingOverRev = 1 + overRevRatio * WEAR.overRevBearingFactor;
    const crankOverRev = 1 + overRevRatio * WEAR.overRevCrankFactor;

    const pistonRingWearDt =
      dt * WEAR.pistonRings * oilWearMultiplier * knockWearMultiplier * (s.coolantTemp > WEAR.hotRingsTemp ? 25 : 1);
    const wallWearDt = dt * WEAR.cylinderWall * oilWearMultiplier * (s.coolantTemp > WEAR.hotWallTemp ? 40 : 1);
    const bearingsWearDt =
      dt *
      WEAR.conrodBearings *
      oilWearMultiplier *
      pressureWearMultiplier *
      knockWearMultiplier *
      bearingOverRev *
      (params.hasNitrous ? WEAR.nitrousBearingFactor : 1);
    const crankshaftWearDt =
      dt * WEAR.crankshaftJournal * oilWearMultiplier * pressureWearMultiplier * crankOverRev;
    const sparkPlugWearDt = dt * WEAR.sparkPlug * (triggeredIgnitedState ? 1.5 : 0.2);
    const valvesWearDt = dt * WEAR.valves * (s.coolantTemp > WEAR.hotValvesTemp ? 5 : 1);

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
      events.push({ kind: 'log', level: 'critical', message: '活塞环熔断！气缸失去气密，更换活塞环前无法再起动。' });
      if (s.engineState === EngineState.RUNNING || s.engineState === EngineState.STARTING) {
        transitionTo(EngineState.STALLED, 'pistonRingsFailed');
      }
    }
    if (nextWear.conrodBearings === 0 && prevWear.conrodBearings > 0) {
      fail(EngineState.EXPLODED, '连杆轴瓦烧毁，连杆断裂击穿缸体！发动机彻底报废！');
    }
    if (nextWear.cylinderWall === 0 && prevWear.cylinderWall > 0) {
      fail(EngineState.SEIZED, '干摩擦与高温导致活塞与气缸熔结抱死。');
    }
  }

  // 7. CRITICAL STRESS THRESHOLDS
  if (newRpm > spec.destructRpm && !isDead) {
    fail(EngineState.EXPLODED, `转速超越机械极限 ${Math.round(spec.destructRpm)} RPM！连杆被拉断，机件碎裂爆炸！`);
  }
  if (s.coolantTemp > THERMAL.seizeTemp && !isDead) {
    fail(EngineState.SEIZED, '严重过热！金属烧熔卡死，曲轴抱死 (SEIZED)。');
  }
  if (params.hasNitrous && s.coolantTemp > 120 && rng() < 0.06 && !isDead) {
    fail(EngineState.EXPLODED, '高温状态下强行喷射笑气，混合气剧烈回火引发缸体爆震解体！');
  }

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
      effectiveThrottle,
      idleBypass: idle.opening,
      tune: tuneSample,
    },
    events,
  };
}
