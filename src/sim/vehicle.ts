/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The machine the engine is bolted into: clutch, gearbox, chain, rear tyre,
 * the body and the air it pushes through.
 *
 * Three degrees of freedom: the crank (owned by the engine), the rear wheel
 * and the vehicle. The clutch couples crank and wheel through a friction
 * limit; the tyre couples wheel and road through a slip curve; weight moves
 * to the rear under acceleration until the front lifts (a wheelie).
 */

import type { EngineCore } from './core';

export type ChassisId = 'street' | 'race' | 'kart';

export interface VehicleConfig {
  chassis: ChassisId;
  /** With rider, kg. */
  mass: number;
  /** Centre of mass height, m. */
  cgHeight: number;
  /** m */
  wheelbase: number;
  /** Static share of the weight on the driven (rear) axle. */
  rearShare: number;
  /** Rolling radius of the driven tyre, m. */
  tireRadius: number;
  /** Peak longitudinal friction coefficient. */
  tireGrip: number;
  /** Drag area, m². */
  cdA: number;
  rollingRes: number;
  /** Gearbox ratios, 1st to top. */
  gears: number[];
  /** Crank to clutch reduction (fixed by the chassis). */
  primary: number;
  /** Chain / final drive: rear sprocket over front. */
  finalDrive: number;
  /** Torque the clutch transmits fully engaged, Nm. */
  clutchCapacity: number;
  /** How long the rider takes to let the clutch out at the start, s. */
  clutchRelease: number;
  /** Ignition-cut shifting without the clutch. */
  quickshifter: boolean;
}

export interface Chassis {
  id: ChassisId;
  name: string;
  blurb: string;
  base: VehicleConfig;
  /** Lightest it can be made (with rider). */
  minMass: number;
}

const STREET: VehicleConfig = {
  chassis: 'street',
  mass: 180,
  cgHeight: 0.64,
  wheelbase: 1.38,
  rearShare: 0.52,
  tireRadius: 0.305,
  tireGrip: 1.05,
  cdA: 0.45,
  rollingRes: 0.02,
  gears: [2.833, 1.875, 1.364, 1.143, 0.957, 0.84],
  primary: 3.0,
  finalDrive: 2.93,
  clutchCapacity: 90,
  clutchRelease: 0.6,
  quickshifter: false,
};

export const CHASSIS: Record<ChassisId, Chassis> = {
  street: {
    id: 'street',
    name: '街车',
    blurb: '坐姿高、重心高、轮胎是街胎。一般人骑的就是它。',
    base: STREET,
    minMass: 150,
  },
  race: {
    id: 'race',
    name: '赛道车',
    blurb: '趴着骑，整流罩，热熔胎。轻、低风阻，一拧就想抬头。',
    base: {
      ...STREET,
      chassis: 'race',
      mass: 158,
      cgHeight: 0.6,
      wheelbase: 1.36,
      rearShare: 0.5,
      tireRadius: 0.3,
      tireGrip: 1.3,
      cdA: 0.32,
      rollingRes: 0.018,
      gears: [2.6, 1.85, 1.45, 1.21, 1.05, 0.93],
      finalDrive: 2.8,
      clutchCapacity: 110,
      clutchRelease: 0.45,
    },
    minMass: 128,
  },
  kart: {
    id: 'kart',
    name: '卡丁车',
    blurb: '人几乎贴地坐，抬不了头；后轮宽、抓地狠，但风阻大。',
    base: {
      ...STREET,
      chassis: 'kart',
      mass: 175,
      cgHeight: 0.26,
      wheelbase: 1.04,
      rearShare: 0.58,
      tireRadius: 0.14,
      tireGrip: 1.45,
      cdA: 0.55,
      rollingRes: 0.025,
      gears: [2.15, 1.6, 1.3, 1.11, 0.98, 0.89],
      primary: 2.7,
      finalDrive: 1.45,
      clutchCapacity: 100,
      clutchRelease: 0.4,
    },
    minMass: 150,
  },
};

export const DEFAULT_VEHICLE = CHASSIS.street.base;

type NumKey = Exclude<keyof VehicleConfig, 'chassis' | 'gears' | 'quickshifter'>;

/** [min, max, step] for every numeric field. */
export const VEHICLE_LIMITS: Record<NumKey, [number, number, number]> = {
  mass: [110, 260, 1],
  cgHeight: [0.2, 0.8, 0.01],
  wheelbase: [0.95, 1.7, 0.01],
  rearShare: [0.4, 0.65, 0.01],
  tireRadius: [0.12, 0.34, 0.005],
  tireGrip: [0.8, 1.7, 0.01],
  cdA: [0.25, 0.7, 0.01],
  rollingRes: [0.012, 0.03, 0.001],
  primary: [1.5, 4, 0.01],
  finalDrive: [1, 4.5, 0.01],
  clutchCapacity: [40, 220, 5],
  clutchRelease: [0.1, 2, 0.05],
};

export const GEAR_LIMITS: [number, number, number] = [0.6, 3.6, 0.01];

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function clampVehicle(v: Partial<VehicleConfig> | null | undefined): VehicleConfig {
  const chassis: ChassisId = v?.chassis === 'race' || v?.chassis === 'kart' ? v.chassis : 'street';
  const base = CHASSIS[chassis].base;
  const out = { ...base, chassis } as VehicleConfig;
  for (const k of Object.keys(VEHICLE_LIMITS) as NumKey[]) {
    const [lo, hi] = VEHICLE_LIMITS[k];
    out[k] = num(v?.[k], lo, hi, base[k]);
  }
  out.mass = Math.max(CHASSIS[chassis].minMass, out.mass);
  const gears = Array.isArray(v?.gears) && v.gears.length === base.gears.length ? v.gears : base.gears;
  // Each gear taller than the one before.
  out.gears = gears.map((g) => num(g, GEAR_LIMITS[0], GEAR_LIMITS[1], 1));
  for (let i = 1; i < out.gears.length; i++) out.gears[i] = Math.min(out.gears[i]!, out.gears[i - 1]! - 0.02);
  out.gears = out.gears.map((g) => Math.max(GEAR_LIMITS[0], Math.round(g * 1000) / 1000));
  out.quickshifter = v?.quickshifter === true;
  return out;
}

/** Overall reduction crank → wheel in a gear (1-based). */
export function overallRatio(v: VehicleConfig, gear: number): number {
  const g = v.gears[Math.max(1, Math.min(v.gears.length, gear)) - 1]!;
  return v.primary * g * v.finalDrive;
}

/** Road speed at an rpm in a gear, km/h. */
export function speedAt(v: VehicleConfig, gear: number, rpm: number): number {
  return ((rpm * Math.PI) / 30 / overallRatio(v, gear)) * v.tireRadius * 3.6;
}

const G = 9.81;
const RHO_AIR = 1.2;
/** Rear wheel, tyre, sprocket and chain, kg·m². */
const WHEEL_INERTIA = 0.75;
const DRIVE_EFF = 0.92;
/** Pitch angle at which the rider can no longer save it, rad. */
export const LOOP_PITCH = 1.05;

/**
 * Longitudinal tyre force over load against slip ratio: rises steeply to a
 * peak near 10% and sags to ~70% when spinning.
 */
export function tyreCurve(slip: number): number {
  const a = Math.abs(slip);
  return Math.sign(slip) * Math.tanh(a / 0.06) * (1 - 0.3 * Math.min(1, Math.max(0, (a - 0.12) / 1.5)));
}

export class VehicleSim {
  cfg: VehicleConfig;
  /** Road gradient, rise over run. */
  grade = 0;
  /** Rear wheel speed, rad/s. */
  ww = 0;
  /** m/s */
  v = 0;
  /** m */
  x = 0;
  /** m/s² */
  a = 0;
  /** 0 = neutral. */
  gear = 1;
  /** Clutch engagement the rider commands, 0-1. */
  clutch = 0;
  /** Front wheel lift, rad, and its rate. */
  pitch = 0;
  pitchRate = 0;
  slip = 0;
  /** Clutch torque last step, Nm (at the crank). */
  clutchTorque = 0;
  /** Front tyre load over static, 0 = light. */
  frontLoad = 1;
  crashed = false;

  constructor(cfg: VehicleConfig) {
    this.cfg = cfg;
  }

  setConfig(cfg: VehicleConfig): void {
    this.cfg = cfg;
    this.gear = Math.min(this.gear, cfg.gears.length);
  }

  /** Rolling start: wheel and body at `ms`, in a gear. */
  place(ms: number, gear: number): void {
    this.v = ms;
    this.ww = ms / this.cfg.tireRadius;
    this.gear = gear;
    this.x = 0;
    this.pitch = 0;
    this.pitchRate = 0;
    this.crashed = false;
  }

  ratio(): number {
    return this.gear > 0 ? overallRatio(this.cfg, this.gear) : 0;
  }

  /** Called by the engine every substep; returns the torque taken off the crank. */
  step(we: number, h: number, ie: number): number {
    const c = this.cfg;
    const m = c.mass;
    const r = c.tireRadius;
    const Gr = this.ratio();
    let tc = 0;
    if (Gr > 0 && this.clutch > 0) {
      // Semi-implicit friction lock: the torque that would close the speed
      // difference this step, limited by what the plates can carry.
      const iref = WHEEL_INERTIA / (Gr * Gr);
      const lock = ((we - Gr * this.ww) / (h * (1 / ie + 1 / iref))) * 0.6;
      const cap = c.clutchCapacity * this.clutch * this.clutch;
      tc = Math.max(-cap, Math.min(cap, lock));
    }
    this.clutchTorque = tc;

    const cos = 1 / Math.sqrt(1 + this.grade * this.grade);
    const sin = this.grade * cos;
    const ntot = m * G * cos;
    const lift = m * this.a * c.cgHeight;
    const frontStatic = ntot * (1 - c.rearShare) * c.wheelbase;
    let nr: number;
    if (this.pitch > 0 || lift > frontStatic) {
      nr = ntot;
      this.frontLoad = 0;
    } else {
      nr = ntot * c.rearShare + lift / c.wheelbase;
      this.frontLoad = Math.max(0, 1 - lift / frontStatic);
    }
    this.slip = (this.ww * r - this.v) / Math.max(Math.abs(this.v), 3);
    const fx = c.tireGrip * nr * tyreCurve(this.slip);
    this.ww += ((tc * Gr * DRIVE_EFF - fx * r) / WHEEL_INERTIA) * h;
    if (this.ww < 0 && this.v <= 0) this.ww = 0;
    const drag = 0.5 * RHO_AIR * c.cdA * this.v * this.v + c.rollingRes * ntot * (this.v > 0.05 ? 1 : 0) + m * G * sin;
    this.a = (fx - drag) / m;
    this.v = Math.max(0, this.v + this.a * h);
    this.x += this.v * h;

    // Pitch: the lifting moment about the rear contact against the front's weight.
    const ip = m * (c.cgHeight * c.cgHeight + Math.pow(c.wheelbase * (1 - c.rearShare), 2));
    const moment = lift - frontStatic * Math.cos(this.pitch);
    if (this.pitch > 0 || moment > 0) {
      this.pitchRate += (moment / ip) * h;
      this.pitch += this.pitchRate * h;
      if (this.pitch <= 0) {
        this.pitch = 0;
        this.pitchRate = 0;
      }
      if (this.pitch > LOOP_PITCH) this.crashed = true;
    }
    return tc;
  }

  attach(core: EngineCore): void {
    core.extLoad = (we, h, ie) => this.step(we, h, ie);
  }
}

// ---------------------------------------------------------------------------
// Parts on the vehicle side.
// ---------------------------------------------------------------------------

export type VehiclePartId = 'sprocket' | 'gearbox' | 'tires' | 'diet' | 'geometry' | 'fairing' | 'clutch' | 'quickshifter';

export interface VehiclePart {
  id: VehiclePartId;
  name: string;
  price: number;
  keys: (keyof VehicleConfig)[];
  pitch: string;
}

export const VEHICLE_PARTS: VehiclePart[] = [
  { id: 'sprocket', name: '链轮（主减速比）', price: 150, keys: ['finalDrive'], pitch: '大后链轮每个挡都变短：起步猛、极速低。最便宜的一招。' },
  { id: 'gearbox', name: '齿比组', price: 1800, keys: ['gears'], pitch: '每个挡单独定。挡位靠得近，换挡后转速掉得少，一直待在扭矩带里。' },
  { id: 'tires', name: '轮胎', price: 600, keys: ['tireGrip', 'tireRadius'], pitch: '软胎抓得住更大的扭矩；轮胎直径也会改每个挡的齿比。' },
  { id: 'diet', name: '减重', price: 1500, keys: ['mass'], pitch: '碳纤维、锂电池、钛螺丝。每一公斤都是白捡的加速度。' },
  { id: 'geometry', name: '底盘几何', price: 1200, keys: ['cgHeight', 'wheelbase', 'rearShare'], pitch: '加长摇臂、降低车身：重心越低、轴距越长，越不容易抬头。' },
  { id: 'fairing', name: '整流罩', price: 800, keys: ['cdA'], pitch: '一百公里以后，风阻吃掉的马力比什么都多。' },
  { id: 'clutch', name: '离合器', price: 450, keys: ['clutchCapacity'], pitch: '片数和弹簧决定它能传多大扭矩；太弱的离合器在弹射和涡轮下会打滑。' },
  { id: 'quickshifter', name: '快排', price: 700, keys: ['quickshifter'], pitch: '升挡不收油不捏离合，断火几十毫秒就挂进去了。' },
];

const sameV = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Math.abs((x as number) - (b[i] as number)) < 1e-6);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return a === b;
};

export function vehiclePartChanged(p: VehiclePart, from: VehicleConfig, to: VehicleConfig): boolean {
  return p.keys.some((k) => !sameV(from[k], to[k]));
}

export function changedVehicleParts(from: VehicleConfig, to: VehicleConfig): VehiclePart[] {
  if (from.chassis !== to.chassis) return [];
  return VEHICLE_PARTS.filter((p) => vehiclePartChanged(p, from, to));
}

export function vehicleCost(from: VehicleConfig, to: VehicleConfig): number {
  return changedVehicleParts(from, to).reduce((s, p) => s + p.price, 0);
}
