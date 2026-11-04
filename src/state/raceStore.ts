/**
 * Timed runs on the strip: what is staged, the last result, personal bests
 * (with their trace, to race as a ghost) and a short history.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { RACE_EVENTS, type RaceEventId, type RaceResult, type Rider } from '../sim/race';
import type { ChassisId } from '../sim/vehicle';

export interface RunRecord {
  result: RaceResult;
  /** Short description of the build, e.g. "450 · 赛道车 · 涡轮". */
  build: string;
  at: number;
}

interface RaceState {
  event: RaceEventId;
  rider: Rider;
  ghost: boolean;
  /** A run is staged or going. */
  live: boolean;
  last: RunRecord | null;
  /** Best per `${chassis}:${event}`. */
  bests: Record<string, RunRecord>;
  history: RunRecord[];
  set: (patch: Partial<Omit<RaceState, 'set'>>) => void;
}

export const bestKey = (chassis: ChassisId, event: RaceEventId): string => `${chassis}:${event}`;

/** Lower is better, except for top speed. */
export function better(a: RaceResult, b: RaceResult | undefined): boolean {
  if (a.dnf) return false;
  if (!b || b.dnf) return true;
  if (RACE_EVENTS[a.event].measure === 'topSpeed') return a.topKmh > b.topKmh;
  return (a.time ?? Infinity) < (b.time ?? Infinity);
}

/** The number a run is ranked on, formatted. */
export function scoreText(r: RaceResult): string {
  if (r.dnf) return '未完成';
  if (RACE_EVENTS[r.event].measure === 'topSpeed') return `${r.topKmh.toFixed(1)} km/h`;
  return `${(r.time ?? 0).toFixed(2)} 秒`;
}

export const useRace = create<RaceState>()(
  persist(
    (set) => ({
      event: 'drag100',
      rider: 'auto',
      ghost: true,
      live: false,
      last: null,
      bests: {},
      history: [],
      set: (patch) => set(patch),
    }),
    {
      name: 'engine-bench:race',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ event: s.event, rider: s.rider, ghost: s.ghost, bests: s.bests, history: s.history.slice(0, 12) }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<RaceState>;
        return {
          ...current,
          event: p.event && p.event in RACE_EVENTS ? p.event : current.event,
          rider: p.rider === 'manual' ? 'manual' : 'auto',
          ghost: p.ghost !== false,
          bests: p.bests && typeof p.bests === 'object' ? p.bests : {},
          history: Array.isArray(p.history) ? p.history.slice(0, 12) : [],
        };
      },
    },
  ),
);
