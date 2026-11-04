/**
 * A handful of acceptance workers for 老周's search, so several builds run
 * at once. Falls back to the main thread (one at a time) without workers.
 */

import { runAcceptance, type AcceptanceResult } from '../game/acceptance';
import type { AcceptanceReply, AcceptanceRequest } from '../game/acceptance.worker';
import type { EvalJob } from './search';

export function poolWidth(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  // Leave a core for the audio thread and the page.
  return Math.max(2, Math.min(8, cores - 1));
}

export interface Pool {
  width: number;
  evaluate: (jobs: EvalJob[]) => Promise<AcceptanceResult[]>;
  close: () => void;
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
    return {
      width: 1,
      evaluate: async (jobs) => {
        const out: AcceptanceResult[] = [];
        for (const j of jobs) {
          // Let the page breathe between runs.
          await new Promise((r) => setTimeout(r, 0));
          out.push(runAcceptance(j.config, j.ecu, j.plan));
        }
        return out;
      },
      close: () => {},
    };
  }

  const idle = [...workers];
  const waiting: (() => void)[] = [];
  const pending = new Set<(err: Error) => void>();
  let nextId = 1;
  let closed = false;

  const one = (job: EvalJob): Promise<AcceptanceResult> =>
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
          if (m.type === 'done') {
            done();
            pending.delete(reject);
            resolve(m.result);
          } else if (m.type === 'error') {
            done();
            reject(new Error(m.message));
          }
        };
        w.onerror = (e) => {
          done();
          reject(new Error(e.message || 'worker error'));
        };
        const req: AcceptanceRequest = { id, config: job.config, ecu: job.ecu, plan: job.plan, quiet: true };
        w.postMessage(req);
      };
      if (idle.length) go();
      else waiting.push(go);
    });

  return {
    width: workers.length,
    evaluate: (jobs) => Promise.all(jobs.map(one)),
    close: () => {
      closed = true;
      for (const w of workers) w.terminate();
      for (const r of [...pending]) r(new Error('closed'));
    },
  };
}
