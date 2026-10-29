import { describe, expect, it } from 'vitest';
import { DEFAULT_BENCH, PRESETS, rodBreakRpm, valveFloatRpm, type EcuConfig, type EnginePreset } from '../sim/config';
import { EngineCore } from '../sim/core';
import { assessBuild, reviewFailure, safeLimiter } from './advice';
import { tuneLambda, tuneSpark, type Sample, type TunerPort } from './tuner';

const FS = 48000;

function run(core: EngineCore, seconds: number, each?: () => void): void {
  const n = Math.round(seconds * FS);
  for (let i = 0; i < n; i++) {
    core.step(1 / FS);
    if (each && i % 240 === 0) each();
  }
}

function preset(id: string): EnginePreset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
}

function started(p: EnginePreset, ecu: EcuConfig = p.ecu): EngineCore {
  const core = new EngineCore(p.engine, ecu);
  core.controls.starter = true;
  for (let t = 0; t < 2 && core.rpm < 1100; t += 0.01) run(core, 0.01);
  core.controls.starter = false;
  run(core, 1.5);
  return core;
}

class CorePort implements TunerPort {
  constructor(readonly core: EngineCore) {}
  ecu(): EcuConfig {
    return this.core.ecu;
  }
  setEcu(patch: Partial<EcuConfig>): void {
    this.core.setEcu({ ...this.core.ecu, ...patch });
  }
  hold(rpm: number): void {
    this.core.controls.throttle = 1;
    this.core.controls.brakeMode = 'speed';
    this.core.controls.brakeRpm = rpm;
  }
  measure(settle: number, window: number): Promise<Sample> {
    run(this.core, settle);
    let torque = 0;
    let knock = 0;
    let cycles = 0;
    let last = -1;
    run(this.core, window, () => {
      const c = this.core.lastCycle;
      if (c && c.index !== last) {
        last = c.index;
        torque += c.brakeTorque;
        knock = Math.max(knock, c.knock);
        cycles++;
      }
    });
    return Promise.resolve({ torque: cycles ? torque / cycles : 0, knock, cycles });
  }
  stopped(): boolean {
    return this.core.status !== 'running';
  }
}

describe('build check-up', () => {
  for (const p of PRESETS) {
    it(`${p.id} ships without warnings`, () => {
      const issues = assessBuild(p.engine, p.ecu, DEFAULT_BENCH, p);
      expect(issues.filter((i) => i.level !== 'info')).toEqual([]);
    });
  }

  it('flags a limiter past valve float and offers a limiter and a spring that fix it', () => {
    const p = preset('street-250');
    const ecu = { ...p.ecu, limiterRpm: valveFloatRpm(p.engine) * 1.2 };
    const issue = assessBuild(p.engine, ecu, DEFAULT_BENCH, p).find((i) => i.id === 'float-crash');
    expect(issue?.level).toBe('danger');
    const spring = issue!.fixes.find((f) => f.config?.valveSpringForce)!.config!.valveSpringForce!;
    expect(valveFloatRpm({ ...p.engine, valveSpringForce: spring })).toBeGreaterThan(ecu.limiterRpm);
    const limiter = issue!.fixes.find((f) => f.ecu?.limiterRpm)!.ecu!.limiterRpm!;
    expect(assessBuild(p.engine, { ...ecu, limiterRpm: limiter }, DEFAULT_BENCH, p).some((i) => i.id.startsWith('float'))).toBe(false);
  });

  it('keeps the safe limiter under rod fatigue onset', () => {
    for (const p of PRESETS) {
      expect(safeLimiter(p.engine)).toBeLessThan(rodBreakRpm(p.engine) * Math.sqrt(0.8));
      expect(safeLimiter(p.engine)).toBeLessThan(valveFloatRpm(p.engine));
    }
  });

  it('reviews every failure kind with at least one fix', () => {
    const p = preset('street-250');
    for (const kind of ['rod', 'valve', 'piston', 'headGasket'] as const) {
      const r = reviewFailure({ kind, title: '', detail: '', rpm: 9000, crankDeg: 360 }, p.engine, p.ecu, { coolantConditioner: false, coolantSetpoint: 85 });
      expect(r.fixes.length).toBeGreaterThan(0);
    }
  });
});

describe('hot tuning', () => {
  it('swaps cam and pipes with the engine running without stalling or blowing up the gas state', () => {
    const p = preset('street-250');
    const core = started(p);
    const port = new CorePort(core);
    port.hold(5000);
    run(core, 1);
    core.tune({ ...p.engine, intakeDuration: 280, exhaustHeaderLength: 1100, intakeRunnerLength: 150, muffler: 'open', flywheelInertia: 0.012 });
    run(core, 1.5);
    expect(core.status).toBe('running');
    expect(Number.isFinite(core.p)).toBe(true);
    expect(Math.abs(core.rpm - 5000)).toBeLessThan(300);
  });

  it('falls back to a rebuild for block parts', () => {
    const p = preset('street-250');
    const core = started(p);
    core.tune({ ...p.engine, bore: 80 });
    expect(core.rpm).toBe(0);
  });
});

describe('auto calibration', () => {
  it('finds lost torque on a retarded street engine without hurting it', async () => {
    const p = preset('street-250');
    const core = started(p, { ...p.ecu, advanceOffset: -14 });
    const port = new CorePort(core);
    const r = await tuneSpark(port, () => {});
    expect(r.to).toBeGreaterThan(-10);
    expect(r.after).toBeGreaterThan(r.before);
    expect(core.ecu.knockControl).toBe(true);
    expect(core.pistonDamage).toBeLessThan(0.1);
  });

  it('pulls spark out of a race engine that knocks at the factory map', async () => {
    const p = preset('race-450');
    const core = started(p, { ...p.ecu, advanceOffset: 0 });
    const port = new CorePort(core);
    const r = await tuneSpark(port, () => {});
    expect(r.to).toBeLessThan(-4);
    expect(r.knockLimited).toBe(true);
    expect(core.failure).toBeNull();
  });

  it('settles WOT lambda in the rich best-power band', async () => {
    const p = preset('street-250');
    const core = started(p, { ...p.ecu, wotLambda: 1.05 });
    const r = await tuneLambda(new CorePort(core), () => {});
    expect(r.to).toBeGreaterThanOrEqual(0.82);
    expect(r.to).toBeLessThanOrEqual(0.94);
  });
});
