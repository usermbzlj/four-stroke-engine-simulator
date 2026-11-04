import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { BenchConfig, EcuConfig, EngineConfig } from '../sim/config';
import type { VehicleConfig } from '../sim/vehicle';
import type { Baseline, DynoRun } from '../state/benchStore';
import type { AcceptanceResult } from './acceptance';
import { JOBS } from './jobs';

export type Mode = 'sandbox' | 'job';

export interface JobProgress {
  stars: number;
  bestHp: number;
  /** Curve of the best-starred run, for comparison. */
  bestCurve: [number, number][];
  cost: number;
}

export interface SavedBuild {
  presetId: string;
  baseline: Baseline;
  config: EngineConfig;
  ecu: EcuConfig;
  vehicle?: VehicleConfig;
  bench: BenchConfig;
  runs: DynoRun[];
}

export interface LastResult {
  /** Build signature the result belongs to. */
  sig: string;
  cost: number;
  result: AcceptanceResult;
}

interface GameState {
  mode: Mode;
  jobId: string | null;
  progress: Record<string, JobProgress>;
  drafts: Record<string, SavedBuild>;
  results: Record<string, LastResult>;
  /** The sandbox build, kept while away on a job. */
  sandbox: SavedBuild | null;
  /** Tips already opened, per job. */
  tips: Record<string, boolean>;
  set: (patch: Partial<Omit<GameState, 'set'>>) => void;
}

export const useGame = create<GameState>()(
  persist(
    (set) => ({
      mode: 'sandbox',
      jobId: null,
      progress: {},
      drafts: {},
      results: {},
      sandbox: null,
      tips: {},
      set: (patch) => set(patch),
    }),
    {
      name: 'engine-bench:game',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        mode: s.mode,
        jobId: s.jobId,
        progress: s.progress,
        drafts: s.drafts,
        results: s.results,
        sandbox: s.sandbox,
        tips: s.tips,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<GameState>;
        const obj = <T,>(v: unknown, d: T): T => (v && typeof v === 'object' ? (v as T) : d);
        const jobId = typeof p.jobId === 'string' && JOBS.some((j) => j.id === p.jobId) ? p.jobId : null;
        return {
          ...current,
          mode: p.mode === 'job' && jobId ? 'job' : 'sandbox',
          jobId,
          progress: obj(p.progress, {}),
          drafts: obj(p.drafts, {}),
          results: obj(p.results, {}),
          sandbox: obj(p.sandbox, null),
          tips: obj(p.tips, {}),
        };
      },
    },
  ),
);

export function totalStars(progress: Record<string, JobProgress>): number {
  return Object.values(progress).reduce((s, p) => s + (p?.stars ?? 0), 0);
}

/** A job is open once the one before it has at least one star. */
export function isUnlocked(index: number, progress: Record<string, JobProgress>): boolean {
  if (index <= 0) return true;
  const prev = JOBS[index - 1];
  return !!prev && (progress[prev.id]?.stars ?? 0) > 0;
}

const RANKS: [number, string][] = [
  [0, '学徒'],
  [3, '帮工'],
  [8, '台架工'],
  [14, '调校师'],
  [21, '老师傅'],
  [28, '老周点头'],
  [33, '单缸之王'],
];

/** Workshop title for a star count, and the stars needed for the next one. */
export function rank(stars: number): { title: string; next: number | null } {
  let title = RANKS[0]![1];
  let next: number | null = null;
  for (const [need, t] of RANKS) {
    if (stars >= need) title = t;
    else {
      next = need;
      break;
    }
  }
  return { title, next };
}
