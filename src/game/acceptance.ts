/**
 * The acceptance run: a fixed, repeatable test schedule driven on a private
 * copy of the solver. It is what a job is judged on, so it never depends on
 * how the player happened to be driving the live bench.
 *
 *   start → idle → (free rev) → WOT speed-held sweep → (endurance) → (overrun pops)
 *
 * Protection is off: if the build cannot survive the schedule, it breaks here.
 */

import type { BenchConfig, EcuConfig, EngineConfig } from '../sim/config';
import { DEFAULT_BENCH } from '../sim/config';
import { EngineCore, type CoreEvent, type Failure } from '../sim/core';

export interface AcceptancePlan {
  /** Measure idle → 90% of limiter with no load. */
  freeRev?: boolean;
  /** Hold WOT at this rpm (or `limiter` − 150) for this long after the sweep. */
  endurance?: { seconds: number; rpm?: number };
  /** Rev to the limiter and snap shut, counting exhaust pops. */
  overrun?: boolean;
  /** Test-cell overrides, e.g. no coolant conditioner. */
  bench?: Partial<BenchConfig>;
  /** Lowest sweep point, rpm. */
  sweepFrom?: number;
  /**
   * Screening run for 老周's search: coarser sweep, shorter settles. Close to
   * the real thing, about half the cost; the final build is always re-run in full.
   */
  quick?: boolean;
  /** Extra sweep points, rpm, so a target speed is measured rather than interpolated. */
  extraPoints?: number[];
  /** Sweep only these points (screening runs that only care about a few speeds). */
  onlyPoints?: number[];
}

export type AcceptancePhase = 'start' | 'idle' | 'freeRev' | 'sweep' | 'endurance' | 'overrun' | 'done';

export const PHASE_TEXT: Record<AcceptancePhase, string> = {
  start: '起动',
  idle: '怠速',
  freeRev: '空轰',
  sweep: '全油门扫转速',
  endurance: '红线耐久',
  overrun: '收油放炮',
  done: '完成',
};

export interface AcceptanceResult {
  started: boolean;
  idle: { mean: number; min: number; max: number } | null;
  /** [rpm, brake torque Nm], ascending. */
  curve: [number, number][];
  peakTorque: number;
  peakTorqueRpm: number;
  peakHp: number;
  peakHpRpm: number;
  /** Seconds from idle to 90% of limiter, null if not measured or never reached. */
  freeRevTime: number | null;
  pops: number;
  knockMax: number;
  knockEvents: number;
  pistonDamage: number;
  rodFatigue: number;
  coolantMax: number;
  egtMax: number;
  failure: Failure | null;
  failedIn: AcceptancePhase | null;
  /** Simulated seconds. */
  simTime: number;
}

export interface AcceptanceProgress {
  phase: AcceptancePhase;
  /** 0-1 of the whole schedule. */
  fraction: number;
  curve: [number, number][];
}

export const hpOf = (rpm: number, nm: number): number => (nm * rpm) / 7121;

const RATE = 24000;
const DT = 1 / RATE;

/** Torque at an rpm by linear interpolation of a curve; 0 outside it. */
export function torqueAt(curve: [number, number][], rpm: number): number {
  if (curve.length === 0) return 0;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (rpm < first[0] - 1 || rpm > last[0] + 1) return 0;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (rpm <= b[0]) {
      const k = (rpm - a[0]) / Math.max(1, b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return last[1];
}

export function runAcceptance(
  config: EngineConfig,
  ecu: EcuConfig,
  plan: AcceptancePlan,
  onProgress?: (p: AcceptanceProgress) => void,
): AcceptanceResult {
  const bench: BenchConfig = { ...DEFAULT_BENCH, ...plan.bench };
  const core = new EngineCore(config, ecu, bench, 7);
  core.controls.protect = false;
  // Customers' engines arrive warm, conditioner or not.
  core.coolantC = Math.max(core.coolantC, 88);
  core.oilC = core.coolantC;
  const events: CoreEvent[] = [];
  // Read through a function so TypeScript does not narrow it across steps.
  const running = (): boolean => core.status === 'running';
  const res: AcceptanceResult = {
    started: false,
    idle: null,
    curve: [],
    peakTorque: 0,
    peakTorqueRpm: 0,
    peakHp: 0,
    peakHpRpm: 0,
    freeRevTime: null,
    pops: 0,
    knockMax: 0,
    knockEvents: 0,
    pistonDamage: 0,
    rodFatigue: 0,
    coolantMax: 0,
    egtMax: 0,
    failure: null,
    failedIn: null,
    simTime: 0,
  };

  const limiter = ecu.limiterRpm;
  const sweepFrom = Math.max(plan.sweepFrom ?? 2000, Math.ceil((ecu.idleRpm + 600) / 500) * 500);
  const sweepTo = limiter - 200;
  const sweepPoints: number[] = [];
  const sweepStep = plan.quick ? 1000 : 500;
  for (let r = sweepFrom; r <= sweepTo; r += sweepStep) sweepPoints.push(r);
  if (sweepPoints.length > 0 && sweepTo - sweepPoints[sweepPoints.length - 1]! > 200) sweepPoints.push(sweepTo);
  for (const r of plan.extraPoints ?? []) if (r >= sweepFrom && r <= sweepTo && !sweepPoints.includes(r)) sweepPoints.push(r);
  if (plan.onlyPoints) sweepPoints.splice(0, sweepPoints.length, ...plan.onlyPoints.filter((r) => r >= sweepFrom && r <= sweepTo));
  sweepPoints.sort((a, b) => a - b);
  const q = plan.quick ? 0.6 : 1;

  // Rough cost of each phase in sim seconds, for the progress bar.
  const cost = {
    start: 1.5,
    idle: 4,
    freeRev: plan.freeRev ? 3 : 0,
    sweep: sweepPoints.length * 1.1 + 0.8,
    endurance: plan.endurance?.seconds ?? 0,
    overrun: plan.overrun ? 7 : 0,
  };
  const total = Object.values(cost).reduce((a, b) => a + b, 0);
  let doneCost = 0;
  let phase: AcceptancePhase = 'start';
  let lastReport = 0;

  const report = (force = false): void => {
    if (!onProgress) return;
    if (!force && res.simTime - lastReport < 0.25) return;
    lastReport = res.simTime;
    const within = Math.min(cost[phase as keyof typeof cost] ?? 0, Math.max(0, res.simTime - phaseStart));
    onProgress({ phase, fraction: Math.min(1, (doneCost + within) / total), curve: res.curve.slice() });
  };
  let phaseStart = 0;
  const enter = (p: AcceptancePhase): void => {
    if (phase !== 'start' || p !== 'start') doneCost += cost[phase as keyof typeof cost] ?? 0;
    phase = p;
    phaseStart = res.simTime;
    report(true);
  };

  /** Run for `seconds`; calls `each` every 10 ms of sim time. Returns false if the engine broke. */
  const run = (seconds: number, each?: () => void): boolean => {
    const n = Math.round(seconds * RATE);
    for (let i = 0; i < n; i++) {
      core.step(DT);
      if (i % 240 === 0) {
        res.simTime += 0.01;
        drain();
        each?.();
        report();
        if (core.failure) {
          res.failure = core.failure;
          res.failedIn = phase;
          return false;
        }
      }
    }
    return true;
  };

  const drain = (): void => {
    if (core.events.length === 0) return;
    events.length = 0;
    core.drainEvents(events);
    for (const e of events) {
      if (e.kind === 'knock') {
        res.knockEvents++;
        res.knockMax = Math.max(res.knockMax, e.intensity);
      } else if (e.kind === 'afterfire' && phase === 'overrun') res.pops++;
    }
    res.coolantMax = Math.max(res.coolantMax, core.coolantC);
    res.egtMax = Math.max(res.egtMax, core.egtK - 273);
  };

  const finish = (): AcceptanceResult => {
    res.pistonDamage = core.pistonDamage;
    res.rodFatigue = core.rodFatigue;
    for (const [rpm, tq] of res.curve) {
      if (tq > res.peakTorque) {
        res.peakTorque = tq;
        res.peakTorqueRpm = rpm;
      }
      const hp = hpOf(rpm, tq);
      if (hp > res.peakHp) {
        res.peakHp = hp;
        res.peakHpRpm = rpm;
      }
    }
    phase = 'done';
    onProgress?.({ phase, fraction: 1, curve: res.curve.slice() });
    return res;
  };

  // ---- start ----
  enter('start');
  core.controls.starter = true;
  let t = 0;
  while (t < 3 && !running()) {
    if (!run(0.05)) return finish();
    t += 0.05;
  }
  core.controls.starter = false;
  if (!run(0.4)) return finish();
  res.started = running();
  if (!res.started) return finish();

  // ---- idle ----
  enter('idle');
  if (!run(2)) return finish();
  {
    let sum = 0;
    let n = 0;
    let min = Infinity;
    let max = -Infinity;
    const ok = run(2, () => {
      sum += core.rpm;
      n++;
      min = Math.min(min, core.rpm);
      max = Math.max(max, core.rpm);
    });
    res.idle = { mean: sum / Math.max(1, n), min: running() ? min : 0, max };
    if (!ok) return finish();
    if (!running()) {
      res.idle.min = 0;
      // A stalled engine has to be restarted for the rest of the schedule.
      core.controls.starter = true;
      t = 0;
      while (t < 3 && !running()) {
        if (!run(0.05)) return finish();
        t += 0.05;
      }
      core.controls.starter = false;
      if (!running()) return finish();
    }
  }

  // ---- free rev ----
  if (plan.freeRev) {
    enter('freeRev');
    core.controls.throttle = 1;
    const target = limiter * 0.9;
    let tr = 0;
    while (tr < 3 && core.rpm < target) {
      if (!run(0.01)) return finish();
      tr += 0.01;
    }
    if (core.rpm >= target) res.freeRevTime = tr;
    core.controls.throttle = 0;
    if (!run(Math.max(0, 3 - tr) * 0.5 + 0.5)) return finish();
  }

  // ---- sweep ----
  enter('sweep');
  core.controls.throttle = 1;
  core.controls.brakeMode = 'speed';
  for (let i = 0; i < sweepPoints.length; i++) {
    const rpm = sweepPoints[i]!;
    core.controls.brakeRpm = rpm;
    // Settles stay full: knock retard needs them, and short ones read optimistic.
    if (!run(i === 0 ? 1.5 : 0.7)) return finish();
    let sum = 0;
    let n = 0;
    let lastIndex = core.lastCycle?.index ?? -1;
    const ok = run(0.4 * q, () => {
      const c = core.lastCycle;
      if (c && c.index !== lastIndex) {
        lastIndex = c.index;
        sum += c.brakeTorque;
        n++;
      }
    });
    if (n > 0) res.curve.push([rpm, sum / n]);
    if (!ok) return finish();
  }

  // ---- endurance ----
  if (plan.endurance) {
    enter('endurance');
    core.controls.brakeRpm = plan.endurance.rpm ?? limiter - 150;
    if (!run(plan.endurance.seconds)) return finish();
  }

  // ---- overrun ----
  if (plan.overrun) {
    enter('overrun');
    core.controls.brakeMode = 'off';
    for (let k = 0; k < 2; k++) {
      core.controls.throttle = 1;
      if (!run(1.2)) return finish();
      core.controls.throttle = 0;
      if (!run(2.3)) return finish();
    }
  }

  core.controls.throttle = 0;
  core.controls.brakeMode = 'off';
  return finish();
}
