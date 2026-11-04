/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Timed runs: the rider (or the player), the launch, the shifts, the
 * electronics, the clock. One director drives both the live bench and the
 * headless runs 老周 and the prize events are judged on.
 */

import type { EcuConfig, EngineConfig } from './config';
import { EngineCore, type Failure } from './core';
import { speedAt, VehicleSim, type VehicleConfig } from './vehicle';

export type RaceEventId = 'drag100' | 'quarter' | 'hill' | 'top' | 'overtake';

export interface RaceEvent {
  id: RaceEventId;
  name: string;
  blurb: string;
  /** Finish line, m (standing start unless `rolling`). */
  distance: number;
  /** Stop the clock at this speed instead, km/h. */
  stopKmh?: number;
  grade: number;
  /** Rolling start in top gear at this speed, km/h; no shifting allowed. */
  rolling?: { kmh: number };
  /** What the result is ranked on. */
  measure: 'time' | 'topSpeed';
  timeLimit: number;
}

export const RACE_EVENTS: Record<RaceEventId, RaceEvent> = {
  drag100: { id: 'drag100', name: '零百加速', blurb: '静止起步，到 100 km/h 停表。起步和前两次换挡定胜负。', distance: 800, stopKmh: 100, grade: 0, measure: 'time', timeLimit: 40 },
  quarter: { id: 'quarter', name: '四百米直线', blurb: '402 米静止起步。看用时，也看过线速度。', distance: 402, grade: 0, measure: 'time', timeLimit: 45 },
  hill: { id: 'hill', name: '爬坡', blurb: '1 公里、12% 的坡，静止起步。扭矩和齿比都要够，不然半路就掉出扭矩带。', distance: 1000, grade: 0.12, measure: 'time', timeLimit: 90 },
  top: { id: 'top', name: '极速', blurb: '3 公里平路，车速不再涨就停表，看最高车速。末挡要正好顶在功率峰附近。', distance: 3000, grade: 0, measure: 'topSpeed', timeLimit: 120 },
  overtake: { id: 'overtake', name: '高挡超车', blurb: '最高挡 50 km/h 起，不许换挡，加到 100 km/h。中段扭矩和末挡齿比说了算。', distance: 2000, stopKmh: 100, grade: 0, rolling: { kmh: 50 }, measure: 'time', timeLimit: 40 },
};

export const RACE_ORDER: RaceEventId[] = ['drag100', 'quarter', 'hill', 'top', 'overtake'];

export type Rider = 'auto' | 'manual';
export type Dnf = 'stall' | 'crash' | 'failure' | 'timeout' | 'limiter' | 'start';

export const DNF_TEXT: Record<Dnf, string> = {
  stall: '起步熄火',
  crash: '抬头翻车',
  failure: '发动机坏了',
  timeout: '超时',
  limiter: '撞断火了还没到',
  start: '没打着',
};

export interface ShiftLog {
  t: number;
  to: number;
  rpmBefore: number;
  rpmAfter: number;
}

export interface RaceResult {
  event: RaceEventId;
  /** Elapsed seconds at the finish (null if not finished). */
  time: number | null;
  /** Speed at the finish, km/h. */
  trapKmh: number;
  topKmh: number;
  /** Split times, s: 18 m (60 ft), 100 m, 100 km/h. */
  t60ft: number | null;
  t100m: number | null;
  t100kmh: number | null;
  dnf: Dnf | null;
  failure: Failure | null;
  shifts: ShiftLog[];
  /** Seconds spent with the rear spinning (>25% slip). */
  spinTime: number;
  /** Seconds with the front off the ground. */
  wheelieTime: number;
  maxPitch: number;
  /** Seconds the electronics spent cutting sparks. */
  cutTime: number;
  /** Rpm at the moment the clutch started to bite. */
  launchRpm: number;
  maxBoostKpa: number;
  /** [t, x m, km/h, rpm, gear, boost kPa, slip, pitch] every 50 ms. */
  trace: number[][];
  pistonDamage: number;
  rodFatigue: number;
}

export type RacePhase = 'stage' | 'run' | 'done';

/** What the live view needs of the ride, every frame. */
export interface RideState {
  phase: RacePhase | 'free';
  event: RaceEventId | null;
  rider: Rider;
  /** Seconds since the start (negative while staged: the countdown). */
  t: number;
  x: number;
  kmh: number;
  gear: number;
  slip: number;
  pitch: number;
  clutch: number;
  cut: boolean;
  frontLoad: number;
  grade: number;
}

/** What the rider robot does without launch control: hold this share of the limiter. */
const RIDER_LAUNCH_SHARE = 0.55;
/** Clutch-in, off-throttle shift without a quick-shifter, s. */
const MANUAL_SHIFT_S = 0.2;
const TICK = 0.001;

/**
 * Runs a timed run. Call {@link tick} about every millisecond of engine time.
 * In 'manual' the throttle comes from {@link input} and shifts from {@link shift}.
 */
export class RaceDirector {
  readonly event: RaceEvent;
  phase: RacePhase = 'stage';
  t = 0;
  private stageLeft: number;
  private shiftLeft = 0;
  private cutLeft = 0;
  private lastTrace = -1;
  private released = 0;
  readonly result: RaceResult;
  /** Player throttle, manual rider. */
  input = 0;
  private wantShift = 0;
  /** Speed samples every half second, for "no longer gaining". */
  private plateau: number[] = [];
  private lastPlateau = 0;

  constructor(
    private readonly core: EngineCore,
    readonly veh: VehicleSim,
    eventId: RaceEventId,
    readonly rider: Rider,
    stageSeconds = 1.5,
  ) {
    this.event = RACE_EVENTS[eventId];
    this.stageLeft = stageSeconds;
    veh.grade = this.event.grade;
    veh.place(0, 1);
    veh.clutch = 0;
    this.result = {
      event: eventId,
      time: null,
      trapKmh: 0,
      topKmh: 0,
      t60ft: null,
      t100m: null,
      t100kmh: null,
      dnf: null,
      failure: null,
      shifts: [],
      spinTime: 0,
      wheelieTime: 0,
      maxPitch: 0,
      cutTime: 0,
      launchRpm: 0,
      maxBoostKpa: 0,
      trace: [],
      pistonDamage: 0,
      rodFatigue: 0,
    };
    const roll = this.event.rolling;
    if (roll) {
      veh.place(roll.kmh / 3.6, veh.cfg.gears.length);
      veh.clutch = 1;
      core.omega = veh.ww * veh.ratio();
      this.stageLeft = 0;
      this.phase = 'run';
    }
  }

  /** Seconds left on the start lights while staged. */
  get countdown(): number {
    return this.phase === 'stage' ? this.stageLeft : 0;
  }

  get kmh(): number {
    return this.veh.v * 3.6;
  }

  /** Request a shift (+1 up, -1 down); manual rider, or the player's paddles. */
  shift(dir: number): void {
    this.wantShift = dir;
  }

  private shiftPoint(gear: number): number {
    const e = this.core.ecu;
    const set = e.shiftRpm[gear - 1] ?? 0;
    return set > 0 ? Math.min(set, e.limiterRpm - 50) : e.limiterRpm - 150;
  }

  private stop(dnf: Dnf | null): void {
    const c = this.core;
    const r = this.result;
    this.phase = 'done';
    r.dnf = dnf;
    r.failure = c.failure;
    r.pistonDamage = c.pistonDamage;
    r.rodFatigue = c.rodFatigue;
    c.extCut = false;
    c.extLimit = 0;
    c.alsRequest = false;
  }

  tick(dt = TICK): void {
    if (this.phase === 'done') return;
    const c = this.core;
    const v = this.veh;
    const e = c.ecu;
    const rpm = c.rpm;
    const auto = this.rider === 'auto';

    if (c.failure) return this.stop('failure');

    if (this.phase === 'stage') {
      v.clutch = 0;
      v.gear = 1;
      if (e.launchRpm > 0) {
        c.extLimit = e.launchRpm;
        c.alsRequest = true;
        c.controls.throttle = auto ? 1 : this.input;
      } else {
        c.extLimit = 0;
        const hold = e.limiterRpm * RIDER_LAUNCH_SHARE;
        c.controls.throttle = auto ? Math.max(0, Math.min(1, 0.25 + (hold - rpm) / 1500)) : this.input;
      }
      this.stageLeft -= dt;
      if (this.stageLeft <= 0) {
        this.phase = 'run';
        this.result.launchRpm = rpm;
        c.extLimit = 0;
        c.alsRequest = false;
        if (c.status !== 'running') return this.stop('start');
      }
      return;
    }

    // ---- running ----
    this.t += dt;
    const r = this.result;
    if (!this.event.rolling) {
      this.released = Math.min(1, this.released + dt / Math.max(0.05, v.cfg.clutchRelease));
    } else this.released = 1;

    let throttle = auto ? 1 : this.input;
    let clutch = this.released;

    // Shifting.
    const canShift = !this.event.rolling;
    if (this.shiftLeft > 0) {
      this.shiftLeft -= dt;
      throttle = 0;
      clutch = 0;
      if (this.shiftLeft <= 0) {
        const before = rpm;
        v.gear = Math.min(v.cfg.gears.length, v.gear + 1);
        r.shifts.push({ t: this.t, to: v.gear, rpmBefore: before, rpmAfter: before * (v.cfg.gears[v.gear - 1]! / v.cfg.gears[v.gear - 2]!) });
      }
    } else if (canShift) {
      const want = auto ? (rpm >= this.shiftPoint(v.gear) && v.slip < 0.3 && v.gear < v.cfg.gears.length ? 1 : 0) : this.wantShift;
      this.wantShift = 0;
      if (want > 0 && v.gear < v.cfg.gears.length) {
        if (v.cfg.quickshifter) {
          const before = rpm;
          v.gear++;
          this.cutLeft = e.quickShiftMs / 1000;
          r.shifts.push({ t: this.t, to: v.gear, rpmBefore: before, rpmAfter: before * (v.cfg.gears[v.gear - 1]! / v.cfg.gears[v.gear - 2]!) });
        } else {
          this.shiftLeft = MANUAL_SHIFT_S;
          throttle = 0;
          clutch = 0;
        }
      } else if (want < 0 && v.gear > 1) {
        v.gear--;
        r.shifts.push({ t: this.t, to: v.gear, rpmBefore: rpm, rpmAfter: rpm * (v.cfg.gears[v.gear - 1]! / v.cfg.gears[v.gear]!) });
      }
    }

    // Electronics: quick-shift cut, traction control, wheelie control.
    let cut = false;
    if (this.cutLeft > 0) {
      this.cutLeft -= dt;
      cut = true;
    }
    if (e.tractionControl > 0 && v.slip > e.tractionControl && v.v > 0.3) cut = true;
    if (e.wheelieControl && (v.pitch > 0.03 || v.frontLoad < 0.05)) cut = true;
    c.extCut = cut;
    c.alsRequest = this.shiftLeft > 0 || this.cutLeft > 0;
    if (cut) r.cutTime += dt;

    c.controls.throttle = throttle;
    v.clutch = clutch;

    // Book-keeping.
    const kmh = this.kmh;
    r.topKmh = Math.max(r.topKmh, kmh);
    r.maxBoostKpa = Math.max(r.maxBoostKpa, c.boostPa / 1000);
    r.maxPitch = Math.max(r.maxPitch, v.pitch);
    if (v.slip > 0.25) r.spinTime += dt;
    if (v.pitch > 0.01) r.wheelieTime += dt;
    if (r.t60ft === null && v.x >= 18.3) r.t60ft = this.t;
    if (r.t100m === null && v.x >= 100) r.t100m = this.t;
    if (r.t100kmh === null && kmh >= 100) r.t100kmh = this.t;
    if (this.t - this.lastTrace >= 0.05) {
      this.lastTrace = this.t;
      r.trace.push([+this.t.toFixed(3), +v.x.toFixed(2), +kmh.toFixed(2), Math.round(rpm), v.gear, +(c.boostPa / 1000).toFixed(1), +v.slip.toFixed(3), +v.pitch.toFixed(3)]);
    }

    // Finish and failure.
    const ev = this.event;
    if (v.crashed) return this.stop('crash');
    if (c.status === 'off' && rpm < 300) return this.stop('stall');
    const finished = ev.stopKmh !== undefined ? kmh >= ev.stopKmh : v.x >= ev.distance;
    if (finished || (ev.measure === 'topSpeed' && v.x >= ev.distance)) {
      r.time = this.t;
      r.trapKmh = kmh;
      return this.stop(null);
    }
    if (ev.measure === 'topSpeed' && this.t - this.lastPlateau >= 0.5) {
      this.lastPlateau = this.t;
      this.plateau.push(kmh);
      const n = this.plateau.length;
      // Terminal speed: under half a km/h gained over the last three seconds.
      if (this.t > 8 && n > 6 && kmh - this.plateau[n - 7]! < 0.5) {
        r.time = this.t;
        r.trapKmh = kmh;
        return this.stop(null);
      }
    }
    if (ev.rolling && rpm >= e.limiterRpm - 30) return this.stop('limiter');
    if (this.t > ev.timeLimit) return this.stop('timeout');
  }
}

const RATE = 24000;
const DT = 1 / RATE;

export interface RaceOptions {
  rider?: Rider;
  seed?: number;
}

/** Run an event headless from a cold-started, warmed-up engine. */
export function runRace(config: EngineConfig, ecu: EcuConfig, vehicle: VehicleConfig, eventId: RaceEventId, opts: RaceOptions = {}): RaceResult {
  const core = new EngineCore(config, ecu, undefined, opts.seed ?? 7);
  core.coolantC = 88;
  core.oilC = 88;
  core.controls.protect = false;
  const veh = new VehicleSim(vehicle);
  const step = (s: number): void => {
    for (let i = 0; i < Math.round(s * RATE); i++) core.step(DT);
  };
  core.controls.starter = true;
  for (let t = 0; t < 3 && core.status !== 'running'; t += 0.05) step(0.05);
  core.controls.starter = false;
  step(1.2);
  veh.gear = 1;
  veh.clutch = 0;
  veh.attach(core);
  const dir = new RaceDirector(core, veh, eventId, opts.rider ?? 'auto');
  if (core.status !== 'running') {
    dir.result.dnf = 'start';
    return dir.result;
  }
  const per = Math.round(RATE * TICK);
  while (dir.phase !== 'done') {
    for (let i = 0; i < per; i++) core.step(DT);
    dir.tick(TICK);
  }
  return dir.result;
}

/** Speed in each gear at the limiter, km/h. */
export function gearSpeeds(v: VehicleConfig, limiter: number): number[] {
  return v.gears.map((_, i) => speedAt(v, i + 1, limiter));
}
