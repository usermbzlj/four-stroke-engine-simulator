/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure parameter math for the Web Audio engine-sound synth.
 *
 * `engineAudio.ts` owns the `AudioContext` graph; this module owns the
 * *formulas* that turn engine telemetry (rpm / throttle / damage / temp) into
 * oscillator frequencies, gains and envelope timings. Keeping them pure makes
 * the audio "tuning" unit-testable and documents the otherwise-cryptic
 * magic numbers in one place.
 */

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Lowpass "engine block" cutoff (Hz). Rises with rpm and wear (tinnier when worn). */
export function blockFilterFreq(rpm: number, damageLevel: number): number {
  return Math.min(2000, 300 + rpm * 0.05 + damageLevel * 1.5);
}

/** Starter-motor whine oscillator frequency (Hz) while cranking. */
export function starterFreq(rpm: number): number {
  return 150 + rpm * 0.4;
}

/** Fundamental of the low rumble bed = one cycle per revolution (Hz). */
export function bodyToneFreq(rpm: number): number {
  return rpm / 60;
}

/** Second partial of the rumble bed, slightly detuned to avoid a sterile octave. */
export function bodyToneHarmonicFreq(rpm: number): number {
  return bodyToneFreq(rpm) * 2 + 1;
}

/** Gain of the sustained rumble bed (throttle opens it up, wear adds grit). */
export function bodyToneGain(throttle: number, damageLevel: number): number {
  return 0.035 + throttle * 0.06 + damageLevel * 0.0006;
}

/**
 * Combustion firing rate for a 4-stroke single (Hz): one power stroke every two
 * revolutions => rpm / 120. Used to schedule discrete exhaust pulses.
 */
export function firingHz(rpm: number): number {
  return rpm / 120;
}

/** Seconds between exhaust pulses (clamped so very low rpm can't explode the period). */
export function firingPeriod(rpm: number): number {
  return 1 / Math.max(1, firingHz(rpm));
}

/** Induction "whoosh" gain — grows with throttle and scales toward redline. */
export function airRushGain(rpm: number, throttle: number): number {
  return Math.min(0.1, (0.012 + throttle * 0.06) * (rpm / 4000));
}

/** Cooling-fan airflow gain from the fan duty plus an over-90°C thermal bleed. */
export function fanGain(fanLevel: number, cylinderTemperature: number): number {
  return clamp(fanLevel * 0.05 + Math.max(0, cylinderTemperature - 90) * 0.0006, 0, 0.05);
}

/** One discrete exhaust "thump": start/end pitch, peak gain and decay time. */
export interface PulseShape {
  startFreq: number;
  endFreq: number;
  peakGain: number;
  decay: number;
}

export function exhaustPulseShape(
  rpm: number,
  throttle: number,
  damageLevel: number,
  jitter: number = 0,
): PulseShape {
  const pitch = 60 + rpm * 0.02 + jitter * 6;
  return {
    startFreq: pitch * 1.6,
    endFreq: Math.max(20, pitch * 0.7),
    peakGain: (0.05 + throttle * 0.14) * (1 + damageLevel * 0.004),
    decay: Math.max(0.025, 6 / (rpm + 60)),
  };
}

/** Main combustion boom: peak gain (throttle-scaled) and rpm-shortened decay. */
export function combustionShape(rpm: number, throttle: number): { peakGain: number; decay: number } {
  return {
    peakGain: 0.18 + throttle * 0.32,
    decay: Math.max(0.03, 10 / (rpm + 50)),
  };
}

/**
 * WaveShaper distortion transfer curve. `amount` controls drive; output is the
 * classic `((3+k)·x·20°)/(π + k·|x|)` soft-clip used for the combustion/backfire
 * crunch. Exposed for testing the curve's shape (odd symmetry, bounded output).
 */
export function makeDistortionCurve(amount: number, nSamples: number = 44100): Float32Array {
  const k = typeof amount === 'number' ? amount : 50;
  const curve = new Float32Array(nSamples);
  const deg = Math.PI / 180;
  for (let i = 0; i < nSamples; ++i) {
    const x = (i * 2) / nSamples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
