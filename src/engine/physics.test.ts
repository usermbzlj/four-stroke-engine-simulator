/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import {
  MAX_THROTTLE,
  estimateBrakeTorque,
  effectiveOilLevel,
  flammabilityLimits,
  getChamberState,
  knockSeverity,
  oilPressureBar,
  smoothThrottle,
  torqueToPowerHp,
  volumetricEfficiency,
} from './physics';
import { defaultBuild, resolveBuild } from './parts';
import { mbtIgnition } from './tune';
import type { ComponentWear, EngineSpec } from '../types';

const pristineWear: ComponentWear = {
  pistonRings: 100,
  cylinderWall: 100,
  conrodBearings: 100,
  crankshaftJournal: 100,
  sparkPlug: 100,
  valves: 100,
};

const stock = resolveBuild(defaultBuild());
const raceBlock = resolveBuild({ ...defaultBuild(), blockId: 'block-450' });

const nearlyEqual = (actual: number, expected: number, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

const torqueAt = (spec: EngineSpec, rpm: number, lambda: number, ignition: number, hasNitrous = false, knock = 0) =>
  estimateBrakeTorque({ rpm, throttle: 1, lambda, ignition, spec, wear: pristineWear, hasNitrous, knock });

it("A butterfly cannot open more than all the way; extra air now comes from boost parts.", () => {
  assert.equal(MAX_THROTTLE, 1.0);
});

it("VE curve peaks near the spec torque-peak RPM and stays bounded.", () => {
  const vePeak = volumetricEfficiency(stock.torquePeakRpm, stock);
  const veLow = volumetricEfficiency(800, stock);
  const veHigh = volumetricEfficiency(stock.redlineRpm, stock);
  assert.ok(vePeak >= veLow, 'VE at peak should be >= VE at low rpm');
  assert.ok(vePeak >= veHigh, 'VE at peak should be >= VE at redline');
  assert.ok(vePeak <= 1.35 && vePeak >= 0.1, 'VE stays within clamp bounds');
});

it("A race cam trades bottom end for top end, and does so continuously.", () => {
  const raceCam = resolveBuild({ ...defaultBuild(), installed: { ...defaultBuild().installed, cam: 'cam-race' } });
  assert.ok(
    volumetricEfficiency(1600, raceCam) < volumetricEfficiency(1600, stock),
    'race cam should lose low-rpm breathing'
  );
  assert.ok(
    volumetricEfficiency(raceCam.redlineRpm, raceCam) > volumetricEfficiency(stock.redlineRpm, stock),
    'race cam should gain top-end breathing'
  );

  // No step change across the torque peak: sample either side of the blend.
  const below = volumetricEfficiency(raceCam.torquePeakRpm - 20, raceCam);
  const above = volumetricEfficiency(raceCam.torquePeakRpm + 20, raceCam);
  assert.ok(Math.abs(above - below) < 0.02, `VE must be continuous across the peak, jumped ${Math.abs(above - below)}`);
});

it("Lambda sweep: the power region out-torques very lean and very rich.", () => {
  const rpm = stock.torquePeakRpm;
  const timing = mbtIgnition(rpm);
  assert.ok(torqueAt(stock, rpm, 0.92, timing) > torqueAt(stock, rpm, 1.45, timing), 'power lambda beats very lean');
  assert.ok(torqueAt(stock, rpm, 0.92, timing) > torqueAt(stock, rpm, 0.62, timing), 'power lambda beats very rich');
});

it("MBT timing beats both retarded and over-advanced timing.", () => {
  const rpm = 5000;
  const mbt = mbtIgnition(rpm);
  const best = torqueAt(stock, rpm, 0.92, mbt);
  assert.ok(best > torqueAt(stock, rpm, 0.92, mbt - 14), 'MBT beats heavily retarded');
  assert.ok(best > torqueAt(stock, rpm, 0.92, mbt + 14), 'MBT beats over-advanced');
});

it("Knock costs measured torque — a detonating tune must not read as free power.", () => {
  const rpm = 5000;
  const mbt = mbtIgnition(rpm);
  assert.ok(
    torqueAt(stock, rpm, 0.92, mbt, false, 0.6) < torqueAt(stock, rpm, 0.92, mbt, false, 0),
    'heavy knock should reduce reported torque'
  );
});

it("Nitrous boosts torque.", () => {
  const rpm = stock.torquePeakRpm;
  const timing = mbtIgnition(rpm);
  assert.ok(torqueAt(stock, rpm, 0.92, timing, true) > torqueAt(stock, rpm, 0.92, timing, false));
});

it("Oil pressure rises with rpm, vanishes when starved, and is bounded.", () => {
  assert.equal(oilPressureBar(0, 100, 90, pristineWear), 0, 'no rotation => no pressure');
  const lowRpm = oilPressureBar(1000, 100, 90, pristineWear);
  const highRpm = oilPressureBar(5000, 100, 90, pristineWear);
  assert.ok(highRpm > lowRpm, 'pressure should rise with rpm');
  assert.ok(highRpm <= 6.5, 'pressure stays within clamp');
  assert.equal(oilPressureBar(5000, 0, 90, pristineWear), 0, 'no oil => no pressure');
});

it("A bigger sump keeps pressure alive at a gauge level that would starve a stock one.", () => {
  const stockSump = oilPressureBar(4000, 30, 95, pristineWear, 1);
  const deepSump = oilPressureBar(4000, 30, 95, pristineWear, 1.9);
  assert.ok(deepSump > stockSump, 'extra capacity should sustain pressure at a low gauge reading');
  assert.equal(effectiveOilLevel(60, 1.9), 100, 'effective level saturates at full');
});

it("A hotter ignition system widens the flammability window.", () => {
  const stockLimits = flammabilityLimits(stock);
  const cdi = resolveBuild({ ...defaultBuild(), installed: { ...defaultBuild().installed, ignition: 'ign-cdi' } });
  const cdiLimits = flammabilityLimits(cdi);
  assert.ok(cdiLimits.lean > stockLimits.lean, 'stronger spark should tolerate leaner mixtures');
  assert.ok(cdiLimits.rich < stockLimits.rich, 'stronger spark should tolerate richer mixtures');
});

it("Power conversion identity.", () => {
  nearlyEqual(torqueToPowerHp(7127, 1), 1);
  nearlyEqual(torqueToPowerHp(0, 5000), 0);
});

it("Throttle lag closes faster than it opens.", () => {
  const opening = smoothThrottle(0, 1, 0.05);
  const closing = smoothThrottle(1, 0, 0.05);
  assert.ok(opening > 0 && opening < 1, 'opening lags toward target');
  assert.ok(1 - closing >= opening, 'closing tau is faster');
});

it("Knock model: conservative timing on a cool stock engine is clean.", () => {
  const clean = knockSeverity({ spec: stock, ignition: 12, lambda: 0.92, rpm: 3000, throttle: 1, cylinderTemp: 85 });
  assert.equal(clean, 0, 'a cool, conservatively timed stock engine should not knock');
});

it("Knock model: heat, compression and advance all push it the right way.", () => {
  const hot = knockSeverity({ spec: raceBlock, ignition: 38, lambda: 0.92, rpm: 8000, throttle: 1, cylinderTemp: 130 });
  assert.ok(hot > 0, 'aggressive timing on a hot high-CR engine should knock');

  const cooler = knockSeverity({ spec: raceBlock, ignition: 38, lambda: 0.92, rpm: 8000, throttle: 1, cylinderTemp: 95 });
  assert.ok(cooler < hot, 'lowering cylinder temperature should reduce knock');

  const richer = knockSeverity({ spec: raceBlock, ignition: 38, lambda: 0.8, rpm: 8000, throttle: 1, cylinderTemp: 130 });
  assert.ok(richer < hot, 'enriching should suppress knock');
});

it("Knock resistance bought in the shop must actually buy knock margin.", () => {
  const base = defaultBuild();
  const hotHead = resolveBuild({
    ...base,
    installed: { ...base.installed, piston: 'piston-race-128', cooling: 'cool-stock' },
  });
  const cooled = resolveBuild({
    ...base,
    installed: { ...base.installed, piston: 'piston-race-128', cooling: 'cool-race' },
  });
  const args = { ignition: 30, lambda: 0.92, rpm: 6000, throttle: 1, cylinderTemp: 115 };
  assert.ok(
    knockSeverity({ spec: cooled, ...args }) < knockSeverity({ spec: hotHead, ...args }),
    'a cooling package should reduce knock at the same operating point'
  );
});

it("Deterministic chamber state: power stroke ignites with a good mixture.", () => {
  const powerAngle = Math.PI * 4 * (450 / 720);
  const chamber = getChamberState({
    angleRad: powerAngle,
    throttle: 0.8,
    lambda: 0.92,
    ignition: 12,
    rpm: 3000,
    spec: stock,
    wear: pristineWear,
    isRunning: true,
    hasNitrous: false,
    cylinderTemp: 90,
    choke: 0,
    rng: () => 0.99,
  });
  assert.equal(chamber.ignited, true, 'good mixture + spark should ignite');
  assert.ok(chamber.pressure > 5, 'combustion should build meaningful pressure');
});

it("Lean beyond the flammability limit misfires deterministically.", () => {
  const powerAngle = Math.PI * 4 * (450 / 720);
  const chamber = getChamberState({
    angleRad: powerAngle,
    throttle: 0.8,
    lambda: 1.5,
    ignition: 12,
    rpm: 3000,
    spec: stock,
    wear: pristineWear,
    isRunning: true,
    hasNitrous: false,
    cylinderTemp: 90,
    choke: 0,
    rng: () => 0,
  });
  assert.equal(chamber.ignited, false, 'over-lean mixture should not ignite');
  assert.equal(chamber.misfire, true, 'and it should be reported as a misfire');
});
