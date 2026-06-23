/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { EngineState, StrokeType } from '../types';
import {
  advanceReadableCrankAngle,
  getReadableVisualRpm,
  strokeFromCrankAngle,
} from './engineVisuals';

const nearlyEqual = (actual: number, expected: number, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

{
  nearlyEqual(getReadableVisualRpm(0), 0);
  nearlyEqual(getReadableVisualRpm(900), 900);
  assert.ok(getReadableVisualRpm(8000) <= 360, 'high-rpm display should be capped for readability');
  assert.ok(getReadableVisualRpm(8000) > 0, 'high-rpm display should keep moving');
}

{
  const physicalAngle = Math.PI * 1.3;
  const result = advanceReadableCrankAngle({
    previousAngle: 0,
    physicalAngle,
    rpm: 900,
    dt: 1 / 60,
    state: EngineState.RUNNING,
  });

  assert.equal(result.mode, 'synced');
  nearlyEqual(result.angle, physicalAngle);
}

{
  const result = advanceReadableCrankAngle({
    previousAngle: 0,
    physicalAngle: Math.PI * 3,
    rpm: 8000,
    dt: 1 / 60,
    state: EngineState.RUNNING,
  });
  const maxFrameAdvance = (getReadableVisualRpm(8000) * 2 * Math.PI / 60) * (1 / 60);

  assert.equal(result.mode, 'readable');
  assert.ok(result.angle <= maxFrameAdvance + 1e-6, 'high-rpm display should advance by capped visual speed');
  assert.ok(result.slowdownRatio > 10, 'mode should report a meaningful visual slowdown ratio');
}

{
  assert.equal(strokeFromCrankAngle(0), StrokeType.INTAKE);
  assert.equal(strokeFromCrankAngle(Math.PI + 0.01), StrokeType.COMPRESSION);
  assert.equal(strokeFromCrankAngle(Math.PI * 2 + 0.01), StrokeType.POWER);
  assert.equal(strokeFromCrankAngle(Math.PI * 3 + 0.01), StrokeType.EXHAUST);
}
