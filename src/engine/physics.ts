/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Kinematics, thermodynamics and the torque model.
 *
 * Everything here is a pure function of an operating point. Ignition advance
 * and lambda arrive as already-interpolated scalars (sampled from the ECU map
 * by the caller), and the build's character — cam profile, knock resistance,
 * boost, spark energy — arrives on the {@link EngineSpec}.
 */

import type { ComponentWear, EngineSpec } from '../types';
import { COMBUSTION, FRICTION, KNOCK, THERMAL, THROTTLE } from './constants';

// ---------------------------------------------------------------------------
// Geometry constants (visual px scale for the canvas; physics uses mm/m)
// ---------------------------------------------------------------------------
export const CRANK_RADIUS = 36; // r (px, drawing only)
export const CONROD_LENGTH = 105; // l (px, drawing only)
export const MAX_THROTTLE = 1.0; // butterfly fully open

/** Pluggable random source so stochastic physics stays deterministic in tests. */
export type Rng = () => number;

/** Piston crown area in m² from bore (mm). */
export function pistonAreaM2(spec: Pick<EngineSpec, 'bore'>): number {
  return Math.PI * Math.pow(spec.bore / 2000, 2);
}

// ---------------------------------------------------------------------------
// Kinematics
// ---------------------------------------------------------------------------

/**
 * Piston displacement from TDC using exact crank-slider geometry (drawing px).
 * 0 at TDC (angle = 0/720), peak at BDC.
 */
export function getPistonDisplacement(angleRad: number): number {
  const theta = angleRad;
  const r = CRANK_RADIUS;
  const l = CONROD_LENGTH;
  const yMax = r + l;
  const yCurrent = r * Math.cos(theta) + Math.sqrt(Math.max(0.1, l * l - r * r * Math.sin(theta) * Math.sin(theta)));
  return yMax - yCurrent;
}

/**
 * Torque generated on the crankpin by gas pressure on the piston crown, using
 * the real reciprocating-mechanism torque equation scaled by spec geometry.
 */
export function calculatePistonTorque(angleRad: number, cylinderPressureBar: number, spec: EngineSpec): number {
  const theta = angleRad % (2 * Math.PI);
  const r_m = spec.stroke / 2000; // crank radius in m (= stroke/2)
  const l_m = (spec.stroke / 2000) * 1.85; // typical conrod ratio l/r ≈ 1.85
  const area = pistonAreaM2(spec);

  const gaugePressure_pa = Math.max(0, cylinderPressureBar - 1.013) * 100000;
  const force_n = gaugePressure_pa * area;

  const sin_t = Math.sin(theta);
  const cos_t = Math.cos(theta);
  const numerator = r_m * sin_t * cos_t;
  const denominator = Math.sqrt(Math.max(1e-6, l_m * l_m - r_m * r_m * sin_t * sin_t));

  return force_n * r_m * (sin_t + numerator / denominator);
}

// ---------------------------------------------------------------------------
// Throttle butterfly inertia — commanded throttle doesn't snap instantly.
// ---------------------------------------------------------------------------
export function smoothThrottle(actual: number, commanded: number, dt: number): number {
  const tau = commanded < actual ? THROTTLE.closingTau : THROTTLE.openingTau;
  const alpha = 1 - Math.exp(-dt / tau);
  return actual + (commanded - actual) * alpha;
}

// ---------------------------------------------------------------------------
// Volumetric efficiency — the shape of the torque curve.
// ---------------------------------------------------------------------------

/**
 * Breathing efficiency at an RPM, shaped by the installed camshaft.
 *
 * The base curve is an asymmetric bell peaking at `torquePeakRpm` (flow chokes
 * faster past the peak than it builds before it). The cam's low/high
 * multipliers are blended across the peak rather than switched at it, so a wild
 * cam trades bottom end for top end as a continuous curve, not a step.
 */
export function volumetricEfficiency(rpm: number, spec: EngineSpec): number {
  const peak = spec.torquePeakRpm;
  const x = rpm / peak;

  let ve: number;
  if (x <= 1) {
    ve = 1.05 - 0.55 * Math.pow(1 - x, 2.0) - 0.18 * Math.pow(Math.max(0, 0.35 - x), 1.5) * 4;
  } else {
    ve = 1.05 - 0.62 * Math.pow(x - 1, 1.35);
  }

  const blend = Math.max(0, Math.min(1, (x - 0.7) / 0.6));
  const camMult = spec.veLowMult + (spec.veHighMult - spec.veLowMult) * blend;

  return Math.max(0.1, Math.min(1.35, ve * camMult));
}

/** Charge multiplier contributed by forced induction (1 = naturally aspirated). */
export function boostChargeMultiplier(spec: EngineSpec): number {
  return 1 + spec.boostBar / 1.013;
}

// ---------------------------------------------------------------------------
// Oil pressure. Pump is crank-driven: pressure rises with RPM, but falls with
// low oil level, hot thin oil, and worn bearings (more clearance = leak-down).
// ---------------------------------------------------------------------------
export function oilPressureBar(
  rpm: number,
  oilLevel: number,
  oilTemp: number,
  wear: ComponentWear,
  oilCapacity = 1
): number {
  if (rpm < 30) return 0;
  const pumpFlow = Math.min(1, rpm / 3000); // saturates ~3000rpm
  // A bigger sump means a given gauge percentage is more actual oil, so
  // starvation begins much later.
  const supply = Math.min(1, (oilLevel / 100) * oilCapacity);
  const hotThinning = Math.max(0.45, 1 - Math.max(0, oilTemp - 95) * 0.006);
  const bearingClearance = 0.6 + 0.4 * (wear.conrodBearings / 100) * (wear.crankshaftJournal / 100);
  const raw = 5.2 * pumpFlow * supply * hotThinning * bearingClearance;
  return Math.max(0, Math.min(6.5, raw));
}

/** Effective oil level once sump capacity is taken into account (0-100). */
export function effectiveOilLevel(oilLevel: number, oilCapacity = 1): number {
  return Math.min(100, oilLevel * oilCapacity);
}

// ---------------------------------------------------------------------------
// Combustion limits
// ---------------------------------------------------------------------------

/** Flammability window, widened by a hotter spark. */
export function flammabilityLimits(spec: EngineSpec): { rich: number; lean: number } {
  return {
    rich: COMBUSTION.lambdaRich - spec.sparkEnergy * 0.04,
    lean: COMBUSTION.lambdaLean + spec.sparkEnergy * 0.12,
  };
}

export interface KnockPoint {
  spec: EngineSpec;
  lambda: number;
  rpm: number;
  cylinderTemp: number;
}

/**
 * The most ignition advance (° BTDC) this engine will accept at this operating
 * point before it starts to detonate.
 *
 * This is the single source of truth for knock: `knockSeverity` measures the
 * overshoot past it, `autoTune` builds its baseline underneath it, and the
 * tuning UI draws it as a line across the ignition curve so the player can see
 * exactly what they are trading against.
 */
export function knockLimitAdvance(point: KnockPoint): number {
  const { spec, lambda, rpm, cylinderTemp } = point;

  const crPenalty = Math.max(0, spec.compressionRatio - KNOCK.referenceCr) * KNOCK.crPenaltyPerPoint;
  const thermalPenalty = Math.max(0, cylinderTemp - KNOCK.thermalOnsetTemp) * KNOCK.thermalPenaltyPerDeg;
  const boostPenalty = spec.boostBar * KNOCK.boostPenaltyPerBar;
  // A rich charge cools the end gas and buys headroom back; a lean one costs it.
  const mixturePenalty = Math.max(-0.1, Math.min(0.5, lambda - KNOCK.mixtureReference)) * KNOCK.mixturePenaltyPerLambda;
  const hardwareBonus = spec.knockResistance * KNOCK.resistanceBonusDeg;

  const mbt = COMBUSTION.optTimingBase + rpm / COMBUSTION.optTimingRpmSlope;
  return mbt + KNOCK.baseHeadroomDeg - crPenalty - thermalPenalty - boostPenalty - mixturePenalty + hardwareBonus;
}

/**
 * Knock severity (0-1): how far past {@link knockLimitAdvance} the ECU is
 * firing, scaled by cylinder load. Zero whenever timing is under the limit,
 * which means retarding is always a cure.
 */
export function knockSeverity(args: KnockPoint & { ignition: number; throttle: number }): number {
  const load = (args.throttle - KNOCK.loadOnset) / KNOCK.loadSpan;
  if (load <= 0) return 0; // no cylinder pressure, no detonation

  const overshoot = args.ignition - knockLimitAdvance(args);
  if (overshoot <= 0) return 0;

  return Math.max(0, Math.min(1, (overshoot / KNOCK.spanDeg) * Math.min(1, load)));
}

export interface ChamberState {
  pressure: number;
  temp: number;
  ignited: boolean;
  efficiency: number;
  knockSeverity: number;
  misfire: boolean;
}

export interface ChamberInput {
  angleRad: number;
  throttle: number;
  /** Lambda sampled from the ECU map at the current RPM. */
  lambda: number;
  /** Ignition advance (° BTDC) sampled from the ECU map at the current RPM. */
  ignition: number;
  rpm: number;
  spec: EngineSpec;
  wear: ComponentWear;
  isRunning: boolean;
  hasNitrous: boolean;
  cylinderTemp: number;
  choke: number;
  rng?: Rng;
}

// ---------------------------------------------------------------------------
// Thermodynamic cylinder state for the current crank angle.
// ---------------------------------------------------------------------------
export function getChamberState(input: ChamberInput): ChamberState {
  const {
    angleRad,
    throttle,
    lambda,
    ignition,
    rpm,
    spec,
    wear,
    isRunning,
    hasNitrous,
    cylinderTemp,
    choke,
    rng = Math.random,
  } = input;

  const thetaDeg = ((angleRad * 180) / Math.PI) % 720;
  const pistonHeightFactor = getPistonDisplacement(angleRad) / (2 * CRANK_RADIUS); // 0..1

  const baseCR = spec.compressionRatio;
  const ringSealing = 0.3 + 0.7 * (wear.pistonRings / 100) * (wear.cylinderWall / 100) * (wear.valves / 100);
  const currentRatio = baseCR - (baseCR - 1) * pistonHeightFactor;

  const ve = volumetricEfficiency(rpm, spec);
  const charge = Math.max(0.04, throttle) * ve * boostChargeMultiplier(spec);
  const boostedManifold = 1.0 + spec.boostBar * throttle;

  let pressure: number;
  let temp: number;
  let ignited = false;
  let efficiency = 0;
  let knock = 0;
  let misfire = false;

  // 1. INTAKE STROKE (0 - 180°)
  if (thetaDeg >= 0 && thetaDeg < 180) {
    const manifoldVacuum = 0.72 * (1.0 - throttle);
    pressure = Math.max(0.28, boostedManifold - manifoldVacuum);
    temp = 25.0 + 35.0 * throttle + spec.boostBar * 40;
  }
  // 2. COMPRESSION STROKE (180 - 360°)
  else if (thetaDeg >= 180 && thetaDeg < 360) {
    const initialPressure = Math.max(0.28, boostedManifold - 0.72 * (1.0 - throttle)) * (0.6 + 0.4 * ve);
    pressure = initialPressure * Math.pow(currentRatio, 1.3) * ringSealing;
    temp = 45.0 + 180.0 * Math.pow(currentRatio, 0.3) * ringSealing;
  }
  // 3. POWER STROKE (360 - 540°)
  else if (thetaDeg >= 360 && thetaDeg < 540) {
    const powerPart = thetaDeg - 360;

    // Cold-start enrichment (choke) widens the rich limit.
    const effLambda = lambda - choke * 0.18;
    const limits = flammabilityLimits(spec);
    const isWithinFlammability = effLambda >= limits.rich && effLambda <= limits.lean;

    const sparkHelp = 1 / (1 + spec.sparkEnergy);
    let misfireChance = 0;
    if (effLambda < 0.78) misfireChance = ((0.78 - effLambda) / (0.78 - limits.rich)) * sparkHelp;
    else if (effLambda > 1.22) misfireChance = ((effLambda - 1.22) / (limits.lean - 1.22)) * sparkHelp;

    const isMisfiredByFuel = rng() < misfireChance;
    const hasFuel = charge > 0.01 && isWithinFlammability && !isMisfiredByFuel;

    if (isRunning && hasFuel && wear.sparkPlug > COMBUSTION.minSparkPlug) {
      ignited = true;

      const optTiming = COMBUSTION.optTimingBase + rpm / COMBUSTION.optTimingRpmSlope;
      const timingError = ignition - optTiming;
      const timingEfficiencyFactor = Math.max(0.15, Math.exp(-Math.pow(timingError / 15, 2)));
      const lambdaEfficiency = Math.max(0, 1.0 - Math.pow(effLambda - COMBUSTION.lambdaPower, 2) * 2.2);

      efficiency = Math.max(0.04, 0.4 * lambdaEfficiency * timingEfficiencyFactor * (0.85 + 0.15 * ve));

      knock = knockSeverity({ spec, ignition, lambda: effLambda, rpm, throttle, cylinderTemp });

      const knockPressureBonus = 1.0 + knock * 0.45;
      const energyMultiplier = charge * (hasNitrous ? 2.6 : 1.0) * timingEfficiencyFactor * (baseCR / 9.5) * 1.05;

      // Burn curve (mass fraction burned approximation)
      let combustionFactor: number;
      if (powerPart < 15) combustionFactor = powerPart / 15;
      else if (powerPart < 90) combustionFactor = 1.0 - (powerPart - 15) / 110;
      else combustionFactor = 0.3 - (powerPart - 90) / 300;
      combustionFactor = Math.max(0.05, combustionFactor);

      const theoreticalPeak = 78.0 * energyMultiplier * ringSealing * knockPressureBonus;
      pressure = theoreticalPeak * combustionFactor * Math.pow(currentRatio / baseCR, 1.15);

      const lateCombustionHeat = timingError < -4 ? Math.abs(timingError + 4) * 0.013 : 0;
      temp = 320.0 + 1380.0 * combustionFactor * energyMultiplier * (0.8 + 0.2 * ringSealing) * (1 + lateCombustionHeat);
    } else {
      misfire = isMisfiredByFuel || !isWithinFlammability;
      const initialPressure = Math.pow(baseCR, 1.3) * ringSealing;
      pressure = initialPressure * Math.pow(currentRatio / baseCR, 1.2);
      temp = 120.0;
    }
  }
  // 4. EXHAUST STROKE (540 - 720°)
  else {
    pressure = 1.02 + 0.25 * (1.0 - wear.valves / 100);
    temp = 380 * (0.4 + 0.6 * throttle) * (1 + spec.boostBar * 0.5);
  }

  return {
    pressure: Math.max(0.1, pressure),
    temp: Math.max(25, temp),
    ignited,
    efficiency: Math.round(efficiency * 100),
    knockSeverity: knock,
    misfire,
  };
}

// ---------------------------------------------------------------------------
// Steady-state brake torque estimator. Used for the instantaneous drive torque
// in the integrator and for quick analytic previews in the tuning UI.
// ---------------------------------------------------------------------------

export interface BrakeTorqueInput {
  rpm: number;
  throttle: number;
  lambda: number;
  ignition: number;
  spec: EngineSpec;
  wear: ComponentWear;
  hasNitrous: boolean;
  /** Knock costs power once it is severe enough to be pulling timing. */
  knock?: number;
}

export function estimateBrakeTorque(input: BrakeTorqueInput): number {
  const { rpm, throttle, lambda, ignition, spec, wear, hasNitrous, knock = 0 } = input;

  const ve = volumetricEfficiency(rpm, spec);
  const ringSealing = 0.3 + 0.7 * (wear.pistonRings / 100) * (wear.cylinderWall / 100) * (wear.valves / 100);

  const optTiming = COMBUSTION.optTimingBase + rpm / COMBUSTION.optTimingRpmSlope;
  const timingError = ignition - optTiming;
  const timingFactor = Math.max(0.15, Math.exp(-Math.pow(timingError / 15, 2)));
  const lambdaFactor = Math.max(0, 1.0 - Math.pow(lambda - COMBUSTION.lambdaPower, 2) * 2.2);

  // `spec.peakTorque` already has the boost pressure ratio baked in by
  // `resolveBuild`, so it must NOT be applied a second time here.
  const indicated =
    spec.peakTorque *
    ve *
    throttle *
    ringSealing *
    timingFactor *
    Math.max(0.2, lambdaFactor) *
    (hasNitrous ? 1.5 : 1.0) *
    // Heavy detonation destroys the pressure trace long before it destroys the
    // engine, so a knocking tune measures slower on the dyno.
    Math.max(0.55, 1 - knock * 0.45);

  // Friction/pumping losses rise with rpm (FMEP-ish), scaled by the build.
  const fmep = (1.2 + Math.pow(rpm / 1000, 1.7) * 0.22) * spec.frictionMult;
  return Math.max(0, indicated - fmep);
}

export function torqueToPowerHp(torqueNm: number, rpm: number): number {
  return (torqueNm * rpm) / 7127;
}

/**
 * Steady-state coolant temperature this build would settle at, by solving the
 * heat balance directly instead of integrating toward it.
 *
 * The garage uses this to warn that a build will cook itself *before* the player
 * spends the credits — a 450 block on the stock radiator predicts well past the
 * seize point, which is exactly the sort of thing you want to be told up front.
 * Assumes the thermostat is fully open, which it is at any temperature worth
 * warning about.
 */
export function equilibriumCoolantTemp(
  spec: EngineSpec,
  rpm: number,
  throttle: number,
  coolantPump: number,
  hasNitrous = false
): number {
  // The power stroke is one of four, so combustion heats the engine 25% of the time.
  const dutyCycle = 0.25;
  const heat =
    THERMAL.combustionHeat *
    dutyCycle *
    (rpm / THERMAL.heatReferenceRpm) *
    (spec.peakTorque / THERMAL.heatOutputReference) *
    (0.45 + 0.55 * throttle) *
    (1 + spec.boostBar * 0.9) *
    (hasNitrous ? THERMAL.nitrousHeatFactor : 1);

  const capacity =
    THERMAL.bypassLeak + (1 + (rpm / 1000) * THERMAL.radiatorRpmFactor) * (0.45 + 0.9 * coolantPump);
  const conductance = THERMAL.radiatorBase * spec.coolingFactor * capacity;
  if (conductance <= 0) return THERMAL.seizeTemp;

  return THERMAL.ambient + heat / conductance;
}

export function rotationalDragTorque(rpm: number, frictionMult = 1): number {
  return ((Math.max(0, rpm) * 2 * Math.PI) / 60) * FRICTION.rotationalDamping * frictionMult;
}
