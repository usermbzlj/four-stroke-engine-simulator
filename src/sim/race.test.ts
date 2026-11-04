import { describe, expect, it } from 'vitest';
import { PRESETS } from './config';
import { runRace } from './race';
import { CHASSIS, clampVehicle, speedAt } from './vehicle';

const [street, race, thumper] = PRESETS as [(typeof PRESETS)[0], (typeof PRESETS)[0], (typeof PRESETS)[0]];

describe('vehicle', () => {
  it('keeps gears in order and mass above the chassis minimum', () => {
    const v = clampVehicle({ chassis: 'race', mass: 50, gears: [2, 2.5, 1, 1, 1, 1] });
    expect(v.mass).toBe(CHASSIS.race.minMass);
    for (let i = 1; i < v.gears.length; i++) expect(v.gears[i]!).toBeLessThan(v.gears[i - 1]!);
  });

  it('turns rpm into road speed through the gearing', () => {
    const v = CHASSIS.street.base;
    expect(speedAt(v, 6, 8000)).toBeGreaterThan(speedAt(v, 1, 8000) * 3);
  });
});

describe('timed runs', () => {
  it('puts a 450 race bike through 0-100 in a believable time', () => {
    const r = runRace(race.engine, race.ecu, CHASSIS.race.base, 'drag100');
    expect(r.dnf).toBeNull();
    expect(r.time!).toBeGreaterThan(3.5);
    expect(r.time!).toBeLessThan(7);
  }, 60_000);

  it('never lifts a kart', () => {
    const r = runRace(race.engine, race.ecu, CHASSIS.kart.base, 'drag100');
    expect(r.maxPitch).toBe(0);
  }, 60_000);

  it('is quicker with a quick-shifter', () => {
    const a = runRace(street.engine, street.ecu, CHASSIS.street.base, 'drag100');
    const b = runRace(street.engine, street.ecu, { ...CHASSIS.street.base, quickshifter: true }, 'drag100');
    expect(b.time!).toBeLessThan(a.time!);
  }, 60_000);

  it('runs out of revs in top gear until the gearing is made taller', () => {
    const a = runRace(thumper.engine, thumper.ecu, CHASSIS.street.base, 'overtake');
    expect(a.dnf).toBe('limiter');
    const b = runRace(thumper.engine, thumper.ecu, { ...CHASSIS.street.base, finalDrive: 2.5 }, 'overtake');
    expect(b.dnf).toBeNull();
  }, 60_000);

  it('holds the front down with wheelie control on sticky tyres', () => {
    const v = { ...CHASSIS.race.base, tireGrip: 1.6 };
    const a = runRace(race.engine, race.ecu, v, 'drag100');
    const b = runRace(race.engine, { ...race.ecu, wheelieControl: true }, v, 'drag100');
    expect(a.wheelieTime).toBeGreaterThan(0.1);
    expect(b.maxPitch).toBeLessThan(a.maxPitch);
  }, 60_000);
});
