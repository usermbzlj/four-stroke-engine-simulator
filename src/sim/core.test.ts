import { describe, expect, it } from 'vitest';
import { PRESETS, rodBreakRpm, type EnginePreset } from './config';
import { EngineCore, type CoreEvent } from './core';

const FS = 48000;
const DT = 1 / FS;

function run(core: EngineCore, seconds: number, each?: () => void): void {
  const n = Math.round(seconds * FS);
  for (let i = 0; i < n; i++) {
    core.step(DT);
    if (each && i % 240 === 0) each();
  }
}

function preset(id: string): EnginePreset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
}

/** Crank until it catches, then let it settle at idle. */
function startedEngine(p: EnginePreset): EngineCore {
  const core = new EngineCore(p.engine, p.ecu);
  core.controls.starter = true;
  for (let t = 0; t < 2 && core.rpm < 1100; t += 0.01) run(core, 0.01);
  core.controls.starter = false;
  run(core, 2);
  return core;
}

/** Hold a speed on the brake at WOT and return the mean absorber torque. */
function heldTorque(core: EngineCore, rpm: number): number {
  core.controls.brakeMode = 'speed';
  core.controls.brakeRpm = rpm;
  core.controls.throttle = 1;
  run(core, 1.2);
  let sum = 0;
  let n = 0;
  run(core, 0.4, () => {
    sum += core.lastCycle?.brakeTorque ?? 0;
    n++;
  });
  return sum / n;
}

describe('starting and idle', () => {
  for (const p of PRESETS) {
    it(`${p.id} starts and holds idle`, () => {
      const core = startedEngine(p);
      let min = Infinity;
      let max = -Infinity;
      run(core, 2, () => {
        min = Math.min(min, core.rpm);
        max = Math.max(max, core.rpm);
      });
      expect(core.status).toBe('running');
      expect(min).toBeGreaterThan(p.ecu.idleRpm * 0.75);
      expect(max).toBeLessThan(p.ecu.idleRpm * 1.35);
    });
  }

  it('stalls when the ignition is switched off', () => {
    const core = startedEngine(preset('street-250'));
    core.controls.ignition = false;
    run(core, 3);
    expect(core.rpm).toBeLessThan(50);
    expect(core.status).toBe('off');
  });
});

describe('performance', () => {
  it('a light single revs from idle to near the limiter in well under two seconds', () => {
    const p = preset('street-250');
    const core = startedEngine(p);
    core.controls.throttle = 1;
    let t = 0;
    while (core.rpm < p.ecu.limiterRpm * 0.95 && t < 3) {
      run(core, 0.01);
      t += 0.01;
    }
    expect(t).toBeLessThan(1.5);
  });

  it('makes plausible torque for its displacement', () => {
    const core = startedEngine(preset('street-250'));
    const tq = heldTorque(core, 5000);
    // 250 cc at ~11 bar BMEP is about 22 Nm.
    expect(tq).toBeGreaterThan(15);
    expect(tq).toBeLessThan(30);
  });

  it('has a best-torque spark advance between too little and too much', () => {
    const p = preset('street-250');
    // Knock-proof fuel, so only the combustion phasing matters.
    const core = startedEngine({ ...p, engine: { ...p.engine, fuelOctane: 110 } });
    const offsets = [-20, -10, 0, 10, 20];
    const torques = offsets.map((offset) => {
      core.setEcu({ ...p.ecu, knockControl: false, advanceOffset: offset });
      return heldTorque(core, 5000);
    });
    const best = torques.indexOf(Math.max(...torques));
    expect(best).toBeGreaterThan(0);
    expect(best).toBeLessThan(offsets.length - 1);
  });
});

describe('knock', () => {
  function knockAt(octane: number, cr: number, offset: number): number {
    const p = preset('street-250');
    const core = startedEngine({ ...p, engine: { ...p.engine, fuelOctane: octane, compressionRatio: cr } });
    core.setEcu({ ...p.ecu, knockControl: false, advanceOffset: offset });
    heldTorque(core, 3500);
    let k = 0;
    run(core, 0.5, () => (k = Math.max(k, core.lastCycle?.knock ?? 0)));
    return k;
  }

  it('gets worse with more advance, more compression and lower octane', () => {
    const base = knockAt(95, 10, 0);
    expect(knockAt(95, 10, 12)).toBeGreaterThan(base);
    expect(knockAt(95, 12.5, 0)).toBeGreaterThan(base);
    expect(knockAt(91, 10, 6)).toBeGreaterThan(knockAt(100, 10, 6));
  });

  it('is pulled back by knock control', () => {
    const p = preset('street-250');
    const core = startedEngine({ ...p, engine: { ...p.engine, compressionRatio: 12.5 } });
    core.setEcu({ ...p.ecu, advanceOffset: 10 });
    heldTorque(core, 3500);
    run(core, 1);
    expect(core.knockRetard).toBeGreaterThan(2);
  });
});

describe('failures', () => {
  it('pulls the rod apart above its rated speed', () => {
    const p = preset('street-250');
    const weak = { ...p.engine, rodStrength: 6000 };
    const core = new EngineCore(weak, { ...p.ecu, limiterRpm: 14000 });
    const breakRpm = rodBreakRpm(weak);
    core.omega = ((breakRpm + 300) * 2 * Math.PI) / 60;
    core.controls.throttle = 1;
    const events: CoreEvent[] = [];
    run(core, 0.1);
    core.drainEvents(events);
    expect(core.failure?.kind).toBe('rod');
    expect(core.status).toBe('broken');
    expect(events.some((e) => e.kind === 'failure')).toBe(true);
  });

  it('bends valves well past float', () => {
    const p = preset('street-250');
    const core = new EngineCore({ ...p.engine, valveSpringForce: 150, rodStrength: 40000 }, { ...p.ecu, limiterRpm: 14000 });
    core.omega = ((core.floatLimitRpm * 1.3) * 2 * Math.PI) / 60;
    core.controls.throttle = 1;
    run(core, 0.1);
    expect(core.failure?.kind).toBe('valve');
  });
});

describe('determinism', () => {
  it('reproduces the same run from the same seed', () => {
    const p = preset('thumper-650');
    const a = startedEngine(p);
    const b = startedEngine(p);
    expect(a.rpm).toBe(b.rpm);
    expect(a.p).toBe(b.p);
  });
});
