/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum EngineState {
  OFF = 'OFF',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  STALLED = 'STALLED',
  SEIZED = 'SEIZED', // Overheated / oil-starved metal fuse
  EXPLODED = 'EXPLODED', // Engine blown up
}

export enum StrokeType {
  INTAKE = 'INTAKE',
  COMPRESSION = 'COMPRESSION',
  POWER = 'POWER',
  EXHAUST = 'EXHAUST',
}

/**
 * Settings the player leaves in a position. These live in React state and change
 * at human speed.
 *
 * Fuelling and ignition advance are deliberately absent — they vary with RPM, so
 * they live in the {@link TuneMap} instead.
 */
export interface EngineControls {
  load: number; // External brake/dyno drag load (Nm)
  oilLevel: number; // 0% - 100%
  coolantPump: number; // 0 - 1 radiator/coolant flow
  choke: number; // 0 - 1 cold-start enrichment
  hasLimiter: boolean;
  limiterRpm: number;
}

/**
 * The complete control input to one physics step. `throttle` and `hasNitrous`
 * are momentary — they are held in refs and integrated per frame rather than
 * stored in React state, so blipping the throttle costs no re-renders.
 */
export interface EngineParameters extends EngineControls {
  throttle: number; // 0 - MAX_THROTTLE commanded pedal (actual butterfly lags)
  hasNitrous: boolean;
}

/** Fast-changing values the control deck displays. Pushed at telemetry cadence. */
export interface HudState {
  /** Commanded pedal position after its ramp, 0-1. */
  pedal: number;
  /** Butterfly position after inertia lag, 0-1. */
  butterfly: number;
  /** Idle-air valve opening, 0-1. */
  idleBypass: number;
  /** Ignition advance the ECU map produced at the current RPM. */
  ignition: number;
  /** Lambda the ECU map produced at the current RPM. */
  lambda: number;
  /** Advance at which the engine would begin to detonate right now. */
  knockLimit: number;
  cranking: boolean;
  ignitionCut: boolean;
  nitrous: boolean;
}

// ---------------------------------------------------------------------------
// ECU tuning maps
// ---------------------------------------------------------------------------

/**
 * Ignition advance and target lambda as a function of RPM. Both arrays hold
 * {@link TUNE_POINTS} values sampled at the breakpoints returned by
 * `tuneBreakpoints(spec)`, and are linearly interpolated in between.
 *
 * This is the heart of the tuning game: a flat map is safe but slow, and real
 * power comes from shaping advance up top without tipping the engine into knock.
 */
export interface TuneMap {
  ignition: number[]; // degrees BTDC at each breakpoint
  lambda: number[]; // target lambda at each breakpoint
}

export interface TunePreset {
  name: string;
  tune: TuneMap;
}

/** Interpolated tune values at one operating point. */
export interface TuneSample {
  ignition: number;
  lambda: number;
}

// ---------------------------------------------------------------------------
// Build / parts
// ---------------------------------------------------------------------------

export type PartSlot =
  | 'piston' // compression ratio
  | 'cam' // torque peak + breathing character
  | 'crank' // rotating inertia (flywheel)
  | 'rod' // destruct RPM headroom
  | 'head' // flow + knock resistance
  | 'intake'
  | 'exhaust'
  | 'ignition' // spark energy -> misfire resistance
  | 'cooling'
  | 'oil'
  | 'ecu' // how many tune breakpoints you may edit
  | 'boost'; // turbo / supercharger

/** Multiplicative/additive modifiers a part contributes to the resolved spec. */
export interface PartMods {
  boreDelta?: number; // mm added to bore
  strokeDelta?: number; // mm added to stroke
  compressionRatio?: number; // absolute override
  inertiaMult?: number;
  redlineMult?: number;
  destructMult?: number;
  bmepMult?: number; // torque per litre
  torquePeakShift?: number; // RPM shift of the VE peak
  veLowMult?: number; // low-RPM breathing
  veHighMult?: number; // high-RPM breathing
  thermalMassMult?: number;
  coolingMult?: number;
  knockResistance?: number; // additive; 0 = stock
  frictionMult?: number;
  sparkEnergy?: number; // additive misfire resistance
  oilCapacityMult?: number;
  boostBar?: number; // gauge boost pressure
  ecuTier?: number; // 0 flat / 1 three-zone / 2 full map
}

export interface Part {
  id: string;
  slot: PartSlot;
  name: string;
  desc: string;
  /** Downside the player should weigh before bolting it on. */
  drawback: string;
  cost: number;
  /** Career tier at which this part appears in the shop. */
  tier: number;
  /** Only fits these blocks; omit for universal parts. */
  blocks?: string[];
  mods: PartMods;
}

/** A purchasable engine platform. Parts bolt onto it. */
export interface EngineBlock {
  id: string;
  name: string;
  desc: string;
  cost: number;
  tier: number;
  bore: number;
  stroke: number;
  baseCompression: number;
  /** Stock head/cam/exhaust character baked into the block, as a BMEP scalar. */
  baseBmepMult: number;
  baseInertia: number;
  baseRedline: number;
  baseDestruct: number;
  baseTorquePeakRpm: number;
  baseThermalMass: number;
  idleRpm: number;
}

/** The player's current engine: a block plus whatever is bolted to it. */
export interface EngineBuild {
  blockId: string;
  installed: Partial<Record<PartSlot, string>>;
}

/**
 * Fully resolved engine characteristics. Produced by `resolveBuild()` — never
 * hand-written — so every physical property traces back to a part the player
 * actually bought.
 */
export interface EngineSpec {
  id: string;
  name: string;
  bore: number; // mm
  stroke: number; // mm
  compressionRatio: number;
  rotatingInertia: number; // kg·m²
  redlineRpm: number;
  destructRpm: number;
  peakTorque: number; // Nm reference used to shape the torque curve
  torquePeakRpm: number;
  thermalMass: number;
  idleRpm: number;
  description: string;

  // --- character fields derived from installed parts ---
  coolingFactor: number; // 1 = stock radiator
  knockResistance: number; // 0 = stock; higher tolerates more advance/heat
  frictionMult: number; // 1 = stock
  veLowMult: number; // cam character below the torque peak
  veHighMult: number; // cam character above the torque peak
  sparkEnergy: number; // 0 = stock; higher resists misfire
  oilCapacity: number; // 1 = stock sump
  boostBar: number; // 0 = naturally aspirated
  ecuTier: number; // 0..2 tune-map resolution
}

// ---------------------------------------------------------------------------
// Condition / telemetry
// ---------------------------------------------------------------------------

export interface ComponentWear {
  pistonRings: number; // 100 (pristine) -> 0 (broken)
  cylinderWall: number;
  conrodBearings: number;
  crankshaftJournal: number;
  sparkPlug: number;
  valves: number;
}

export interface TelemetryPoint {
  timeIndex: number;
  rpm: number;
  temp: number; // coolant °C
  torque: number; // Nm
  power: number; // HP
  pressure: number; // peak cylinder pressure, bar
  fuelFlow: number; // ml/s
  efficiency: number; // combustion quality %
  oilPressure: number; // bar
  knock: number; // 0-100 knock severity
}

export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'critical';

export interface LogMessage {
  id: string;
  time: string;
  type: LogLevel;
  message: string;
}

// ---------------------------------------------------------------------------
// Dyno
// ---------------------------------------------------------------------------

export interface DynoCurvePoint {
  rpm: number;
  torque: number; // Nm
  power: number; // HP
  knock: number; // 0-1 severity recorded at this RPM
}

export interface DynoResult {
  id: string;
  specName: string;
  curve: DynoCurvePoint[];
  peakPowerHp: number;
  peakPowerRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  /** Highest coolant temperature seen during the pull (°C). */
  maxTemp: number;
  /** Highest knock severity seen during the pull (0-1). */
  maxKnock: number;
  /** Health points consumed by the pull, summed across components. */
  wearCost: number;
  /** Set when the pull ended early (blew up, seized, stalled, timed out). */
  aborted: string | null;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Career
// ---------------------------------------------------------------------------

export type ContractKind = 'idle' | 'dyno' | 'redline' | 'endurance' | 'powerband' | 'thermal';

export interface Contract {
  id: string;
  kind: ContractKind;
  tier: number;
  name: string;
  brief: string;
  /** What the player should actually do, in one line. */
  how: string;
  /** Pass threshold. Interpreted per `kind`. */
  target: number;
  /** Threshold for a perfect (3-star) result. */
  stretch: number;
  /**
   * Optional secondary gate on a dyno contract: peak knock severity (0-1) that
   * the pull must stay under. Used for "make this much power *cleanly*".
   */
  knockLimit?: number;
  reward: number; // credits
  /** Parts gifted outright the first time this contract is passed. */
  unlocks: string[];
}

export interface ContractRun {
  id: string | null;
  startedAt: number;
  elapsed: number;
  metricLabel: string;
  metricValue: number;
  targetValue: number;
  stretchValue: number;
  status: 'idle' | 'running' | 'passed' | 'failed';
  message: string;
  /** Live hint about what is currently blocking a pass. */
  hint: string;
}

export interface GarageState {
  credits: number;
  runtimeHours: number;
  score: number;
  /** Highest career tier reached; gates what the shop stocks. */
  tier: number;
  /** Stars earned per contract id (0-3). */
  stars: Record<string, number>;
  /** Best metric per contract id. */
  best: Record<string, number>;
  /** Block + part ids the player owns. */
  owned: string[];
}
