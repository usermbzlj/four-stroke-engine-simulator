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
  type EnginePreset,
} from '../sim/config';
import { clampVehicle, DEFAULT_VEHICLE, type VehicleConfig } from '../sim/vehicle';

export interface DynoRun {
  id: number;
  label: string;
  /** [rpm, brake torque Nm], ascending rpm. */
  points: [number, number][];
  /** Build + calibration the curve was taken with. */
  sig?: string;
}

/** The build the current one started from: the "factory" marks and the zero of the parts bill. */
export interface Baseline {
  name: string;
  config: EngineConfig;
  ecu: EcuConfig;
  /** Missing on builds saved before the track existed. */
  vehicle?: VehicleConfig;
}

interface BenchState {
  /** Preset the sandbox build came from, or 'custom' once changed. */
  presetId: string;
  baseline: Baseline;
  config: EngineConfig;
  ecu: EcuConfig;
  /** The machine the engine goes in on the track. */
  vehicle: VehicleConfig;
  bench: BenchConfig;
  volume: number;
  runs: DynoRun[];
  loadPreset: (id: string) => void;
  /** Put a whole build on the stand (job start, sandbox restore). */
  loadBuild: (b: { presetId: string; baseline: Baseline; config: EngineConfig; ecu: EcuConfig; vehicle?: VehicleConfig; bench?: BenchConfig; runs?: DynoRun[] }) => void;
  setVehicle: (patch: Partial<VehicleConfig>) => void;
  setConfig: (patch: Partial<EngineConfig>) => void;
  setEcu: (patch: Partial<EcuConfig>) => void;
  setBench: (patch: Partial<BenchConfig>) => void;
  setVolume: (v: number) => void;
  addRun: (points: [number, number][], label?: string) => DynoRun;
  removeRun: (id: number) => void;
  clearRuns: () => void;
}

const STORAGE_KEY = 'engine-bench:v2';
const MAX_RUNS = 4;

for (const old of ['four-stroke-sim:v1', 'four-stroke-sim:v2', 'engine-bench:v1']) {
  try {
    localStorage.removeItem(old);
  } catch {
    // Storage can be unavailable (private mode); nothing to clean then.
  }
}

export function buildSig(config: EngineConfig, ecu: EcuConfig): string {
  return JSON.stringify([config, ecu]);
}

export function presetBaseline(p: EnginePreset, vehicle: VehicleConfig = DEFAULT_VEHICLE): Baseline {
  return { name: p.name, config: p.engine, ecu: p.ecu, vehicle };
}

/** The vehicle the parts bill counts from. */
export function baseVehicle(b: Baseline, now: VehicleConfig): VehicleConfig {
  const v = b.vehicle ?? DEFAULT_VEHICLE;
  // A different chassis is a different bike: its own stock parts are the zero.
  return v.chassis === now.chassis ? v : clampVehicle({ chassis: now.chassis });
}

/** The baseline as a preset, for code that compares against "factory". */
export function basePreset(): EnginePreset {
  const b = useBench.getState().baseline;
  return { id: 'baseline', name: b.name, blurb: '', engine: b.config, ecu: b.ecu };
}

export const useBench = create<BenchState>()(
  persist(
    (set, get) => ({
      presetId: DEFAULT_PRESET.id,
      baseline: presetBaseline(DEFAULT_PRESET),
      config: DEFAULT_PRESET.engine,
      ecu: DEFAULT_PRESET.ecu,
      vehicle: DEFAULT_VEHICLE,
      bench: DEFAULT_BENCH,
      volume: 0.7,
      runs: [],
      loadPreset: (id) => {
        const p = PRESETS.find((x) => x.id === id) ?? DEFAULT_PRESET;
        set({ presetId: p.id, baseline: presetBaseline(p, get().vehicle), config: p.engine, ecu: p.ecu });
      },
      loadBuild: (b) =>
        set({
          presetId: b.presetId,
          baseline: b.baseline,
          config: clampConfig(b.config),
          ecu: clampEcu(b.ecu),
          vehicle: clampVehicle(b.vehicle ?? b.baseline.vehicle),
          bench: b.bench ?? DEFAULT_BENCH,
          runs: b.runs ?? [],
        }),
      setConfig: (patch) => set({ config: clampConfig({ ...get().config, ...patch }), presetId: 'custom' }),
      setEcu: (patch) => set({ ecu: clampEcu({ ...get().ecu, ...patch }) }),
      setVehicle: (patch) => set({ vehicle: clampVehicle({ ...get().vehicle, ...patch }) }),
      setBench: (patch) => set({ bench: clampBench({ ...get().bench, ...patch }) }),
      setVolume: (v) => set({ volume: Math.min(1, Math.max(0, v)) }),
      addRun: (points, label) => {
        const { runs, config, ecu } = get();
        const id = (runs.at(-1)?.id ?? 0) + 1;
        const run: DynoRun = { id, label: label ?? `第 ${id} 次`, points, sig: buildSig(config, ecu) };
        set({ runs: [...runs, run].slice(-MAX_RUNS) });
        return run;
      },
      removeRun: (id) => set({ runs: get().runs.filter((r) => r.id !== id) }),
      clearRuns: () => set({ runs: [] }),
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        presetId: s.presetId,
        baseline: s.baseline,
        config: s.config,
        ecu: s.ecu,
        vehicle: s.vehicle,
        bench: s.bench,
        volume: s.volume,
        runs: s.runs,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<BenchState>;
        const b = p.baseline;
        const baseline: Baseline =
          b && typeof b === 'object' && b.config && b.ecu
            ? {
                name: typeof b.name === 'string' ? b.name : current.baseline.name,
                config: clampConfig({ ...current.config, ...b.config }),
                ecu: clampEcu({ ...current.ecu, ...b.ecu }),
                vehicle: clampVehicle(b.vehicle),
              }
            : current.baseline;
        return {
          ...current,
          presetId: typeof p.presetId === 'string' ? p.presetId : current.presetId,
          baseline,
          config: p.config ? clampConfig({ ...current.config, ...p.config }) : current.config,
          ecu: p.ecu ? clampEcu({ ...current.ecu, ...p.ecu }) : current.ecu,
          vehicle: clampVehicle(p.vehicle),
          bench: p.bench ? clampBench({ ...current.bench, ...p.bench }) : current.bench,
          volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : current.volume,
          runs: Array.isArray(p.runs) ? p.runs.slice(-MAX_RUNS) : current.runs,
        };
      },
    },
  ),
);
