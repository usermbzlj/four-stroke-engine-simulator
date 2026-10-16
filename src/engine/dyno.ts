/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dyno.
 *
 * The old sweep asked an analytic torque formula for 40 samples and animated a
 * progress bar over the answer, which meant heat, knock, oil pressure and the
 * rev limiter had no effect whatsoever on your number. This one is a real
 * controller: it commands wide-open throttle, modulates a brake to hold a
 * controlled rate of climb, and reads torque back out of the rotational
 * dynamics exactly the way a real dyno does —
 *
 *     T_brake = T_applied + T_windage + I · dω/dt
 *
 * Because it is just a controller over {@link stepEngine}, the same code runs
 * the live on-screen pull (audible, and perfectly capable of grenading your
 * engine) and the deterministic headless pull used by tests.
 */

import type { ComponentWear, DynoCurvePoint, DynoResult, EngineParameters, EngineSpec, TuneMap } from '../types';
import { EngineState } from '../types';
import { DYNO, SIM } from './constants';
import {
  estimateBrakeTorque,
  knockSeverity,
  rotationalDragTorque,
  torqueToPowerHp,
  volumetricEfficiency,
  type Rng,
} from './physics';
import { INITIAL_WEAR, createEngineState, stepEngine, type EngineSimState, type StepResult } from './simulation';
import { sampleTune, tuneBreakpoints } from './tune';

const TWO_PI = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface Bin {
  sum: number;
  count: number;
  knock: number;
}

export interface DynoSession {
  phase: 'settle' | 'sweep' | 'hold' | 'done';
  /** Seconds elapsed in the current phase. */
  phaseTime: number;
  totalTime: number;
  targetRpm: number;
  /** RPM the steady-state hold sits at (peak power, chosen when the sweep ends). */
  holdRpm: number;
  /** Brake torque commanded this tick (Nm). */
  brake: number;
  brakeIntegral: number;
  bins: Bin[];
  binLo: number;
  binHi: number;
  maxTemp: number;
  maxKnock: number;
  startWear: ComponentWear;
  lastRpm: number;
  torqueEma: number;
  /** Highest RPM seen, used for the stall watchdog and progress reporting. */
  peakRpm: number;
  sinceProgress: number;
  aborted: string | null;
}

export function createDynoSession(spec: EngineSpec, wear: ComponentWear): DynoSession {
  return {
    phase: 'settle',
    phaseTime: 0,
    totalTime: 0,
    targetRpm: DYNO.startRpm,
    holdRpm: Math.round(spec.redlineRpm * 0.85),
    brake: 0,
    brakeIntegral: 0,
    bins: Array.from({ length: DYNO.bins }, () => ({ sum: 0, count: 0, knock: 0 })),
    binLo: DYNO.startRpm,
    binHi: spec.redlineRpm,
    maxTemp: 0,
    maxKnock: 0,
    startWear: { ...wear },
    lastRpm: 0,
    torqueEma: 0,
    peakRpm: 0,
    sinceProgress: 0,
    aborted: null,
  };
}

/** Controls the dyno commands during a pull. Throttle is always wide open. */
export interface DynoCommand {
  throttle: number;
  load: number;
}

export interface DynoTickResult {
  session: DynoSession;
  command: DynoCommand;
  done: boolean;
  /** 0-1 sweep completion, for the progress bar. */
  progress: number;
}

const isDead = (s: EngineState): boolean => s === EngineState.EXPLODED || s === EngineState.SEIZED;

/**
 * Advance the dyno controller one tick.
 *
 * Call this *after* stepping the engine, passing the step's outputs. It returns
 * the throttle and brake load to command on the next step.
 */
export function tickDyno(
  session: DynoSession,
  args: { state: EngineSimState; derived: StepResult['derived']; spec: EngineSpec; dt: number }
): DynoTickResult {
  const { state, derived, spec, dt } = args;
  const s: DynoSession = { ...session, bins: session.bins };

  if (s.phase === 'done') {
    return { session: s, command: { throttle: 0, load: 0 }, done: true, progress: 1 };
  }

  s.phaseTime += dt;
  s.totalTime += dt;
  const rpm = state.rpm;

  s.maxTemp = Math.max(s.maxTemp, state.coolantTemp);
  s.maxKnock = Math.max(s.maxKnock, derived.chamber.knockSeverity);

  // --- termination conditions --------------------------------------------
  if (isDead(state.engineState)) {
    s.phase = 'done';
    s.aborted =
      state.engineState === EngineState.EXPLODED
        ? '发动机在测功台上炸缸，拉力测试中止'
        : '发动机在测功台上抱死，拉力测试中止';
  } else if (state.engineState === EngineState.STALLED || state.engineState === EngineState.OFF) {
    s.phase = 'done';
    s.aborted = '发动机在拉力测试中熄火';
  } else if (s.totalTime > DYNO.maxSeconds) {
    s.phase = 'done';
    s.aborted = '拉力测试超时';
  }

  if (s.phase === 'done') {
    return { session: s, command: { throttle: 0, load: 0 }, done: true, progress: sweepProgress(s) };
  }

  // --- phase machine ------------------------------------------------------
  if (s.phase === 'settle') {
    s.targetRpm = DYNO.startRpm;
    if (s.phaseTime >= DYNO.settleSeconds) {
      s.phase = 'sweep';
      s.phaseTime = 0;
      s.peakRpm = rpm;
      s.sinceProgress = 0;
    }
  } else if (s.phase === 'hold') {
    s.targetRpm = s.holdRpm;
    if (s.phaseTime >= DYNO.holdSeconds) s.phase = 'done';
  } else {
    s.targetRpm = Math.min(spec.redlineRpm + 200, DYNO.startRpm + DYNO.sweepRateRpm * s.phaseTime);

    // Measure brake torque from the rotational dynamics.
    if (s.lastRpm > 0) {
      const alpha = (((rpm - s.lastRpm) * TWO_PI) / 60) / Math.max(1e-4, dt);
      const measured = s.brake + rotationalDragTorque(rpm, spec.frictionMult) + spec.rotatingInertia * alpha;
      const alphaSmooth = 1 - Math.exp(-dt / DYNO.measureTau);
      s.torqueEma += (measured - s.torqueEma) * alphaSmooth;

      const index = binIndexFor(s, rpm);
      const bin = index === null ? undefined : s.bins[index];
      if (bin && s.torqueEma > 0) {
        bin.sum += s.torqueEma;
        bin.count += 1;
        bin.knock = Math.max(bin.knock, derived.chamber.knockSeverity);
      }
    }

    // Stall watchdog: a tune too sick to pull should fail honestly, not hang.
    if (rpm > s.peakRpm + DYNO.minProgressRpm) {
      s.peakRpm = rpm;
      s.sinceProgress = 0;
    } else {
      s.sinceProgress += dt;
      if (s.sinceProgress > DYNO.stallWindow) {
        s.phase = 'done';
        s.aborted = `动力不足，转速卡在 ${Math.round(rpm)} rpm 无法继续爬升`;
      }
    }

    if (rpm >= spec.redlineRpm) {
      // Hold at whichever RPM measured strongest — that is where the engine is
      // working hardest, so it is the honest place to heat-soak it.
      s.holdRpm = peakPowerRpmOf(s) ?? s.holdRpm;
      s.phase = 'hold';
      s.phaseTime = 0;
    }
  }

  s.lastRpm = rpm;

  // --- brake controller (PI on RPM error) ---------------------------------
  const error = rpm - s.targetRpm;
  s.brakeIntegral = clamp(s.brakeIntegral + error * dt * DYNO.brakeIntegralGain, 0, DYNO.maxBrake);
  s.brake = clamp(error * DYNO.brakeGain + s.brakeIntegral, 0, DYNO.maxBrake);

  return {
    session: s,
    command: { throttle: 1, load: s.brake },
    done: s.phase === 'done',
    progress: sweepProgress(s),
  };
}

/** RPM of the strongest power reading recorded so far, if any. */
function peakPowerRpmOf(s: DynoSession): number | null {
  const span = Math.max(1, s.binHi - s.binLo);
  let bestPower = 0;
  let bestRpm: number | null = null;
  s.bins.forEach((bin, i) => {
    if (bin.count === 0) return;
    const rpm = s.binLo + (span * (i + 0.5)) / s.bins.length;
    const power = torqueToPowerHp(bin.sum / bin.count, rpm);
    if (power > bestPower) {
      bestPower = power;
      bestRpm = rpm;
    }
  });
  return bestRpm;
}

/** 0-1 completion: the sweep is the first 80%, the steady-state hold the rest. */
function sweepProgress(s: DynoSession): number {
  if (s.phase === 'settle') return 0;
  if (s.phase === 'done') return 1;
  if (s.phase === 'hold') return 0.8 + 0.2 * clamp(s.phaseTime / DYNO.holdSeconds, 0, 1);
  const span = Math.max(1, s.binHi - s.binLo);
  return 0.8 * clamp((s.peakRpm - s.binLo) / span, 0, 1);
}

function binIndexFor(s: DynoSession, rpm: number): number | null {
  if (rpm < s.binLo || rpm > s.binHi) return null;
  const span = Math.max(1, s.binHi - s.binLo);
  const index = Math.floor(((rpm - s.binLo) / span) * DYNO.bins);
  return clamp(index, 0, DYNO.bins - 1);
}

/** Turn an accumulated session into a reportable result. */
export function finishDyno(session: DynoSession, spec: EngineSpec, endWear: ComponentWear): DynoResult {
  const curve: DynoCurvePoint[] = [];
  const span = Math.max(1, session.binHi - session.binLo);

  session.bins.forEach((bin, i) => {
    if (bin.count === 0) return;
    const rpm = session.binLo + (span * (i + 0.5)) / DYNO.bins;
    const torque = bin.sum / bin.count;
    if (torque <= 0) return;
    curve.push({ rpm, torque, power: torqueToPowerHp(torque, rpm), knock: bin.knock });
  });

  let peakPowerHp = 0;
  let peakPowerRpm = 0;
  let peakTorqueNm = 0;
  let peakTorqueRpm = 0;
  for (const point of curve) {
    if (point.power > peakPowerHp) {
      peakPowerHp = point.power;
      peakPowerRpm = point.rpm;
    }
    if (point.torque > peakTorqueNm) {
      peakTorqueNm = point.torque;
      peakTorqueRpm = point.rpm;
    }
  }

  const wearCost = (Object.keys(session.startWear) as (keyof ComponentWear)[]).reduce(
    (sum, key) => sum + Math.max(0, session.startWear[key] - endWear[key]),
    0
  );

  return {
    id: Math.random().toString(36).slice(2, 8),
    specName: spec.name,
    curve,
    peakPowerHp,
    peakPowerRpm,
    peakTorqueNm,
    peakTorqueRpm,
    maxTemp: session.maxTemp,
    maxKnock: session.maxKnock,
    wearCost,
    aborted: session.aborted,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Headless pull — same controller, no UI. Used by tests and by the "预估" path.
// ---------------------------------------------------------------------------

export interface HeadlessPullOptions {
  spec: EngineSpec;
  tune: TuneMap;
  params: EngineParameters;
  wear?: ComponentWear;
  startCoolantTemp?: number;
  rng?: Rng;
}

export function runDynoHeadless(options: HeadlessPullOptions): DynoResult {
  const { spec, tune, params, wear = INITIAL_WEAR, startCoolantTemp = 85, rng = Math.random } = options;

  let state = createEngineState(startCoolantTemp, wear);
  state.engineState = EngineState.RUNNING;
  state.rpm = DYNO.startRpm;
  state.actualThrottle = 1;

  let session = createDynoSession(spec, wear);
  let command: DynoCommand = { throttle: 1, load: 0 };
  let timestamp = 0;

  for (let i = 0; i < Math.ceil(DYNO.maxSeconds / SIM.fixedDt); i++) {
    timestamp += SIM.fixedDt * 1000;
    const stepParams: EngineParameters = {
      ...params,
      throttle: command.throttle,
      load: command.load,
      choke: 0,
      hasNitrous: false,
    };
    const step = stepEngine({ state, params: stepParams, spec, tune, dt: SIM.fixedDt, timestampMs: timestamp, rng });
    state = step.state;

    const tick = tickDyno(session, { state, derived: step.derived, spec, dt: SIM.fixedDt });
    session = tick.session;
    command = tick.command;
    if (tick.done) break;
  }

  return finishDyno(session, spec, state.wear);
}

// ---------------------------------------------------------------------------
// Analytic preview — instant, side-effect free, for the tuning editor.
// ---------------------------------------------------------------------------

/**
 * Steady-state torque/power estimate across the rev range.
 *
 * This is *not* what the dyno reports. It ignores thermal build-up and the
 * limiter, so the real pull will usually come in a little under it — which is
 * the gap the player is trying to close by tuning.
 */
export function previewCurve(spec: EngineSpec, tune: TuneMap, wear: ComponentWear, cylinderTemp = 95): DynoCurvePoint[] {
  const breakpoints = tuneBreakpoints(spec);
  const points: DynoCurvePoint[] = [];
  const steps = 40;

  for (let i = 0; i <= steps; i++) {
    const rpm = DYNO.startRpm + ((spec.redlineRpm - DYNO.startRpm) * i) / steps;
    const sample = sampleTune(tune, breakpoints, rpm);
    const knock = knockSeverity({
      spec,
      ignition: sample.ignition,
      lambda: sample.lambda,
      rpm,
      throttle: 1,
      cylinderTemp,
    });
    const torque = estimateBrakeTorque({
      rpm,
      throttle: 1,
      lambda: sample.lambda,
      ignition: sample.ignition,
      spec,
      wear,
      hasNitrous: false,
      knock,
    });
    points.push({ rpm, torque, power: torqueToPowerHp(torque, rpm), knock });
  }

  return points;
}

/** Volumetric efficiency trace, handy for explaining a cam swap in the UI. */
export function veCurve(spec: EngineSpec, steps = 40): { rpm: number; ve: number }[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const rpm = DYNO.startRpm + ((spec.redlineRpm - DYNO.startRpm) * i) / steps;
    return { rpm, ve: volumetricEfficiency(rpm, spec) };
  });
}
