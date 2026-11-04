/**
 * Measurements 老周 runs on a private engine, the way a calibrator works a
 * load cell: hold an rpm at full throttle, change one thing, read the
 * torque and the knock. Each task covers a few map columns so several run
 * side by side on the worker pool.
 */

import { EngineCore } from '../../sim/core';
import { MAP_LOAD, MAP_RPM, type EcuConfig, type EngineConfig, type EcuTable } from '../../sim/config';

/** Knock the piston shrugs off; trace knock at the limit is normal. */
export const KNOCK_OK = 0.08;

export type TaskSpec =
  | { kind: 'spark'; rpms: number[] }
  | { kind: 'lambda'; rpms: number[] }
  | { kind: 'cam'; rpms: number[] }
  | { kind: 'boost'; rpms: number[]; max: number }
  | { kind: 'idle' };

export interface ColumnResult {
  rpm: number;
  /** Best value found for the map cell(s). */
  value: number;
  torque: number;
  /** Manifold load the column was measured at. */
  load: number;
  /** Stopped by knock (spark, boost) or by the injector (boost). */
  limitedBy: 'knock' | 'injector' | 'torque' | 'none';
}

export type TaskOut =
  | { kind: 'columns'; columns: ColumnResult[] }
  | { kind: 'idle'; idleMin: number; idleMax: number; blipMin: number; blipEnd: number; stalled: boolean };

const RATE = 24000;
const DT = 1 / RATE;

function warm(config: EngineConfig, ecu: EcuConfig): EngineCore | null {
  const core = new EngineCore(config, ecu, undefined, 7);
  core.coolantC = 88;
  core.oilC = 88;
  core.controls.starter = true;
  for (let t = 0; t < 3 && core.status !== 'running'; t += 0.01) for (let i = 0; i < 240; i++) core.step(DT);
  core.controls.starter = false;
  for (let i = 0; i < RATE * 0.8; i++) core.step(DT);
  return core.status === 'running' ? core : null;
}

interface Reading {
  torque: number;
  knock: number;
  duty: number;
  load: number;
  broke: boolean;
}

function read(core: EngineCore, settle: number, window: number): Reading {
  for (let i = 0; i < Math.round(RATE * settle); i++) core.step(DT);
  let sum = 0;
  let n = 0;
  let knock = 0;
  let duty = 0;
  let map = 0;
  let last = core.lastCycle?.index ?? -1;
  for (let i = 0; i < Math.round(RATE * window); i++) {
    core.step(DT);
    const c = core.lastCycle;
    if (c && c.index !== last) {
      last = c.index;
      sum += c.brakeTorque;
      knock = Math.max(knock, c.knock);
      duty = Math.max(duty, c.injDuty);
      map += c.mapKpa;
      n++;
    }
  }
  return { torque: n ? sum / n : 0, knock, duty, load: n ? map / n / 101.325 : 1, broke: core.failure !== null };
}

/** Write `v` into the full-load cells of one rpm column (rows at or above `fromLoad`). */
export function setColumn(t: EcuTable, rpm: number, v: number, fromLoad: number): EcuTable {
  const c = MAP_RPM.indexOf(rpm);
  if (c < 0) return t;
  return t.map((row, r) => (MAP_LOAD[r]! >= fromLoad - 1e-6 ? row.map((x, j) => (j === c ? v : x)) : row));
}

/** Rows the full-throttle calibration writes: everything from just below the measured load. */
export function wotFrom(load: number): number {
  let from = MAP_LOAD[0]!;
  for (const l of MAP_LOAD) if (l <= load - 0.15) from = l;
  return Math.max(0.6, from);
}

function column(t: EcuTable, rpm: number): number {
  const c = MAP_RPM.indexOf(rpm);
  return t[MAP_LOAD.indexOf(1)]![c] ?? 0;
}

/** Hill-climb one table cell on torque, with knock (and the injector) as walls. */
function climb(
  config: EngineConfig,
  ecu: EcuConfig,
  rpms: number[],
  candidates: (current: number) => number[],
  apply: (e: EcuConfig, rpm: number, v: number, load: number) => EcuConfig,
  current: (e: EcuConfig, rpm: number) => number,
  pick: (rs: { v: number; r: Reading }[]) => { v: number; limitedBy: ColumnResult['limitedBy'] },
): TaskOut {
  const columns: ColumnResult[] = [];
  const core = warm(config, { ...ecu, knockControl: false });
  if (!core) return { kind: 'columns', columns };
  core.controls.throttle = 1;
  core.controls.brakeMode = 'speed';
  let e = { ...ecu, knockControl: false };
  for (const rpm of rpms) {
    // A calibration rig: wear from the last column does not carry over.
    core.pistonDamage = 0;
    core.rodFatigue = 0;
    core.controls.brakeRpm = rpm;
    const base = read(core, 0.9, 0.25);
    const load = base.load;
    const tried: { v: number; r: Reading }[] = [];
    for (const v of candidates(current(e, rpm))) {
      e = apply(e, rpm, v, load);
      core.setEcu(e);
      const r = read(core, 0.3, 0.3);
      // A candidate that broke the engine ends this column; start a fresh one.
      if (r.broke) break;
      tried.push({ v, r });
      // Heavy knock: further along this way only hurts the piston.
      if (r.knock > 0.2) break;
    }
    if (core.failure) break;
    const choice = tried.length ? pick(tried) : { v: current(ecu, rpm), limitedBy: 'none' as const };
    e = apply(e, rpm, choice.v, load);
    core.setEcu(e);
    const best = tried.find((x) => x.v === choice.v);
    columns.push({ rpm, value: choice.v, torque: best?.r.torque ?? base.torque, load, limitedBy: choice.limitedBy });
  }
  return { kind: 'columns', columns };
}

const NOISE = 0.004;

export function runTask(config: EngineConfig, ecu: EcuConfig, task: TaskSpec): TaskOut {
  switch (task.kind) {
    case 'spark':
      return climb(
        config,
        ecu,
        task.rpms,
        (cur) => [-8, -5, -2, 1, 4, 7].map((d) => Math.max(-20, Math.min(20, cur + d))),
        (e, rpm, v, load) => ({ ...e, sparkTable: setColumn(e.sparkTable, rpm, v, wotFrom(load)) }),
        (e, rpm) => column(e.sparkTable, rpm),
        (rs) => {
          // Best clean torque, then 1.5° back from the first knocking step for margin.
          const clean = rs.filter((x) => x.r.knock <= KNOCK_OK);
          const knocked = rs.find((x) => x.r.knock > KNOCK_OK);
          if (clean.length === 0) return { v: Math.max(-20, rs[0]!.v - 3), limitedBy: 'knock' };
          const best = clean.reduce((a, b) => (b.r.torque > a.r.torque * (1 + NOISE) ? b : a));
          const wall = knocked ? knocked.v - 1.5 : Infinity;
          return { v: Math.round(Math.min(best.v, wall) * 2) / 2, limitedBy: knocked && best.v >= wall ? 'knock' : 'torque' };
        },
      );
    case 'lambda':
      return climb(
        config,
        ecu,
        task.rpms,
        () => [-0.06, -0.03, 0, 0.03, 0.06],
        (e, rpm, v, load) => ({ ...e, lambdaTable: setColumn(e.lambdaTable, rpm, v, wotFrom(load)) }),
        (e, rpm) => column(e.lambdaTable, rpm),
        (rs) => {
          // Richest mixture within noise of best torque: same power, cooler charge.
          const clean = rs.filter((x) => x.r.knock <= KNOCK_OK);
          const pool = clean.length ? clean : rs;
          const top = Math.max(...pool.map((x) => x.r.torque));
          const v = pool.filter((x) => x.r.torque >= top * (1 - 2 * NOISE)).sort((a, b) => a.v - b.v)[0]!.v;
          return { v, limitedBy: 'torque' };
        },
      );
    case 'cam': {
      const range = config.vvtRange;
      if (range <= 0) return { kind: 'columns', columns: [] };
      return climb(
        config,
        ecu,
        task.rpms,
        () => [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * range)),
        (e, rpm, v, load) => ({ ...e, camTable: setColumn(e.camTable, rpm, v, Math.min(0.6, wotFrom(load))) }),
        (e, rpm) => column(e.camTable, rpm),
        (rs) => ({ v: rs.reduce((a, b) => (b.r.torque > a.r.torque ? b : a)).v, limitedBy: 'torque' }),
      );
    }
    case 'boost': {
      if (config.turboSize <= 0) return { kind: 'columns', columns: [] };
      const steps = [40, 60, 80, 100, 125, 150, 175, 200].filter((v) => v <= task.max);
      return climb(
        config,
        ecu,
        task.rpms,
        () => steps,
        (e, rpm, v) => {
          const c = MAP_RPM.indexOf(rpm);
          return { ...e, boostTable: e.boostTable.map((x, j) => (j === c ? v : x)) };
        },
        (e, rpm) => e.boostTable[MAP_RPM.indexOf(rpm)] ?? 0,
        (rs) => {
          // Climb until knock, the injector or the gain runs out; one step back from a wall.
          let pick = rs[0]!;
          let limitedBy: ColumnResult['limitedBy'] = 'none';
          for (const x of rs) {
            if (x.r.knock > KNOCK_OK) {
              limitedBy = 'knock';
              break;
            }
            if (x.r.duty > 0.88) {
              limitedBy = 'injector';
              break;
            }
            if (x.r.torque < pick.r.torque * (1 + NOISE) && x !== rs[0]) {
              limitedBy = 'torque';
              break;
            }
            pick = x;
          }
          return { v: pick.v, limitedBy };
        },
      );
    }
    case 'idle': {
      const core = warm(config, ecu);
      if (!core) return { kind: 'idle', idleMin: 0, idleMax: 0, blipMin: 0, blipEnd: 0, stalled: true };
      let idleMin = Infinity;
      let idleMax = 0;
      for (let i = 0; i < RATE * 2.5; i++) {
        core.step(DT);
        if (i % 240 === 0) {
          const r = core.status === 'running' ? core.rpm : 0;
          idleMin = Math.min(idleMin, r);
          idleMax = Math.max(idleMax, r);
        }
      }
      core.controls.throttle = 1;
      for (let i = 0; i < RATE * 0.3; i++) core.step(DT);
      core.controls.throttle = 0;
      let blipMin = Infinity;
      let stalled = false;
      for (let i = 0; i < RATE * 2.7; i++) {
        core.step(DT);
        if (i % 240 === 0) {
          if (core.status !== 'running') stalled = true;
          blipMin = Math.min(blipMin, core.status === 'running' ? core.rpm : 0);
        }
      }
      return { kind: 'idle', idleMin, idleMax, blipMin: stalled ? 0 : blipMin, blipEnd: core.rpm, stalled };
    }
  }
}

/** Map columns between idle and the limiter, for calibration. */
export function columnsFor(ecu: EcuConfig, from = 2000): number[] {
  return MAP_RPM.filter((r) => r >= Math.max(from, ecu.idleRpm + 600) && r <= ecu.limiterRpm - 100);
}
