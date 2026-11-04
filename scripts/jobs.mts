/**
 * Calibrate the work orders: each job's untouched engine should fail, and the
 * reference solution in `SOLUTIONS` should earn at least two stars.
 *
 *   npm run jobs            all jobs
 *   npm run jobs -- octane  jobs whose id contains "octane"
 */
import { runAcceptance } from '../src/game/acceptance.ts';
import { JOBS, grade, jobStart, type Job } from '../src/game/jobs.ts';
import { buildCost, changedParts } from '../src/game/parts.ts';
import { clampConfig, clampEcu } from '../src/sim/config.ts';
import { runRace, type RaceEventId, type RaceResult } from '../src/sim/race.ts';
import { changedVehicleParts, clampVehicle, vehicleCost } from '../src/sim/vehicle.ts';
import { SOLUTIONS } from '../src/game/solutions.ts';

function evaluate(job: Job, label: string, patch: (typeof SOLUTIONS)[string] | undefined): number {
  const start = jobStart(job);
  const config = clampConfig({ ...start.config, ...patch?.config });
  const ecu = clampEcu({ ...start.ecu, ...patch?.ecu });
  const t0 = performance.now();
  const result = runAcceptance(config, ecu, job.plan);
  const base = clampVehicle(job.vehicle);
  const vehicle = clampVehicle({ ...base, ...patch?.vehicle });
  const races: Partial<Record<RaceEventId, RaceResult>> = {};
  for (const ev of job.races ?? []) races[ev] = runRace(config, ecu, vehicle, ev);
  const ms = performance.now() - t0;
  const cost = buildCost(start.config, config) + vehicleCost(base, vehicle);
  const g = grade(job, { config, ecu, cost, result, races });
  const parts = [...changedParts(start.config, config), ...changedVehicleParts(base, vehicle)].map((p) => p.name).join('、') || '无';
  console.log(`  ${label}: ${'★'.repeat(g.stars)}${'☆'.repeat(3 - g.stars)}  花费 ¥${cost}（${parts}）  ${(ms / 1000).toFixed(1)}s`);
  job.rules.forEach((c, i) => console.log(`     ${g.rules[i]!.pass ? '✔' : '✘'} ${c.label} → ${g.rules[i]!.actual}`));
  console.log(`     ${g.bonus.pass ? '✔' : '✘'} [加分] ${job.bonus.label} → ${g.bonus.actual}`);
  console.log(`     曲线 ${result.curve.map(([r, t]) => `${r / 1000}k:${t.toFixed(1)}`).join(' ')}`);
  return g.stars;
}

const filter = process.argv[2];
let bad = 0;
for (const job of JOBS) {
  if (filter && !job.id.includes(filter)) continue;
  console.log(`\n■ ${job.title} (${job.id})  预算 ¥${job.budget}`);
  const s0 = evaluate(job, '原样', undefined);
  const s1 = evaluate(job, '参考解', SOLUTIONS[job.id]);
  if (s0 > 0) {
    console.log('  !! 原样就能过');
    bad++;
  }
  if (s1 < 2) {
    console.log('  !! 参考解不到两星');
    bad++;
  }
}
if (bad) {
  console.log(`\n${bad} 个问题`);
  process.exitCode = 1;
}
