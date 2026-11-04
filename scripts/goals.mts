/**
 * Hand every work order to 老周, starting from the customer's engine, and
 * grade what he comes back with.
 *
 *   npm run goals            all jobs
 *   npm run goals -- tractor jobs whose id contains "tractor"
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { JOBS, grade, jobStart } from '../src/game/jobs.ts';
import { changedParts } from '../src/game/parts.ts';
import { briefForJob } from '../src/mentor/goals.ts';
import { engineer } from '../src/mentor/engineer/engineer.ts';
import { assemble, unitsOf, type Unit, type UnitOut } from '../src/mentor/pool.ts';
import { costOf, summary } from '../src/mentor/search.ts';
import { changedVehicleParts } from '../src/sim/vehicle.ts';

const width = Math.max(2, Math.min(8, availableParallelism() - 1));
const pool = Array.from({ length: width }, () => new Worker(`import('tsx/esm/api').then((t) => { t.register(); return import('${new URL('./goal-worker.mts', import.meta.url).href}'); });`, { eval: true }));
let nextId = 0;
const waiting = new Map<number, (r: UnitOut) => void>();
for (const w of pool) w.on('message', (m: { id: number; out: UnitOut }) => waiting.get(m.id)?.(m.out));
const idle = [...pool];
const queue: (() => void)[] = [];

function one(unit: Unit): Promise<UnitOut> {
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
      w.postMessage({ id, unit });
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
  const out = await engineer(brief, { config: start.config, ecu: start.ecu, vehicle: brief.vehicle, wish: start.ecu.limiterRpm }, {
    evaluate: async (jobs) => assemble(jobs, await Promise.all(jobs.flatMap(unitsOf).map(one))),
    tasks: async (config, ecu, specs) => (await Promise.all(specs.map((task) => one({ config, ecu, plan: {}, quiet: true, task })))).map((o) => o.result as never),
    width,
    log: (t) => console.log(`   · ${t}`),
    stage: (t) => console.log(`   【${t}】`),
    progress: () => {},
    stopped: () => false,
  });
  const v = out.verified;
  const cost = costOf(brief, v);
  const g = grade(job, { config: v.config, ecu: v.ecu, cost, result: v.result, races: v.races });
  const parts = [...changedParts(start.config, v.config), ...changedVehicleParts(brief.vehicleBaseline, v.vehicle)].map((p) => p.name).join('、') || '无';
  console.log(`  试了 ${out.tried} 种，${((performance.now() - t0) / 1000).toFixed(0)} 秒。正式验收：${'★'.repeat(g.stars)}${'☆'.repeat(3 - g.stars)}  ¥${cost}（${parts}）`);
  console.log(`  ${summary(brief.goals, v)}`);
  const diff = <T extends object,>(a: T, b: T): Partial<T> => Object.fromEntries(Object.entries(b).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify((a as Record<string, unknown>)[k]))) as Partial<T>;
  console.log(`  解：${JSON.stringify({ config: diff(start.config, v.config), ecu: diff(start.ecu, v.ecu), vehicle: diff(brief.vehicle, v.vehicle) })}`);
  if (g.stars < 1) bad++;
}
for (const w of pool) void w.terminate();
if (bad) {
  console.log(`\n${bad} 单没过`);
  process.exitCode = 1;
}
