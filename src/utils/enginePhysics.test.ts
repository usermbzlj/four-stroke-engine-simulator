/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {
  ENGINE_SPECS,
  MAX_THROTTLE,
  estimateBrakeTorque,
  rotationalDragTorque,
} from './enginePhysics';

const pristineWear = {
  pistonRings: 100,
  cylinderWall: 100,
  conrodBearings: 100,
  crankshaftJournal: 100,
  sparkPlug: 100,
  valves: 100,
};

{
  assert.equal(MAX_THROTTLE, 1.5);
}

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
