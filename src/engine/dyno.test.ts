/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { EngineParameters } from '../types';
import { DYNO } from './constants';
import { previewCurve, runDynoHeadless, veCurve } from './dyno';
import { defaultBuild, resolveBuild } from './parts';
import { autoTune, flatTune, tuneBreakpoints } from './tune';
import { INITIAL_WEAR } from './simulation';

const stock = resolveBuild(defaultBuild());

const params: EngineParameters = {
  throttle: 1,
  load: 0,
  oilLevel: 100,
  hasLimiter: false,
  limiterRpm: 6800,
  hasNitrous: false,
  coolantPump: 1,
  choke: 0,
};

// A deterministic RNG keeps the pull repeatable (no random misfires).
const steadyRng = () => 0.99;

// A healthy engine with a sane tune pulls all the way to redline.
const baseline = runDynoHeadless({ spec: stock, tune: autoTune(stock), params, rng: steadyRng });
it("case 1", () => {
  assert.equal(baseline.aborted, null, `baseline pull should complete, aborted: ${baseline.aborted}`);
  assert.ok(baseline.curve.length > 15, `expected a populated curve, got ${baseline.curve.length} points`);

  // The curve must actually span the rev range, not just the bottom.
  const lastRpm = baseline.curve.at(-1)!.rpm;
  assert.ok(lastRpm > stock.redlineRpm * 0.85, `sweep should reach the top, stopped at ${lastRpm.toFixed(0)}`);

  // RPM strictly ascends through the binned curve.
  for (let i = 1; i < baseline.curve.length; i++) {
    assert.ok(baseline.curve[i]!.rpm > baseline.curve[i - 1]!.rpm, 'curve rpm must ascend');
  }
});

it("The measured numbers land in a physically sensible place for a stock 250.", () => {
  assert.ok(
    baseline.peakPowerHp > 8 && baseline.peakPowerHp < 20,
    `stock 250 should make roughly 10-15 HP, measured ${baseline.peakPowerHp.toFixed(1)}`
  );
  assert.ok(
    baseline.peakTorqueNm > 14 && baseline.peakTorqueNm < 28,
    `stock 250 peak torque out of range: ${baseline.peakTorqueNm.toFixed(1)} Nm`
  );
  assert.ok(baseline.peakPowerRpm > baseline.peakTorqueRpm, 'peak power must occur above peak torque');
  assert.ok(baseline.maxTemp > 0, 'the pull should record a temperature trace');
});

it("Unlike the old analytic sweep, the pull reflects the real engine: it costs wear, and it heats the engine up while it climbs.", () => {
  assert.ok(baseline.wearCost > 0, 'a real pull should consume some component life');
  assert.ok(baseline.maxTemp > 85, 'a loaded WOT sweep should raise coolant temperature');
});

it("Tuning has to matter: a badly retarded map must measure worse than MBT.", () => {
  const retarded = runDynoHeadless({ spec: stock, tune: flatTune(0, 0.92), params, rng: steadyRng });
  assert.ok(
    retarded.peakPowerHp < baseline.peakPowerHp,
    `zero advance (${retarded.peakPowerHp.toFixed(1)} HP) should measure below a real tune (${baseline.peakPowerHp.toFixed(1)} HP)`
  );
});

it("A wildly over-advanced map knocks, and the dyno reports that knock.", () => {
  const detonating = runDynoHeadless({ spec: stock, tune: flatTune(45, 1.3), params, rng: steadyRng });
  assert.ok(detonating.maxKnock > 0, 'an over-advanced, lean map should register knock on the pull');
  assert.ok(
    detonating.wearCost > baseline.wearCost,
    'a detonating pull should cost more component life than a clean one'
  );
});

it("Bolting on parts must show up on the dyno.", () => {
  const built = resolveBuild({
    ...defaultBuild(),
    installed: {
      ...defaultBuild().installed,
      cam: 'cam-street',
      head: 'head-ported',
      exhaust: 'exhaust-header',
      intake: 'intake-velocity',
      cooling: 'cool-rad',
    },
  });
  const tuned = runDynoHeadless({ spec: built, tune: autoTune(built), params, rng: steadyRng });
  assert.ok(
    tuned.peakPowerHp > baseline.peakPowerHp,
    `bolt-ons should gain power: ${tuned.peakPowerHp.toFixed(1)} vs ${baseline.peakPowerHp.toFixed(1)} HP`
  );
});

it("A tune too sick to pull aborts honestly instead of hanging for the full budget.", () => {
  const dead = runDynoHeadless({ spec: stock, tune: flatTune(12, 1.5), params, rng: steadyRng });
  assert.ok(dead.aborted !== null, 'an unburnable mixture should abort the pull');
  assert.ok(dead.peakPowerHp < baseline.peakPowerHp, 'and it certainly should not out-measure a real tune');
});

it("The rev limiter caps the pull where you set it.", () => {
  const limited = runDynoHeadless({
    spec: stock,
    tune: autoTune(stock),
    params: { ...params, hasLimiter: true, limiterRpm: 4000 },
    rng: steadyRng,
  });
  assert.ok(limited.aborted !== null, 'a limiter below redline should stop the sweep short');
  assert.ok(
    limited.peakPowerHp < baseline.peakPowerHp,
    'a 4000 rpm limiter must cost peak power on a 6800 rpm engine'
  );
});

it("The analytic preview is a usable optimistic estimate, not a replacement.", () => {
  const preview = previewCurve(stock, autoTune(stock), INITIAL_WEAR);
  assert.equal(preview.length, 41);
  assert.ok(preview[0]?.rpm === DYNO.startRpm);
  const previewPeak = Math.max(...preview.map((p) => p.power));
  assert.ok(previewPeak > 0, 'preview should produce power');
  assert.ok(
    Math.abs(previewPeak - baseline.peakPowerHp) < baseline.peakPowerHp * 0.5,
    `preview (${previewPeak.toFixed(1)}) should be in the same ballpark as the real pull (${baseline.peakPowerHp.toFixed(1)})`
  );
});

it("The VE trace lines up with the build's advertised torque peak.", () => {
  const trace = veCurve(stock);
  const best = trace.reduce((a, b) => (b.ve > a.ve ? b : a));
  assert.ok(
    Math.abs(best.rpm - stock.torquePeakRpm) < 600,
    `VE should peak near the torque peak, got ${best.rpm.toFixed(0)} vs ${stock.torquePeakRpm}`
  );
  assert.equal(tuneBreakpoints(stock)[6], stock.redlineRpm);
});
