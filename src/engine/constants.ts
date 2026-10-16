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
  /**
   * Closed-throttle pumping loss (Nm per RPM at zero throttle).
   *
   * `estimateBrakeTorque` clamps at zero, so the motoring loss of pulling
   * against a shut butterfly was being thrown away — which made the engine coast
   * down from redline over about ten seconds and killed the feel of blipping the
   * throttle. This restores it, faded out with throttle opening so it does not
   * double-count the FMEP term that is already inside the torque estimate.
   */
  pumpingPerRpm: 0.0025,
  /** Static (breakaway) friction torque (Nm) at nominal condition. */
  staticTorque: 1.6,
  /** Rotational aerodynamic/pumping damping coefficient (per rad/s). */
  rotationalDamping: 0.006,
} as const;

/**
 * Thermal model (coolant + oil).
 *
 * Calibrated so temperature is a live constraint rather than decoration: a
 * stock build idles at ~90°C, and holding it at wide-open throttle on the
 * standard radiator walks it up past 118°C in under half a minute. That is what
 * makes the cooling parts worth buying and thermal knock worth fearing.
 */
export const THERMAL = {
  ambient: 25, // °C
  /**
   * Thermostat set point. Below this the coolant loop is mostly closed, so a
   * cold engine warms up instead of being held at ambient forever.
   */
  thermostatTemp: 88,
  /** Degrees over the set point across which the thermostat opens fully. */
  thermostatSpan: 12,
  /** Fraction of radiator capacity that leaks away even with the loop closed. */
  bypassLeak: 0.06,
  /** Coolant temp (°C) where overheat warnings begin. */
  warnTemp: 118,
  /** Coolant temp (°C) where the engine seizes from heat. */
  seizeTemp: 140,
  /** Base combustion heat-rate scalar. */
  combustionHeat: 26,
  /** Reference RPM the combustion heat curve is normalised against. */
  heatReferenceRpm: 1100,
  /** Peak torque (Nm) the heat output is normalised against — bigger = hotter. */
  heatOutputReference: 24,
  /** Nitrous heat multiplier. */
  nitrousHeatFactor: 2.5,
  /** Radiator base cooling coefficient. */
  radiatorBase: 0.22,
  /** How much water-pump/airflow capacity scales with engine speed (per krpm). */
  radiatorRpmFactor: 0.12,
  /**
   * Divides the net heat flow so temperature moves on a human timescale
   * (roughly 2 minutes to warm up at idle, ~15s to overheat at full load).
   */
  massScale: 8,
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
  /**
   * Over-rev damage, scaled by *how far* past redline you are rather than a flat
   * penalty. Kissing the limiter is nearly free; holding 15% over redline eats
   * the bottom end in well under a minute.
   */
  overRevBearingFactor: 700,
  overRevCrankFactor: 400,
  /**
   * Coolant temperatures at which thermal damage kicks in. These sit above the
   * normal ~90-115°C operating band so hard use is punished but not instantly
   * fatal, and below {@link THERMAL.seizeTemp} so there is a warning window.
   */
  hotRingsTemp: 122,
  hotWallTemp: 128,
  hotValvesTemp: 118,
} as const;

/**
 * Idle-air control. Without this a pedal-operated throttle would kill the
 * engine the instant you lift, which is both unrealistic and miserable to play.
 * The bypass behaves like an idle-air valve: a base opening, proportional and
 * integral correction toward the target idle, all fading out as revs rise.
 */
export const IDLE = {
  /** Butterfly-equivalent opening held at the target idle speed. */
  baseBypass: 0.17,
  /** Extra opening per 1000 RPM below target. */
  proportionalGain: 0.14,
  /** Integral wind-up rate per 1000 RPM·s of error. Trims out the steady-state
   *  offset so idle actually lands on the target instead of hovering above it. */
  integralGain: 0.2,
  /** Ceiling on total bypass opening. */
  maxBypass: 0.4,
  /** RPM above idle at which the bypass has fully closed. */
  fadeSpanRpm: 900,
  /** Extra fast-idle opening at full choke. */
  chokeBoost: 0.08,
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

/**
 * Fixed-step scheduling. The live runtime and the headless dyno both advance
 * the engine in steps of exactly `fixedDt`, so a given tune produces the same
 * result regardless of the display's refresh rate.
 */
export const SIM = {
  /** Physics step (s). */
  fixedDt: 1 / 120,
  /** Longest wall-clock gap (s) simulated in one frame; the rest is dropped. */
  maxFrameDt: 0.1,
  /** Minimum crank-angle window (degrees) in which a spark counts as firing. */
  sparkWindowDeg: 12,
} as const;

/**
 * Knock model.
 *
 * Knock is expressed as a *limit in degrees of advance* rather than a standing
 * penalty: an engine has some headroom past MBT, and compression, heat, boost
 * and a lean mixture each eat into it. Severity is then simply how far past the
 * limit the ECU is asking the engine to fire.
 *
 * The consequence is the one that makes tuning interesting: retarding always
 * cures knock, and buying cooling genuinely buys back timing.
 */
export const KNOCK = {
  /** Degrees past MBT a cool, stock-compression engine tolerates. */
  baseHeadroomDeg: 6,
  /** Degrees of headroom lost per point of compression ratio above 9.5. */
  crPenaltyPerPoint: 1.8,
  referenceCr: 9.5,
  /** Coolant temperature at which thermal knock begins. */
  thermalOnsetTemp: 95,
  thermalPenaltyPerDeg: 0.28,
  /** Degrees of headroom lost per bar of boost (charge heating). */
  boostPenaltyPerBar: 22,
  /** Degrees of headroom bought per unit of `spec.knockResistance`. */
  resistanceBonusDeg: 20,
  /** Lambda at which the mixture is neither helping nor hurting. */
  mixtureReference: 0.88,
  /** Degrees of headroom lost per unit of lambda above the reference. */
  mixturePenaltyPerLambda: 14,
  /** Degrees past the limit that corresponds to full-severity detonation. */
  spanDeg: 12,
  /** Knock needs cylinder pressure: below this throttle it cannot occur. */
  loadOnset: 0.25,
  loadSpan: 0.45,
} as const;

/** ECU tune-map ranges and baseline-generation behaviour. */
export const TUNE = {
  /** RPM the lowest map breakpoint sits at. */
  lowAnchorRpm: 1000,
  minIgnition: 0,
  maxIgnition: 45,
  minLambda: 0.6,
  maxLambda: 1.5,
  /** Coolant temperature `autoTune` designs its safety margin against. */
  designTemp: 100,
  /** Degrees of retard `autoTune` always keeps in hand. */
  baseSafetyMargin: 2.0,
} as const;

/**
 * Dyno pull behaviour.
 *
 * The sweep rate is deliberately slower than the engine's free acceleration so
 * the brake actually absorbs torque and the pull is a *loaded* sweep: the
 * engine heats up as it climbs, which is what makes a marginal ignition curve
 * start knocking two-thirds of the way up the rev range.
 */
export const DYNO = {
  /** Hard budget (simulated seconds) before a pull is abandoned. */
  maxSeconds: 60,
  /** RPM the measured sweep begins at. */
  startRpm: 1500,
  /** Rate of RPM climb the brake controller targets during the sweep. */
  sweepRateRpm: 500,
  /** Number of evenly spaced RPM bins in the reported curve. */
  bins: 48,
  /** Seconds spent stabilising at the start RPM before measuring. */
  settleSeconds: 2.5,
  /**
   * Steady-state hold at peak-power RPM after the sweep, the way a real dyno
   * session finishes. A ~12s sweep alone never saturates the cooling system, so
   * without this the radiator you bought would make almost no difference and
   * heat-soak knock — the most instructive failure mode there is — would never
   * show up.
   */
  holdSeconds: 9,
  /** Brake-load proportional gain (Nm per rpm of error). */
  brakeGain: 0.03,
  /** Brake-load integral gain (Nm per rpm·s of error). */
  brakeIntegralGain: 0.05,
  /** Maximum brake load the dyno can apply (Nm). */
  maxBrake: 300,
  /** Torque-measurement smoothing time constant (s). */
  measureTau: 0.16,
  /** Abort if the engine fails to gain this many RPM within `stallWindow`. */
  minProgressRpm: 60,
  stallWindow: 3.5,
} as const;

/** Economy: repair / rebuild costs and reward scaling. */
export const ECONOMY = {
  /** Per-component repair, scaled by how worn the component is. */
  repairCost: 60,
  /** Full rebuild — always charged now, even after a grenade. */
  rebuildCost: 320,
  /** Extra levy when the rebuild follows a catastrophic failure. */
  blastSurcharge: 260,
  startingCredits: 400,
  /** Credits per peak HP recorded on a dyno pull — the core repeatable income. */
  dynoCreditPerHp: 6,
  /** Repeat runs of an already-3-starred contract pay this fraction. */
  repeatRewardFactor: 0.25,
  oilChangeCost: 25,
} as const;
