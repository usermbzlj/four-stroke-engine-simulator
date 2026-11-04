/**
 * Idle that holds in one run is not idle that holds. A build is checked
 * across several days' worth of cycle-to-cycle scatter, warm and cold, with
 * a short blip and a full rev let go, and only counts as stable when every
 * one of them comes back to idle.
 */

import type { BenchConfig, EcuConfig, EngineConfig } from '../../sim/config';
import type { TaskOut, TaskSpec } from './tasks';

export type RunTasks = (config: EngineConfig, ecu: EcuConfig, specs: TaskSpec[]) => Promise<TaskOut[]>;

export interface IdleVerdict {
  /** Scenarios that stalled, out of `total`. */
  stalls: number;
  total: number;
  /** Lowest rpm seen after a let-go across all scenarios (0 if any stalled). */
  worstDip: number;
  /** Lowest steady idle across all scenarios. */
  worstIdle: number;
  /** Every scenario came back. */
  ok: boolean;
}

const SEEDS = [7, 11, 23, 41];

export function stressSpecs(opts: { bench?: BenchConfig; coolants?: number[] } = {}): TaskSpec[] {
  const coolants = opts.coolants ?? [88, 50];
  return SEEDS.flatMap((seed) => coolants.map((coolant): TaskSpec => ({ kind: 'idle', seed, coolant, stress: true, ...(opts.bench ? { bench: opts.bench } : {}) })));
}

export async function idleVerdict(run: RunTasks, config: EngineConfig, ecu: EcuConfig, specs: TaskSpec[]): Promise<IdleVerdict> {
  const outs = await run(config, ecu, specs);
  let stalls = 0;
  let worstDip = Infinity;
  let worstIdle = Infinity;
  for (const o of outs) {
    if (o.kind !== 'idle') continue;
    if (o.stalled) stalls++;
    worstDip = Math.min(worstDip, o.blipMin);
    worstIdle = Math.min(worstIdle, o.idleMin);
  }
  const floor = Math.max(500, ecu.idleRpm * 0.5);
  return { stalls, total: outs.length, worstDip: stalls ? 0 : worstDip, worstIdle, ok: stalls === 0 && worstDip >= floor };
}

export const verdictText = (v: IdleVerdict): string =>
  v.stalls ? `${v.total} 种情况里 ${v.stalls} 种熄火` : `${v.total} 种情况都没熄，最低掉到 ${Math.round(v.worstDip).toLocaleString('en-US')} 转`;
