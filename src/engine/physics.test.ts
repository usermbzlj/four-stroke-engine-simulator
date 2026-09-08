/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {
  ENGINE_SPECS,
  MAX_THROTTLE,
  estimateBrakeTorque,
  getChamberState,
  oilPressureBar,
  rotationalDragTorque,
  smoothThrottle,
  torqueToPowerHp,
  volumetricEfficiency,
} from './physics';
import { ComponentWear } from '../types';

const pristineWear: ComponentWear = {
  pistonRings: 100,
  cylinderWall: 100,
  conrodBearings: 100,
  crankshaftJournal: 100,
  sparkPlug: 100,
  valves: 100,
};

const nearlyEqual = (actual: number, expected: number, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

// MAX_THROTTLE contract
{
  assert.equal(MAX_THROTTLE, 1.5);
}

// Overdrive throttle keeps positive high-rpm torque margin (regression).
{
  const stock = ENGINE_SPECS[0];
  const targetRpm = stock.destructRpm * 0.95;
  const bestTiming = 10 + targetRpm / 280;
  const brakeTorque = estimateBrakeTorque(targetRpm, MAX_THROTTLE, 0.92, bestTiming, stock, pristineWear, false);
  const highRpmDrag = rotationalDragTorque(targetRpm);

  assert.ok(
    brakeTorque - highRpmDrag > 2,
    `expected overdrive throttle to keep positive high-rpm torque margin, got ${(brakeTorque - highRpmDrag).toFixed(2)} Nm`
  );
}

// VE curve peaks near the spec torque-peak RPM and stays bounded.
{
  const stock = ENGINE_SPECS[0];
  const vePeak = volumetricEfficiency(stock.torquePeakRpm, stock);
  const veLow = volumetricEfficiency(800, stock);
  const veHigh = volumetricEfficiency(stock.redlineRpm, stock);
  assert.ok(vePeak >= veLow, 'VE at peak should be >= VE at low rpm');
  assert.ok(vePeak >= veHigh, 'VE at peak should be >= VE at redline');
  assert.ok(vePeak <= 1.12 && vePeak >= 0.12, 'VE stays within clamp bounds');
}

// Lambda sweep: stoich/power region out-torques very lean and very rich.
{
  const stock = ENGINE_SPECS[0];
  const rpm = stock.torquePeakRpm;
  const timing = 10 + rpm / 280;
  const power = estimateBrakeTorque(rpm, 1.0, 0.92, timing, stock, pristineWear, false);
  const lean = estimateBrakeTorque(rpm, 1.0, 1.45, timing, stock, pristineWear, false);
  const rich = estimateBrakeTorque(rpm, 1.0, 0.62, timing, stock, pristineWear, false);
  assert.ok(power > lean, 'power lambda should beat very lean');
  assert.ok(power > rich, 'power lambda should beat very rich');
}

// Nitrous boosts torque.
{
  const stock = ENGINE_SPECS[0];
  const rpm = stock.torquePeakRpm;
  const timing = 10 + rpm / 280;
  const dry = estimateBrakeTorque(rpm, 1.0, 0.92, timing, stock, pristineWear, false);
  const wet = estimateBrakeTorque(rpm, 1.0, 0.92, timing, stock, pristineWear, true);
  assert.ok(wet > dry, 'nitrous should increase torque');
}

// Oil pressure rises with rpm, vanishes when starved, and is bounded.
{
  assert.equal(oilPressureBar(0, 100, 90, pristineWear), 0, 'no rotation => no pressure');
  const lowRpm = oilPressureBar(1000, 100, 90, pristineWear);
  const highRpm = oilPressureBar(5000, 100, 90, pristineWear);
  assert.ok(highRpm > lowRpm, 'pressure should rise with rpm');
  assert.ok(highRpm <= 6.5, 'pressure stays within clamp');
  assert.ok(oilPressureBar(5000, 0, 90, pristineWear) === 0, 'no oil => no pressure');
}

// Power conversion identity.
{
  nearlyEqual(torqueToPowerHp(7127, 1), 1);
  nearlyEqual(torqueToPowerHp(0, 5000), 0);
}

// Throttle lag closes faster than it opens.
{
  const opening = smoothThrottle(0, 1, 0.05);
  const closing = smoothThrottle(1, 0, 0.05);
  assert.ok(opening > 0 && opening < 1, 'opening lags toward target');
  // closing should cover more fractional distance than opening at the same dt
  assert.ok(1 - closing > opening - 0 - 1e-9 || 1 - closing >= opening, 'closing tau is faster');
}

// Deterministic chamber state with injected RNG: power stroke ignites with good mixture.
{
  const stock = ENGINE_SPECS[0];
  const powerAngle = (Math.PI * 4) * (450 / 720); // mid power stroke
  const rng = () => 0.99; // never trip the random misfire
  const chamber = getChamberState(powerAngle, 0.8, 0.92, true, pristineWear, false, 12, 3000, stock, 90, 0, rng);
  assert.equal(chamber.ignited, true, 'good mixture + spark should ignite');
  assert.ok(chamber.pressure > 5, 'combustion should build meaningful pressure');
}

// Lean beyond the flammability limit misfires deterministically.
{
  const stock = ENGINE_SPECS[0];
  const powerAngle = (Math.PI * 4) * (450 / 720);
  const rng = () => 0; // force the random misfire branch where applicable
  const chamber = getChamberState(powerAngle, 0.8, 1.5, true, pristineWear, false, 12, 3000, stock, 90, 0, rng);
  assert.equal(chamber.ignited, false, 'over-lean mixture should not ignite');
}

// High compression + hot + over-advanced timing produces knock.
{
  const race = ENGINE_SPECS[1];
  const powerAngle = (Math.PI * 4) * (440 / 720);
  const rng = () => 0.99;
  const chamber = getChamberState(powerAngle, 1.0, 0.92, true, pristineWear, false, 38, 8000, race, 130, 0, rng);
  assert.ok(chamber.knockSeverity > 0, 'aggressive timing on a hot high-CR engine should knock');
}
