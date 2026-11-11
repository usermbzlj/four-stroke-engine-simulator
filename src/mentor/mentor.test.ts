import { describe, expect, it } from 'vitest';
import { EngineRunner } from '../audio/runner';
import { PART_OF } from '../game/parts';
import { useCareer } from '../game/career';
import { useGame } from '../game/store';
import { DEFAULT_BENCH, PRESETS, rodBreakRpm, valveFloatRpm, type EcuConfig, type EnginePreset } from '../sim/config';
import { EngineCore } from '../sim/core';
import { CHASSIS, VEHICLE_PARTS } from '../sim/vehicle';
import { useBench } from '../state/benchStore';
import { assessBuild, reviewFailure, safeLimiter } from './advice';
import { isTorqueParam, noteForParam } from './params';
import { draftNow, lockedParts, lockedVehicleParts, undoQuest, useQuest } from './quest';
import { tuneLambda, tuneSpark, type Sample, type TunerPort } from './tuner';
import { pick } from './voice';

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

describe('voice', () => {
  it('can pick every line in a two-line pool', () => {
    const pool = ['这人没救了。来，零件咱们批量订吧，有折扣。', '零件商刚给我发消息，问你是不是新开了个厂。'];
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(pick(pool));
    expect(seen.size).toBe(2);
    expect(seen.has(pool[0]!)).toBe(true);
  });
});

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

describe('params & runner safety', () => {
  it('explains every engine and vehicle part parameter and filters non-torque knobs', () => {
    for (const k of Object.keys(PART_OF)) {
      expect(noteForParam(`config.${k}`), `config.${k}`).toBeDefined();
    }
    for (const vp of VEHICLE_PARTS) {
      for (const k of vp.keys) {
        expect(noteForParam(`vehicle.${String(k)}`), `vehicle.${String(k)}`).toBeDefined();
        expect(isTorqueParam(`vehicle.${String(k)}`)).toBe(false);
      }
    }
    expect(noteForParam('vehicle.gear3')).toBeDefined();
    expect(noteForParam('ecu.shiftRpm2')).toBeDefined();
    expect(isTorqueParam('ecu.shiftRpm0')).toBe(false);
    expect(isTorqueParam('ecu.crankLambda')).toBe(false);
    expect(isTorqueParam('ecu.advanceOffset')).toBe(true);
    expect(isTorqueParam('config.turboSize')).toBe(true);
  });

  it('resets active track ride cleanly on engine rebuild, restore, or raceAbort', () => {
    const p = preset('street-250');
    const seen: { ride: { phase: string; gear: number; kmh: number } | null } = { ride: null };
    const runner = new EngineRunner(24000, { config: p.engine, ecu: p.ecu, bench: DEFAULT_BENCH }, false, (msg) => {
      if (msg.type === 'snapshot' && msg.snapshot.ride) seen.ride = msg.snapshot.ride;
    });
    const startEngine = (): void => {
      runner.handle({ type: 'controls', controls: { starter: true } });
      for (let i = 0; i < 40 && runner.core.rpm < 1100; i++) runner.run(240);
      runner.handle({ type: 'controls', controls: { starter: false } });
      runner.run(12000);
    };
    startEngine();
    runner.handle({ type: 'vehicle', vehicle: CHASSIS.street.base });
    runner.handle({ type: 'race', event: 'drag100', rider: 'auto', countdown: 0 });
    runner.run(24000);
    expect(seen.ride?.phase).toBe('run');
    expect(seen.ride?.kmh).toBeGreaterThan(1);
    runner.handle({ type: 'rebuild', config: p.engine });
    runner.run(500);
    expect(seen.ride?.phase).toBe('free');
    expect(seen.ride?.gear).toBe(0);
    expect(seen.ride?.kmh).toBe(0);

    startEngine();
    runner.handle({ type: 'race', event: 'drag100', rider: 'auto', countdown: 0 });
    runner.run(24000);
    expect(seen.ride?.phase).toBe('run');
    expect(seen.ride?.kmh).toBeGreaterThan(1);
    runner.handle({ type: 'raceAbort' });
    runner.run(500);
    expect(seen.ride?.phase).toBe('free');
    expect(seen.ride?.gear).toBe(0);
    expect(seen.ride?.kmh).toBe(0);
  });

  it('respects sandbox reputation locks inside quest drafts and lock lists', () => {
    const hadStorage = 'localStorage' in globalThis;
    if (!hadStorage) {
      const m = new Map<string, string>();
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) },
      });
    }
    const prevMode = useGame.getState().mode;
    const prevJob = useGame.getState().jobId;
    const prevRep = useCareer.getState().rep;
    try {
      useGame.setState({ mode: 'sandbox', jobId: null });
      useBench.getState().loadPreset('street-250');
      useCareer.setState({ rep: 0 });
      expect(lockedParts()).toContain('turbo');
      expect(lockedParts()).toContain('vvt');
      expect(lockedVehicleParts()).toContain('gearbox');
      const d0 = draftNow();
      expect(d0.parts).not.toContain('turbo');
      expect(d0.vehicleParts).not.toContain('gearbox');

      useCareer.setState({ rep: 120 });
      expect(lockedParts()).toEqual([]);
      expect(lockedVehicleParts()).toEqual([]);

      // Restoring a quest snapshot whose EngineConfig matches current values keeps b.config untouched
      const beforeCfg = useBench.getState().config;
      const beforeEcu = useBench.getState().ecu;
      useQuest.setState({
        undo: {
          config: { ...beforeCfg },
          ecu: { ...beforeEcu, idleRpm: beforeEcu.idleRpm + 100 },
          vehicle: useBench.getState().vehicle,
        },
      });
      undoQuest();
      expect(useBench.getState().config).toBe(beforeCfg);
      expect(useBench.getState().ecu.idleRpm).toBe(beforeEcu.idleRpm + 100);
    } finally {
      useQuest.setState({ undo: null });
      useCareer.setState({ rep: prevRep });
      useGame.setState({ mode: prevMode, jobId: prevJob });
    }
  });
});
