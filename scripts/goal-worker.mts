import { parentPort } from 'node:worker_threads';
import { runLocal, type Unit } from '../src/mentor/pool.ts';

parentPort!.on('message', (m: { id: number; unit: Unit }) => {
  parentPort!.postMessage({ id: m.id, out: runLocal(m.unit) });
});
