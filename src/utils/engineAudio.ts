/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Web Audio synthesis for the engine.
 *
 * Sustained layers (body rumble, induction rush, starter whine, fan) run as
 * always-on nodes whose parameters follow the engine; the exhaust pulse train
 * is scheduled a little ahead of the clock. One-shot events (spark, combustion
 * crack, backfire, explosion) are short-lived oscillators.
 *
 * The context is created lazily on the first user gesture, as browsers require.
 */

import type { AudioFrame, AudioSink } from '../runtime/audioSink';
import {
  airRushGain,
  blockFilterFreq,
  bodyToneFreq,
  bodyToneGain,
  bodyToneHarmonicFreq,
  combustionShape,
  exhaustPulseShape,
  fanGain,
  firingPeriod,
  makeDistortionCurve,
  starterFreq,
} from './engineAudioParams';

/** Combustion cracks closer together than this are merged: they are inaudible as separate hits. */
const MIN_COMBUSTION_GAP_S = 0.04;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  blockFilter: BiquadFilterNode;
  cylinderOsc1: OscillatorNode;
  cylinderOsc2: OscillatorNode;
  cylinderGain: GainNode;
  airGain: GainNode;
  fanGain: GainNode;
  starterOsc: OscillatorNode;
  starterGain: GainNode;
  noise: AudioBuffer;
  crunch: WaveShaperNode['curve'];
  heavyCrunch: WaveShaperNode['curve'];
}

class EngineSoundManager implements AudioSink {
  private graph: Graph | null = null;
  private muted = false;
  private volume = 0.5;
  private nextPulseTime = 0;
  private lastCombustionTime = 0;

  /** Create the audio graph. Must be called from a user gesture the first time. */
  init(): void {
    if (this.graph || typeof AudioContext === 'undefined') return;
    try {
      this.graph = this.build(new AudioContext());
    } catch (error) {
      console.warn('Failed to initialise Web Audio:', error);
    }
  }

  private build(ctx: AudioContext): Graph {
    const t = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(this.muted ? 0 : this.volume, t);
    master.connect(ctx.destination);

    // Muffles the raw waves the way an engine block does.
    const blockFilter = ctx.createBiquadFilter();
    blockFilter.type = 'lowpass';
    blockFilter.frequency.setValueAtTime(450, t);
    blockFilter.connect(master);

    // One shared second of white noise, looped by every noise layer.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

    const noiseLayer = (type: BiquadFilterType, frequency: number, q: number, destination: AudioNode): GainNode => {
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(frequency, t);
      filter.Q.setValueAtTime(q, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      source.connect(filter).connect(gain).connect(destination);
      source.start();
      return gain;
    };

    // Cylinder body tone: low sawtooth + triangle an octave up.
    const cylinderGain = ctx.createGain();
    cylinderGain.gain.setValueAtTime(0, t);
    cylinderGain.connect(blockFilter);
    const oscillator = (type: OscillatorType, frequency: number, destination: AudioNode): OscillatorNode => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, t);
      osc.connect(destination);
      osc.start();
      return osc;
    };
    const cylinderOsc1 = oscillator('sawtooth', 10, cylinderGain);
    const cylinderOsc2 = oscillator('triangle', 20, cylinderGain);

    // Starter whine bypasses the block filter so it stays bright.
    const starterGain = ctx.createGain();
    starterGain.gain.setValueAtTime(0, t);
    starterGain.connect(master);
    const starterOsc = oscillator('sine', 180, starterGain);
    oscillator('triangle', 90, starterGain);

    return {
      ctx,
      master,
      blockFilter,
      cylinderOsc1,
      cylinderOsc2,
      cylinderGain,
      airGain: noiseLayer('bandpass', 800, 1.0, blockFilter),
      fanGain: noiseLayer('bandpass', 420, 0.7, master),
      starterOsc,
      starterGain,
      noise,
      crunch: makeDistortionCurve(40),
      heavyCrunch: makeDistortionCurve(100),
    };
  }

  update(frame: AudioFrame): void {
    const g = this.graph;
    if (!g) return;
    this.resume(g.ctx);
    const now = g.ctx.currentTime;
    const { rpm, throttle, damage } = frame;

    g.blockFilter.frequency.setTargetAtTime(blockFilterFreq(rpm, damage), now, 0.1);

    g.starterGain.gain.setTargetAtTime(frame.cranking ? 0.18 : 0, now, frame.cranking ? 0.05 : 0.1);
    if (frame.cranking) g.starterOsc.frequency.setTargetAtTime(starterFreq(rpm), now, 0.1);

    if (frame.running && rpm > 50) {
      g.cylinderOsc1.frequency.setTargetAtTime(bodyToneFreq(rpm), now, 0.05);
      g.cylinderOsc2.frequency.setTargetAtTime(bodyToneHarmonicFreq(rpm), now, 0.05);
      g.cylinderGain.gain.setTargetAtTime(bodyToneGain(throttle, damage), now, 0.05);

      // Schedule discrete exhaust pulses a little ahead to keep cadence tight.
      const period = firingPeriod(rpm);
      if (this.nextPulseTime < now) this.nextPulseTime = now + 0.02;
      for (let guard = 0; guard < 16 && this.nextPulseTime < now + 0.12; guard++) {
        this.schedulePulse(g, this.nextPulseTime, rpm, throttle, damage);
        this.nextPulseTime += period;
      }
      g.airGain.gain.setTargetAtTime(airRushGain(rpm, throttle), now, 0.1);
    } else {
      g.cylinderGain.gain.setTargetAtTime(0, now, 0.15);
      g.airGain.gain.setTargetAtTime(0, now, 0.15);
      this.nextPulseTime = 0;
    }

    g.fanGain.gain.setTargetAtTime(fanGain(frame.fanLevel, frame.coolantTemp), now, 0.2);
  }

  private schedulePulse(g: Graph, when: number, rpm: number, throttle: number, damage: number): void {
    const osc = g.ctx.createOscillator();
    osc.type = 'triangle';
    const { startFreq, endFreq, peakGain, decay } = exhaustPulseShape(rpm, throttle, damage, Math.random());
    osc.frequency.setValueAtTime(startFreq, when);
    osc.frequency.exponentialRampToValueAtTime(endFreq, when + 0.05);

    const gain = g.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    osc.connect(gain).connect(g.blockFilter);
    osc.start(when);
    osc.stop(when + decay + 0.02);
  }

  /** A short enveloped oscillator, optionally through a distortion curve. */
  private blip(
    g: Graph,
    opts: {
      type: OscillatorType;
      freq: number;
      endFreq?: number;
      gain: number;
      duration: number;
      curve?: WaveShaperNode['curve'];
      oversample?: OverSampleType;
      destination?: AudioNode;
    }
  ): void {
    const now = g.ctx.currentTime;
    const osc = g.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, now + opts.duration * 0.7);

    const gain = g.ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + opts.duration);

    let head: AudioNode = osc;
    if (opts.curve) {
      const shaper = g.ctx.createWaveShaper();
      shaper.curve = opts.curve;
      if (opts.oversample) shaper.oversample = opts.oversample;
      head = head.connect(shaper);
    }
    head.connect(gain).connect(opts.destination ?? g.master);
    osc.start(now);
    osc.stop(now + opts.duration + 0.02);
  }

  spark(): void {
    const g = this.graph;
    if (!g || this.muted) return;
    this.resume(g.ctx);
    this.blip(g, { type: 'sine', freq: 3200, gain: 0.03, duration: 0.005 });
  }

  combustion(rpm: number, throttle: number, knocking: boolean): void {
    const g = this.graph;
    if (!g || this.muted) return;
    this.resume(g.ctx);
    const now = g.ctx.currentTime;
    if (now - this.lastCombustionTime < MIN_COMBUSTION_GAP_S) return;
    this.lastCombustionTime = now;

    const { peakGain, decay } = combustionShape(rpm, throttle);
    this.blip(g, {
      type: 'triangle',
      freq: 45 + Math.random() * 10,
      gain: peakGain,
      duration: decay,
      curve: g.crunch,
      oversample: '4x',
      destination: g.blockFilter,
    });

    // Pre-ignition or a worn rod: a metallic "clank".
    if (knocking) this.blip(g, { type: 'sine', freq: 1100 + Math.random() * 400, gain: 0.12, duration: 0.015 });
  }

  backfire(): void {
    const g = this.graph;
    if (!g || this.muted) return;
    this.resume(g.ctx);
    this.blip(g, {
      type: 'sawtooth',
      freq: 140 + Math.random() * 120,
      endFreq: 50,
      gain: 0.22,
      duration: 0.12,
      curve: g.heavyCrunch,
    });
  }

  explosion(): void {
    const g = this.graph;
    if (!g) return;
    this.resume(g.ctx);
    this.blip(g, {
      type: 'sawtooth',
      freq: 60,
      endFreq: 10,
      gain: 0.8,
      duration: 0.8,
      curve: g.heavyCrunch,
    });
    this.blip(g, { type: 'sawtooth', freq: 800, gain: 0.3, duration: 0.4 });

    // Immediately quieten the normal signals.
    const now = g.ctx.currentTime;
    g.cylinderGain.gain.setTargetAtTime(0, now, 0.01);
    g.airGain.gain.setTargetAtTime(0, now, 0.01);
  }

  setMute(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyMaster();
  }

  private applyMaster(): void {
    const g = this.graph;
    if (g) g.master.gain.setValueAtTime(this.muted ? 0 : this.volume, g.ctx.currentTime);
  }

  private resume(ctx: AudioContext): void {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
}

export const engineAudio = new EngineSoundManager();
