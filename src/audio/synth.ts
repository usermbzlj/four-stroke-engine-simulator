import { displacementCc, type EngineConfig } from '../sim/config';
import type { EngineCore } from '../sim/core';
import { createRng, type Rng } from '../sim/rng';
import { Biquad, Delay, OnePole, Room } from './dsp';

const RHO_AMB = 1.184;
const INPUT_GAIN = 5.6;
const COMP_THRESHOLD = 0.05;
const COMP_RATIO = 4;
const COMP_MAKEUP = 3.2;

interface MufflerVoice {
  /** Low-pass corner of the can, Hz. */
  corner: number;
  /** Reflection at the pipe's far end (negative: an open/expansion end). */
  endReflection: number;
  gain: number;
}

const MUFFLERS: Record<EngineConfig['muffler'], MufflerVoice> = {
  stock: { corner: 420, endReflection: -0.55, gain: 0.55 },
  sport: { corner: 1400, endReflection: -0.7, gain: 0.85 },
  open: { corner: 6000, endReflection: -0.82, gain: 1.15 },
};

/**
 * Turns the solver's per-sample gas flows into sound. Nothing here is a
 * sample or a loop: the exhaust valve's mass flow drives a waveguide model of
 * the header, whose ends reflect according to the valve lift and the muffler;
 * everything else (induction, knock, valve seating, afterfire) is excited by
 * the same physical quantities the solver computes.
 */
export class EngineSynth {
  volume = 0.8;
  outL = 0;
  outR = 0;

  private readonly fs: number;
  private readonly rng: Rng;
  private flowRef = 0.3;
  private muffler: MufflerVoice = MUFFLERS.stock;
  private headerLen = 0.6;
  private runnerLen = 0.3;

  private readonly exFwd: Delay;
  private readonly exBwd: Delay;
  private readonly exEndLp: OnePole;
  private readonly exValveLp: OnePole;
  private readonly can1: OnePole;
  private readonly can2: OnePole;
  private readonly canBody: Biquad;
  private exPrev = 0;

  private readonly inFwd: Delay;
  private readonly inBwd: Delay;
  private readonly inLp: OnePole;
  private readonly inHp: OnePole;

  private readonly hiss: Biquad;
  private readonly suckHiss: Biquad;
  private readonly block: Biquad;
  private readonly seatRing: Biquad;
  private readonly knockHp: OnePole;
  private pPrev = 101325;

  private popEnv = 0;
  private popThumpPhase = 0;
  private readonly popLp: OnePole;

  private starterPhase = 0;
  private readonly starterLp: OnePole;

  private readonly room: Room;
  private readonly dcL: OnePole;
  private readonly dcR: OnePole;
  private env = 0;
  private readonly attack: number;
  private readonly release: number;

  constructor(sampleRate: number, config: EngineConfig, seed = 7) {
    const fs = sampleRate;
    this.fs = fs;
    this.rng = createRng(seed);
    this.exFwd = new Delay(fs * 0.02);
    this.exBwd = new Delay(fs * 0.02);
    this.exEndLp = new OnePole(3500, fs);
    this.exValveLp = new OnePole(6000, fs);
    this.can1 = new OnePole(420, fs);
    this.can2 = new OnePole(420, fs);
    this.canBody = Biquad.bandpass(160, 2.5, fs);
    this.inFwd = new Delay(fs * 0.01);
    this.inBwd = new Delay(fs * 0.01);
    this.inLp = new OnePole(900, fs);
    this.inHp = new OnePole(35, fs);
    this.hiss = Biquad.bandpass(2600, 0.9, fs);
    this.suckHiss = Biquad.bandpass(1700, 1.2, fs);
    this.block = Biquad.bandpass(1600, 1.4, fs);
    this.seatRing = Biquad.bandpass(3400, 14, fs);
    this.knockHp = new OnePole(3000, fs);
    this.popLp = new OnePole(2400, fs);
    this.starterLp = new OnePole(700, fs);
    this.room = new Room(fs);
    this.dcL = new OnePole(18, fs);
    this.dcR = new OnePole(18, fs);
    this.attack = 1 - Math.exp(-1 / (0.004 * fs));
    this.release = 1 - Math.exp(-1 / (0.18 * fs));
    this.setConfig(config);
  }

  setConfig(c: EngineConfig): void {
    const vd = displacementCc(c) * 1e-6;
    // Roughly the peak blowdown flow of this engine at high speed.
    this.flowRef = RHO_AMB * vd * 900;
    this.muffler = MUFFLERS[c.muffler];
    this.can1.setCutoff(this.muffler.corner, this.fs);
    this.can2.setCutoff(this.muffler.corner * 1.6, this.fs);
    this.headerLen = c.exhaustHeaderLength / 1000;
    this.runnerLen = c.intakeRunnerLength / 1000 + 0.12;
  }

  /** Produce one stereo sample from the solver's current state. */
  tick(core: EngineCore): void {
    const fs = this.fs;
    const noise = this.rng() * 2 - 1;
    const ref = this.flowRef;
    const rps = Math.abs(core.omega) / (2 * Math.PI);

    // ---- exhaust header waveguide ----------------------------------------
    const cEx = Math.sqrt(1.35 * 287 * Math.max(300, core.tEp));
    const exDelay = (this.headerLen / cEx) * fs;
    const src = core.exhaustValveFlow / ref;
    const atEnd = this.exFwd.read(exDelay);
    const atValve = this.exBwd.read(exDelay);
    const endRefl = this.exEndLp.lowpass(atEnd) * this.muffler.endReflection;
    const valveRefl = this.exValveLp.lowpass(atValve) * (0.92 - 0.7 * core.exhaustOpen);
    const turbulence = this.hiss.process(noise) * Math.min(2, Math.abs(src)) * 0.9;
    this.exFwd.write((src + turbulence * 0.25 + valveRefl) * 0.995);
    this.exBwd.write(endRefl * 0.995);
    let tail = atEnd * (1 + this.muffler.endReflection);

    // Afterfire: a flame front in the pipe, out through the can.
    const pop = core.afterfireImpulse;
    if (pop > 0) {
      core.afterfireImpulse = 0;
      this.popEnv = Math.min(3, this.popEnv + Math.sqrt(pop / 40));
      this.popThumpPhase = 0;
    }
    if (this.popEnv > 1e-4) {
      this.popThumpPhase += (2 * Math.PI * 95) / fs;
      const crack = this.popLp.lowpass(noise) * 2.2 + Math.sin(this.popThumpPhase) * 0.8;
      tail += crack * this.popEnv;
      this.popEnv *= Math.exp(-1 / (0.018 * fs));
    }

    const can = this.muffler.corner > 5000 ? tail : this.can2.lowpass(this.can1.lowpass(tail));
    const body = this.muffler.corner < 1000 ? this.canBody.process(tail) * 0.35 : 0;
    // A small source radiates the rate of change of its volume velocity.
    const radiated = (can - this.exPrev) * (fs / 900);
    this.exPrev = can;
    const exhaust = (radiated * 0.55 + can * 0.45 + body) * this.muffler.gain;

    // ---- induction --------------------------------------------------------
    const inDelay = (this.runnerLen / 345) * fs;
    const inSrc = -core.intakeValveFlow / ref;
    const inEnd = this.inFwd.read(inDelay);
    const inValve = this.inBwd.read(inDelay);
    this.inFwd.write(inSrc + inValve * 0.85 * (1 - 0.6 * core.throttleActual));
    this.inBwd.write(-inEnd * 0.7);
    const vacuum = Math.max(0, 1 - core.pPl / 101325);
    const suck = this.suckHiss.process(noise) * (core.throttleFlow / ref) * (0.4 + vacuum * 6);
    const intake = this.inHp.highpass(this.inLp.lowpass(inEnd * 0.3)) * 0.5 + suck * 0.6;

    // ---- block: combustion noise, knock ring, valve seating ---------------
    const dp = (core.measuredPressure - this.pPrev) / 1e5;
    this.pPrev = core.measuredPressure;
    const combustion = this.block.process(dp) * 0.06;
    const knock = this.knockHp.highpass(core.knockSignal / 1e5) * 0.05;
    let seat = 0;
    if (core.valveTick > 0) {
      seat = core.valveTick * 0.5;
      core.valveTick = 0;
    }
    const ticks = this.seatRing.process(seat + noise * 0.0015 * Math.min(1.5, rps / 80));

    // ---- starter motor ----------------------------------------------------
    let starter = 0;
    if (core.controls.starter && !core.failure) {
      const f = 30 + rps * 13;
      this.starterPhase += f / fs;
      if (this.starterPhase > 1) this.starterPhase -= 1;
      const saw = this.starterPhase * 2 - 1;
      starter = this.starterLp.lowpass(saw + noise * 0.3) * 0.12;
    }

    const dry = (exhaust + intake + combustion + knock + ticks + starter) * INPUT_GAIN;
    this.room.process(dry);
    const l = this.dcL.highpass(dry + this.room.outL * 0.35);
    const r = this.dcR.highpass(dry + this.room.outR * 0.35);

    // Test-cell microphone compressor: keeps idle audible without letting
    // a big single at full noise flatten everything.
    const level = Math.max(Math.abs(l), Math.abs(r));
    const coeff = level > this.env ? this.attack : this.release;
    this.env += (level - this.env) * coeff;
    const gain = this.env > COMP_THRESHOLD ? Math.pow(COMP_THRESHOLD / this.env, 1 - 1 / COMP_RATIO) : 1;
    const v = this.volume * gain * COMP_MAKEUP;
    this.outL = Math.tanh(l * v);
    this.outR = Math.tanh(r * v);
  }
}
