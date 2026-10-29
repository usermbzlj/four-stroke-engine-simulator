import type { BenchConfig, EcuConfig, EngineConfig } from '../sim/config';
import type { Controls, CoreEvent, CycleTrace } from '../sim/core';
import type { EngineSnapshot } from '../sim/snapshot';

export interface EngineSetup {
  config: EngineConfig;
  ecu: EcuConfig;
  bench: BenchConfig;
}

export type HostCommand =
  | { type: 'controls'; controls: Partial<Controls> }
  /** Swap the engine on the stand. The crank is stopped and the gas reset. */
  | { type: 'rebuild'; config: EngineConfig }
  | { type: 'ecu'; ecu: EcuConfig }
  | { type: 'bench'; bench: BenchConfig }
  /** Fit new parts after a failure. */
  | { type: 'restore' }
  | { type: 'volume'; volume: number };

export type EngineMessage =
  | { type: 'snapshot'; snapshot: EngineSnapshot }
  | { type: 'trace'; trace: CycleTrace }
  | { type: 'events'; events: CoreEvent[] };
