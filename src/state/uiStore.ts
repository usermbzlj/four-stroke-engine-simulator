import { create } from 'zustand';
import type { EcuConfig, EngineConfig } from '../sim/config';
import { useBench } from './benchStore';
import { useControls } from './controlStore';
import { useLive, type Metrics } from './liveStore';

export type Drawer = 'build' | 'ecu' | 'dyno';

/** The knob the user is working on, and how the engine was doing before they touched it. */
export interface Focus {
  param: string;
  label: string;
  /** performance.now() of the last touch. */
  at: number;
  before: Metrics | null;
  /** Throttle and brake mode at the baseline, to tell whether a comparison is fair. */
  beforeThrottle: number;
  beforeBrake: boolean;
  beforeConfig: EngineConfig;
  beforeEcu: EcuConfig;
}

interface UiState {
  drawer: Drawer | null;
  focus: Focus | null;
  setDrawer: (d: Drawer | null) => void;
  touch: (param: string, label: string) => void;
  clearFocus: () => void;
}

/** A new touch on the same knob within this long keeps the original baseline. */
const SAME_SESSION_MS = 6000;
/** A baseline older than this is no longer what the user remembers. */
const BASELINE_MS = 30000;

let expiry = 0;

export const useUi = create<UiState>()((set, get) => ({
  drawer: null,
  focus: null,
  setDrawer: (drawer) => set({ drawer }),
  touch: (param, label) => {
    const now = performance.now();
    window.clearTimeout(expiry);
    expiry = window.setTimeout(() => set({ focus: null }), BASELINE_MS);
    const f = get().focus;
    if (f && f.param === param && now - f.at < SAME_SESSION_MS) {
      set({ focus: { ...f, at: now } });
      return;
    }
    const { config, ecu } = useBench.getState();
    const live = useLive.getState();
    set({
      focus: {
        param,
        label,
        at: now,
        before: live.metrics,
        beforeThrottle: live.snapshot?.throttle ?? 0,
        beforeBrake: useControls.getState().brakeMode === 'speed',
        beforeConfig: config,
        beforeEcu: ecu,
      },
    });
  },
  clearFocus: () => set({ focus: null }),
}));
