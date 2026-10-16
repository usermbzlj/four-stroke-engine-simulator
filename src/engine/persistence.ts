/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Save/load. The schema grew a build, an ECU map and a career, so this reads
 * both the v1 layout and the current one — an existing player keeps their
 * credits and hours instead of being reset to zero.
 */

import type { EngineBuild, GarageState, TuneMap, TunePreset } from '../types';
import { INITIAL_GARAGE } from './career';
import { defaultBuild, getBlock, getPart, PART_SLOTS, resolveBuild, starterOwned, stockPartFor } from './parts';
import { autoTune, clampTune, projectToEcu } from './tune';

const STORAGE_KEY = 'four-stroke-sim:v2';
const LEGACY_KEY = 'four-stroke-sim:v1';
const MAX_PRESETS = 8;

export interface PersistedProgress {
  garage: GarageState;
  build: EngineBuild;
  tune: TuneMap;
  presets: TunePreset[];
  /** Whether the player has already been walked through the basics. */
  onboarded: boolean;
}

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const toFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function defaultProgress(): PersistedProgress {
  const build = defaultBuild();
  return {
    garage: { ...INITIAL_GARAGE, owned: starterOwned(), stars: {}, best: {} },
    build,
    tune: autoTune(resolveBuild(build)),
    presets: [],
    onboarded: false,
  };
}

function sanitiseBuild(raw: unknown): EngineBuild {
  const fallback = defaultBuild();
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Partial<EngineBuild>;

  const blockId = typeof candidate.blockId === 'string' ? getBlock(candidate.blockId).id : fallback.blockId;
  const installed: EngineBuild['installed'] = {};
  for (const slot of PART_SLOTS) {
    const id = candidate.installed?.[slot];
    const part = typeof id === 'string' ? getPart(id) : undefined;
    // Reject a part saved into the wrong slot as well as one that no longer exists.
    installed[slot] = part && part.slot === slot ? part.id : stockPartFor(slot).id;
  }
  return { blockId, installed };
}

function sanitiseStringRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function sanitisePresets(raw: unknown): TunePreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is TunePreset => !!p && typeof p === 'object' && typeof (p as TunePreset).name === 'string')
    .map((p) => ({ name: p.name, tune: clampTune((p as TunePreset).tune ?? { ignition: [], lambda: [] }) }))
    .slice(-MAX_PRESETS);
}

/**
 * Read a v1 save (credits / runtimeHours / score only) so returning players
 * keep what they earned. Everything else falls back to a fresh career.
 */
function migrateLegacy(): PersistedProgress | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { garage?: { credits?: unknown; runtimeHours?: unknown; score?: unknown } };
    const base = defaultProgress();
    return {
      ...base,
      garage: {
        ...base.garage,
        credits: toFiniteNumber(parsed.garage?.credits, base.garage.credits),
        runtimeHours: toFiniteNumber(parsed.garage?.runtimeHours, 0),
        score: toFiniteNumber(parsed.garage?.score, 0),
      },
    };
  } catch {
    return null;
  }
}

/** Load persisted progress, tolerating missing, partial or corrupt data. */
export function loadProgress(): PersistedProgress {
  if (!isBrowser()) return defaultProgress();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateLegacy() ?? defaultProgress();

    const parsed = JSON.parse(raw) as Partial<PersistedProgress>;
    const fallback = defaultProgress();
    const build = sanitiseBuild(parsed.build);
    const spec = resolveBuild(build);

    const owned = Array.isArray(parsed.garage?.owned)
      ? Array.from(new Set([...starterOwned(), ...parsed.garage!.owned.filter((id): id is string => typeof id === 'string')]))
      : starterOwned();

    const garage: GarageState = {
      credits: toFiniteNumber(parsed.garage?.credits, INITIAL_GARAGE.credits),
      runtimeHours: toFiniteNumber(parsed.garage?.runtimeHours, 0),
      score: toFiniteNumber(parsed.garage?.score, 0),
      tier: Math.max(0, Math.round(toFiniteNumber(parsed.garage?.tier, 0))),
      stars: sanitiseStringRecord(parsed.garage?.stars),
      best: sanitiseStringRecord(parsed.garage?.best),
      owned,
    };

    // A map saved on a standalone ECU must not survive a downgrade to a stock one.
    const tune = parsed.tune ? projectToEcu(clampTune(parsed.tune), spec.ecuTier) : fallback.tune;

    return {
      garage,
      build,
      tune,
      presets: sanitisePresets(parsed.presets),
      onboarded: parsed.onboarded === true,
    };
  } catch {
    return defaultProgress();
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

/** Wipe the career. Used by the "重开生涯" action. */
export function clearProgress(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}
