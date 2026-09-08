/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChallengeId, GarageState, TunePreset } from '../types';
import { INITIAL_GARAGE } from './gameplay';

const STORAGE_KEY = 'four-stroke-sim:v1';

/** Persisted slice of player progress (everything that should survive a refresh). */
export interface PersistedProgress {
  garage: GarageState;
  presets: TunePreset[];
  best: Record<ChallengeId, number>;
}

const EMPTY_BEST: Record<ChallengeId, number> = { idle: 0, dyno: 0, endurance: 0, redline: 0 };

export const DEFAULT_PROGRESS: PersistedProgress = {
  garage: { ...INITIAL_GARAGE },
  presets: [],
  best: { ...EMPTY_BEST },
};

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const toFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Load persisted progress, tolerating missing/corrupt data. */
export function loadProgress(): PersistedProgress {
  if (!isBrowser()) return { ...DEFAULT_PROGRESS, garage: { ...INITIAL_GARAGE }, best: { ...EMPTY_BEST }, presets: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredCloneProgress(DEFAULT_PROGRESS);
    const parsed = JSON.parse(raw) as Partial<PersistedProgress>;

    const garage: GarageState = {
      credits: toFiniteNumber(parsed.garage?.credits, INITIAL_GARAGE.credits),
      runtimeHours: toFiniteNumber(parsed.garage?.runtimeHours, 0),
      score: toFiniteNumber(parsed.garage?.score, 0),
    };

    const best: Record<ChallengeId, number> = {
      idle: toFiniteNumber(parsed.best?.idle, 0),
      dyno: toFiniteNumber(parsed.best?.dyno, 0),
      endurance: toFiniteNumber(parsed.best?.endurance, 0),
      redline: toFiniteNumber(parsed.best?.redline, 0),
    };

    const presets: TunePreset[] = Array.isArray(parsed.presets)
      ? parsed.presets
          .filter((p): p is TunePreset => !!p && typeof p.name === 'string' && !!p.params)
          .slice(-6)
      : [];

    return { garage, best, presets };
  } catch {
    return structuredCloneProgress(DEFAULT_PROGRESS);
  }
}

/** Persist progress; silently no-ops when storage is unavailable. */
export function saveProgress(progress: PersistedProgress): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage full / disabled (private mode) — non-fatal.
  }
}

/** Clear all persisted progress. */
export function clearProgress(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function structuredCloneProgress(p: PersistedProgress): PersistedProgress {
  return {
    garage: { ...p.garage },
    presets: p.presets.map((preset) => ({ ...preset, params: { ...preset.params } })),
    best: { ...p.best },
  };
}
