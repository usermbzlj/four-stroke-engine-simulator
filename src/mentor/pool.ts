/**
 * A handful of workers for 老周, so several builds (and their timed runs, and
 * his calibration measurements) run at once. Falls back to the main thread,
 * one at a time, without workers.
 */

import { runAcceptance, type AcceptanceResult } from '../game/acceptance';
import type { AcceptanceReply, AcceptanceRequest } from '../game/acceptance.worker';
import type { EcuConfig, EngineConfig } from '../sim/config';
import { runRace, type RaceEventId, type RaceResult } from '../sim/race';
import { runTask, type TaskOut, type TaskSpec } from './engineer/tasks';
import type { EvalJob, EvalOut } from './search';

export function poolWidth(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  // Leave a core for the audio thread and the page.
  return Math.max(2, Math.min(8, cores - 1));
}

export interface Pool {
  width: number;
  evaluate: (jobs: EvalJob[]) => Promise<EvalOut[]>;
  /** Run measurement tasks; results in the same order. */
  tasks: (config: EngineConfig, ecu: EcuConfig, specs: TaskSpec[]) => Promise<TaskOut[]>;
  close: () => void;
}

export type Unit = Omit<AcceptanceRequest, 'id'>;
export type UnitOut = { kind: 'accept'; result: AcceptanceResult } | { kind: 'race'; result: RaceResult } | { kind: 'task'; result: TaskOut };

export function runLocal(u: Unit): UnitOut {
  if (u.task) return { kind: 'task', result: runTask(u.config, u.ecu, u.task) };
  if (u.race) return { kind: 'race', result: runRace(u.config, u.ecu, u.race.vehicle, u.race.event) };
  return { kind: 'accept', result: runAcceptance(u.config, u.ecu, u.plan) };
}

export function unitsOf(j: EvalJob): Unit[] {
  return [
    ...(j.reuse ? [] : [{ config: j.config, ecu: j.ecu, plan: j.plan, quiet: true }]),
    ...j.events.map((event): Unit => ({ config: j.config, ecu: j.ecu, plan: j.plan, quiet: true, race: { vehicle: j.vehicle, event } })),
  ];
}

export function assemble(jobs: EvalJob[], outs: UnitOut[]): EvalOut[] {
  let k = 0;
  return jobs.map((j) => {
    const a: UnitOut = j.reuse ? { kind: 'accept', result: j.reuse } : outs[k++]!;
    const races: Partial<Record<RaceEventId, RaceResult>> = {};
    for (const e of j.events) {
      const r = outs[k++]!;
      if (r.kind === 'race') races[e] = r.result;
    }
    return { result: (a as { result: AcceptanceResult }).result, races };
  });
}

export function openPool(): Pool {
  const width = poolWidth();
  const workers: Worker[] = [];
  try {
    for (let i = 0; i < width; i++) workers.push(new Worker(new URL('../game/acceptance.worker.ts', import.meta.url), { type: 'module' }));
  } catch (err) {
    console.warn('Search workers unavailable, running on the main thread', err);
    for (const w of workers) w.terminate();
    workers.length = 0;
  }
  if (workers.length === 0) {
    const all = async (units: Unit[]): Promise<UnitOut[]> => {
      const out: UnitOut[] = [];
      for (const u of units) {
        // Let the page breathe between runs.
        await new Promise((r) => setTimeout(r, 0));
        out.push(runLocal(u));
      }
      return out;
    };
    return {
      width: 1,
      evaluate: async (jobs) => assemble(jobs, await all(jobs.flatMap(unitsOf))),
      tasks: async (config, ecu, specs) => (await all(specs.map((task) => ({ config, ecu, plan: {}, quiet: true, task })))).map((o) => (o as { result: TaskOut }).result),
      close: () => {},
    };
  }

  const idle = [...workers];
  const waiting: (() => void)[] = [];
  const pending = new Set<(err: Error) => void>();
  let nextId = 1;
  let closed = false;

  const one = (unit: Unit): Promise<UnitOut> =>
    new Promise((resolve, reject0) => {
      const reject = (err: Error): void => {
        pending.delete(reject);
        reject0(err);
      };
      pending.add(reject);
      const go = (): void => {
        if (closed) {
          reject(new Error('closed'));
          return;
        }
        const w = idle.pop()!;
        const id = nextId++;
        const done = (): void => {
          idle.push(w);
          waiting.shift()?.();
        };
        w.onmessage = (e: MessageEvent<AcceptanceReply>) => {
          const m = e.data;
          if (m.id !== id) return;
          if (m.type === 'progress') return;
          done();
          if (m.type === 'error') {
            reject(new Error(m.message));
            return;
          }
          pending.delete(reject);
          resolve(m.type === 'done' ? { kind: 'accept', result: m.result } : m.type === 'raced' ? { kind: 'race', result: m.result } : { kind: 'task', result: m.result });
        };
        w.onerror = (e) => {
          done();
          reject(new Error(e.message || 'worker error'));
        };
        const req: AcceptanceRequest = { id, ...unit };
        w.postMessage(req);
      };
      if (idle.length) go();
      else waiting.push(go);
    });

  return {
    width: workers.length,
    evaluate: async (jobs) => assemble(jobs, await Promise.all(jobs.flatMap(unitsOf).map(one))),
    tasks: async (config, ecu, specs) => (await Promise.all(specs.map((task) => one({ config, ecu, plan: {}, quiet: true, task })))).map((o) => (o as { result: TaskOut }).result),
    close: () => {
      closed = true;
      for (const w of workers) w.terminate();
      for (const r of [...pending]) r(new Error('closed'));
    },
  };
}
