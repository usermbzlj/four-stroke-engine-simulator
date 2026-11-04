import type { BenchConfig, EcuConfig, EngineConfig } from '../sim/config';
import type { Controls, CoreEvent, CycleTrace } from '../sim/core';
import type { EngineSnapshot } from '../sim/snapshot';
import type { RaceEventId, RaceResult, Rider } from '../sim/race';
import type { VehicleConfig } from '../sim/vehicle';

export interface EngineSetup {
  config: EngineConfig;
  ecu: EcuConfig;
  bench: BenchConfig;
}

export type HostCommand =
  | { type: 'controls'; controls: Partial<Controls> }
  /** Swap the engine on the stand. The crank is stopped and the gas reset. */
  | { type: 'rebuild'; config: EngineConfig }
  /** Swap bolt-on parts with the engine running; block changes fall back to a rebuild. */
  | { type: 'tune'; config: EngineConfig }
  | { type: 'ecu'; ecu: EcuConfig }
  | { type: 'bench'; bench: BenchConfig }
  /** Fit new parts after a failure. */
  | { type: 'restore' }
  /** Fresh piston and rod on a running engine (wear only, not a failure). */
  | { type: 'renew' }
  | { type: 'volume'; volume: number }
  /** Put the engine in a vehicle (track) or back on the dyno (null). */
  | { type: 'vehicle'; vehicle: VehicleConfig | null }
  /** Stage a timed run; the lights go out after `countdown` seconds. */
  | { type: 'race'; event: RaceEventId; rider: Rider; countdown: number }
  | { type: 'raceAbort' }
  | { type: 'shift'; dir: number };

export type EngineMessage =
  | { type: 'snapshot'; snapshot: EngineSnapshot }
  | { type: 'trace'; trace: CycleTrace }
  | { type: 'events'; events: CoreEvent[] }
  | { type: 'race'; result: RaceResult };
