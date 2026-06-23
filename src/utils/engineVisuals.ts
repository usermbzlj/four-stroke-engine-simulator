/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EngineState, StrokeType } from '../types';

const TWO_PI = Math.PI * 2;
const FOUR_PI = Math.PI * 4;
const READABLE_RPM_THRESHOLD = 1400;
const MAX_READABLE_RPM = 360;

export type VisualMotionMode = 'synced' | 'readable';

export interface AdvanceReadableCrankAngleInput {
  previousAngle: number;
  physicalAngle: number;
  rpm: number;
  dt: number;
  state: EngineState;
}

export interface AdvanceReadableCrankAngleResult {
  angle: number;
  visualRpm: number;
  slowdownRatio: number;
  mode: VisualMotionMode;
}

export function normalizeCycleAngle(angle: number): number {
  const normalized = angle % FOUR_PI;
  return normalized < 0 ? normalized + FOUR_PI : normalized;
}

export function getReadableVisualRpm(rpm: number): number {
  const safeRpm = Math.max(0, rpm);
  if (safeRpm <= READABLE_RPM_THRESHOLD) return safeRpm;

  const over = safeRpm - READABLE_RPM_THRESHOLD;
  const eased = 210 + Math.sqrt(over) * 1.35;
  return Math.min(MAX_READABLE_RPM, eased);
}

export function strokeFromCrankAngle(angle: number): StrokeType {
  const thetaDeg = (normalizeCycleAngle(angle) * 180) / Math.PI;
  if (thetaDeg < 180) return StrokeType.INTAKE;
  if (thetaDeg < 360) return StrokeType.COMPRESSION;
  if (thetaDeg < 540) return StrokeType.POWER;
  return StrokeType.EXHAUST;
}

export function advanceReadableCrankAngle(input: AdvanceReadableCrankAngleInput): AdvanceReadableCrankAngleResult {
  const physicalAngle = normalizeCycleAngle(input.physicalAngle);
  const isRunning = input.state === EngineState.RUNNING || input.state === EngineState.STARTING;
  const visualRpm = getReadableVisualRpm(input.rpm);

  if (!isRunning || input.rpm <= READABLE_RPM_THRESHOLD || input.dt <= 0) {
    return {
      angle: physicalAngle,
      visualRpm: input.rpm,
      slowdownRatio: 1,
      mode: 'synced',
    };
  }

  const previousAngle = normalizeCycleAngle(input.previousAngle);
  const visualAngularVelocity = (visualRpm * TWO_PI) / 60;
  const angle = normalizeCycleAngle(previousAngle + visualAngularVelocity * input.dt);

  return {
    angle,
    visualRpm,
    slowdownRatio: input.rpm / Math.max(1, visualRpm),
    mode: 'readable',
  };
}
