import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  clampBench,
  clampConfig,
  clampEcu,
  DEFAULT_BENCH,
  DEFAULT_PRESET,
  PRESETS,
  type BenchConfig,
  type EcuConfig,
  type EngineConfig,
} from '../sim/config';

export interface DynoRun {
  id: number;
  label: string;
  /** [rpm, brake torque Nm], ascending rpm. */
  points: [number, number][];
}

interface BenchState {
  presetId: string;
  config: EngineConfig;
  ecu: EcuConfig;
  bench: BenchConfig;
  volume: number;
  runs: DynoRun[];
  loadPreset: (id: string) => void;
  setConfig: (patch: Partial<EngineConfig>) => void;
  setEcu: (patch: Partial<EcuConfig>) => void;
  setBench: (patch: Partial<BenchConfig>) => void;
  setVolume: (v: number) => void;
  addRun: (points: [number, number][]) => void;
  removeRun: (id: number) => void;
}

const STORAGE_KEY = 'engine-bench:v1';
const MAX_RUNS = 4;

for (const old of ['four-stroke-sim:v1', 'four-stroke-sim:v2']) {
  try {
    localStorage.removeItem(old);
  } catch {
    // Storage can be unavailable (private mode); nothing to clean then.
  }
}

export const useBench = create<BenchState>()(
  persist(
    (set, get) => ({
      presetId: DEFAULT_PRESET.id,
      config: DEFAULT_PRESET.engine,
      ecu: DEFAULT_PRESET.ecu,
      bench: DEFAULT_BENCH,
      volume: 0.7,
      runs: [],
      loadPreset: (id) => {
        const p = PRESETS.find((x) => x.id === id) ?? DEFAULT_PRESET;
        set({ presetId: p.id, config: p.engine, ecu: p.ecu });
      },
      setConfig: (patch) => set({ config: clampConfig({ ...get().config, ...patch }), presetId: 'custom' }),
      setEcu: (patch) => set({ ecu: clampEcu({ ...get().ecu, ...patch }) }),
      setBench: (patch) => set({ bench: clampBench({ ...get().bench, ...patch }) }),
      setVolume: (v) => set({ volume: Math.min(1, Math.max(0, v)) }),
      addRun: (points) => {
        const runs = get().runs;
        const id = (runs.at(-1)?.id ?? 0) + 1;
        set({ runs: [...runs, { id, label: `第 ${id} 次`, points }].slice(-MAX_RUNS) });
      },
      removeRun: (id) => set({ runs: get().runs.filter((r) => r.id !== id) }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        presetId: s.presetId,
        config: s.config,
        ecu: s.ecu,
        bench: s.bench,
        volume: s.volume,
        runs: s.runs,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<BenchState>;
        return {
          ...current,
          presetId: typeof p.presetId === 'string' ? p.presetId : current.presetId,
          config: p.config ? clampConfig({ ...current.config, ...p.config }) : current.config,
          ecu: p.ecu ? clampEcu({ ...current.ecu, ...p.ecu }) : current.ecu,
          bench: p.bench ? clampBench({ ...current.bench, ...p.bench }) : current.bench,
          volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : current.volume,
          runs: Array.isArray(p.runs) ? p.runs.slice(-MAX_RUNS) : current.runs,
        };
      },
    },
  ),
);
