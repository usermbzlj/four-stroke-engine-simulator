import type { EcuConfig, EngineConfig } from '../sim/config';
import { runRace, type RaceEventId, type RaceResult } from '../sim/race';
import type { VehicleConfig } from '../sim/vehicle';
import { runAcceptance, type AcceptancePlan, type AcceptanceProgress, type AcceptanceResult } from './acceptance';
import { runTask, type TaskOut, type TaskSpec } from '../mentor/engineer/tasks';

export interface AcceptanceRequest {
  id: number;
  config: EngineConfig;
  ecu: EcuConfig;
  plan: AcceptancePlan;
  /** No progress messages: 老周's search only wants the result. */
  quiet?: boolean;
  /** Run a timed event instead of the acceptance schedule. */
  race?: { vehicle: VehicleConfig; event: RaceEventId };
  /** Run one of 老周's measurement tasks instead. */
  task?: TaskSpec;
  /** After the schedule, these timed runs too (work orders judged on the strip). */
  alsoRaces?: { vehicle: VehicleConfig; events: RaceEventId[] };
}

export type AcceptanceReply =
  | { id: number; type: 'progress'; progress: AcceptanceProgress }
  | { id: number; type: 'done'; result: AcceptanceResult; races?: Partial<Record<RaceEventId, RaceResult>> }
  | { id: number; type: 'raced'; result: RaceResult }
  | { id: number; type: 'task'; result: TaskOut }
  | { id: number; type: 'error'; message: string };

const post = (msg: AcceptanceReply): void => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<AcceptanceRequest>) => {
  const { id, config, ecu, plan, quiet, race, task, alsoRaces } = e.data;
  try {
    if (task) {
      post({ id, type: 'task', result: runTask(config, ecu, task) });
    } else if (race) {
      post({ id, type: 'raced', result: runRace(config, ecu, race.vehicle, race.event) });
    } else {
      const result = runAcceptance(config, ecu, plan, quiet ? undefined : (progress) => post({ id, type: 'progress', progress }));
      const races: Partial<Record<RaceEventId, RaceResult>> = {};
      if (alsoRaces && result.started && !result.failure) {
        for (const ev of alsoRaces.events) races[ev] = runRace(config, ecu, alsoRaces.vehicle, ev);
      }
      post({ id, type: 'done', result, races });
    }
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
