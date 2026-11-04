import { parentPort } from 'node:worker_threads';
import { runAcceptance } from '../src/game/acceptance.ts';
import type { EvalJob } from '../src/mentor/search.ts';

parentPort!.on('message', (m: { id: number; job: EvalJob }) => {
  parentPort!.postMessage({ id: m.id, result: runAcceptance(m.job.config, m.job.ecu, m.job.plan) });
});
