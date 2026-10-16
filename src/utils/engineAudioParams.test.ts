/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the pure audio-parameter math. These guard the "tuning"
 * formulas (frequencies, gains, envelopes) against accidental drift and
 * document the intended physical/perceptual relationships.
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import {
  airRushGain,
  blockFilterFreq,
  bodyToneFreq,
  bodyToneGain,
  bodyToneHarmonicFreq,
  combustionShape,
  exhaustPulseShape,
  fanGain,
  firingHz,
  firingPeriod,
  makeDistortionCurve,
  starterFreq,
} from './engineAudioParams';

it("--- Block filter: rises with rpm + damage, capped at 2 kHz ---", () => {
  assert.ok(blockFilterFreq(0, 0) === 300, 'idle/no-damage cutoff anchors at 300 Hz');
  assert.ok(
    blockFilterFreq(4000, 0) > blockFilterFreq(1000, 0),
    'higher rpm opens the cutoff'
  );
  assert.ok(
    blockFilterFreq(1000, 200) > blockFilterFreq(1000, 0),
    'more damage brightens (raises cutoff)'
  );
  assert.equal(blockFilterFreq(100000, 100000), 2000, 'cutoff is clamped to 2 kHz');
});

it("--- Starter whine scales with cranking rpm ---", () => {
  assert.equal(starterFreq(0), 150, 'starter base frequency is 150 Hz');
  assert.ok(starterFreq(300) > starterFreq(0), 'starter pitch rises with rpm');
});

it("--- Body tone: fundamental = rev/sec, harmonic detuned above the octave ---", () => {
  assert.equal(bodyToneFreq(6000), 100, '6000 rpm => 100 Hz fundamental');
  assert.ok(
    bodyToneHarmonicFreq(6000) > bodyToneFreq(6000) * 2,
    'harmonic sits just above the 2nd partial (detuned by +1 Hz)'
  );
  assert.equal(bodyToneHarmonicFreq(6000), 201, 'harmonic = fundamental*2 + 1');
});

it("--- Body tone gain grows with throttle and (slightly) wear ---", () => {
  assert.ok(
    bodyToneGain(1, 0) > bodyToneGain(0, 0),
    'opening the throttle raises the rumble gain'
  );
  assert.ok(
    bodyToneGain(0, 100) > bodyToneGain(0, 0),
    'damage adds a touch of gain (grit)'
  );
});

it("--- Firing frequency: a 4-stroke single fires once per 2 revolutions ---", () => {
  // 1200 rpm = 20 rev/s => 10 power strokes/s.
  assert.equal(firingHz(1200), 10, '1200 rpm => 10 Hz firing');
  assert.equal(firingPeriod(1200), 0.1, 'firing period is the reciprocal (0.1 s)');
  // Period is clamped so near-zero rpm can't produce an enormous period.
  assert.ok(firingPeriod(0) <= 1, 'firing period is clamped at low rpm');
  assert.ok(
    firingPeriod(6000) < firingPeriod(1200),
    'higher rpm => shorter period (faster pulses)'
  );
});

it("--- Air rush: monotonic in throttle and rpm, capped at 0.1 ---", () => {
  assert.ok(airRushGain(4000, 1) > airRushGain(4000, 0.2), 'more throttle => more induction noise');
  assert.ok(airRushGain(4000, 0.5) > airRushGain(1000, 0.5), 'more rpm => more induction noise');
  assert.ok(airRushGain(20000, 1) <= 0.1, 'air rush gain is clamped to 0.1');
  assert.equal(airRushGain(0, 1), 0, 'no airflow at zero rpm');
});

it("--- Cooling fan: duty + thermal bleed, clamped to [0, 0.05] ---", () => {
  assert.equal(fanGain(0, 25), 0, 'cold engine, fan off => silent');
  assert.ok(fanGain(0, 130) > 0, 'over-temperature bleeds in fan noise even at 0 duty');
  assert.ok(fanGain(1, 200) <= 0.05, 'fan gain is clamped to 0.05');
  assert.ok(fanGain(0.5, 25) > fanGain(0, 25), 'higher fan duty => more airflow noise');
});

it("--- Exhaust pulse: pitch & loudness rise with rpm/throttle, decay shortens ---", () => {
  const idle = exhaustPulseShape(1000, 0.1, 0);
  const wot = exhaustPulseShape(6000, 1, 0);
  assert.ok(wot.startFreq > idle.startFreq, 'higher rpm raises pulse pitch');
  assert.ok(wot.peakGain > idle.peakGain, 'more throttle => louder pulse');
  assert.ok(idle.endFreq >= 20, 'pulse end frequency is floored at 20 Hz');
  assert.ok(idle.startFreq > idle.endFreq, 'pulse sweeps downward in pitch');

  // Pulse decay is floored at 25 ms; the floor dominates for any running rpm
  // (crossover at rpm=180), so idle/redline share the minimum tail length.
  assert.equal(idle.decay, 0.025, 'normal-rpm pulse decay sits at the 25 ms floor');
  assert.equal(wot.decay, 0.025, 'redline pulse decay is also at the floor');
  assert.ok(
    exhaustPulseShape(0, 0.5, 0).decay > 0.025,
    'below the crossover (cranking) the decay tail is longer'
  );

  // Damage adds loudness; jitter perturbs pitch deterministically.
  assert.ok(
    exhaustPulseShape(3000, 0.5, 100).peakGain > exhaustPulseShape(3000, 0.5, 0).peakGain,
    'worn engine pulses are louder'
  );
  assert.ok(
    exhaustPulseShape(3000, 0.5, 0, 1).startFreq > exhaustPulseShape(3000, 0.5, 0, 0).startFreq,
    'positive jitter nudges pitch up'
  );
});

it("--- Combustion boom: throttle-scaled gain, rpm-shortened decay ---", () => {
  const soft = combustionShape(2000, 0);
  const hard = combustionShape(2000, 1);
  assert.ok(hard.peakGain > soft.peakGain, 'wide-open throttle booms louder');
  assert.equal(soft.peakGain, 0.18, 'closed-throttle combustion floor is 0.18');
  assert.equal(hard.peakGain, 0.5, 'wide-open combustion peak is 0.50');
  // Decay shortens with rpm only below the ~283 rpm crossover; above it the
  // 30 ms floor dominates (so any running rpm shares the minimum tail).
  assert.ok(
    combustionShape(200, 1).decay < combustionShape(50, 1).decay,
    'combustion decay shortens with rpm below the floor crossover'
  );
  assert.equal(combustionShape(2000, 1).decay, 0.03, 'running-rpm combustion decay sits at the 30 ms floor');
  assert.ok(combustionShape(100000, 1).decay >= 0.03, 'combustion decay is floored at 30 ms');
});

it("--- Distortion curve: correct length, bounded, odd-symmetric soft-clip ---", () => {
  const curve = makeDistortionCurve(50, 2048);
  assert.equal(curve.length, 2048, 'curve has the requested sample count');
  assert.ok(curve instanceof Float32Array, 'curve is a Float32Array (WaveShaper-ready)');

  // f(x) = ((3+k)·x·20°)/(π + k·|x|) is mathematically odd: f(-x) = -f(x).
  // Verify on the continuous function at exact ± inputs.
  const f = (x: number, k = 50) => ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  for (const x of [0.1, 0.4, 0.75, 1]) {
    assert.ok(Math.abs(f(-x) + f(x)) < 1e-12, `transfer function is odd at x=${x}`);
  }
  assert.equal(f(0), 0, 'transfer function passes through the origin');

  // Output stays bounded (no runaway values) and is finite throughout.
  let maxAbs = 0;
  for (let i = 0; i < curve.length; i++) {
    assert.ok(Number.isFinite(curve[i]), 'every curve sample is finite');
    maxAbs = Math.max(maxAbs, Math.abs(curve[i] ?? 0));
  }
  assert.ok(maxAbs < 5, 'curve output stays bounded');

  // More drive => steeper response near the extremes.
  const gentle = makeDistortionCurve(10, 2048);
  const aggressive = makeDistortionCurve(200, 2048);
  assert.ok(
    Math.abs(aggressive.at(-1) ?? 0) > Math.abs(gentle.at(-1) ?? 0),
    'higher drive pushes the rails harder'
  );
});
