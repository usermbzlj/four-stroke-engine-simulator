/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { holdTransientZero, smoothMetric } from './telemetrySmoothing';

const nearlyEqual = (actual: number, expected: number, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

{
  const result = smoothMetric(1000, 7000, 0.1, { timeConstant: 0.5 });

  assert.ok(result > 1000, 'EMA should move toward the target');
  assert.ok(result < 3000, 'EMA should not jump straight to a new raw sample');
}

{
  const result = smoothMetric(1000, 7000, 0.1, {
    timeConstant: 0.01,
    maxDeltaPerSecond: 1500,
  });

  nearlyEqual(result, 1150);
}

{
  const held = holdTransientZero(42, 0, 0.1, {
    zeroHoldSeconds: 0.35,
    zeroDecayTimeConstant: 0.8,
    elapsedZeroSeconds: 0.1,
  });
  const decayed = holdTransientZero(42, 0, 0.1, {
    zeroHoldSeconds: 0.35,
    zeroDecayTimeConstant: 0.8,
    elapsedZeroSeconds: 0.5,
  });

  nearlyEqual(held.value, 42);
  assert.equal(held.elapsedZeroSeconds, 0.2);
  assert.ok(decayed.value > 0 && decayed.value < 42, 'extended zero should decay instead of dropping instantly');
}

{
  const recovered = holdTransientZero(12, 18, 0.1, {
    zeroHoldSeconds: 0.35,
    zeroDecayTimeConstant: 0.8,
    elapsedZeroSeconds: 0.5,
  });

  assert.equal(recovered.value, 18);
  assert.equal(recovered.elapsedZeroSeconds, 0);
}
