import { describe, expect, it } from 'vitest';
import { medalFor } from '../../game/career';
import { JOBS, jobStart } from '../../game/jobs';
import { runAcceptance } from '../../game/acceptance';
import { PRESETS, flatTable, tableAt, MAP_RPM } from '../../sim/config';
import { CHASSIS } from '../../sim/vehicle';
import { briefForJob, score } from '../goals';
import { costOf, type Tried } from '../search';
import { diagnose, shiftPoints, stallVariants } from './engineer';
import { setColumn, wotFrom } from './tasks';

describe('ECU maps', () => {
  it('interpolates between breakpoints and holds flat outside', () => {
    const t = setColumn(flatTable(), 4000, 10, 0.2);
    expect(tableAt(t, 1, 4000)).toBeCloseTo(10);
    expect(tableAt(t, 1, 3500)).toBeCloseTo(5);
    expect(tableAt(t, 1, 20000)).toBe(0);
    expect(MAP_RPM).toHaveLength(16);
  });
  it('writes full-load calibration into the rows at and above the measured load', () => {
    expect(wotFrom(1)).toBeCloseTo(0.8);
    expect(wotFrom(1.8)).toBeCloseTo(1.6);
  });
});

describe('shift points', () => {
  it('shifts later than the torque peak and never past the limiter', () => {
    const curve: [number, number][] = [
      [2000, 20],
      [4000, 25],
      [6000, 24],
      [8000, 18],
      [9000, 14],
    ];
    const pts = shiftPoints(curve, CHASSIS.street.base, 9200);
    expect(pts).toHaveLength(5);
    for (const p of pts) {
      expect(p).toBeGreaterThan(4000);
      expect(p).toBeLessThanOrEqual(9200 - 150);
    }
  });
});

describe('diagnosis', () => {
  it('sees that the redline job needs parts for the revs, and says which', () => {
    const job = JOBS.find((j) => j.id === 'redline')!;
    const s = jobStart(job);
    const brief = briefForJob(job, s.config);
    const result = runAcceptance(s.config, s.ecu, { ...job.plan, quick: true });
    const b = { config: s.config, ecu: s.ecu, vehicle: brief.vehicle, wish: s.ecu.limiterRpm };
    const t: Tried = { ...b, result, races: {}, cost: costOf(brief, b), score: score(brief.goals, { config: s.config, ecu: s.ecu, cost: 0, result }) };
    const f = diagnose(t, brief);
    expect(f.some((x) => x.id === 'ceiling')).toBe(true);
  }, 60_000);

  it('offers fuel-cut and idle cures for a stall, smallest first', () => {
    const v = stallVariants(PRESETS[0]!.ecu);
    expect(v.length).toBeGreaterThan(4);
    expect(v[0]!.patch.overrunResumeAbove).toBeGreaterThan(PRESETS[0]!.ecu.overrunResumeAbove);
  });
});

describe('medals', () => {
  it('ranks times and top speeds the right way round', () => {
    const base = { trapKmh: 0, t60ft: null, t100m: null, t100kmh: null, dnf: null, failure: null, shifts: [], spinTime: 0, wheelieTime: 0, maxPitch: 0, cutTime: 0, launchRpm: 0, maxBoostKpa: 0, trace: [], pistonDamage: 0, rodFatigue: 0 };
    expect(medalFor('street', { ...base, event: 'drag100', time: 5, topKmh: 100 })).toBe(3);
    expect(medalFor('street', { ...base, event: 'drag100', time: 20, topKmh: 100 })).toBe(0);
    expect(medalFor('street', { ...base, event: 'top', time: 20, topKmh: 150 })).toBe(2);
  });
});
