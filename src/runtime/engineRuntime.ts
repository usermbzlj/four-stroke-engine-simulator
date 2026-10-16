/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The live engine, with no framework attached.
 *
 * `EngineRuntime` owns the physics state, steps it on a fixed clock, runs the
 * dyno controller when a pull is in progress, and publishes a small immutable
 * snapshot for the UI. React reads it through `useSyncExternalStore`; the
 * headless playtest and the tests drive it directly with `advance()`.
 *
 * Time is simulated, not wall-clock: a frame hands `advance` the elapsed time,
 * which is consumed in `SIM.fixedDt` steps. Pausing the tab therefore pauses
 * contracts and the limiter oscillation instead of fast-forwarding them.
 */

import { SIM } from '../engine/constants';
import { COMPONENT_LABELS } from '../engine/labels';
import {
  createDynoSession,
  finishDyno,
  tickDyno,
  type DynoSession,
} from '../engine/dyno';
import { resolveBuild, SLOT_REFRESHES } from '../engine/parts';
import { knockLimitAdvance, torqueToPowerHp } from '../engine/physics';
import {
  INITIAL_WEAR,
  createEngineState,
  stepEngine,
  type EngineEvent,
  type EngineSimState,
  type StepDerived,
} from '../engine/simulation';
import { sampleTune, tuneBreakpoints } from '../engine/tune';
import {
  EngineState,
  StrokeType,
  type ComponentWear,
  type DynoResult,
  type EngineBuild,
  type EngineControls,
  type EngineParameters,
  type EngineSpec,
  type HudState,
  type LogLevel,
  type PartSlot,
  type TelemetryPoint,
  type TuneMap,
} from '../types';
import { NULL_AUDIO, type AudioSink } from './audioSink';
import { InputIntent, advancePedal } from './intent';
import { TelemetryTracker, createTelemetryPoint } from './telemetry';

/** Seconds of simulated time between UI snapshots of the fast-changing values. */
const TELEMETRY_INTERVAL = 0.095;
/** Safety cap on steps per frame so a slow frame cannot snowball. */
const MAX_STEPS_PER_FRAME = Math.ceil(SIM.maxFrameDt / SIM.fixedDt);

export const INITIAL_CONTROLS: EngineControls = {
  load: 0.8,
  oilLevel: 95,
  coolantPump: 0.6,
  choke: 0,
  hasLimiter: true,
  limiterRpm: 6800,
};

const INITIAL_HUD: HudState = {
  pedal: 0,
  butterfly: 0,
  idleBypass: 0,
  ignition: 0,
  lambda: 1,
  knockLimit: 0,
  cranking: false,
  ignitionCut: false,
  nitrous: false,
};

export interface DynoLivePoint {
  rpm: number;
  torque: number;
  power: number;
}

export interface DynoUiState {
  running: boolean;
  progress: number;
  /** Points measured so far, so the curve can draw itself live. */
  live: DynoLivePoint[];
  result: DynoResult | null;
}

const IDLE_DYNO: DynoUiState = { running: false, progress: 0, live: [], result: null };

/** Everything the UI renders from. Replaced (never mutated) when something changes. */
export interface RuntimeSnapshot {
  engineState: EngineState;
  stroke: StrokeType;
  spec: EngineSpec;
  controls: EngineControls;
  wear: ComponentWear;
  liveStats: TelemetryPoint;
  history: TelemetryPoint[];
  hud: HudState;
  dyno: DynoUiState;
}

export interface TickContext {
  /** Simulated seconds covered by this frame. */
  dt: number;
  /** Simulated clock in milliseconds. */
  clockMs: number;
  rpm: number;
  /** Air actually admitted (pedal or idle bypass), 0-1. */
  throttle: number;
  pedal: number;
  cranking: boolean;
  coolantTemp: number;
  wear: ComponentWear;
  engineState: EngineState;
  runningHoursDelta: number;
}

export type RuntimeEvent =
  | { type: 'log'; level: LogLevel; message: string }
  | { type: 'tick'; ctx: TickContext }
  | { type: 'dynoComplete'; result: DynoResult }
  | { type: 'catastrophe'; state: EngineState };

export interface EngineRuntimeOptions {
  build: EngineBuild;
  tune: TuneMap;
  audio?: AudioSink;
  rng?: () => number;
}

const isDead = (s: EngineState): boolean => s === EngineState.EXPLODED || s === EngineState.SEIZED;

function livePointsOf(session: DynoSession): DynoLivePoint[] {
  const span = session.binHi - session.binLo;
  const points: DynoLivePoint[] = [];
  session.bins.forEach((bin, i) => {
    if (bin.count === 0) return;
    const rpm = session.binLo + (span * (i + 0.5)) / session.bins.length;
    const torque = bin.sum / bin.count;
    points.push({ rpm, torque, power: torqueToPowerHp(torque, rpm) });
  });
  return points;
}

export class EngineRuntime {
  /** Operator intent; write to it from input handlers. */
  readonly input = new InputIntent();

  private state: EngineSimState = createEngineState(40);
  private spec: EngineSpec;
  private tune: TuneMap;
  private breakpoints: number[];
  private controls: EngineControls;

  private readonly audio: AudioSink;
  private readonly rng: () => number;
  private readonly telemetry = new TelemetryTracker();

  private pedal = 0;
  private clockMs = 0;
  private accumulator = 0;
  private sinceTelemetry = 0;

  private dynoSession: DynoSession | null = null;
  private dynoCommand: { throttle: number; load: number } | null = null;

  private snapshot: RuntimeSnapshot;
  private dirty = false;
  private readonly subscribers = new Set<() => void>();
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();

  private frameHandle = 0;
  private lastFrameTime = 0;

  constructor(options: EngineRuntimeOptions) {
    this.audio = options.audio ?? NULL_AUDIO;
    this.rng = options.rng ?? Math.random;
    this.spec = resolveBuild(options.build);
    this.tune = options.tune;
    this.breakpoints = tuneBreakpoints(this.spec);
    this.controls = { ...INITIAL_CONTROLS, limiterRpm: this.spec.redlineRpm };
    this.telemetry.reset(this.state.coolantTemp);

    this.snapshot = {
      engineState: this.state.engineState,
      stroke: StrokeType.INTAKE,
      spec: this.spec,
      controls: this.controls,
      wear: this.state.wear,
      liveStats: createTelemetryPoint(),
      history: [],
      hud: INITIAL_HUD,
      dyno: IDLE_DYNO,
    };
  }

  // ---- Observation --------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  readonly getSnapshot = (): RuntimeSnapshot => this.snapshot;

  /** Domain events (logs, per-frame ticks, dyno results, catastrophes). */
  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Live crank angle in radians (0..4π). Read it from a render loop, not React state. */
  getCrankAngle(): number {
    return this.state.angle;
  }

  /** The raw physics state, for tests and tooling. */
  getPhysicsState(): Readonly<EngineSimState> {
    return this.state;
  }

  getClockMs(): number {
    return this.clockMs;
  }

  /** Overwrite parts of the physics state. For tests and tooling only. */
  patchPhysics(patch: Partial<EngineSimState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.engineState !== undefined) this.patch({ engineState: patch.engineState });
    if (patch.wear !== undefined) this.patch({ wear: patch.wear });
    this.flush();
  }

  // ---- Loop ---------------------------------------------------------------

  /** Drive `advance` from `requestAnimationFrame`. */
  start(): void {
    if (this.frameHandle || typeof requestAnimationFrame === 'undefined') return;
    this.lastFrameTime = 0;
    const frame = (time: number) => {
      const dt = this.lastFrameTime ? (time - this.lastFrameTime) / 1000 : 0;
      this.lastFrameTime = time;
      this.advance(dt);
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  /** Consume `frameDt` seconds of wall-clock time as fixed physics steps. */
  advance(frameDt: number): void {
    this.accumulator += Math.min(SIM.maxFrameDt, Math.max(0, frameDt));

    let steps = 0;
    let simulated = 0;
    let last: { derived: StepDerived; params: EngineParameters } | null = null;

    while (this.accumulator >= SIM.fixedDt && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= SIM.fixedDt;
      last = this.step(SIM.fixedDt);
      simulated += SIM.fixedDt;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    if (!last) return;

    const { state } = this;
    this.audio.update({
      rpm: state.rpm,
      throttle: last.derived.effectiveThrottle,
      cranking: state.cranking,
      running: state.engineState === EngineState.RUNNING,
      damage: 100 - state.wear.conrodBearings,
      coolantTemp: state.coolantTemp,
      fanLevel: last.params.coolantPump,
    });

    this.emit({
      type: 'tick',
      ctx: {
        dt: simulated,
        clockMs: this.clockMs,
        rpm: state.rpm,
        throttle: last.derived.effectiveThrottle,
        pedal: this.pedal,
        cranking: state.cranking,
        coolantTemp: state.coolantTemp,
        wear: state.wear,
        engineState: state.engineState,
        runningHoursDelta: state.engineState === EngineState.RUNNING && state.rpm > 100 ? simulated / 3600 : 0,
      },
    });

    this.sinceTelemetry += simulated;
    if (this.sinceTelemetry > TELEMETRY_INTERVAL) {
      this.publishTelemetry(this.sinceTelemetry, last.derived, last.params);
      this.sinceTelemetry = 0;
    }
    this.flush();
  }

  private step(dt: number): { derived: StepDerived; params: EngineParameters } {
    const intent = this.input.current;
    const state = this.state;
    const session = this.dynoSession;

    // The starter is momentary, so it is read straight from intent.
    const wantStarter = intent.starter && !isDead(state.engineState) && !session;
    if (wantStarter !== state.cranking) {
      state.cranking = wantStarter;
      if (wantStarter && (state.engineState === EngineState.OFF || state.engineState === EngineState.STALLED)) {
        state.ignitionCut = false;
        state.engineState = EngineState.STARTING;
        this.patch({ engineState: EngineState.STARTING });
      }
    }

    this.pedal = advancePedal(this.pedal, intent, dt);
    const command = this.dynoCommand;
    const params: EngineParameters = {
      ...this.controls,
      throttle: command ? command.throttle : this.pedal,
      load: command ? command.load : this.controls.load,
      // A dyno pull is a baseline measurement: no laughing gas, no choke.
      choke: command ? 0 : this.controls.choke,
      hasNitrous: command ? false : intent.nitrous && state.engineState === EngineState.RUNNING,
    };

    this.clockMs += dt * 1000;
    const result = stepEngine({
      state,
      params,
      spec: this.spec,
      tune: this.tune,
      dt,
      timestampMs: this.clockMs,
      rng: this.rng,
    });
    this.state = result.state;

    for (const event of result.events) this.handleEvent(event);
    this.telemetry.observe(dt, result.derived);
    if (session) this.stepDyno(session, result.derived, dt);

    return { derived: result.derived, params };
  }

  private stepDyno(session: DynoSession, derived: StepDerived, dt: number): void {
    const tick = tickDyno(session, { state: this.state, derived, spec: this.spec, dt });

    if (tick.done) {
      this.dynoSession = null;
      this.dynoCommand = null;
      const result = finishDyno(tick.session, this.spec, this.state.wear);
      this.patch({ dyno: { running: false, progress: 1, live: [], result } });
      this.emit({ type: 'dynoComplete', result });
      return;
    }

    this.dynoSession = tick.session;
    this.dynoCommand = tick.command;
    const shown = this.snapshot.dyno;
    if (Math.abs(shown.progress - tick.progress) >= 0.01 || shown.live.length === 0) {
      this.patch({
        dyno: { running: true, progress: tick.progress, live: livePointsOf(tick.session), result: shown.result },
      });
    }
  }

  private handleEvent(event: EngineEvent): void {
    switch (event.kind) {
      case 'stateChange':
        this.patch({ engineState: event.to });
        break;
      case 'log':
        this.log(event.level, event.message);
        break;
      case 'spark':
        this.audio.spark();
        break;
      case 'combustion':
        this.audio.combustion(event.rpm, event.throttle, event.knocking);
        break;
      case 'backfire':
        this.audio.backfire();
        break;
      case 'explosion':
        this.audio.explosion();
        break;
      case 'failure':
        this.patch({ engineState: event.state });
        this.emit({ type: 'catastrophe', state: event.state });
        break;
    }
  }

  private publishTelemetry(sampleDt: number, derived: StepDerived, params: EngineParameters): void {
    const { state, spec } = this;
    const liveStats = this.telemetry.sample(sampleDt, state, derived, spec, params);
    this.patch({
      liveStats,
      history: this.telemetry.history,
      stroke: derived.stroke,
      wear: state.wear,
      hud: {
        pedal: this.pedal,
        butterfly: state.actualThrottle,
        idleBypass: derived.idleBypass,
        ignition: derived.tune.ignition,
        lambda: derived.tune.lambda,
        knockLimit: knockLimitAdvance({
          spec,
          lambda: derived.tune.lambda,
          rpm: state.rpm,
          cylinderTemp: state.coolantTemp,
        }),
        cranking: state.cranking,
        ignitionCut: state.ignitionCut,
        nitrous: params.hasNitrous,
      },
    });
  }

  // ---- Configuration ------------------------------------------------------

  /** Install a new build. Call {@link refit} as well when parts physically changed. */
  setBuild(build: EngineBuild): void {
    const spec = resolveBuild(build);
    this.spec = spec;
    this.breakpoints = tuneBreakpoints(spec);
    // Never let a stale limiter sit above a downgraded engine.
    if (this.controls.limiterRpm > spec.destructRpm) {
      this.controls = { ...this.controls, limiterRpm: spec.redlineRpm };
      this.patch({ controls: this.controls });
    }
    this.patch({ spec });
    this.flush();
  }

  setTune(tune: TuneMap): void {
    this.tune = tune;
  }

  setControls(patch: Partial<EngineControls>): void {
    this.controls = { ...this.controls, ...patch };
    this.patch({ controls: this.controls });
    this.flush();
  }

  resetControls(): void {
    this.controls = { ...INITIAL_CONTROLS, limiterRpm: this.spec.redlineRpm };
    this.patch({ controls: this.controls });
    this.log('info', '辅助控制（负载 / 机油 / 冷却 / 限速）已恢复默认。');
    this.flush();
  }

  toggleChoke(): void {
    const choke = this.controls.choke > 0.05 ? 0 : 0.8;
    this.controls = { ...this.controls, choke };
    this.patch({ controls: this.controls });
    this.log('info', choke > 0 ? '阻风门已拉起（冷车加浓）。' : '阻风门已关闭。');
    this.flush();
  }

  toggleCutoff(): void {
    const cut = !this.state.ignitionCut;
    this.state.ignitionCut = cut;
    if (cut && this.state.engineState === EngineState.RUNNING) {
      this.state.engineState = EngineState.STALLED;
      this.state.rpm = 0;
      this.patch({ engineState: EngineState.STALLED });
      this.log('warning', '切断点火系统，发动机熄火。 (IGNITION OFF)');
    } else {
      this.log('info', cut ? '点火系统已切断。' : '点火系统已恢复，可以起动。');
    }
    this.flush();
  }

  manualSpark(): void {
    const { state } = this;
    if (isDead(state.engineState)) return;
    this.audio.spark();

    if (state.rpm > 100 && this.pedal > 0.05) {
      const sample = sampleTune(this.tune, this.breakpoints, state.rpm);
      const knocking = state.wear.conrodBearings < 30 || sample.ignition > 30;
      this.audio.combustion(state.rpm, this.pedal, knocking);
      if (state.engineState === EngineState.STALLED || state.engineState === EngineState.OFF) {
        state.engineState = EngineState.RUNNING;
        this.patch({ engineState: EngineState.RUNNING });
        this.log('success', '强制跳火点着了！发动机进入运转状态。');
        this.flush();
        return;
      }
    }
    this.log('info', '外部强制高压脉冲跳火。');
  }

  /** Hand-turn the crank to `angle` radians (dragging it on the cross-section). */
  crankDrag(angle: number): void {
    this.state.angle = angle;
    const { engineState } = this.state;
    if (engineState === EngineState.OFF || engineState === EngineState.STALLED) this.state.rpm = 90;
  }

  // ---- Dyno ---------------------------------------------------------------

  isDynoRunning(): boolean {
    return this.dynoSession !== null;
  }

  startDyno(): void {
    if (this.dynoSession) {
      this.log('info', '拉力测试已在进行中。');
      return;
    }
    const { engineState, wear } = this.state;
    if (isDead(engineState)) {
      this.log('error', '发动机已损毁，无法上测功台。请先大修。');
      return;
    }
    if (engineState !== EngineState.RUNNING) {
      this.log('error', '测功台需要发动机处于运转状态。请先按住 S 起动。');
      return;
    }
    this.dynoSession = createDynoSession(this.spec, wear);
    this.dynoCommand = { throttle: 1, load: 0 };
    this.patch({ dyno: { running: true, progress: 0, live: [], result: null } });
    this.log('info', `测功台接合：全油门加载扫描至 ${this.spec.redlineRpm} rpm，全程会计入部件损耗。`);
    this.flush();
  }

  abortDyno(): void {
    const session = this.dynoSession;
    if (!session) return;
    this.dynoSession = null;
    this.dynoCommand = null;
    const result = finishDyno({ ...session, aborted: '操作员手动中止' }, this.spec, this.state.wear);
    this.patch({ dyno: { running: false, progress: 0, live: [], result } });
    this.log('warning', '拉力测试已手动中止。');
    this.flush();
  }

  clearDynoResult(): void {
    this.patch({ dyno: { ...this.snapshot.dyno, result: null, progress: 0 } });
    this.flush();
  }

  // ---- Maintenance --------------------------------------------------------

  repairComponent(key: keyof ComponentWear): void {
    if (this.state.engineState === EngineState.EXPLODED) {
      this.log('error', '缸体已碎裂，无法局部修理，必须整机大修。');
      return;
    }
    this.state.wear = { ...this.state.wear, [key]: 100 };
    this.patch({ wear: this.state.wear });
    this.log('success', `已更换并翻新组件：${COMPONENT_LABELS[key]}。`);
    this.flush();
  }

  flushOil(): void {
    this.controls = { ...this.controls, oilLevel: 100 };
    this.patch({ controls: this.controls });
    this.log('success', '已放净旧油并注满全合成润滑油。');
    this.flush();
  }

  completeRebuild(): void {
    this.state = createEngineState(40, INITIAL_WEAR);
    this.controls = { ...this.controls, oilLevel: 100 };
    this.cancelDyno();
    this.resetTelemetry(40);
    this.patch({ wear: INITIAL_WEAR, controls: this.controls, engineState: EngineState.OFF });
    this.log('success', '🛠 整机大修完成：缸体重镗、全套新件装配到位，可以重新起动了。');
    this.flush();
  }

  /**
   * A part was re-fitted: stop the engine and renew the components that slot
   * replaces. A new block is a whole new engine, so everything resets.
   */
  refit(slot: PartSlot | 'block', blockChanged: boolean): void {
    this.cancelDyno();

    let wear: ComponentWear;
    let coolant: number;
    if (blockChanged) {
      wear = INITIAL_WEAR;
      coolant = 40;
    } else {
      const refreshed = slot === 'block' ? [] : (SLOT_REFRESHES[slot] ?? []);
      wear = { ...this.state.wear };
      for (const key of refreshed) wear[key] = 100;
      coolant = this.state.coolantTemp;
    }
    this.state = createEngineState(coolant, wear);
    this.resetTelemetry(coolant);
    this.patch({ wear: this.state.wear, engineState: EngineState.OFF });
    this.flush();
  }

  addLog(level: LogLevel, message: string): void {
    this.log(level, message);
  }

  // ---- Internals ----------------------------------------------------------

  private cancelDyno(): void {
    this.dynoSession = null;
    this.dynoCommand = null;
    this.patch({ dyno: IDLE_DYNO });
  }

  private resetTelemetry(coolantTemp: number): void {
    this.telemetry.reset(coolantTemp);
    this.pedal = 0;
    this.sinceTelemetry = 0;
    this.patch({ liveStats: this.telemetry.stats, history: [] });
  }

  private log(level: LogLevel, message: string): void {
    this.emit({ type: 'log', level, message });
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private patch(next: Partial<RuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    this.dirty = true;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const subscriber of this.subscribers) subscriber();
  }
}
