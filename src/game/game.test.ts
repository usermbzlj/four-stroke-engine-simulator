import { describe, expect, it } from 'vitest';
import { PRESETS, clampConfig, clampEcu } from '../sim/config';
import { CHASSIS, vehicleCost } from '../sim/vehicle';
import type { RaceResult } from '../sim/race';
import { buildSig, jobSig } from '../state/benchStore';
import { runAcceptance, torqueAt, type AcceptanceResult } from './acceptance';
import { C, JOBS, RACE_CHECKS, grade, jobStart } from './jobs';
import { PARTS, PART_OF, buildCost, changedParts } from './parts';
import { compactRaces } from './session';
import { SOLUTIONS } from './solutions';
import { isUnlocked } from './store';

const base = PRESETS[0]!.engine;

function fakeResult(patch: Partial<AcceptanceResult> = {}): AcceptanceResult {
  return {
    started: true,
    idle: { mean: 1400, min: 1300, max: 1500 },
    blip: null,
    points: [],
    curve: [
      [2000, 20],
      [4000, 24],
      [6000, 18],
    ],
    peakTorque: 24,
    peakTorqueRpm: 4000,
    peakHp: 15.2,
    peakHpRpm: 6000,
    freeRevTime: null,
    pops: 0,
    knockMax: 0,
    knockEvents: 0,
    pistonDamage: 0,
    rodFatigue: 0,
    coolantMax: 90,
    egtMax: 700,
    failure: null,
    failedIn: null,
    simTime: 10,
    ...patch,
  };
}

describe('parts', () => {
  it('maps every engine parameter to exactly one part', () => {
    const keys = Object.keys(base);
    for (const k of keys) expect(PART_OF[k as keyof typeof base], k).toBeDefined();
    const total = PARTS.reduce((n, p) => n + p.keys.length, 0);
    expect(total).toBe(keys.length);
  });

  it('charges a part once however many of its values change, and nothing for going back', () => {
    const cam = { ...base, intakeDuration: 250, exhaustLift: 9 };
    expect(changedParts(base, cam).map((p) => p.id)).toEqual(['cam']);
    expect(buildCost(base, cam)).toBe(PART_OF.intakeDuration.price);
    expect(buildCost(base, { ...cam, intakeDuration: base.intakeDuration, exhaustLift: base.exhaustLift })).toBe(0);
  });
});

describe('grading', () => {
  const job = JOBS.find((j) => j.id === 'courier')!;
  const start = jobStart(job);

  it('needs an acceptance run before test checks count', () => {
    const g = grade(job, { config: start.config, ecu: start.ecu, cost: 0, result: null });
    expect(g.passed).toBe(false);
    expect(g.stars).toBe(0);
    expect(g.rules.some((r) => r.pass === null)).toBe(true);
  });

  it('awards one star for the rules, one for the stretch goal and one for the budget', () => {
    const ctx = { config: start.config, ecu: start.ecu };
    expect(grade(job, { ...ctx, cost: 0, result: fakeResult({ peakHp: 18.2 }) }).stars).toBe(2);
    expect(grade(job, { ...ctx, cost: 0, result: fakeResult({ peakHp: 20.1 }) }).stars).toBe(3);
    expect(grade(job, { ...ctx, cost: 99999, result: fakeResult({ peakHp: 20.1 }) }).stars).toBe(2);
    expect(grade(job, { ...ctx, cost: 0, result: fakeResult({ peakHp: 17 }) }).stars).toBe(0);
  });

  it('fails any job whose engine broke during acceptance', () => {
    const broke = fakeResult({ peakHp: 30, failure: { kind: 'rod', title: '连杆断了', detail: '', rpm: 9000, crankDeg: 360 } });
    expect(grade(job, { config: start.config, ecu: start.ecu, cost: 0, result: broke }).passed).toBe(false);
  });

  it('never displays a miss as the target value', () => {
    const out = C.peakHp(16.2).eval({ config: base, ecu: PRESETS[0]!.ecu, cost: 0, result: fakeResult({ peakHp: 16.17 }) });
    expect(out.pass).toBe(false);
    expect(out.actual).toBe('16.1 hp');
  });

  it('opens jobs one at a time', () => {
    expect(isUnlocked(0, {})).toBe(true);
    expect(isUnlocked(1, {})).toBe(false);
    expect(isUnlocked(1, { [JOBS[0]!.id]: { stars: 1, bestHp: 0, bestCurve: [], cost: 0 } })).toBe(true);
  });
});

describe('torqueAt', () => {
  it('interpolates inside the curve and is zero outside it', () => {
    const c: [number, number][] = [
      [2000, 20],
      [3000, 30],
    ];
    expect(torqueAt(c, 2500)).toBeCloseTo(25);
    expect(torqueAt(c, 1500)).toBe(0);
    expect(torqueAt(c, 3500)).toBe(0);
  });
});

describe('acceptance on the real solver', () => {
  const job = JOBS[0]!;
  const start = jobStart(job);

  it('fails the first job as delivered: it stalls at idle', () => {
    const r = runAcceptance(start.config, start.ecu, job.plan);
    expect(r.started).toBe(true);
    expect(r.failure).toBeNull();
    expect(r.idle?.min ?? 0).toBeLessThan(1100);
    expect(grade(job, { config: start.config, ecu: start.ecu, cost: 0, result: r }).stars).toBe(0);
  }, 30000);

  it('gives the reference fix three stars', () => {
    const fix = SOLUTIONS[job.id]!;
    const config = clampConfig({ ...start.config, ...fix.config });
    const ecu = clampEcu({ ...start.ecu, ...fix.ecu });
    const r = runAcceptance(config, ecu, job.plan);
    expect(r.curve.length).toBeGreaterThan(8);
    expect(r.peakHp).toBeGreaterThan(14);
    expect(grade(job, { config, ecu, cost: buildCost(start.config, config), result: r }).stars).toBe(3);
  }, 30000);

  it('is repeatable', () => {
    const a = runAcceptance(start.config, { ...start.ecu, idleRpm: 1400 }, {});
    const b = runAcceptance(start.config, { ...start.ecu, idleRpm: 1400 }, {});
    expect(a.curve).toEqual(b.curve);
  }, 30000);
});

describe('job catalogue', () => {
  it('has a reference solution for every job and only known parts locked', () => {
    for (const j of JOBS) {
      expect(SOLUTIONS[j.id], j.id).toBeDefined();
      for (const id of j.locked ?? []) expect(PARTS.some((p) => p.id === id)).toBe(true);
    }
  });

  it('tracks vehicle cost, job signature and race outcomes together', () => {
    const job = JOBS.find((j) => j.id === 'topspeed')!;
    const start = jobStart(job);
    const vBase = CHASSIS.street.base;
    const vFairing = { ...vBase, cdA: 0.34 };
    expect(buildSig(start.config, start.ecu)).toBe(buildSig(start.config, start.ecu));
    expect(jobSig(start.config, start.ecu, vBase)).not.toBe(jobSig(start.config, start.ecu, vFairing));

    const cost = buildCost(start.config, start.config) + vehicleCost(vBase, vFairing);
    expect(cost).toBe(800);

    const fakeRace: RaceResult = {
      event: 'top',
      time: 18,
      topKmh: 165,
      trapKmh: 165,
      t60ft: 2.1,
      t100m: 5.5,
      t100kmh: 6.2,
      dnf: null,
      failure: null,
      shifts: [],
      spinTime: 0,
      wheelieTime: 0,
      maxPitch: 0,
      cutTime: 0,
      launchRpm: 5000,
      maxBoostKpa: 0,
      trace: [],
      pistonDamage: 0,
      rodFatigue: 0,
    };
    const tracedRace: RaceResult = { ...fakeRace, trace: [[0, 0, 0, 1000, 0], [1, 10, 40, 6000, 1]] };
    const compacted = compactRaces({ top: tracedRace });
    expect(compacted?.top?.trace).toEqual([]);
    expect(compacted?.top?.topKmh).toBe(165);
    expect(compactRaces({})).toBeUndefined();

    const g = grade(job, {
      config: start.config,
      ecu: start.ecu,
      cost,
      result: fakeResult({ coolantMax: 90 }),
      races: compacted,
    });
    expect(g.passed).toBe(true);
    expect(g.stars).toBe(3);
    expect(RACE_CHECKS.top(165).eval({ config: start.config, ecu: start.ecu, cost, result: fakeResult(), races: compacted }).actual).toBe('165.0 km/h');
    expect(RACE_CHECKS.top(165).eval({ config: start.config, ecu: start.ecu, cost, result: fakeResult() }).actual).toBe('待验收');
  });
});
