/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralised tuning constants for the engine simulation.
 *
 * These were previously scattered as magic numbers throughout the per-frame
 * integrator. Grouping them here makes the physics model legible and tunable
 * without hunting through the loop, and lets the tests assert against named
 * quantities instead of bare literals.
 *
 * Units are noted per field. "physics" quantities use SI-ish units (Nm, bar,
 * °C, kg·m²); a handful of canvas geometry constants live in
 * {@link ./physics.ts} because they are drawing-only.
 */

/** Self-sustaining / state-transition thresholds (RPM). */
export const RPM = {
  /** Above this while STARTING => engine catches and transitions to RUNNING. */
  catch: 420,
  /** Below this while RUNNING => engine stalls. */
  stall: 250,
  /** Below this with the starter released while STARTING => failed start, back to OFF. */
  failedStart: 150,
  /** Minimum RPM for wear accumulation / friction-spike logic to engage. */
  wearFloor: 100,
} as const;

/** Starter motor behaviour. */
export const STARTER = {
  /** Reference rotating inertia (kg·m²) the starter strength is normalised against. */
  referenceInertia: 0.14,
  /** Base starter strength multiplier. */
  baseStrength: 2.2,
  /** Angular-speed ceiling (rad/s) the starter can drive toward. */
  driveSpeedCeiling: 75,
} as const;

/** Friction / drag model. */
export const FRICTION = {
  /** Oil temp (°C) below which cold-oil viscosity penalty applies. */
  coldOilTemp: 70,
  /** Viscosity gain per °C below {@link coldOilTemp}. */
  coldOilViscosityPerDeg: 0.012,
  /** Base oil viscosity factor at operating temperature. */
  baseViscosity: 0.3,
  /** Oil level (%) below which the low-oil friction heater engages. */
  lowOilLevel: 35,
  /** Oil pressure (bar) below which metal-to-metal friction spikes. */
  lowOilPressure: 0.8,
  /** Coolant temp (°C) above which thermal-expansion friction spikes. */
  hotFrictionTemp: 115,
  /** Kinetic friction coefficient (per RPM). */
  kineticPerRpm: 0.0015,
  /** Static (breakaway) friction torque (Nm) at nominal condition. */
  staticTorque: 1.6,
  /** Rotational aerodynamic/pumping damping coefficient (per rad/s). */
  rotationalDamping: 0.006,
} as const;

/** Thermal model (coolant + oil). */
export const THERMAL = {
  ambient: 25, // °C
  /** Coolant temp (°C) where overheat warnings begin. */
  warnTemp: 125,
  /** Coolant temp (°C) where the engine seizes from heat. */
  seizeTemp: 145,
  /** Base combustion heat-rate scalar. */
  combustionHeat: 5,
  /** Reference RPM the combustion heat curve is normalised against. */
  heatReferenceRpm: 1100,
  /** Nitrous heat multiplier. */
  nitrousHeatFactor: 2.5,
  /** Radiator base cooling coefficient. */
  radiatorBase: 0.05,
  /** Oil temperature offset above coolant at idle (°C). */
  oilOffset: 8,
  /** Oil temp response rate (per second). */
  oilResponseRate: 0.4,
} as const;

/** Component-wear degradation rates (health points per second, before multipliers). */
export const WEAR = {
  pistonRings: 0.018,
  cylinderWall: 0.016,
  conrodBearings: 0.02,
  crankshaftJournal: 0.012,
  sparkPlug: 0.01,
  valves: 0.009,
  /** Knock severity multiplier on ring/bearing wear. */
  knockFactor: 35,
  /** Nitrous multiplier on bearing wear. */
  nitrousBearingFactor: 5,
} as const;

/** Throttle butterfly inertia (first-order lag time constants, seconds). */
export const THROTTLE = {
  /** Faster when closing (engine-braking realism). */
  closingTau: 0.05,
  /** Slower when opening. */
  openingTau: 0.09,
} as const;

/** Crank-drive torque smoothing. */
export const DRIVE = {
  baseTau: 0.16,
  inertiaTauFactor: 0.65,
  maxDeltaFactor: 18, // × spec.peakTorque per second
  pulseTrimClamp: 0.12,
} as const;

/** Combustion / ignition limits. */
export const COMBUSTION = {
  /** Lower flammability limit (lambda). */
  lambdaLean: 1.45,
  /** Upper rich flammability limit (lambda). */
  lambdaRich: 0.62,
  /** Lambda that produces peak power. */
  lambdaPower: 0.92,
  /** Minimum spark-plug health (%) for combustion. */
  minSparkPlug: 10,
  /** Optimal-timing base + rpm slope (degrees BTDC). */
  optTimingBase: 10,
  optTimingRpmSlope: 280,
} as const;

/** Rev-limiter behaviour when bouncing off the limiter. */
export const LIMITER = {
  /** Base torque scale while on the limiter. */
  torqueScaleBase: 0.22,
  torqueScaleSwing: 0.25,
  /** Spark-cut oscillation frequency factor (× timestamp ms). */
  cutFrequency: 0.05,
} as const;

/** Integrator safety. */
export const INTEGRATOR = {
  /** Maximum dt (s) honoured per step; clamps tab-inactive leaps. */
  maxDt: 0.1,
} as const;

/** Economy: repair / rebuild costs and reward scaling. */
export const ECONOMY = {
  repairCost: 60,
  rebuildCost: 320,
  startingCredits: 250,
} as const;
