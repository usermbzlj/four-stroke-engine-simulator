import { describe, expect, it } from 'vitest';
import { runAcceptance, type AcceptanceResult } from '../game/acceptance';
import { JOBS, jobStart } from '../game/jobs';
import { PRESETS, safeLimiterRpm } from '../sim/config';
import { briefForJob, score, type Goal } from './goals';
import { repair, search } from './search';
import { CHASSIS } from '../sim/vehicle';

const vehicle = CHASSIS.street.base;

const fake = (peakHp: number): AcceptanceResult => ({
  started: true,
  idle: { mean: 1400, min: 1350, max: 1450 },
  blip: null,
  points: [],
  curve: [],
  peakTorque: 0,
  peakTorqueRpm: 0,
  peakHp,
  peakHpRpm: 8000,
  freeRevTime: null,
  pops: 0,
  knockMax: 0,
  knockEvents: 0,
  pistonDamage: 0,
  rodFatigue: 0,
  coolantMax: 85,
  egtMax: 700,
  failure: null,
  failedIn: null,
  simTime: 10,
});

describe('briefs', () => {
  it('turns every measurable job requirement into a goal', () => {
    for (const job of JOBS) {
      const brief = briefForJob(job, jobStart(job).config);
      // survive is implicit; every other check maps to a goal, a lock or a muffler rule.
      const mapped = [...job.rules, job.bonus].filter((c) => c.spec).length;
      expect(mapped, job.id).toBe(job.rules.length);
      expect(brief.goals.some((g) => g.kind === 'budget' && g.value === job.budget)).toBe(true);
      for (const p of job.locked ?? []) expect(brief.parts).not.toContain(p);
    }
  });
});

describe('score', () => {
  const p = PRESETS[0]!;
  const ctx = (hp: number, cost: number) => ({ config: p.engine, ecu: p.ecu, cost, result: fake(hp) });
  const goals: Goal[] = [
    { kind: 'peakHp', value: 20, must: true },
    { kind: 'budget', value: 500, must: false },
  ];

  it('lets a needed part through before the musts are met', () => {
    // 1 hp closer for a part that blows the budget is still progress.
    expect(score(goals, ctx(19, 1500)).loss).toBeLessThan(score(goals, ctx(18, 0)).loss);
  });

  it('never makes meeting a must look worse', () => {
    expect(score(goals, ctx(20.05, 1500)).loss).toBeLessThan(score(goals, ctx(19.95, 1500)).loss);
  });

  it('counts the budget once the musts are met', () => {
    expect(score(goals, ctx(20.5, 0)).loss).toBeLessThan(score(goals, ctx(21, 1500)).loss);
    expect(score(goals, ctx(20.5, 0)).allMet).toBe(true);
    expect(score(goals, ctx(21, 1500)).allMet).toBe(false);
  });

  it('treats a broken engine as worse than any shortfall', () => {
    const broken = { ...fake(30), failure: { kind: 'rod' as const, title: '', detail: '', rpm: 9000, crankDeg: 0 } };
    expect(score(goals, { ...ctx(30, 0), result: broken }).loss).toBeGreaterThan(score(goals, ctx(15, 0)).loss);
  });
});

describe('search', () => {
  it('never fits a limiter above what the parts survive', () => {
    const job = JOBS.find((j) => j.id === 'redline')!;
    const s = jobStart(job);
    const b = repair({ config: s.config, ecu: s.ecu, vehicle, wish: 16000 }, briefForJob(job, s.config));
    expect(b.ecu.limiterRpm).toBeLessThanOrEqual(safeLimiterRpm(b.config));
  });

  it('keeps fixed ECU settings and the octane cap', () => {
    const job = JOBS.find((j) => j.id === 'timid')!;
    const s = jobStart(job);
    const brief = briefForJob(job, s.config);
    const b = repair({ config: s.config, ecu: { ...s.ecu, knockControl: true }, vehicle, wish: s.ecu.limiterRpm }, brief);
    expect(b.ecu.knockControl).toBe(false);
    const c = JOBS.find((j) => j.id === 'courier')!;
    const cs = jobStart(c);
    expect(repair({ config: { ...cs.config, fuelOctane: 100 }, ecu: cs.ecu, vehicle, wish: 9000 }, briefForJob(c, cs.config)).config.fuelOctane).toBe(92);
  });

  it(
    'fixes the stalling job from the customer engine',
    async () => {
      const job = JOBS.find((j) => j.id === 'stall')!;
      const s = jobStart(job);
      const brief = briefForJob(job, s.config);
      const out = await search(
        brief,
        { config: s.config, ecu: s.ecu, vehicle, wish: s.ecu.limiterRpm },
        {
          evaluate: async (jobs) => jobs.map((j) => ({ result: runAcceptance(j.config, j.ecu, j.plan), races: {} })),
          width: 6,
          log: () => {},
          stage: () => {},
          progress: () => {},
          stopped: () => false,
        },
        60,
      );
      expect(out.verified.score.mustMet).toBe(true);
      expect(out.verified.cost).toBe(0);
    },
    120_000,
  );
});
