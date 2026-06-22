/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class EngineSoundManager {
  private ctx: AudioContext | null = null;
  private mainGain: GainNode | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5;

  // Sound nodes
  private cylinderOsc1: OscillatorNode | null = null;
  private cylinderOsc2: OscillatorNode | null = null;
  private cylinderGain: GainNode | null = null;
  
  private airNoise: AudioWorkletNode | ScriptProcessorNode | null = null;
  private airGain: GainNode | null = null;

  private starterOsc: OscillatorNode | null = null;
  private starterGain: GainNode | null = null;

  // Cooling fan / radiator airflow loop
  private fanGain: GainNode | null = null;

  // Lowpass filter to simulate engine block muffling
  private blockFilter: BiquadFilterNode | null = null;

  // Combustion pulse scheduling (single-cylinder fires once per 2 revolutions)
  private nextPulseTime = 0;

  constructor() {
    // Initialized lazily upon user interaction
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      
      this.mainGain = this.ctx.createGain();
      this.mainGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
      this.mainGain.connect(this.ctx.destination);

      // Lowpass block filter
      this.blockFilter = this.ctx.createBiquadFilter();
      this.blockFilter.type = 'lowpass';
      this.blockFilter.frequency.setValueAtTime(450, this.ctx.currentTime); // muffles the rough raw waves
      this.blockFilter.connect(this.mainGain);

      // 1. Cylinder Base Tone (Low-freq sawtooth simulating cylinder movement & pulses)
      this.cylinderOsc1 = this.ctx.createOscillator();
      this.cylinderOsc1.type = 'sawtooth';
      this.cylinderOsc1.frequency.setValueAtTime(10, this.ctx.currentTime);

      this.cylinderOsc2 = this.ctx.createOscillator();
      this.cylinderOsc2.type = 'triangle';
      this.cylinderOsc2.frequency.setValueAtTime(20, this.ctx.currentTime);

      this.cylinderGain = this.ctx.createGain();
      this.cylinderGain.gain.setValueAtTime(0, this.ctx.currentTime);

      this.cylinderOsc1.connect(this.cylinderGain);
      this.cylinderOsc2.connect(this.cylinderGain);
      this.cylinderGain.connect(this.blockFilter);

      this.cylinderOsc1.start();
      this.cylinderOsc2.start();

      // 2. Air Intake / Exhaust Rushing (noise)
      this.setupAirNoise();

      // 3. Starter Motor
      this.starterOsc = this.ctx.createOscillator();
      this.starterOsc.type = 'sine';
      this.starterOsc.frequency.setValueAtTime(180, this.ctx.currentTime);
      
      // Starter sub-harmonics for gear grinding
      const starterSaw = this.ctx.createOscillator();
      starterSaw.type = 'triangle';
      starterSaw.frequency.setValueAtTime(90, this.ctx.currentTime);

      this.starterGain = this.ctx.createGain();
      this.starterGain.gain.setValueAtTime(0, this.ctx.currentTime);

      this.starterOsc.connect(this.starterGain);
      starterSaw.connect(this.starterGain);
      this.starterGain.connect(this.mainGain); // bypass lowpass for high starter whine

      this.starterOsc.start();
      starterSaw.start();

      // 4. Cooling fan airflow (filtered noise loop)
      this.setupFanNoise();
    } catch (e) {
      console.warn("Failed to initialize Web Audio API:", e);
    }
  }

  private setupFanNoise() {
    if (!this.ctx || !this.mainGain) return;
    try {
      const bufferSize = 4096;
      const provider = this.ctx.createScriptProcessor ? this.ctx.createScriptProcessor(bufferSize, 1, 1) : null;
      if (!provider) return;
      provider.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) out[i] = Math.random() * 2 - 1;
      };
      this.fanGain = this.ctx.createGain();
      this.fanGain.gain.setValueAtTime(0, this.ctx.currentTime);
      const fanFilter = this.ctx.createBiquadFilter();
      fanFilter.type = 'bandpass';
      fanFilter.frequency.setValueAtTime(420, this.ctx.currentTime);
      fanFilter.Q.setValueAtTime(0.7, this.ctx.currentTime);
      provider.connect(fanFilter);
      fanFilter.connect(this.fanGain);
      this.fanGain.connect(this.mainGain);
    } catch (e) {
      console.warn('Failed to build fan noise:', e);
    }
  }

  private setupAirNoise() {
    if (!this.ctx || !this.blockFilter) return;

    // Standard script processor for noise (broadly supported fallback)
    try {
      const bufferSize = 4096;
      const provider = this.ctx.createScriptProcessor ? this.ctx.createScriptProcessor(bufferSize, 1, 1) : null;
      if (provider) {
        provider.onaudioprocess = (e) => {
          const output = e.outputBuffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            // White noise
            output[i] = Math.random() * 2 - 1;
          }
        };

        this.airGain = this.ctx.createGain();
        this.airGain.gain.setValueAtTime(0, this.ctx.currentTime);

        const airFilter = this.ctx.createBiquadFilter();
        airFilter.type = 'bandpass';
        airFilter.frequency.setValueAtTime(800, this.ctx.currentTime);
        airFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

        provider.connect(airFilter);
        airFilter.connect(this.airGain);
        this.airGain.connect(this.blockFilter);

        this.airNoise = provider as any;
      }
    } catch (e) {
      console.error("Failed to build noise generator:", e);
    }
  }

  // Set sound properties in real-time
  update(
    rpm: number,
    throttle: number,
    isStarting: boolean,
    isRunning: boolean,
    damageLevel: number,
    cylinderTemperature: number,
    fanLevel: number = 0
  ) {
    this.ensureContextRunning();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Low oil density / high damage creates metallic high-pitch filter changes
    const filterFreq = 300 + rpm * 0.05 + damageLevel * 1.5;
    if (this.blockFilter) {
      this.blockFilter.frequency.setTargetAtTime(Math.min(2000, filterFreq), now, 0.1);
    }

    // 1. Starter Whine
    if (isStarting) {
      this.starterGain?.gain.setTargetAtTime(0.18, now, 0.05);
      this.starterOsc?.frequency.setTargetAtTime(150 + rpm * 0.4, now, 0.1);
    } else {
      this.starterGain?.gain.setTargetAtTime(0, now, 0.1);
    }

    // 2. Engine body tone — low rumble bed under the discrete exhaust pulses.
    if (isRunning && rpm > 50) {
      const baseFreq = rpm / 60;
      this.cylinderOsc1?.frequency.setTargetAtTime(baseFreq, now, 0.05);
      this.cylinderOsc2?.frequency.setTargetAtTime(baseFreq * 2 + 1, now, 0.05);
      const targetVolume = 0.035 + throttle * 0.06 + damageLevel * 0.0006;
      this.cylinderGain?.gain.setTargetAtTime(targetVolume, now, 0.05);

      // 2b. Schedule discrete combustion pulses at the firing frequency.
      // A 4-stroke single fires once every 2 revolutions => f = rpm/120 (Hz).
      const firingHz = rpm / 120;
      const period = 1 / Math.max(1, firingHz);
      if (this.nextPulseTime < now) this.nextPulseTime = now + 0.02;
      // Schedule a little ahead to keep cadence tight without flooding.
      let guard = 0;
      while (this.nextPulseTime < now + 0.12 && guard < 16) {
        this.schedulePulse(this.nextPulseTime, rpm, throttle, damageLevel);
        this.nextPulseTime += period;
        guard++;
      }
    } else {
      this.cylinderGain?.gain.setTargetAtTime(0, now, 0.15);
      this.nextPulseTime = 0;
    }

    // 3. Air Rush (Induction) — louder with throttle (butterfly whoosh)
    if (isRunning && this.airGain) {
      const airTarget = (0.012 + throttle * 0.06) * (rpm / 4000);
      this.airGain.gain.setTargetAtTime(Math.min(0.1, airTarget), now, 0.1);
    } else {
      this.airGain?.gain.setTargetAtTime(0, now, 0.15);
    }

    // 4. Cooling fan airflow
    if (this.fanGain) {
      const fanTarget = Math.max(0, Math.min(0.05, fanLevel * 0.05 + Math.max(0, cylinderTemperature - 90) * 0.0006));
      this.fanGain.gain.setTargetAtTime(fanTarget, now, 0.2);
    }
  }

  /** A single short exhaust pulse "thump" scheduled at an absolute time. */
  private schedulePulse(when: number, rpm: number, throttle: number, damageLevel: number) {
    if (!this.ctx) return;
    const dest = this.blockFilter ?? this.mainGain;
    if (!dest) return;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const pitch = 60 + rpm * 0.02 + Math.random() * 6;
    osc.frequency.setValueAtTime(pitch * 1.6, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, pitch * 0.7), when + 0.05);

    const g = this.ctx.createGain();
    const peak = (0.05 + throttle * 0.14) * (1 + damageLevel * 0.004);
    const decay = Math.max(0.025, 6 / (rpm + 60));
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    osc.connect(g);
    g.connect(dest);
    osc.start(when);
    osc.stop(when + decay + 0.02);
  }

  /** Lean-pop / rev-limiter backfire crackle. */
  triggerBackfire() {
    this.ensureContextRunning();
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140 + Math.random() * 120, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.makeDistortionCurve(80);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(shaper);
    shaper.connect(g);
    g.connect(this.mainGain!);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  // High-fidelity instant combustion explosion tick
  triggerCombustion(rpm: number, throttle: number, isKnocking: boolean) {
    this.ensureContextRunning();
    if (!this.ctx || this.isMuted) return;

    const now = this.ctx.currentTime;

    // Short sub-harmonic burst
    const combustionOsc = this.ctx.createOscillator();
    combustionOsc.type = 'triangle';
    combustionOsc.frequency.setValueAtTime(45 + Math.random() * 10, now);
    
    // Add distortion for power!
    const distortion = this.ctx.createWaveShaper();
    distortion.curve = this.makeDistortionCurve(40);
    distortion.oversample = '4x';

    const gainNode = this.ctx.createGain();
    const peakGain = 0.18 + (throttle * 0.32); // throttle increases boom!
    gainNode.gain.setValueAtTime(peakGain, now);
    // Fires faster at high RPM
    const decayDuration = Math.max(0.03, 10 / (rpm + 50)); 
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + decayDuration);

    combustionOsc.connect(distortion);
    distortion.connect(gainNode);
    if (this.blockFilter) {
      gainNode.connect(this.blockFilter);
    } else {
      gainNode.connect(this.mainGain!);
    }

    combustionOsc.start(now);
    combustionOsc.stop(now + decayDuration + 0.02);

    // If knocking (pre-ignition or critical rod wear), trigger high frequency metal "clank"
    if (isKnocking) {
      this.triggerMetalKling(decayDuration);
    }
  }

  private makeDistortionCurve(amount: number) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  private triggerMetalKling(decayDuration: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    // metallic frequency
    osc.frequency.setValueAtTime(1100 + Math.random() * 400, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

    osc.connect(gain);
    gain.connect(this.mainGain!);
    osc.start(now);
    osc.stop(now + 0.03);
  }

  // Trigger spark discharge sound
  triggerSpark() {
    this.ensureContextRunning();
    if (!this.ctx || this.isMuted) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(3200, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.005);

    osc.connect(gain);
    gain.connect(this.mainGain!);
    osc.start(now);
    osc.stop(now + 0.01);
  }

  // Trigger explosion / mechanical boom sound
  triggerExplosion() {
    this.ensureContextRunning();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Huge booming noise with heavy decay
    const noiseOsc = this.ctx.createOscillator();
    noiseOsc.type = 'sawtooth';
    noiseOsc.frequency.setValueAtTime(60, now);
    noiseOsc.frequency.linearRampToValueAtTime(10, now + 0.8);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0.8, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    // Distortion
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.makeDistortionCurve(100);

    noiseOsc.connect(shaper);
    shaper.connect(gainNode);
    gainNode.connect(this.mainGain!);

    noiseOsc.start(now);
    noiseOsc.stop(now + 0.8);

    // Metallic shatter ringing
    const ringOsc = this.ctx.createOscillator();
    ringOsc.type = 'sawtooth';
    ringOsc.frequency.setValueAtTime(800, now);

    const ringGain = this.ctx.createGain();
    ringGain.gain.setValueAtTime(0.3, now);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    ringOsc.connect(ringGain);
    ringGain.connect(this.mainGain!);
    ringOsc.start(now);
    ringOsc.stop(now + 0.52);

    // Immediately quieten down all normal signals
    this.cylinderGain?.gain.setTargetAtTime(0, now, 0.01);
    this.airGain?.gain.setTargetAtTime(0, now, 0.01);
  }

  setMute(muted: boolean) {
    this.isMuted = muted;
    if (this.mainGain && this.ctx) {
      this.mainGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  setVolume(vol: number) {
    this.volume = vol;
    if (this.mainGain && this.ctx && !this.isMuted) {
      this.mainGain.gain.setValueAtTime(vol, this.ctx.currentTime);
    }
  }

  private ensureContextRunning() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }
}

export const engineAudio = new EngineSoundManager();
