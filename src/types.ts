/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum EngineState {
  OFF = 'OFF',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  STALLED = 'STALLED',
  SEIZED = 'SEIZED', // Overheated/no-oil metal fuse / seized
  EXPLODED = 'EXPLODED', // Engine blown up
}

export enum StrokeType {
  INTAKE = 'INTAKE',       // 进气
  COMPRESSION = 'COMPRESSION', // 压缩
  POWER = 'POWER',         // 动力 (作功)
  EXHAUST = 'EXHAUST',     // 排气
}

export interface EngineParameters {
  throttle: number;         // 0 - 1 (commanded throttle; actual lags via butterfly inertia)
  load: number;             // Brake/dyno drag load (0 - 50 Nm)
  fuelAirRatio: number;     // Lambda: 0.6 (rich) - 1.5 (lean), ideal is ~0.92 for power / 1.0 stoich
  oilLevel: number;         // 0% - 100%, below 35% causes friction heater and extreme wear
  ignitionTiming: number;   // Ignition advance degrees BTDC (Before Top Dead Center), 0° - 45°
  hasLimiter: boolean;      // True if RPM limiter is active
  limiterRpm: number;       // RPM ceiling (e.g. 7000 RPM)
  hasNitrous: boolean;      // Nos boost active helper
  coolantPump: number;      // 0 - 1, radiator/coolant flow capacity (cooling aggressiveness)
  choke: number;            // 0 - 1, cold-start enrichment (extra fuel when cold)
}

/**
 * Static engine build specification. Swapping these reconfigures the whole physics model:
 * displacement, redline behaviour, torque curve shape, thermal mass, etc.
 */
export interface EngineSpec {
  id: string;
  name: string;
  bore: number;             // mm
  stroke: number;           // mm
  compressionRatio: number; // static geometric CR (e.g. 9.5, 11.5 for race)
  rotatingInertia: number;  // kg·m² (crank + flywheel) — lighter = revvier but less stable idle
  redlineRpm: number;       // mechanical safe redline
  destructRpm: number;      // hard mechanical failure RPM (rods let go)
  peakTorque: number;       // Nm reference at the torque peak (used to shape the VE curve)
  torquePeakRpm: number;    // RPM where volumetric efficiency peaks
  thermalMass: number;      // relative heat capacity (higher = heats/cools slower)
  description: string;
}

export interface ComponentWear {
  pistonRings: number;      // 100 (pristine) -> 0 (broken, causes oil burning, compression loss)
  cylinderWall: number;     // 100 -> 0 (scoured, causes compression leak, blowby)
  conrodBearings: number;   // 100 -> 0 (knocking, reduces power, can throw a rod!)
  crankshaftJournal: number;// 100 -> 0 (friction spikes, risk of seize)
  sparkPlug: number;        // 100 -> 0 (misfires, stalling)
  valves: number;           // 100 -> 0 (leaking valves, loss of power/stall)
}

export interface TelemetryPoint {
  timeIndex: number;
  rpm: number;
  temp: number;             // Cylinder/coolant temperature in °C
  torque: number;           // output torque in Nm
  power: number;            // output power in HP
  pressure: number;         // cylinder pressure in bar (peaks during Power stroke)
  fuelFlow: number;         // ml/s
  efficiency: number;       // Thermodynamic efficiency %
  oilPressure: number;      // bar
}

export interface LogMessage {
  id: string;
  time: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'critical';
  message: string;
}

/** Live derived runtime telemetry (richer than a single charted point). */
export interface RuntimeStats {
  rpm: number;
  coolantTemp: number;      // °C
  oilTemp: number;          // °C
  oilPressure: number;      // bar
  torque: number;           // Nm (net brake torque)
  power: number;            // HP
  pressure: number;         // instantaneous cylinder pressure bar
  fuelFlow: number;         // ml/s
  efficiency: number;       // %
  actualThrottle: number;   // 0-1 (butterfly position after lag)
  knock: number;            // 0-1 knock severity
  boost: number;            // nitrous/forced indicator 0-1
}

/** A captured dyno pull: torque & power vs RPM. */
export interface DynoCurvePoint {
  rpm: number;
  torque: number;  // Nm
  power: number;   // HP
}

export interface DynoResult {
  id: string;
  specName: string;
  curve: DynoCurvePoint[];
  peakPowerHp: number;
  peakPowerRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  timestamp: number;
}

export type ChallengeId = 'idle' | 'dyno' | 'endurance' | 'redline';

export interface Challenge {
  id: ChallengeId;
  name: string;
  subtitle: string;
  goal: string;
}

export interface ChallengeProgress {
  active: ChallengeId | null;
  startedAt: number;        // performance.now() ms
  elapsed: number;          // seconds inside the challenge
  metricLabel: string;      // what we're measuring
  metricValue: number;      // live measured value
  targetValue: number;      // value needed to pass
  best: Record<ChallengeId, number>; // personal bests per challenge
  status: 'idle' | 'running' | 'passed' | 'failed';
  message: string;
}

export interface GarageState {
  credits: number;          // currency earned from challenges/dyno, spent on repairs
  runtimeHours: number;     // accumulated engine running time (engine "mileage")
  score: number;            // cumulative tuning score
}

export interface TunePreset {
  name: string;
  params: Pick<EngineParameters, 'fuelAirRatio' | 'ignitionTiming' | 'limiterRpm' | 'hasLimiter' | 'coolantPump'>;
}
