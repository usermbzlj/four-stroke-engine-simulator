/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SmoothMetricOptions {
  timeConstant: number;
  maxDeltaPerSecond?: number;
  deadband?: number;
}

export interface TransientZeroOptions {
  zeroHoldSeconds: number;
  zeroDecayTimeConstant: number;
  elapsedZeroSeconds: number;
}

export interface TransientZeroResult {
  value: number;
  elapsedZeroSeconds: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function smoothMetric(previous: number, target: number, dt: number, options: SmoothMetricOptions): number {
  if (!Number.isFinite(target)) return previous;
  if (!Number.isFinite(previous)) return target;
  if (dt <= 0 || options.timeConstant <= 0) return target;

  const alpha = 1 - Math.exp(-dt / options.timeConstant);
  let next = previous + (target - previous) * alpha;

  if (options.maxDeltaPerSecond !== undefined) {
    const maxDelta = Math.max(0, options.maxDeltaPerSecond) * dt;
    next = previous + clamp(next - previous, -maxDelta, maxDelta);
  }

  if (options.deadband !== undefined && Math.abs(next) < options.deadband) return 0;
  return next;
}

export function holdTransientZero(
  previous: number,
  target: number,
  dt: number,
  options: TransientZeroOptions
): TransientZeroResult {
  if (target > 0) {
    return { value: target, elapsedZeroSeconds: 0 };
  }

  const elapsedZeroSeconds = options.elapsedZeroSeconds + Math.max(0, dt);
  if (elapsedZeroSeconds <= options.zeroHoldSeconds) {
    return { value: previous, elapsedZeroSeconds };
  }

  const value = smoothMetric(previous, 0, dt, {
    timeConstant: options.zeroDecayTimeConstant,
    deadband: 0.001,
  });

  return { value, elapsedZeroSeconds };
}
