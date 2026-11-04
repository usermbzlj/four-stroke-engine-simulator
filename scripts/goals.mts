/**
 * Hand every work order to 老周's search, starting from the customer's
 * engine, and grade what he comes back with.
 *
 *   npm run goals            all jobs
 *   npm run goals -- tractor jobs whose id contains "tractor"
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import type { AcceptanceResult } from '../src/game/acceptance.ts';
import { JOBS, grade, jobStart } from '../src/game/jobs.ts';
import { buildCost, changedParts } from '../src/game/parts.ts';
import { briefForJob } from '../src/mentor/goals.ts';
import { search, summary, type EvalJob } from '../src/mentor/search.ts';

const width = Math.max(2, Math.min(8, availableParallelism() - 1));
const pool = Array.from({ length: width }, () => new Worker(`import('tsx/esm/api').then((t) => { t.register(); return import('${new URL('./goal-worker.mts', import.meta.url).href}'); });`, { eval: true }));
let nextId = 0;
const waiting = new Map<number, (r: AcceptanceResult) => void>();
for (const w of pool) w.on('message', (m: { id: number; result: AcceptanceResult }) => waiting.get(m.id)?.(m.result));
const idle = [...pool];
const queue: (() => void)[] = [];

function one(job: EvalJob): Promise<AcceptanceResult> {
  return new Promise((resolve) => {
    const go = (): void => {
      const w = idle.pop()!;
      const id = nextId++;
      waiting.set(id, (r) => {
        waiting.delete(id);
        idle.push(w);
        queue.shift()?.();
        resolve(r);
      });
      w.postMessage({ id, job });
    };
    if (idle.length) go();
    else queue.push(go);
  });
}

const filter = process.argv[2];
let bad = 0;
for (const job of JOBS) {
  if (filter && !job.id.includes(filter)) continue;
  const start = jobStart(job);
  const brief = briefForJob(job, start.config);
  const t0 = performance.now();
  console.log(`\n■ ${job.title} (${job.id})`);
  const out = await search(brief, { config: start.config, ecu: start.ecu, wish: start.ecu.limiterRpm }, {
    evaluate: (jobs) => Promise.all(jobs.map(one)),
    width,
    log: (t) => console.log(`   · ${t}`),
    stage: (t) => console.log(`   【${t}】`),
    progress: () => {},
    stopped: () => false,
  });
  const v = out.verified;
  const cost = buildCost(start.config, v.config);
  const g = grade(job, { config: v.config, ecu: v.ecu, cost, result: v.result });
  console.log(`  试了 ${out.tried} 种，${((performance.now() - t0) / 1000).toFixed(0)} 秒。正式验收：${'★'.repeat(g.stars)}${'☆'.repeat(3 - g.stars)}  ¥${cost}（${changedParts(start.config, v.config).map((p) => p.name).join('、') || '无'}）`);
  console.log(`  ${summary(brief.goals, v)}`);
  if (g.stars < 1) bad++;
}
for (const w of pool) void w.terminate();
if (bad) {
  console.log(`\n${bad} 单没过`);
  process.exitCode = 1;
}
