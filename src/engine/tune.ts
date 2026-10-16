/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ECU tuning maps.
 *
 * Ignition advance and target lambda are not single numbers — they are curves
 * against RPM. An engine wants more advance as it revs (less time to burn) but
 * tolerates less of it when hot and highly compressed, so the interesting tune
 * is never flat: you chase MBT timing up top while staying the right side of
 * the knock limit, and you enrich where the engine needs charge cooling.
 *
 * How much of the curve you may actually shape is gated by the ECU you own:
 * a stock ECU moves all seven breakpoints together, a standalone unlocks them
 * individually.
 */

import type { EngineSpec, TuneMap, TuneSample } from '../types';
import { COMBUSTION, TUNE } from './constants';
import { knockLimitAdvance } from './physics';

/** Number of RPM breakpoints in every map. */
export const TUNE_POINTS = 7;

/**
 * RPM breakpoints for a spec: evenly spaced from a fixed low anchor up to the
 * engine's redline, so the editor always spans the usable range of the build.
 */
export function tuneBreakpoints(spec: EngineSpec): number[] {
  const lo = TUNE.lowAnchorRpm;
  const hi = Math.max(lo + TUNE_POINTS * 100, spec.redlineRpm);
  return Array.from({ length: TUNE_POINTS }, (_, i) => Math.round(lo + ((hi - lo) * i) / (TUNE_POINTS - 1)));
}

/** MBT (best-torque) ignition advance for an RPM, ignoring knock. */
export function mbtIgnition(rpm: number): number {
  return COMBUSTION.optTimingBase + rpm / COMBUSTION.optTimingRpmSlope;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sampleChannel(values: readonly number[], breakpoints: readonly number[], rpm: number): number {
  const last = Math.min(values.length, breakpoints.length) - 1;
  if (last < 0) return 0;
  const first = values[0] ?? 0;
  const tail = values[last] ?? first;
  if (rpm <= (breakpoints[0] ?? 0)) return first;
  if (rpm >= (breakpoints[last] ?? 0)) return tail;
  for (let i = 0; i < last; i++) {
    const lo = breakpoints[i] ?? 0;
    const hi = breakpoints[i + 1] ?? lo;
    if (rpm >= lo && rpm <= hi) {
      const t = hi === lo ? 0 : (rpm - lo) / (hi - lo);
      return lerp(values[i] ?? first, values[i + 1] ?? tail, t);
    }
  }
  return tail;
}

/** Interpolate the map at an operating point. */
export function sampleTune(tune: TuneMap, breakpoints: number[], rpm: number): TuneSample {
  return {
    ignition: sampleChannel(tune.ignition, breakpoints, rpm),
    lambda: sampleChannel(tune.lambda, breakpoints, rpm),
  };
}

/** A map with the same value at every breakpoint. */
export function flatTune(ignition: number, lambda: number): TuneMap {
  return {
    ignition: Array(TUNE_POINTS).fill(ignition),
    lambda: Array(TUNE_POINTS).fill(lambda),
  };
}

/** Target lambda a sane baseline would run at an RPM. */
function baselineLambda(spec: EngineSpec, rpm: number): number {
  const t = Math.min(1, rpm / Math.max(1, spec.redlineRpm));
  // Near-stoichiometric down low for a clean idle, rich up top for charge cooling.
  return clampLambda(lerp(1.0, spec.boostBar > 0 ? 0.84 : 0.89, t));
}

/**
 * A safe baseline for a build: the lower of MBT and the knock limit, minus a
 * fixed safety margin, evaluated at a slightly pessimistic design temperature.
 *
 * Because it is derived from the same {@link knockLimitAdvance} the physics
 * uses, it is knock-free by construction on any build — while still leaving a
 * couple of degrees on the table for the player to go and find on the dyno.
 */
export function autoTune(spec: EngineSpec): TuneMap {
  const breakpoints = tuneBreakpoints(spec);
  const lambda = breakpoints.map((rpm) => baselineLambda(spec, rpm));

  const ignition = breakpoints.map((rpm, i) => {
    const limit = knockLimitAdvance({ spec, lambda: lambda[i] ?? 0.9, rpm, cylinderTemp: TUNE.designTemp });
    return clampIgnition(Math.min(mbtIgnition(rpm), limit) - TUNE.baseSafetyMargin);
  });

  return { ignition, lambda };
}

/**
 * The knock-limit trace across the map's breakpoints, for the tuning UI to draw
 * as a ceiling over the ignition curve.
 */
export function knockCeiling(spec: EngineSpec, tune: TuneMap, cylinderTemp: number): number[] {
  return tuneBreakpoints(spec).map((rpm, i) =>
    knockLimitAdvance({ spec, lambda: tune.lambda[i] ?? 0.9, rpm, cylinderTemp })
  );
}

/** MBT trace across the map's breakpoints, for the tuning UI. */
export function mbtCeiling(spec: EngineSpec): number[] {
  return tuneBreakpoints(spec).map((rpm) => mbtIgnition(rpm));
}

export const clampIgnition = (v: number): number => Math.max(TUNE.minIgnition, Math.min(TUNE.maxIgnition, v));
export const clampLambda = (v: number): number => Math.max(TUNE.minLambda, Math.min(TUNE.maxLambda, v));

export function clampTune(tune: TuneMap): TuneMap {
  return {
    ignition: normaliseChannel(tune.ignition, clampIgnition, mbtIgnition(3000)),
    lambda: normaliseChannel(tune.lambda, clampLambda, 0.95),
  };
}

function normaliseChannel(values: unknown, clamp: (v: number) => number, fallback: number): number[] {
  const arr = Array.isArray(values) ? values : [];
  return Array.from({ length: TUNE_POINTS }, (_, i) => {
    const v = arr[i];
    return clamp(typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  });
}

// ---------------------------------------------------------------------------
// ECU tiers: which breakpoints the player may move independently
// ---------------------------------------------------------------------------

/**
 * Breakpoint indices grouped into editable zones. A stock ECU exposes one zone
 * spanning the whole map (so editing it keeps the curve flat); a standalone
 * exposes all seven individually.
 */
export function tuneZones(ecuTier: number): number[][] {
  if (ecuTier >= 2) return Array.from({ length: TUNE_POINTS }, (_, i) => [i]);
  if (ecuTier === 1) return [[0, 1], [2, 3, 4], [5, 6]];
  return [Array.from({ length: TUNE_POINTS }, (_, i) => i)];
}

export function zoneLabels(ecuTier: number): string[] {
  if (ecuTier >= 2) return Array.from({ length: TUNE_POINTS }, (_, i) => `断点 ${i + 1}`);
  if (ecuTier === 1) return ['低转区', '中转区', '高转区'];
  return ['全域固定值'];
}

/** Write a value into every breakpoint belonging to one editable zone. */
export function setZoneValue(
  tune: TuneMap,
  ecuTier: number,
  zoneIndex: number,
  channel: 'ignition' | 'lambda',
  value: number
): TuneMap {
  const zones = tuneZones(ecuTier);
  const zone = zones[zoneIndex];
  if (!zone) return tune;
  const clamp = channel === 'ignition' ? clampIgnition : clampLambda;
  const next = [...tune[channel]];
  const clamped = clamp(value);
  for (const i of zone) next[i] = clamped;
  return { ...tune, [channel]: next };
}

/** Representative current value of a zone (zones are kept internally uniform). */
export function zoneValue(tune: TuneMap, ecuTier: number, zoneIndex: number, channel: 'ignition' | 'lambda'): number {
  const zone = tuneZones(ecuTier)[zoneIndex] ?? [0];
  const sum = zone.reduce((acc, i) => acc + (tune[channel][i] ?? 0), 0);
  return sum / zone.length;
}

/**
 * Collapse a map down to what a lower-tier ECU can actually represent. Called
 * when a preset built on a standalone is loaded onto a stock ECU, so the player
 * never ends up running a curve their hardware could not produce.
 */
export function projectToEcu(tune: TuneMap, ecuTier: number): TuneMap {
  let out = clampTune(tune);
  const zones = tuneZones(ecuTier);
  for (const channel of ['ignition', 'lambda'] as const) {
    const next = [...out[channel]];
    for (const zone of zones) {
      const mean = zone.reduce((acc, i) => acc + (next[i] ?? 0), 0) / zone.length;
      for (const i of zone) next[i] = mean;
    }
    out = { ...out, [channel]: next };
  }
  return out;
}
