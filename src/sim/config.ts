/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The physical description of an engine on the bench, and the ECU that runs it.
 *
 * Everything here is a measurable quantity — millimetres, degrees, newtons,
 * kg·m² — so the torque curve, the knock limit, valve float and the rpm at
 * which the rod lets go are all *consequences* of the build rather than
 * numbers someone typed in.
 */

export type MufflerType = 'stock' | 'sport' | 'open';
export type LimiterMode = 'spark' | 'fuel';

export interface EngineConfig {
  /** mm */
  bore: number;
  /** mm */
  stroke: number;
  /** Centre-to-centre, mm. */
  rodLength: number;
  compressionRatio: number;

  /** 1 or 2 valves per side. */
  intakeValves: number;
  exhaustValves: number;
  /** Valve head diameters, mm. */
  intakeValveDiameter: number;
  exhaustValveDiameter: number;
  /** Duration at 5% of peak lift, crank degrees, as quoted on a cam card. */
  intakeDuration: number;
  exhaustDuration: number;
  /** Peak valve lift, mm. */
  intakeLift: number;
  exhaustLift: number;
  /** Lobe separation angle, cam degrees as quoted on a cam card. */
  lobeSeparation: number;
  /** Intake centreline, crank degrees after overlap TDC. */
  intakeCenterline: number;
  /** Valve spring force at full lift, N. */
  valveSpringForce: number;

  /** mm */
  throttleDiameter: number;
  /** mm */
  intakeRunnerLength: number;
  intakeRunnerDiameter: number;
  /** mm */
  exhaustHeaderLength: number;
  exhaustHeaderDiameter: number;
  muffler: MufflerType;

  /** Crank + flywheel, kg·m². */
  flywheelInertia: number;
  /** Piston, pin, rings and small end, kg. */
  reciprocatingMass: number;
  /** Tensile load the rod survives on a single cycle, N. */
  rodStrength: number;

  /** Research octane number of the fuel in the tank. */
  fuelOctane: number;
  /** Radiator size relative to the stock core. */
  radiatorCapacity: number;
}

export interface EcuConfig {
  /** Added to the factory spark map, degrees. */
  advanceOffset: number;
  /** Lambda targeted at part load. */
  cruiseLambda: number;
  /** Lambda targeted at wide-open throttle. */
  wotLambda: number;
  limiterRpm: number;
  limiterMode: LimiterMode;
  idleRpm: number;
  /** Shut the injector when coasting with the throttle closed. */
  overrunFuelCut: boolean;
  /** Retard on detected knock, then creep back. */
  knockControl: boolean;
}

export interface BenchConfig {
  /** Test-cell coolant conditioner holds the jacket at a set point. */
  coolantConditioner: boolean;
  coolantSetpoint: number;
}

export interface EnginePreset {
  id: string;
  name: string;
  blurb: string;
  engine: EngineConfig;
  ecu: EcuConfig;
}

const STREET_250: EngineConfig = {
  bore: 72,
  stroke: 61.2,
  rodLength: 112,
  compressionRatio: 10,
  intakeValves: 1,
  exhaustValves: 1,
  intakeValveDiameter: 33,
  exhaustValveDiameter: 28,
  intakeDuration: 236,
  exhaustDuration: 240,
  intakeLift: 8,
  exhaustLift: 7.5,
  lobeSeparation: 110,
  intakeCenterline: 108,
  valveSpringForce: 470,
  throttleDiameter: 32,
  intakeRunnerLength: 280,
  intakeRunnerDiameter: 30,
  exhaustHeaderLength: 650,
  exhaustHeaderDiameter: 32,
  muffler: 'stock',
  flywheelInertia: 0.025,
  reciprocatingMass: 0.24,
  rodStrength: 10300,
  fuelOctane: 92,
  radiatorCapacity: 1,
};

const RACE_450: EngineConfig = {
  bore: 96,
  stroke: 62,
  rodLength: 108,
  compressionRatio: 12.5,
  intakeValves: 2,
  exhaustValves: 2,
  intakeValveDiameter: 36,
  exhaustValveDiameter: 30,
  intakeDuration: 262,
  exhaustDuration: 258,
  intakeLift: 10,
  exhaustLift: 9,
  lobeSeparation: 108,
  intakeCenterline: 106,
  valveSpringForce: 900,
  throttleDiameter: 44,
  intakeRunnerLength: 200,
  intakeRunnerDiameter: 40,
  exhaustHeaderLength: 520,
  exhaustHeaderDiameter: 40,
  muffler: 'open',
  flywheelInertia: 0.012,
  reciprocatingMass: 0.32,
  rodStrength: 21500,
  fuelOctane: 98,
  radiatorCapacity: 1.3,
};

const THUMPER_650: EngineConfig = {
  bore: 100,
  stroke: 83,
  rodLength: 145,
  compressionRatio: 9.8,
  intakeValves: 2,
  exhaustValves: 2,
  intakeValveDiameter: 36,
  exhaustValveDiameter: 31,
  intakeDuration: 228,
  exhaustDuration: 232,
  intakeLift: 9,
  exhaustLift: 8.5,
  lobeSeparation: 112,
  intakeCenterline: 110,
  valveSpringForce: 450,
  throttleDiameter: 40,
  intakeRunnerLength: 380,
  intakeRunnerDiameter: 38,
  exhaustHeaderLength: 800,
  exhaustHeaderDiameter: 42,
  muffler: 'sport',
  flywheelInertia: 0.06,
  reciprocatingMass: 0.45,
  rodStrength: 16900,
  fuelOctane: 92,
  radiatorCapacity: 1.4,
};

export const DEFAULT_ECU: EcuConfig = {
  advanceOffset: 0,
  cruiseLambda: 1,
  wotLambda: 0.88,
  limiterRpm: 8800,
  limiterMode: 'spark',
  idleRpm: 1400,
  overrunFuelCut: true,
  knockControl: true,
};

export const DEFAULT_BENCH: BenchConfig = {
  coolantConditioner: true,
  coolantSetpoint: 85,
};

export const PRESETS: EnginePreset[] = [
  {
    id: 'street-250',
    name: '250 街车单缸',
    blurb: '温和凸轮、重飞轮、原厂消音器。好起动，好伺候，适合先摸清每个参数。',
    engine: STREET_250,
    ecu: DEFAULT_ECU,
  },
  {
    id: 'race-450',
    name: '450 短冲程赛机',
    blurb: '高压缩、大重叠角凸轮、直通排气、轻飞轮。怠速发抖，一万转以上才醒。',
    engine: RACE_450,
    ecu: {
      ...DEFAULT_ECU,
      advanceOffset: -10,
      limiterRpm: 11800,
      idleRpm: 1900,
      overrunFuelCut: false,
      wotLambda: 0.86,
    },
  },
  {
    id: 'thumper-650',
    name: '650 长冲程大单缸',
    blurb: '每一下点火都像捶胸口。转不高，但低转扭矩厚得像墙。',
    engine: THUMPER_650,
    ecu: { ...DEFAULT_ECU, limiterRpm: 6600, idleRpm: 1100 },
  },
];

export const DEFAULT_PRESET = PRESETS[0] as EnginePreset;

// ---------------------------------------------------------------------------
// Derived quantities, shared by the solver and the build sheet.
// ---------------------------------------------------------------------------

/** Swept volume of the cylinder, cc. */
export function displacementCc(c: Pick<EngineConfig, 'bore' | 'stroke'>): number {
  return (Math.PI / 4) * c.bore * c.bore * c.stroke * 1e-3;
}

/** Degrees during which both valves are open around overlap TDC. */
export function overlapDeg(c: EngineConfig): number {
  const exhaustCenterline = 2 * c.lobeSeparation - c.intakeCenterline;
  const ivo = c.intakeDuration / 2 - c.intakeCenterline; // before TDC
  const evc = c.exhaustDuration / 2 - exhaustCenterline; // after TDC
  return Math.max(0, ivo + evc);
}

/** Valve-train mass that the spring has to control, kg. Scales with head area. */
export function valveTrainMass(diameterMm: number): number {
  return 0.06 * Math.pow(diameterMm / 31, 2);
}

/**
 * Seat-to-seat half-width of the cos² lift bump relative to the quoted
 * duration: cos² falls to 5% of peak at 0.856 of its half-width.
 */
export const LIFT_PROFILE_STRETCH = 1 / 0.856;

/**
 * Speed at which the spring can no longer keep the follower on the lobe.
 *
 * The lift profile is a cos² bump, whose peak deceleration (at the nose) is
 * `lift/2 · (π/h)² · ω²` with `h` the seat-to-seat half-width in radians.
 * Float starts when that deceleration × valve mass beats the spring.
 */
export function valveFloatRpm(c: EngineConfig): number {
  const rpmFor = (lift: number, duration: number, diameter: number): number => {
    const half = (duration / 2) * LIFT_PROFILE_STRETCH * (Math.PI / 180);
    const k = (lift / 1000 / 2) * Math.pow(Math.PI / half, 2);
    const omega = Math.sqrt(c.valveSpringForce / (valveTrainMass(diameter) * k));
    return (omega * 60) / (2 * Math.PI);
  };
  return Math.min(
    rpmFor(c.intakeLift, c.intakeDuration, c.intakeValveDiameter),
    rpmFor(c.exhaustLift, c.exhaustDuration, c.exhaustValveDiameter)
  );
}

/** Valve opening/closing angles at 5% lift, cycle degrees (firing TDC = 0, overlap TDC = 360). */
export function valveEvents(c: EngineConfig): { ivo: number; ivc: number; evo: number; evc: number } {
  const ivCenter = 360 + c.intakeCenterline;
  const evCenter = 360 - (2 * c.lobeSeparation - c.intakeCenterline);
  return {
    ivo: ivCenter - c.intakeDuration / 2,
    ivc: ivCenter + c.intakeDuration / 2,
    evo: evCenter - c.exhaustDuration / 2,
    evc: evCenter + c.exhaustDuration / 2,
  };
}

/** Lift as a fraction of peak at a cycle angle, ignoring float. */
export function liftFraction(c: EngineConfig, cycleDeg: number, side: 'intake' | 'exhaust'): number {
  const center =
    side === 'intake' ? 360 + c.intakeCenterline : 360 - (2 * c.lobeSeparation - c.intakeCenterline);
  const half = ((side === 'intake' ? c.intakeDuration : c.exhaustDuration) / 2) * LIFT_PROFILE_STRETCH;
  let d = cycleDeg - center;
  if (d > 360) d -= 720;
  else if (d < -360) d += 720;
  if (d <= -half || d >= half) return 0;
  const k = Math.cos((d / half) * (Math.PI / 2));
  return k * k;
}

/** Peak inertial tension on the rod at exhaust TDC, N. */
export function rodInertiaForce(c: EngineConfig, rpm: number): number {
  const r = c.stroke / 2000;
  const l = c.rodLength / 1000;
  const omega = (rpm * 2 * Math.PI) / 60;
  return c.reciprocatingMass * r * omega * omega * (1 + r / l);
}

/** Speed at which inertia alone exceeds the rod's strength. */
export function rodBreakRpm(c: EngineConfig): number {
  const r = c.stroke / 2000;
  const l = c.rodLength / 1000;
  const omega = Math.sqrt(c.rodStrength / (c.reciprocatingMass * r * (1 + r / l)));
  return (omega * 60) / (2 * Math.PI);
}

/** Mean piston speed, m/s. */
export function meanPistonSpeed(c: Pick<EngineConfig, 'stroke'>, rpm: number): number {
  return (2 * (c.stroke / 1000) * rpm) / 60;
}

/** Ranges the build sheet allows. Outside these the solver stops being honest. */
export const CONFIG_LIMITS: Record<Exclude<keyof EngineConfig, 'muffler'>, [number, number, number]> = {
  bore: [56, 105, 0.5],
  stroke: [44, 95, 0.2],
  rodLength: [90, 160, 1],
  compressionRatio: [8, 14.5, 0.1],
  intakeValves: [1, 2, 1],
  exhaustValves: [1, 2, 1],
  intakeValveDiameter: [22, 44, 0.5],
  exhaustValveDiameter: [18, 38, 0.5],
  intakeDuration: [200, 310, 1],
  exhaustDuration: [200, 310, 1],
  intakeLift: [5, 12.5, 0.1],
  exhaustLift: [5, 12, 0.1],
  lobeSeparation: [100, 118, 0.5],
  intakeCenterline: [96, 120, 0.5],
  valveSpringForce: [300, 1500, 10],
  throttleDiameter: [24, 50, 1],
  intakeRunnerLength: [100, 600, 5],
  intakeRunnerDiameter: [24, 46, 1],
  exhaustHeaderLength: [250, 1200, 10],
  exhaustHeaderDiameter: [26, 48, 1],
  flywheelInertia: [0.006, 0.09, 0.001],
  reciprocatingMass: [0.15, 0.6, 0.01],
  rodStrength: [7000, 26000, 100],
  fuelOctane: [87, 102, 1],
  radiatorCapacity: [0.6, 2, 0.05],
};

/**
 * Parts that set the swept and clearance volume. Everything else can be
 * swapped with the engine running; these need the crank stopped.
 */
export const BLOCK_KEYS = ['bore', 'stroke', 'rodLength', 'compressionRatio'] as const;

export function blockChanged(a: EngineConfig, b: EngineConfig): boolean {
  return BLOCK_KEYS.some((k) => a[k] !== b[k]);
}

export function clampConfig(c: EngineConfig): EngineConfig {
  const out = { ...c };
  for (const key of Object.keys(CONFIG_LIMITS) as (keyof typeof CONFIG_LIMITS)[]) {
    const [lo, hi] = CONFIG_LIMITS[key];
    const v = out[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_PRESET.engine[key];
  }
  if (out.muffler !== 'stock' && out.muffler !== 'sport' && out.muffler !== 'open') out.muffler = 'stock';
  out.intakeValves = Math.round(out.intakeValves);
  out.exhaustValves = Math.round(out.exhaustValves);
  const fit = maxValveDiameters(out);
  out.intakeValveDiameter = Math.min(out.intakeValveDiameter, fit.intake);
  out.exhaustValveDiameter = Math.min(out.exhaustValveDiameter, fit.exhaust);
  return out;
}

/** Largest valve heads that physically fit in the bore with this layout, mm. */
export function maxValveDiameters(c: Pick<EngineConfig, 'bore' | 'intakeValves' | 'exhaustValves'>): {
  intake: number;
  exhaust: number;
} {
  const across = c.bore * 0.92;
  const intake = c.intakeValves === 2 ? c.bore * 0.46 : across * 0.55;
  const exhaust = c.exhaustValves === 2 ? c.bore * 0.4 : across * 0.47;
  return { intake: Math.round(intake * 2) / 2, exhaust: Math.round(exhaust * 2) / 2 };
}

export function clampBench(b: BenchConfig): BenchConfig {
  const sp = b.coolantSetpoint;
  return {
    coolantConditioner: b.coolantConditioner !== false,
    coolantSetpoint: typeof sp === 'number' && Number.isFinite(sp) ? Math.min(105, Math.max(40, sp)) : 85,
  };
}

export function clampEcu(e: EcuConfig): EcuConfig {
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    advanceOffset: num(e.advanceOffset, -20, 20, 0),
    cruiseLambda: num(e.cruiseLambda, 0.7, 1.4, 1),
    wotLambda: num(e.wotLambda, 0.7, 1.3, 0.88),
    limiterRpm: num(e.limiterRpm, 2000, 16000, 8800),
    limiterMode: e.limiterMode === 'fuel' ? 'fuel' : 'spark',
    idleRpm: num(e.idleRpm, 800, 3000, 1400),
    overrunFuelCut: e.overrunFuelCut !== false,
    knockControl: e.knockControl !== false,
  };
}
