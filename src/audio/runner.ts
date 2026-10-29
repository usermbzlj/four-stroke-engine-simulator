import { EngineCore, type CoreEvent } from '../sim/core';
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
  }

  handle(cmd: HostCommand): void {
    const core = this.core;
    switch (cmd.type) {
      case 'controls':
        Object.assign(core.controls, cmd.controls);
        break;
      case 'rebuild':
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
        core.restore();
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

  private flush(): void {
    const core = this.core;
    this.post({ type: 'snapshot', snapshot: takeSnapshot(core, this.samples * this.dt) });
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
