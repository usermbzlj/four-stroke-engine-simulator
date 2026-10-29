import type { CycleStats, CycleTrace, EngineCore, EngineStatus, Failure } from './core';

/** What the UI sees of the solver, ~60 times a second. */
export interface EngineSnapshot {
  time: number;
  rpm: number;
  /** Cycle angle, degrees from firing TDC (0-720). */
  crankDeg: number;
  status: EngineStatus;
  throttle: number;
  iac: number;
  mapKpa: number;
  advance: number;
  lambdaTarget: number;
  knockRetard: number;
  overrunCut: boolean;
  limiterCut: boolean;
  torque: number;
  brakeTorque: number;
  coolantC: number;
  oilC: number;
  oilPressure: number;
  headerWallC: number;
  egtC: number;
  pistonDamage: number;
  rodFatigue: number;
  floatRpm: number;
  failure: Failure | null;
  cycle: CycleStats | null;
}

export function takeSnapshot(core: EngineCore, time: number): EngineSnapshot {
  return {
    time,
    rpm: core.rpm,
    crankDeg: (core.theta * 180) / Math.PI,
    status: core.status,
    throttle: core.throttleActual,
    iac: core.iac,
    mapKpa: core.mapKpa,
    advance: core.advance,
    lambdaTarget: core.lambdaTarget,
    knockRetard: core.knockRetard,
    overrunCut: core.overrunCut,
    limiterCut: core.limiterCut,
    torque: core.torqueLive,
    brakeTorque: core.brakeTorque,
    coolantC: core.coolantC,
    oilC: core.oilC,
    oilPressure: core.oilPressure,
    headerWallC: core.headerWallK - 273,
    egtC: core.egtK - 273,
    pistonDamage: core.pistonDamage,
    rodFatigue: core.rodFatigue,
    floatRpm: core.floatLimitRpm,
    failure: core.failure,
    cycle: core.lastCycle,
  };
}

export function copyTrace(t: CycleTrace): CycleTrace {
  return {
    pressure: t.pressure.slice(),
    temperature: t.temperature.slice(),
    fresh: t.fresh.slice(),
    flame: t.flame.slice(),
  };
}
