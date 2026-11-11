import { EngineCore, type CoreEvent } from '../sim/core';
import { RaceDirector, type RideState } from '../sim/race';
import { VehicleSim } from '../sim/vehicle';
import { copyTrace, takeSnapshot } from '../sim/snapshot';
import type { EngineMessage, EngineSetup, HostCommand } from './protocol';
import { EngineSynth } from './synth';

const SNAPSHOT_HZ = 60;

/**
 * Owns the solver and the synth and speaks the host protocol. The same class
 * runs inside the AudioWorklet and, without sound, on the main thread.
 */
export class EngineRunner {
  readonly core: EngineCore;
  private readonly synth: EngineSynth | null;
  private readonly dt: number;
  private readonly snapshotEvery: number;
  private untilSnapshot = 0;
  private sentTrace = -1;
  private samples = 0;
  private readonly events: CoreEvent[] = [];
  private veh: VehicleSim | null = null;
  private dir: RaceDirector | null = null;
  private playerThrottle = 0;
  private readonly tickEvery: number;
  private untilTick = 0;
  private reported = false;

  constructor(
    sampleRate: number,
    setup: EngineSetup,
    withSound: boolean,
    private readonly post: (msg: EngineMessage) => void,
  ) {
    this.dt = 1 / sampleRate;
    this.snapshotEvery = Math.round(sampleRate / SNAPSHOT_HZ);
    this.core = new EngineCore(setup.config, setup.ecu, setup.bench);
    this.synth = withSound ? new EngineSynth(sampleRate, setup.config) : null;
    this.tickEvery = Math.max(1, Math.round(sampleRate / 1000));
  }

  private detachRide(): void {
    const core = this.core;
    core.extLoad = null;
    core.extCut = false;
    core.extLimit = 0;
    core.alsRequest = false;
    this.veh = null;
    this.dir = null;
    this.reported = false;
    core.controls.throttle = this.playerThrottle;
  }

  private resetRide(): void {
    const v = this.veh;
    if (!v) return;
    this.dir = null;
    this.reported = false;
    v.gear = 0;
    v.clutch = 0;
    v.v = 0;
    v.x = 0;
    v.a = 0;
    v.ww = 0;
    v.pitch = 0;
    v.pitchRate = 0;
    v.slip = 0;
    v.braking = true;
    this.core.extCut = false;
    this.core.extLimit = 0;
    this.core.alsRequest = false;
    this.core.controls.throttle = this.playerThrottle;
  }

  private ride(): RideState | null {
    const v = this.veh;
    if (!v) return null;
    const d = this.dir;
    return {
      phase: d ? d.phase : 'free',
      event: d ? d.event.id : null,
      rider: d ? d.rider : 'auto',
      t: d ? (d.phase === 'stage' ? -d.countdown : d.t) : 0,
      x: v.x,
      kmh: v.v * 3.6,
      gear: v.gear,
      slip: v.slip,
      pitch: v.pitch,
      clutch: v.clutch,
      cut: this.core.extCut,
      frontLoad: v.frontLoad,
      grade: v.grade,
    };
  }

  handle(cmd: HostCommand): void {
    const core = this.core;
    switch (cmd.type) {
      case 'controls':
        if (cmd.controls.throttle !== undefined) this.playerThrottle = cmd.controls.throttle;
        {
          const held = core.controls.throttle;
          Object.assign(core.controls, cmd.controls);
          // The rider robot keeps the grip during a run.
          if (this.dir && this.dir.phase !== 'done' && this.dir.rider === 'auto') core.controls.throttle = held;
        }
        break;
      case 'vehicle':
        if (!cmd.vehicle) {
          this.detachRide();
        } else if (this.veh) {
          this.veh.setConfig(cmd.vehicle);
        } else {
          this.veh = new VehicleSim(cmd.vehicle);
          this.veh.gear = 0;
          this.veh.clutch = 0;
          this.veh.attach(core);
          core.controls.brakeMode = 'off';
        }
        break;
      case 'race':
        if (this.veh) {
          core.controls.brakeMode = 'off';
          this.veh.braking = false;
          this.dir = new RaceDirector(core, this.veh, cmd.event, cmd.rider, cmd.countdown);
          this.reported = false;
        }
        break;
      case 'raceAbort':
        this.resetRide();
        break;
      case 'shift':
        this.dir?.shift(cmd.dir);
        break;
      case 'rebuild':
        this.resetRide();
        core.rebuild(cmd.config);
        this.synth?.setConfig(cmd.config);
        break;
      case 'tune':
        core.tune(cmd.config);
        this.synth?.setConfig(cmd.config);
        break;
      case 'ecu':
        core.setEcu(cmd.ecu);
        break;
      case 'bench':
        core.setBench(cmd.bench);
        break;
      case 'restore':
        this.resetRide();
        core.restore();
        break;
      case 'renew':
        core.renew();
        break;
      case 'volume':
        if (this.synth) this.synth.volume = cmd.volume;
        break;
    }
  }

  /** Advance `n` samples, writing sound into the buffers when there are any. */
  run(n: number, left?: Float32Array, right?: Float32Array): void {
    const core = this.core;
    const synth = this.synth;
    for (let i = 0; i < n; i++) {
      core.step(this.dt);
      if (this.veh && --this.untilTick <= 0) {
        this.untilTick = this.tickEvery;
        this.tickRide();
      }
      if (synth && left && right) {
        synth.tick(core);
        left[i] = synth.outL;
        right[i] = synth.outR;
      }
      if (--this.untilSnapshot <= 0) {
        this.untilSnapshot = this.snapshotEvery;
        this.flush();
      }
    }
    this.samples += n;
  }

  private tickRide(): void {
    const d = this.dir;
    if (!d) return;
    d.input = this.playerThrottle;
    d.tick(this.tickEvery * this.dt);
    if (d.phase === 'done' && !this.reported) {
      this.reported = true;
      const v = this.veh!;
      v.clutch = 0;
      v.gear = 0;
      v.braking = true;
      this.core.controls.throttle = this.playerThrottle;
      this.post({ type: 'race', result: d.result });
    }
  }

  private flush(): void {
    const core = this.core;
    this.post({ type: 'snapshot', snapshot: takeSnapshot(core, this.samples * this.dt, this.ride()) });
    if (core.traceVersion !== this.sentTrace) {
      this.sentTrace = core.traceVersion;
      this.post({ type: 'trace', trace: copyTrace(core.lastTrace) });
    }
    if (core.events.length > 0) {
      this.events.length = 0;
      core.drainEvents(this.events);
      this.post({ type: 'events', events: this.events.slice(0, 40) });
    }
  }
}
