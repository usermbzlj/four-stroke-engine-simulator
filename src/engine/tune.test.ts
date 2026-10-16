/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import {
  TUNE_POINTS,
  autoTune,
  clampTune,
  flatTune,
  mbtIgnition,
  projectToEcu,
  sampleTune,
  setZoneValue,
  tuneBreakpoints,
  tuneZones,
  zoneLabels,
  zoneValue,
} from './tune';
import { defaultBuild, resolveBuild } from './parts';
import { knockSeverity } from './physics';
import { TUNE } from './constants';

const at = (values: readonly number[], index: number): number => {
  const value = values[index];
  assert.ok(value !== undefined, `no value at index ${index}`);
  return value;
};

const stock = resolveBuild(defaultBuild());
const race = resolveBuild({ ...defaultBuild(), blockId: 'block-450' });

it("Breakpoints span idle-ish to redline, ascending, with the right count.", () => {
  const bp = tuneBreakpoints(stock);
  assert.equal(bp.length, TUNE_POINTS);
  assert.equal(bp[0], TUNE.lowAnchorRpm);
  assert.equal(bp[bp.length - 1], stock.redlineRpm);
  for (let i = 1; i < bp.length; i++) assert.ok(at(bp, i) > at(bp, i - 1), 'breakpoints must ascend');

  // A higher-revving build gets a wider map.
  assert.ok(at(tuneBreakpoints(race), TUNE_POINTS - 1) > at(bp, TUNE_POINTS - 1));
});

it("Sampling interpolates between breakpoints and clamps outside them.", () => {
  const bp = tuneBreakpoints(stock);
  const tune = { ignition: [10, 12, 14, 16, 18, 20, 22], lambda: [1, 1, 0.98, 0.96, 0.94, 0.92, 0.9] };

  assert.equal(sampleTune(tune, bp, at(bp, 0)).ignition, 10, 'exact hit on the first breakpoint');
  assert.equal(sampleTune(tune, bp, at(bp, 6)).ignition, 22, 'exact hit on the last breakpoint');
  assert.equal(sampleTune(tune, bp, 0).ignition, 10, 'below the map clamps to the first value');
  assert.equal(sampleTune(tune, bp, 99999).ignition, 22, 'above the map clamps to the last value');

  const mid = sampleTune(tune, bp, (at(bp, 0) + at(bp, 1)) / 2);
  assert.ok(Math.abs(mid.ignition - 11) < 1e-9, 'midpoint interpolates linearly');
  assert.ok(mid.lambda > 0.99 && mid.lambda <= 1, 'lambda interpolates too');
});

it("A flat map really is flat everywhere.", () => {
  const bp = tuneBreakpoints(stock);
  const tune = flatTune(14, 0.95);
  for (const rpm of [500, 1500, 3000, 5000, 9000]) {
    const s = sampleTune(tune, bp, rpm);
    assert.equal(s.ignition, 14);
    assert.equal(s.lambda, 0.95);
  }
});

it("The generated baseline must be safe: no knock anywhere at operating temperature.", () => {
  for (const spec of [stock, race, resolveBuild({ ...defaultBuild(), blockId: 'block-650' })]) {
    const tune = autoTune(spec);
    const bp = tuneBreakpoints(spec);
    bp.forEach((rpm, i) => {
      const severity = knockSeverity({
        spec,
        ignition: at(tune.ignition, i),
        lambda: at(tune.lambda, i),
        rpm,
        throttle: 1,
        cylinderTemp: 95,
      });
      assert.equal(severity, 0, `${spec.name} auto-tune knocks at ${rpm} rpm (${severity.toFixed(2)})`);
    });
  }
});

it("The baseline leaves real headroom below MBT — that gap is the tuning game.", () => {
  const tune = autoTune(stock);
  const bp = tuneBreakpoints(stock);
  bp.forEach((rpm, i) => {
    const gap = mbtIgnition(rpm) - at(tune.ignition, i);
    assert.ok(gap > 0.5, `auto-tune should stay below MBT at ${rpm} rpm, gap was ${gap.toFixed(2)}°`);
  });
  // Advance still has to climb with revs, like a real curve.
  assert.ok(at(tune.ignition, 6) > at(tune.ignition, 0), 'advance should increase with RPM');
  assert.ok(at(tune.lambda, 6) < at(tune.lambda, 0), 'the top end should be richer than idle');
});

it("A high-compression build is given a more conservative baseline than a stock one, because its knock limit — not MBT — becomes the binding constraint.", () => {
  const hot = resolveBuild({
    ...defaultBuild(),
    installed: { ...defaultBuild().installed, piston: 'piston-race-128' },
  });
  const stockTune = autoTune(stock);
  const hotTune = autoTune(hot);
  assert.ok(at(hotTune.ignition, 4) < at(stockTune.ignition, 4), 'higher CR should be timed more conservatively');

  // Cooling hardware buys that timing back, which is the whole point of the shop.
  const cooled = resolveBuild({
    ...defaultBuild(),
    installed: { ...defaultBuild().installed, piston: 'piston-race-128', cooling: 'cool-race' },
  });
  assert.ok(at(autoTune(cooled).ignition, 4) > at(hotTune.ignition, 4), 'a cooling package should recover advance');
});

it("ECU tiers expose the right number of independently editable zones.", () => {
  assert.equal(tuneZones(0).length, 1);
  assert.equal(tuneZones(1).length, 3);
  assert.equal(tuneZones(2).length, TUNE_POINTS);
  assert.equal(zoneLabels(1).length, 3);

  // Every breakpoint is covered exactly once at every tier.
  for (const tier of [0, 1, 2]) {
    const seen = tuneZones(tier).flat().sort((a, b) => a - b);
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6], `tier ${tier} must partition the map`);
  }
});

it("Editing a stock-ECU zone moves the whole curve; a standalone moves one point.", () => {
  const base = flatTune(12, 1);

  const stockEdit = setZoneValue(base, 0, 0, 'ignition', 20);
  assert.deepEqual(stockEdit.ignition, Array(TUNE_POINTS).fill(20), 'stock ECU edits stay flat');

  const standaloneEdit = setZoneValue(base, 2, 3, 'ignition', 30);
  assert.equal(standaloneEdit.ignition[3], 30);
  assert.equal(standaloneEdit.ignition[2], 12, 'neighbouring breakpoints are untouched');
  assert.equal(zoneValue(standaloneEdit, 2, 3, 'ignition'), 30);

  // Edits are clamped to the physical range.
  assert.equal(setZoneValue(base, 2, 0, 'ignition', 999).ignition[0], TUNE.maxIgnition);
  assert.equal(setZoneValue(base, 2, 0, 'lambda', -5).lambda[0], TUNE.minLambda);
});

it("Downgrading the ECU flattens a map the new hardware could not produce.", () => {
  const detailed = { ignition: [5, 10, 15, 20, 25, 30, 35], lambda: [1, 1, 1, 1, 1, 1, 1] };
  const onStock = projectToEcu(detailed, 0);
  assert.equal(new Set(onStock.ignition).size, 1, 'a stock ECU can only hold one value');
  assert.equal(onStock.ignition[0], 20, 'and it should be the mean of the old curve');

  const onTuner = projectToEcu(detailed, 1);
  assert.deepEqual(onTuner.ignition, [7.5, 7.5, 20, 20, 20, 32.5, 32.5], 'three-zone ECU averages within each zone');
});

it("Corrupt or short maps are repaired rather than trusted.", () => {
  const repaired = clampTune({ ignition: [999, NaN], lambda: [] } as never);
  assert.equal(repaired.ignition.length, TUNE_POINTS);
  assert.equal(repaired.lambda.length, TUNE_POINTS);
  assert.ok(repaired.ignition.every((v) => Number.isFinite(v) && v >= TUNE.minIgnition && v <= TUNE.maxIgnition));
  assert.ok(repaired.lambda.every((v) => Number.isFinite(v) && v >= TUNE.minLambda && v <= TUNE.maxLambda));
});
