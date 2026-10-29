/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Crank-angle-resolved single-cylinder engine.
 *
 * The cylinder is a single-zone open thermodynamic system: mass and internal
 * energy are integrated through the whole 720° cycle as the piston moves and
 * the valves breathe. Air reaches it through a throttle, a small plenum and an
 * intake runner whose gas column has inertia; it leaves through an exhaust
 * header that also has inertia, a muffler volume and a tailpipe. Those two
 * inertial columns are what produce ram tuning, reversion and scavenging.
 *
 * Nothing in here looks up a torque. Torque is gas pressure on the piston
 * crown times the crank-slider lever arm, integrated against the flywheel.
 * Volumetric efficiency, pumping loss, the knock limit, MBT timing, idle
 * stability and engine braking are all outputs.
 *
 * The solver is allocation-free in the hot path and runs comfortably at audio
 * rate, which is why the sound is generated from the same state.
 */

import type { BenchConfig, EcuConfig, EngineConfig } from './config';
import { DEFAULT_BENCH, LIFT_PROFILE_STRETCH, displacementCc, rodInertiaForce, valveFloatRpm } from './config';
import { createRng, type Rng } from './rng';

// ---------------------------------------------------------------------------
// Gas properties
// ---------------------------------------------------------------------------
const R = 287;
const GAMMA = 1.35;
const CV = R / (GAMMA - 1);
const CP = CV + R;
const P_AMB = 101325;
const T_AMB = 298;
const LHV = 43.5e6;
const AFR = 14.7;
const FUEL_LATENT = 350e3;
const DEG = Math.PI / 180;
const FOUR_PI = 4 * Math.PI;
const CRIT_PR = Math.pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1));
const CHOKED_PSI = Math.sqrt(GAMMA * Math.pow(2 / (GAMMA + 1), (GAMMA + 1) / (GAMMA - 1)));
const PSI_K = (2 * GAMMA) / (GAMMA - 1);
const KNOCK_EXP = (GAMMA - 1) / GAMMA;

/** Crank-angle resolution of the per-cycle trace. */
export const CYCLE_BINS = 720;
/** Largest crank-angle step the solver will take. */
const MAX_STEP_DEG = 0.6;
/** Heat the gas in the port volume loses to the header, W/K. */
const HEADER_HTC = 5;
/**
 * Heat the header metal picks up, W/K. Larger than {@link HEADER_HTC}: the
 * port volume is only the first stretch of pipe, the metal sees all of it.
 */
const HEADER_WALL_HTC = 20;
/**
 * Douaud–Eyzat ignition delay fitted to a single-zone end gas runs early; this
 * puts a 10:1 engine on 92 RON at its usual mid-20s knock-limited advance.
 */
const KNOCK_TAU_SCALE = 2.4;
/** Fuel mass fraction below which exhaust gas is too dilute to light as a slug. */
const AFTERFIRE_MIN_FUEL_FRACTION = 0.025;
const KNOCK_MIN_RPM = 700;
/** Exponent from grip position to blade angle; 1 would be a linear pulley. */
const THROTTLE_PROGRESSION = 1.8;
/** Knock intensity the piston shrugs off; trace knock is normal at the limit. */
const KNOCK_HARMLESS = 0.08;
/** Laminar flame progress expressed as an equivalent crank speed (~300 rpm). */
const LAMINAR_FLOOR_RAD_S = 31;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Compressible flow through an orifice, kg/s, from `pUp` to `pDown`. */
function orifice(cdA: number, pUp: number, tUp: number, pDown: number): number {
  if (cdA <= 0 || pUp <= pDown) return 0;
  const pr = pDown / pUp;
  const psi = pr <= CRIT_PR ? CHOKED_PSI : Math.sqrt(PSI_K * (Math.pow(pr, 2 / GAMMA) - Math.pow(pr, (GAMMA + 1) / GAMMA)));
  return (cdA * pUp * psi) / Math.sqrt(R * tUp);
}

/** Signed flow, positive from a to b. */
function flowBetween(cdA: number, pa: number, ta: number, pb: number, tb: number): number {
  return pa >= pb ? orifice(cdA, pa, ta, pb) : -orifice(cdA, pb, tb, pa);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BrakeMode = 'off' | 'speed';

export interface Controls {
  /** Pedal / twist-grip, 0-1. */
  throttle: number;
  starter: boolean;
  ignition: boolean;
  brakeMode: BrakeMode;
  brakeRpm: number;
}

export const DEFAULT_CONTROLS: Controls = {
  throttle: 0,
  starter: false,
  ignition: true,
  brakeMode: 'off',
  brakeRpm: 5000,
};

export type FailureKind = 'rod' | 'valve' | 'piston' | 'headGasket';

export interface Failure {
  kind: FailureKind;
  title: string;
  detail: string;
  rpm: number;
  /** Crank angle (0-720, firing TDC = 0) at which it happened. */
  crankDeg: number;
}

export type EngineStatus = 'off' | 'cranking' | 'running' | 'broken';

export type CoreEvent =
  | { kind: 'knock'; intensity: number; rpm: number; advance: number }
  | { kind: 'afterfire'; energy: number }
  | { kind: 'misfire'; reason: 'lean' | 'rich' | 'dilution' }
  | { kind: 'failure'; failure: Failure }
  | { kind: 'limiter' }
  | { kind: 'valveFloat'; rpm: number };

export interface CycleStats {
  index: number;
  rpm: number;
  /** Indicated mean effective pressure, bar. */
  imep: number;
  /** Net crank torque after friction, Nm (cycle average). */
  torque: number;
  /** Absorber torque, Nm (cycle average; 0 with the brake off). */
  brakeTorque: number;
  powerKw: number;
  /** Fresh air trapped at IVC relative to ambient density × swept volume. */
  ve: number;
  pmax: number;
  /** Crank degrees after firing TDC of peak pressure. */
  pmaxDeg: number;
  advance: number;
  lambda: number;
  /** 10-90% burn duration, crank degrees (0 on a misfire). */
  burnDeg: number;
  knock: number;
  misfire: boolean;
  /** Mean plenum pressure, kPa. */
  mapKpa: number;
  fuelMg: number;
}

/** One crank cycle, sampled per degree from firing TDC. */
export interface CycleTrace {
  pressure: Float32Array;
  temperature: Float32Array;
  /** Fraction of cylinder mass that is fresh charge (0 = all exhaust). */
  fresh: Float32Array;
  /** Flame presence 0-1 while the charge burns. */
  flame: Float32Array;
}

const newTrace = (): CycleTrace => ({
  pressure: new Float32Array(CYCLE_BINS),
  temperature: new Float32Array(CYCLE_BINS),
  fresh: new Float32Array(CYCLE_BINS),
  flame: new Float32Array(CYCLE_BINS),
});

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export class EngineCore {
  config: EngineConfig;
  ecu: EcuConfig;
  bench: BenchConfig;
  controls: Controls = { ...DEFAULT_CONTROLS };

  // --- geometry & derived (refreshed by setConfig) ---
  private area = 0;
  private vd = 0;
  private vc = 0;
  private crankR = 0;
  private rod = 0;
  private boreM = 0;
  private ivCenter = 0;
  private evCenter = 0;
  private ivHalf = 0;
  private evHalf = 0;
  private ivLift = 0;
  private evLift = 0;
  private ivDiam = 0;
  private evDiam = 0;
  private ivCount = 1;
  private evCount = 1;
  private throttleArea = 0;
  private runnerArea = 0;
  private runnerLen = 0;
  private runnerVol = 0;
  private plenumVol = 0;
  private headerArea = 0;
  private headerLen = 0;
  private headerVol = 0;
  private mufflerVol = 0;
  private tailArea = 0;
  private inertia = 0;
  private floatRpm = 0;
  private octaneFactor = 1;
  private starterStall = 0;
  private coolantCapacity = 0;
  private accessoryScale = 1;
  private springFmep = 0;

  // --- crank ---
  theta = 0;
  omega = 0;

  // --- cylinder ---
  private m = 0;
  private mAir = 0;
  private mFuel = 0;
  private T = T_AMB;
  p = P_AMB;

  // --- intake: plenum → runner (inertial) → port ---
  private mPl = 0;
  private burnedPl = 0;
  private tPl = T_AMB;
  pPl = P_AMB;
  private mIp = 0;
  private tIp = T_AMB;
  private pIp = P_AMB;
  private burnedIp = 0;
  private qRunner = 0;

  // --- exhaust: port → header (inertial) → muffler → tail ---
  private mEp = 0;
  tEp = T_AMB;
  private pEp = P_AMB;
  private fuelEp = 0;
  private airEp = 0;
  private qHeader = 0;
  private mMf = 0;
  private airMf = 0;
  private fuelMf = 0;
  private tMf = T_AMB;
  private pMf = P_AMB;

  // --- throttle & idle air ---
  throttleActual = 0;
  /** Learned trim on {@link iacBase}, as a fraction. */
  private iacIntegral = 0;
  /** Feed-forward idle-air opening, fraction of the throttle bore. */
  private iacBase = 0.03;
  private dashpot = 0;
  iac = 0;

  // --- combustion ---
  private burning = false;
  private burnAngle = 0;
  private burnDur = 40;
  private burnFuel = 0;
  private xbPrev = 0;
  private knockIntegral = 0;
  private knocked = false;
  private pIvc = P_AMB;
  private tIvc = T_AMB;
  private ringAmp = 0;
  private ringPhase = 0;
  private ringFreq = 6000;
  private burn10 = -1;
  private burn90 = -1;

  // --- ECU ---
  advance = 10;
  lambdaTarget = 1;
  knockRetard = 0;
  private fuelOn = true;
  overrunCut = false;
  limiterCut = false;
  private brakeIntegral = 0;
  brakeTorque = 0;

  // --- thermal ---
  coolantC = 25;
  oilC = 25;
  /** Exhaust header metal, K. Drives the glow. */
  headerWallK = T_AMB;
  egtK = T_AMB;
  oilPressure = 0;

  // --- damage ---
  pistonDamage = 0;
  rodFatigue = 0;
  failure: Failure | null = null;
  private floatWarned = false;

  // --- cycle accumulation ---
  private cycWork = 0;
  private cycPmax = 0;
  private cycPmaxDeg = 0;
  private cycTrapped = 0;
  private cycKnock = 0;
  private cycMisfire = false;
  private cycFired = false;
  private cycOmega = 0;
  private cycTime = 0;
  private cycMap = 0;
  private cycBrake = 0;
  private cycFriction = 0;
  private cycAirIn = 0;
  private cycFuelIn = 0;
  private cycFuelBurnt = 0;
  private cycAdvance = 0;
  private cycleIndex = 0;
  private firedRecently = 0;
  private lastPmaxBar = 40;
  lastCycle: CycleStats | null = null;
  private trace = newTrace();
  lastTrace: CycleTrace = newTrace();
  /** Increments every time {@link lastTrace} is replaced. */
  traceVersion = 0;

  // --- per-sample outputs for the synthesiser ---
  /** Exhaust valve mass flow out of the cylinder, kg/s. */
  exhaustValveFlow = 0;
  intakeValveFlow = 0;
  throttleFlow = 0;
  tailFlow = 0;
  /** Cylinder pressure including the knock ring, Pa. */
  measuredPressure = P_AMB;
  knockSignal = 0;
  /** Accumulated valve-seating impulse since the synth last read it. */
  valveTick = 0;
  /** Accumulated afterfire energy since the synth last read it, J. */
  afterfireImpulse = 0;
  /** Exhaust valve lift fraction (for the waveguide's valve-end reflection). */
  exhaustOpen = 0;
  /** Smoothed net crank torque for display, Nm. */
  torqueLive = 0;

  readonly events: CoreEvent[] = [];
  private readonly rng: Rng;
  private gasTorque = 0;
  private frictionTorque = 0;
  private prevIvLift = 0;
  private prevEvLift = 0;

  constructor(config: EngineConfig, ecu: EcuConfig, bench: BenchConfig = DEFAULT_BENCH, seed = 1) {
    this.config = config;
    this.ecu = ecu;
    this.bench = bench;
    this.rng = createRng(seed);
    this.setConfig(config);
    this.resetGas();
    this.coolantC = bench.coolantConditioner ? bench.coolantSetpoint : 25;
    this.oilC = this.coolantC;
  }

  // ---- configuration -------------------------------------------------------

  setConfig(c: EngineConfig): void {
    this.config = c;
    this.boreM = c.bore / 1000;
    this.area = (Math.PI / 4) * this.boreM * this.boreM;
    this.crankR = c.stroke / 2000;
    this.rod = c.rodLength / 1000;
    this.vd = this.area * this.crankR * 2;
    this.vc = this.vd / (c.compressionRatio - 1);

    const ecl = 2 * c.lobeSeparation - c.intakeCenterline;
    this.ivCenter = 360 + c.intakeCenterline;
    this.evCenter = 360 - ecl;
    this.ivHalf = (c.intakeDuration / 2) * LIFT_PROFILE_STRETCH;
    this.evHalf = (c.exhaustDuration / 2) * LIFT_PROFILE_STRETCH;
    this.ivCount = c.intakeValves;
    this.evCount = c.exhaustValves;
    this.ivLift = c.intakeLift / 1000;
    this.evLift = c.exhaustLift / 1000;
    this.ivDiam = c.intakeValveDiameter / 1000;
    this.evDiam = c.exhaustValveDiameter / 1000;

    this.throttleArea = (Math.PI / 4) * Math.pow(c.throttleDiameter / 1000, 2);
    this.runnerArea = (Math.PI / 4) * Math.pow(c.intakeRunnerDiameter / 1000, 2);
    this.runnerLen = c.intakeRunnerLength / 1000;
    this.runnerVol = this.runnerArea * this.runnerLen * 0.5;
    this.plenumVol = Math.max(0.00015, this.vd * 0.8);
    this.headerArea = (Math.PI / 4) * Math.pow(c.exhaustHeaderDiameter / 1000, 2);
    this.headerLen = c.exhaustHeaderLength / 1000;
    this.headerVol = this.headerArea * this.headerLen * 0.5;
    const mufflerScale = c.muffler === 'stock' ? 1 : c.muffler === 'sport' ? 0.7 : 0.25;
    this.mufflerVol = Math.max(0.0005, this.vd * 10 * mufflerScale);
    const tailFrac = c.muffler === 'stock' ? 0.45 : c.muffler === 'sport' ? 0.75 : 1.15;
    this.tailArea = this.headerArea * tailFrac;

    this.inertia = c.flywheelInertia;
    this.floatRpm = valveFloatRpm(c);
    this.octaneFactor = Math.pow(c.fuelOctane / 100, 3.402);
    const cc = displacementCc(c);
    this.starterStall = 0.26 * cc * Math.pow(c.compressionRatio / 10, 0.7);
    this.coolantCapacity = 6000 * Math.pow(cc / 250, 0.7);
    this.accessoryScale = Math.sqrt(cc / 250);
    this.springFmep = 0.05e5 * (c.valveSpringForce / 470) * ((c.intakeValves + c.exhaustValves) / 2);
    this.updateIacBase();
  }

  setEcu(e: EcuConfig): void {
    this.ecu = e;
    this.updateIacBase();
  }

  /** Bypass opening that passes roughly the air a warm engine idles on. */
  private updateIacBase(): void {
    if (!this.ecu) return;
    const idleAir = 0.4 * (P_AMB / (R * T_AMB)) * this.vd * (this.ecu.idleRpm / 120);
    const chokedFlux = (P_AMB * CHOKED_PSI) / Math.sqrt(R * T_AMB);
    this.iacBase = clamp(idleAir / (chokedFlux * 0.8 * this.throttleArea), 0.005, 0.12);
  }

  setBench(b: BenchConfig): void {
    this.bench = b;
  }

  /** Fill every volume with still air at ambient conditions. */
  private resetGas(): void {
    const rho = P_AMB / (R * T_AMB);
    this.T = T_AMB;
    this.p = P_AMB;
    this.m = rho * this.cylVolume(this.theta);
    this.mAir = this.m;
    this.mFuel = 0;
    this.mPl = rho * this.plenumVol;
    this.burnedPl = 0;
    this.tPl = T_AMB;
    this.pPl = P_AMB;
    this.mIp = rho * this.runnerVol;
    this.tIp = T_AMB;
    this.pIp = P_AMB;
    this.burnedIp = 0;
    this.qRunner = 0;
    this.mEp = rho * this.headerVol;
    this.tEp = T_AMB;
    this.pEp = P_AMB;
    this.fuelEp = 0;
    this.airEp = this.mEp;
    this.qHeader = 0;
    this.mMf = rho * this.mufflerVol;
    this.airMf = this.mMf;
    this.fuelMf = 0;
    this.tMf = T_AMB;
    this.pMf = P_AMB;
    this.burning = false;
  }

  /** Back to a fresh, cold-but-conditioned engine with no damage. */
  restore(): void {
    this.failure = null;
    this.pistonDamage = 0;
    this.rodFatigue = 0;
    this.omega = 0;
    this.theta = 0;
    this.knockRetard = 0;
    this.iacIntegral = 0;
    this.brakeIntegral = 0;
    this.floatWarned = false;
    this.headerWallK = T_AMB;
    this.egtK = T_AMB;
    this.coolantC = this.bench.coolantConditioner ? this.bench.coolantSetpoint : 25;
    this.oilC = this.coolantC;
    this.lastCycle = null;
    this.firedRecently = 0;
    this.resetGas();
  }

  /** Geometry changes only make sense with the crank stopped. */
  rebuild(config: EngineConfig): void {
    this.setConfig(config);
    this.omega = 0;
    this.resetGas();
  }

  // ---- kinematics ----------------------------------------------------------

  private pistonX(theta: number): number {
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    const r = this.crankR;
    const l = this.rod;
    return r + l - (r * c + Math.sqrt(l * l - r * r * s * s));
  }

  /** dx/dθ, metres per radian. */
  private pistonDx(theta: number): number {
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    const r = this.crankR;
    const l = this.rod;
    return r * s + (r * r * s * c) / Math.sqrt(l * l - r * r * s * s);
  }

  private cylVolume(theta: number): number {
    return this.vc + this.area * this.pistonX(theta);
  }

  /** Valve lift in metres at a cycle angle, including float-induced late closing. */
  private lift(cycleDeg: number, center: number, half: number, peak: number, floatRatio: number): number {
    let d = cycleDeg - center;
    if (d > 360) d -= 720;
    else if (d < -360) d += 720;
    const h = d > 0 && floatRatio > 0 ? half * (1 + 2.5 * floatRatio) : half;
    if (d <= -h || d >= h) return 0;
    const c = Math.cos((d / h) * (Math.PI / 2));
    return peak * c * c;
  }

  // ---- ECU -----------------------------------------------------------------

  /** Burn duration (crank degrees, 0-100%) at an operating point. */
  burnDuration(rpm: number, lambda: number, residual: number): number {
    const speed = Math.pow(Math.max(rpm, 500) / 3000, 0.3);
    const mixture = 1 + 4 * (lambda - 0.9) * (lambda - 0.9);
    const dilution = 1 + 2.2 * residual;
    const size = Math.sqrt(this.boreM / 0.072);
    return clamp(52 * speed * mixture * dilution * size, 25, 160);
  }

  /**
   * The factory spark map: put 50% burn about 8° after TDC for the expected
   * burn rate. It knows nothing about knock — that is what the knock sensor
   * and the calibrator are for.
   */
  factoryAdvance(rpm: number, load: number): number {
    const lambda = load > 0.85 ? this.ecu.wotLambda : this.ecu.cruiseLambda;
    const residual = clamp(0.32 - 0.26 * load, 0.05, 0.35);
    const dur = this.burnDuration(rpm, lambda, residual);
    return clamp(0.52 * dur - 8, 2, 45);
  }

  private runEcuForCycle(rpm: number, load: number): void {
    const e = this.ecu;
    if (rpm < 500) {
      this.advance = 2;
      this.lambdaTarget = 0.85;
    } else {
      this.advance = clamp(this.factoryAdvance(rpm, load) + e.advanceOffset - this.knockRetard, -10, 60);
      const blend = smoothstep(0.6, 0.92, load);
      let lambda = e.cruiseLambda + (e.wotLambda - e.cruiseLambda) * blend;
      if (this.coolantC < 50) lambda *= 0.93;
      this.lambdaTarget = lambda;
    }

    const closed = this.controls.throttle < 0.02;
    if (e.overrunFuelCut && closed && rpm > e.idleRpm + 700) this.overrunCut = true;
    if (!closed || rpm < e.idleRpm + 350 || !e.overrunFuelCut) this.overrunCut = false;

    if (e.knockControl) this.knockRetard = Math.max(0, this.knockRetard - 0.12);
    else this.knockRetard = 0;
  }

  // ---- stepping ------------------------------------------------------------

  /** Advance by `dt` seconds (typically one audio sample). */
  step(dt: number): void {
    const degPerSec = Math.abs(this.omega) / DEG;
    const n = Math.min(12, Math.max(1, Math.ceil((degPerSec * dt) / MAX_STEP_DEG)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h);
  }

  private substep(h: number): void {
    const c = this.config;
    const ctl = this.controls;
    const broken = this.failure !== null;
    const rpm = (this.omega * 60) / (2 * Math.PI);
    const theta = this.theta;
    const cycleDeg = theta / DEG;

    // ---- throttle & idle air ----------------------------------------------
    const cmd = clamp(ctl.throttle, 0, 1);
    this.throttleActual += (cmd - this.throttleActual) * Math.min(1, h / 0.025);
    this.updateIdleAir(rpm, h);
    // Progressive grip: the first part of the travel opens the blade gently.
    const phi = 6 + Math.pow(this.throttleActual, THROTTLE_PROGRESSION) * 84;
    const butterfly = this.throttleArea * clamp(1 - Math.cos(phi * DEG) / Math.cos(6 * DEG), 0, 1);
    const bypass = this.throttleArea * this.iac;
    const throttleCdA = 0.8 * (butterfly + bypass) + 0.6e-6;

    // ---- limiter -----------------------------------------------------------
    if (rpm > this.ecu.limiterRpm) {
      if (!this.limiterCut) this.events.push({ kind: 'limiter' });
      this.limiterCut = true;
    } else if (rpm < this.ecu.limiterRpm - 120) {
      this.limiterCut = false;
    }
    const fuelLimiterCut = this.limiterCut && this.ecu.limiterMode === 'fuel';
    this.fuelOn = ctl.ignition && !this.overrunCut && !fuelLimiterCut && !broken;

    // ---- valves --------------------------------------------------------------
    const floatRatio = Math.max(0, Math.abs(rpm) / this.floatRpm - 1);
    const ivL = this.lift(cycleDeg, this.ivCenter, this.ivHalf, this.ivLift, floatRatio);
    const evL = this.lift(cycleDeg, this.evCenter, this.evHalf, this.evLift, floatRatio);
    const ivCdA =
      this.ivCount * 0.6 * Math.min(Math.PI * this.ivDiam * ivL, 0.85 * (Math.PI / 4) * this.ivDiam * this.ivDiam);
    const evCdA =
      this.evCount * 0.65 * Math.min(Math.PI * this.evDiam * evL, 0.85 * (Math.PI / 4) * this.evDiam * this.evDiam);
    if (this.prevIvLift > 0 && ivL === 0) this.valveTick += 0.4 + floatRatio * 6;
    if (this.prevEvLift > 0 && evL === 0) this.valveTick += 0.4 + floatRatio * 6;
    this.prevIvLift = ivL;
    this.prevEvLift = evL;
    this.exhaustOpen = evL / this.evLift;

    // ---- flows (all evaluated from the state at the start of the substep) --
    const p = this.p;
    const T = this.T;
    const mdotThr = flowBetween(throttleCdA, P_AMB, T_AMB, this.pPl, this.tPl);
    const mdotIv = flowBetween(ivCdA, this.pIp, this.tIp, p, T);
    const mdotEv = flowBetween(evCdA, p, T, this.pEp, this.tEp);
    const tailCdA = 0.7 * this.tailArea;
    const mdotTail = flowBetween(tailCdA, this.pMf, this.tMf, P_AMB, T_AMB);
    const leakCdA = (1.5e-7 + this.pistonDamage * 6e-6) * (this.boreM / 0.072) + (broken ? 2e-4 : 0);
    const mdotLeak = orifice(leakCdA, p, T, P_AMB);
    this.exhaustValveFlow = mdotEv;
    this.intakeValveFlow = mdotIv;
    this.throttleFlow = mdotThr;
    this.tailFlow = mdotTail;

    // Inertial gas columns: dq/dt = A/L · (Δp − loss).
    const rhoR = this.pPl / (R * this.tPl);
    const lossR = (1.1 * this.qRunner * Math.abs(this.qRunner)) / (2 * rhoR * this.runnerArea * this.runnerArea);
    this.qRunner += (this.runnerArea / this.runnerLen) * (this.pPl - this.pIp - lossR) * h;
    const rhoH = this.pEp / (R * this.tEp);
    const lossH = (1.4 * this.qHeader * Math.abs(this.qHeader)) / (2 * rhoH * this.headerArea * this.headerArea);
    this.qHeader += (this.headerArea / this.headerLen) * (this.pEp - this.pMf - lossH) * h;
    const qR = this.qRunner;
    const qH = this.qHeader;

    // ---- combustion ----------------------------------------------------------
    let dQ = 0;
    if (this.burning) {
      // Turbulence scales the flame with engine speed; laminar burning sets a floor.
      const burnRate = Math.abs(this.omega) + LAMINAR_FLOOR_RAD_S;
      this.burnAngle += (burnRate * h) / DEG;
      let xb: number;
      if (this.knocked) {
        xb = Math.min(1, this.xbPrev + (burnRate * h) / DEG / 2.5);
      } else {
        const s = this.burnAngle / this.burnDur;
        xb = 1 - Math.exp(-5 * s * s * s);
      }
      const dxb = Math.max(0, xb - this.xbPrev);
      const bf = Math.min(this.burnFuel * dxb, this.mFuel, this.mAir / AFR);
      if (bf > 0) {
        this.mFuel -= bf;
        this.mAir -= bf * AFR;
        dQ = bf * LHV * 0.96;
        this.cycFuelBurnt += bf;
      }
      if (this.burn10 < 0 && xb >= 0.1) this.burn10 = this.burnAngle;
      if (this.burn90 < 0 && xb >= 0.9) this.burn90 = this.burnAngle;

      // While cranking the charge loses its heat to cold metal faster than it can autoignite.
      if (!this.knocked && xb < 0.97 && p > this.pIvc && rpm > KNOCK_MIN_RPM) {
        const tu = this.tIvc * Math.pow(p / this.pIvc, KNOCK_EXP);
        const tau = KNOCK_TAU_SCALE * 17.68e-3 * this.octaneFactor * Math.pow(p / P_AMB, -1.7) * Math.exp(3800 / tu);
        this.knockIntegral += h / tau;
        if (this.knockIntegral >= 1) this.onKnock(1 - xb, rpm);
      }

      this.xbPrev = xb;
      if (xb > 0.999 || this.burnAngle > this.burnDur * 1.8) this.burning = false;
    }

    // ---- wall heat (Woschni) -------------------------------------------------
    const sp = Math.abs((2 * c.stroke * rpm) / 60000);
    const w = 2.28 * sp + (this.burning ? 1.4 * sp : 0) + 0.3;
    const hc =
      3.26 * Math.pow(this.boreM, -0.2) * Math.pow(p / 1000, 0.8) * Math.pow(T, -0.55) * Math.pow(w, 0.8);
    const x = this.pistonX(theta);
    const wallArea = 2.2 * this.area + Math.PI * this.boreM * x;
    const wallK = this.coolantC + 273 + 110;
    const ringBoost = 1 + Math.min(4, this.ringAmp / 4e5);
    const qWall = hc * wallArea * (T - wallK) * ringBoost * h;

    // ---- cylinder mass & energy ---------------------------------------------
    const dV = this.area * this.pistonDx(theta) * this.omega * h;
    let dm = 0;
    let dU = dQ - qWall - p * dV;

    if (mdotIv >= 0) {
      const dmIn = mdotIv * h;
      const burnedFrac = this.mIp > 0 ? clamp(this.burnedIp / this.mIp, 0, 1) : 0;
      const airIn = dmIn * (1 - burnedFrac);
      const fuelIn = this.fuelOn ? airIn / (AFR * this.lambdaTarget) : 0;
      this.mAir += airIn;
      this.mFuel += fuelIn;
      this.burnedIp = Math.max(0, this.burnedIp - dmIn * burnedFrac);
      dm += dmIn + fuelIn;
      dU += CP * this.tIp * (dmIn + fuelIn) - fuelIn * FUEL_LATENT * 0.6;
      this.cycAirIn += airIn;
      this.cycFuelIn += fuelIn;
    } else {
      const dmOut = -mdotIv * h;
      const fa = this.mAir / this.m;
      const ff = this.mFuel / this.m;
      this.mAir -= dmOut * fa;
      this.mFuel -= dmOut * ff;
      this.burnedIp += dmOut * (1 - fa - ff);
      dm -= dmOut;
      dU -= CP * T * dmOut;
    }

    if (mdotEv >= 0) {
      const dmOut = mdotEv * h;
      const fa = this.mAir / this.m;
      const ff = this.mFuel / this.m;
      this.mAir -= dmOut * fa;
      this.mFuel -= dmOut * ff;
      this.airEp += dmOut * fa;
      this.fuelEp += dmOut * ff;
      dm -= dmOut;
      dU -= CP * T * dmOut;
    } else {
      const dmIn = -mdotEv * h;
      const fa = this.mEp > 0 ? clamp(this.airEp / this.mEp, 0, 1) : 0;
      const ff = this.mEp > 0 ? clamp(this.fuelEp / this.mEp, 0, 1) : 0;
      this.mAir += dmIn * fa;
      this.mFuel += dmIn * ff;
      this.airEp -= dmIn * fa;
      this.fuelEp -= dmIn * ff;
      dm += dmIn;
      dU += CP * this.tEp * dmIn;
    }

    if (mdotLeak > 0) {
      const dmOut = mdotLeak * h;
      const fa = this.mAir / this.m;
      const ff = this.mFuel / this.m;
      this.mAir -= dmOut * fa;
      this.mFuel -= dmOut * ff;
      dm -= dmOut;
      dU -= CP * T * dmOut;
    }

    const U = this.m * CV * T + dU;
    this.m = Math.max(1e-8, this.m + dm);
    this.mAir = clamp(this.mAir, 0, this.m);
    this.mFuel = clamp(this.mFuel, 0, this.m - this.mAir);
    this.T = clamp(U / (this.m * CV), 200, 3200);
    const V = this.cylVolume(theta + this.omega * h);
    this.p = (this.m * R * this.T) / V;

    // ---- intake plenum -----------------------------------------------------
    {
      const plBurnedFrac = clamp(this.burnedPl / this.mPl, 0, 1);
      const ipBurnedFrac = clamp(this.burnedIp / this.mIp, 0, 1);
      const burnedToPort = qR >= 0 ? qR * h * plBurnedFrac : qR * h * ipBurnedFrac;
      this.burnedPl -= burnedToPort;
      this.burnedIp += burnedToPort;
      if (mdotThr < 0) this.burnedPl += mdotThr * h * plBurnedFrac;

      const dmP = mdotThr * h - qR * h;
      let dUP = (mdotThr >= 0 ? CP * T_AMB : CP * this.tPl) * mdotThr * h;
      dUP -= (qR >= 0 ? CP * this.tPl : CP * this.tIp) * qR * h;
      const wallT = 273 + 25 + (this.coolantC - 25) * 0.35;
      dUP += 0.6 * (wallT - this.tPl) * h;
      const Up = this.mPl * CV * this.tPl + dUP;
      this.mPl = Math.max(1e-7, this.mPl + dmP);
      this.burnedPl = clamp(this.burnedPl, 0, this.mPl);
      this.tPl = clamp(Up / (this.mPl * CV), 220, 600);
      this.pPl = (this.mPl * R * this.tPl) / this.plenumVol;
    }

    // ---- intake port (runner volume) ---------------------------------------
    {
      const dmI = qR * h - mdotIv * h;
      let dUI = (qR >= 0 ? CP * this.tPl : CP * this.tIp) * qR * h;
      dUI -= (mdotIv >= 0 ? CP * this.tIp : CP * T) * mdotIv * h;
      const wallT = 273 + this.coolantC * 0.8;
      dUI += 3 * (wallT - this.tIp) * h;
      const Ui = this.mIp * CV * this.tIp + dUI;
      this.mIp = Math.max(1e-8, this.mIp + dmI);
      this.burnedIp = clamp(this.burnedIp, 0, this.mIp);
      this.tIp = clamp(Ui / (this.mIp * CV), 220, 1400);
      this.pIp = (this.mIp * R * this.tIp) / this.runnerVol;
    }

    // ---- exhaust port (header volume) --------------------------------------
    {
      const dmE = mdotEv * h - qH * h;
      let dUE = (mdotEv >= 0 ? CP * T : CP * this.tEp) * mdotEv * h;
      dUE -= (qH >= 0 ? CP * this.tEp : CP * this.tMf) * qH * h;
      dUE -= HEADER_HTC * (this.tEp - this.headerWallK) * h;
      if (qH > 0) {
        const out = (qH * h) / this.mEp;
        const air = this.airEp * out;
        const fuel = this.fuelEp * out;
        this.airEp -= air;
        this.fuelEp -= fuel;
        this.airMf += air;
        this.fuelMf += fuel;
      } else if (qH < 0) {
        const back = (-qH * h) / this.mMf;
        const air = this.airMf * back;
        const fuel = this.fuelMf * back;
        this.airMf -= air;
        this.fuelMf -= fuel;
        this.airEp += air;
        this.fuelEp += fuel;
      }

      if (this.tEp > 850 && this.fuelEp > 0 && this.airEp > 0) {
        const burnable = Math.min(this.fuelEp, this.airEp / AFR);
        if (this.fuelEp / this.mEp > AFTERFIRE_MIN_FUEL_FRACTION && burnable * LHV > 6) {
          // A slug of unburnt charge meets the next hot blowdown and lights off.
          const energy = burnable * LHV * 0.9;
          this.fuelEp -= burnable;
          this.airEp -= burnable * AFR;
          dUE += energy;
          this.afterfireImpulse += energy;
          this.events.push({ kind: 'afterfire', energy });
        } else {
          // Traces of fuel just oxidise in the hot pipe.
          const ox = burnable * Math.min(1, h * 40);
          this.fuelEp -= ox;
          this.airEp -= ox * AFR;
          dUE += ox * LHV * 0.9;
        }
      }

      const Ue = this.mEp * CV * this.tEp + dUE;
      this.mEp = Math.max(1e-8, this.mEp + dmE);
      this.airEp = clamp(this.airEp, 0, this.mEp);
      this.fuelEp = clamp(this.fuelEp, 0, this.mEp);
      this.tEp = clamp(Ue / (this.mEp * CV), 250, 2600);
      this.pEp = (this.mEp * R * this.tEp) / this.headerVol;
    }

    // ---- muffler -----------------------------------------------------------
    {
      const dmM = qH * h - mdotTail * h;
      let dUM = (qH >= 0 ? CP * this.tEp : CP * this.tMf) * qH * h;
      dUM -= (mdotTail >= 0 ? CP * this.tMf : CP * T_AMB) * mdotTail * h;
      dUM -= 6 * (this.tMf - (T_AMB + 150)) * h;
      if (mdotTail > 0) {
        const out = (mdotTail * h) / this.mMf;
        this.airMf -= this.airMf * out;
        this.fuelMf -= this.fuelMf * out;
      } else {
        this.airMf -= mdotTail * h;
      }
      const Um = this.mMf * CV * this.tMf + dUM;
      this.mMf = Math.max(1e-7, this.mMf + dmM);
      this.airMf = clamp(this.airMf, 0, this.mMf);
      this.fuelMf = clamp(this.fuelMf, 0, this.mMf - this.airMf);
      this.tMf = clamp(Um / (this.mMf * CV), 250, 1800);
      this.pMf = (this.mMf * R * this.tMf) / this.mufflerVol;
    }

    // ---- knock ring --------------------------------------------------------
    if (this.ringAmp > 1) {
      this.ringPhase += 2 * Math.PI * this.ringFreq * h;
      if (this.ringPhase > 2 * Math.PI) this.ringPhase -= 2 * Math.PI;
      this.ringAmp *= Math.exp(-h / 0.0012);
      this.knockSignal = this.ringAmp * Math.sin(this.ringPhase);
    } else {
      this.ringAmp = 0;
      this.knockSignal = 0;
    }
    this.measuredPressure = this.p + this.knockSignal;

    // ---- crank dynamics ----------------------------------------------------
    const dx = this.pistonDx(theta);
    this.gasTorque = broken ? 0 : (this.p - P_AMB) * this.area * dx;
    const oilVisc = 1 + 0.9 * clamp((80 - this.oilC) / 60, 0, 1);
    const fmep =
      (0.7e5 + 0.004 * this.lastPmaxBar * 1e5 + 0.09e5 * sp + 0.0009e5 * sp * sp + this.springFmep) * oilVisc;
    // Alternator, oil and water pumps, cam drive.
    const accessories = (1.1 + 0.12 * (Math.abs(rpm) / 1000)) * this.accessoryScale;
    const frictionMean = (fmep * this.vd) / (4 * Math.PI) + accessories + (broken ? 60 : 0);
    this.frictionTorque = frictionMean * Math.tanh(this.omega / 3);

    let starter = 0;
    if (ctl.starter && !broken) {
      const free = (450 * 2 * Math.PI) / 60;
      starter = this.starterStall * Math.max(0, 1 - this.omega / free);
    }

    let brake = 0;
    if (ctl.brakeMode === 'speed' && !broken) {
      const err = rpm - ctl.brakeRpm;
      this.brakeIntegral = clamp(this.brakeIntegral + err * 0.06 * h, 0, 400);
      brake = clamp(err * 0.08 + this.brakeIntegral, 0, 400);
    } else {
      this.brakeIntegral = 0;
    }
    this.brakeTorque = brake;

    const net = this.gasTorque - this.frictionTorque - brake * Math.tanh(this.omega / 5) + starter;
    this.omega += (net / this.inertia) * h;
    if (this.omega < -40) this.omega = -40;
    this.torqueLive += (this.gasTorque - this.frictionTorque - this.torqueLive) * Math.min(1, h / 0.15);

    // ---- integrate cycle quantities ------------------------------------------
    this.cycWork += p * dV;
    const pBar = this.measuredPressure / 1e5;
    if (pBar > this.cycPmax) {
      this.cycPmax = pBar;
      this.cycPmaxDeg = cycleDeg;
    }
    this.cycOmega += this.omega * h;
    this.cycTime += h;
    this.cycMap += this.pPl * h;
    this.cycBrake += brake * h;
    this.cycFriction += frictionMean * h;

    const bin = Math.min(CYCLE_BINS - 1, Math.floor(cycleDeg));
    const tr = this.trace;
    tr.pressure[bin] = pBar;
    tr.temperature[bin] = this.T;
    tr.fresh[bin] = (this.mAir + this.mFuel) / this.m;
    tr.flame[bin] = this.burning ? 1 - this.xbPrev * 0.7 : 0;

    // ---- advance the crank and fire angle-triggered events -------------------
    let next = theta + this.omega * h;
    if (next >= FOUR_PI) next -= FOUR_PI;
    else if (next < 0) next += FOUR_PI;
    this.theta = next;
    if (this.omega > 0) this.angleEvents(cycleDeg, next / DEG, rpm, floatRatio);

    this.updateThermal(h, rpm, qWall / h);
  }

  private updateIdleAir(rpm: number, h: number): void {
    const target = this.ecu.idleRpm;
    // Dashpot: the butterfly is let down gently so a snap shut does not
    // drop the manifold into a vacuum the engine cannot fire in.
    this.dashpot = Math.max(this.dashpot * Math.exp(-h / 0.7), this.throttleActual * 0.3);
    if (this.controls.starter && rpm < 500) {
      this.iac = this.iacBase * 1.6;
      return;
    }
    // Stays in at a cracked throttle so a small grip opening never starves the engine below idle.
    const closed = this.controls.throttle < 0.03;
    const engaged = this.controls.throttle < 0.3 && rpm < target + 2500;
    if (!engaged) {
      this.iac = 0;
      return;
    }
    const err = (target - rpm) / 1000;
    // Learn only at a closed throttle near idle, so a flare after start or a blip does not unwind it.
    if (closed && Math.abs(err) < 0.4) this.iacIntegral = clamp(this.iacIntegral + err * 0.5 * h, -0.6, 1.5);
    const gain = err > 0 ? 0.08 : 0.03;
    const opening = this.iacBase * (1 + this.iacIntegral) + err * gain;
    this.iac = closed ? Math.max(clamp(opening, 0, 0.2), this.dashpot) : clamp(opening, 0, 0.2);
  }

  /** Fire the events whose crank angle lies in (from, to]. */
  private angleEvents(from: number, to: number, rpm: number, floatRatio: number): void {
    const crossed = (a: number): boolean => (from <= to ? from < a && a <= to : from < a || a <= to);

    const sparkDeg = (720 - this.advance + 720) % 720;
    if (crossed(sparkDeg)) this.spark(rpm);

    const ivc = (this.ivCenter + this.ivHalf) % 720;
    if (crossed(ivc)) {
      this.pIvc = this.p;
      this.tIvc = this.T;
      this.cycTrapped = this.mAir;
    }

    // Exhaust TDC: no gas pressure to help, so this is the rod's worst moment.
    if (crossed(360)) this.checkRod(rpm, floatRatio);

    if (crossed(540)) this.endCycle();
  }

  private spark(rpm: number): void {
    const ctl = this.controls;
    this.cycAdvance = this.advance;
    if (!ctl.ignition || this.failure) return;
    if (this.limiterCut && this.ecu.limiterMode === 'spark') return;

    const fresh = this.mAir + this.mFuel;
    const residual = 1 - fresh / this.m;
    const lambda = this.mFuel > 1e-9 ? this.mAir / (this.mFuel * AFR) : 99;

    let reason: 'lean' | 'rich' | 'dilution' | null = null;
    const r = this.rng();
    if (lambda > 1.6 || r < smoothstep(1.35, 1.6, lambda)) reason = 'lean';
    else if (lambda < 0.6 || r < smoothstep(0.72, 0.6, lambda)) reason = 'rich';
    else if (r < smoothstep(0.45, 0.68, residual)) reason = 'dilution';

    if (reason) {
      this.cycMisfire = true;
      if (lambda < 50) this.events.push({ kind: 'misfire', reason });
      return;
    }

    this.burning = true;
    this.knocked = false;
    this.knockIntegral = 0;
    this.burnAngle = 0;
    this.xbPrev = 0;
    this.burn10 = -1;
    this.burn90 = -1;
    this.burnDur = this.burnDuration(rpm, lambda, residual) * (0.92 + 0.16 * this.rng());
    this.burnFuel = Math.min(this.mFuel, this.mAir / AFR);
    this.cycFired = true;
  }

  private onKnock(intensity: number, rpm: number): void {
    this.knocked = true;
    const soundSpeed = Math.sqrt(GAMMA * R * this.T);
    this.ringFreq = (1.84 * soundSpeed) / (Math.PI * this.boreM);
    this.ringAmp = intensity * this.p * 0.35;
    this.ringPhase = 0;
    this.cycKnock = Math.max(this.cycKnock, intensity);
    if (intensity > 0.04) {
      this.events.push({ kind: 'knock', intensity, rpm, advance: this.advance });
      if (this.ecu.knockControl) this.knockRetard = Math.min(16, this.knockRetard + 1 + intensity * 6);
    }
    const harmful = Math.max(0, intensity - KNOCK_HARMLESS);
    this.pistonDamage += harmful * harmful * 0.06 * (this.p / 60e5);
    if (this.pistonDamage >= 1 && !this.failure) {
      this.fail({
        kind: 'piston',
        title: '活塞顶烧穿',
        detail: `持续爆震把活塞顶冲出了一个洞。最后一次爆震强度 ${(intensity * 100).toFixed(0)}%，点火提前 ${this.advance.toFixed(1)}°，燃油 ${this.config.fuelOctane} 号。退点火角、加浓或换高标号油都能避免。`,
        rpm,
        crankDeg: this.theta / DEG,
      });
    }
  }

  private checkRod(rpm: number, floatRatio: number): void {
    if (this.failure) return;
    const c = this.config;
    const force = rodInertiaForce(c, rpm);
    const ratio = force / c.rodStrength;
    if (ratio >= 1) {
      this.fail({
        kind: 'rod',
        title: '连杆拉断',
        detail: `在排气上止点，活塞组件的惯性把连杆拉到 ${(force / 1000).toFixed(1)} kN，超过了它 ${(c.rodStrength / 1000).toFixed(1)} kN 的强度。往复质量 ${(c.reciprocatingMass * 1000).toFixed(0)} g，转速 ${Math.round(rpm)} rpm。`,
        rpm,
        crankDeg: 360,
      });
      return;
    }
    if (ratio > 0.8) {
      this.rodFatigue += Math.pow((ratio - 0.8) / 0.2, 3) * 0.003;
      if (this.rodFatigue >= 1) {
        this.fail({
          kind: 'rod',
          title: '连杆疲劳断裂',
          detail: `连杆长时间在 ${(ratio * 100).toFixed(0)}% 强度下反复拉伸，最终在 ${Math.round(rpm)} rpm 时断开。超过强度八成以后，每多转一圈都在累积疲劳。`,
          rpm,
          crankDeg: 360,
        });
        return;
      }
    }

    if (floatRatio > 0 && !this.floatWarned) {
      this.floatWarned = true;
      this.events.push({ kind: 'valveFloat', rpm });
    }
    if (floatRatio <= 0) this.floatWarned = false;
    if (floatRatio > 0.15) {
      this.fail({
        kind: 'valve',
        title: '气门撞活塞',
        detail: `转速 ${Math.round(rpm)} rpm 比气门飘浮转速 ${Math.round(this.floatRpm)} rpm 高出 ${Math.round(floatRatio * 100)}%。气门弹簧压不住，气门在重叠上止点没能及时关闭，被活塞顶弯。加硬气门弹簧，或者换升程更平缓的凸轮。`,
        rpm,
        crankDeg: 360,
      });
    }
  }

  private fail(f: Failure): void {
    this.failure = f;
    this.burning = false;
    this.events.push({ kind: 'failure', failure: f });
  }

  private endCycle(): void {
    const t = this.cycTime;
    if (t > 0) {
      const omegaAvg = this.cycOmega / t;
      const rpm = (omegaAvg * 60) / (2 * Math.PI);
      const frictionAvg = this.cycFriction / t;
      const indicated = this.cycWork / (4 * Math.PI);
      const torque = indicated - frictionAvg;
      const rhoAmb = P_AMB / (R * T_AMB);
      const lambda =
        this.cycFuelBurnt > 1e-9 && !this.cycMisfire ? this.cycAirIn / (this.cycFuelIn * AFR) : this.cycAirIn > 0 ? 2 : 1;
      const mapKpa = this.cycMap / t / 1000;
      this.lastPmaxBar = this.cycPmax;
      this.firedRecently = this.cycFired ? 2 : Math.max(0, this.firedRecently - 1);
      const brakeAvg = this.cycBrake / t;
      this.lastCycle = {
        index: this.cycleIndex++,
        rpm,
        imep: this.cycWork / this.vd / 1e5,
        torque,
        brakeTorque: brakeAvg,
        powerKw: (Math.max(0, this.controls.brakeMode === 'speed' ? brakeAvg : torque) * omegaAvg) / 1000,
        ve: this.cycTrapped / (rhoAmb * this.vd),
        pmax: this.cycPmax,
        pmaxDeg: this.cycPmaxDeg > 360 ? this.cycPmaxDeg - 720 : this.cycPmaxDeg,
        advance: this.cycAdvance,
        lambda: Math.min(2, lambda),
        burnDeg: this.burn90 > 0 && this.burn10 >= 0 ? this.burn90 - this.burn10 : 0,
        knock: this.cycKnock,
        misfire: this.cycMisfire,
        mapKpa,
        fuelMg: this.cycFuelIn * 1e6,
      };

      const swap = this.lastTrace;
      this.lastTrace = this.trace;
      this.trace = swap;
      this.traceVersion++;

      this.runEcuForCycle(rpm, mapKpa / (P_AMB / 1000));
    }

    this.cycWork = 0;
    this.cycPmax = 0;
    this.cycPmaxDeg = 0;
    this.cycKnock = 0;
    this.cycMisfire = false;
    this.cycFired = false;
    this.cycOmega = 0;
    this.cycTime = 0;
    this.cycMap = 0;
    this.cycBrake = 0;
    this.cycFriction = 0;
    this.cycAirIn = 0;
    this.cycFuelIn = 0;
    this.cycFuelBurnt = 0;
  }

  private updateThermal(h: number, rpm: number, wallHeatW: number): void {
    const b = this.bench;
    const frictionW = Math.abs(this.frictionTorque * this.omega);
    let qIn = Math.max(0, wallHeatW) + frictionW * 0.5;
    if (b.coolantConditioner) {
      qIn += clamp(1500 * (b.coolantSetpoint - this.coolantC), -40000, 6000);
    } else {
      const open = clamp((this.coolantC - 82) / 10, 0, 1);
      const fan = this.coolantC > 98 ? 1.6 : 1;
      const ua = 110 * this.config.radiatorCapacity * (0.15 + 0.85 * open) * fan * (1 + Math.abs(rpm) / 12000);
      qIn -= ua * (this.coolantC - 25) + 4 * (this.coolantC - 25);
    }
    this.coolantC += (qIn / this.coolantCapacity) * h;

    const oilTarget = this.coolantC + 6 + frictionW / 300;
    this.oilC += (oilTarget - this.oilC) * Math.min(1, h / 25);
    const visc = clamp(1 + (90 - this.oilC) / 60, 0.6, 2.2);
    this.oilPressure = clamp(0.95 * Math.pow(Math.max(0, rpm) / 1000, 0.8) * visc, 0, 5.5);

    // Header metal: heated by the gas, loses heat by radiation and convection.
    const area = Math.PI * (this.config.exhaustHeaderDiameter / 1000) * this.headerLen;
    const tw = this.headerWallK;
    const loss = area * (0.8 * 5.67e-8 * (tw * tw * tw * tw - T_AMB ** 4) + 15 * (tw - T_AMB));
    this.headerWallK += ((HEADER_WALL_HTC * (this.tEp - tw) - loss) / 300) * h;
    this.egtK += (this.tEp - this.egtK) * Math.min(1, h / 0.4);

    if (this.coolantC > 135 && !this.failure) {
      this.fail({
        kind: 'headGasket',
        title: '缸垫冲坏',
        detail: `冷却液温度 ${this.coolantC.toFixed(0)}°C，缸盖受热变形，燃烧气体冲破缸垫窜进水道。台架水温机关掉以后，散热只能靠你自己的散热器。`,
        rpm,
        crankDeg: this.theta / DEG,
      });
    }
  }

  // ---- read-outs -----------------------------------------------------------

  get rpm(): number {
    return (this.omega * 60) / (2 * Math.PI);
  }

  get status(): EngineStatus {
    if (this.failure) return 'broken';
    if (this.controls.starter && this.rpm < 900) return 'cranking';
    const cut = this.overrunCut || this.limiterCut;
    if ((this.firedRecently > 0 || cut) && this.rpm > 250) return 'running';
    return 'off';
  }

  get floatLimitRpm(): number {
    return this.floatRpm;
  }

  get mapKpa(): number {
    return this.pPl / 1000;
  }

  /** Read and clear the queued events. */
  drainEvents(out: CoreEvent[]): void {
    for (const e of this.events) out.push(e);
    this.events.length = 0;
  }
}
