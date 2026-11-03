import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** auto: slowed so the eye can follow; slow: one cycle every few seconds; paused: frozen, scrub by hand. */
export type ViewSpeed = 'auto' | 'slow' | 'paused';

interface ViewState {
  speed: ViewSpeed;
  /** Name tags on the parts. */
  labels: boolean;
  /** Cycle angle to show while paused, degrees. */
  pausedDeg: number;
  setSpeed: (s: ViewSpeed) => void;
  togglePause: () => void;
  toggleLabels: () => void;
  /** Turn the frozen crank by this many degrees (pauses first). */
  scrub: (deltaDeg: number, fromDeg?: number) => void;
}

/** The angle the picture is showing right now (written every frame by the engine view). */
export const shownDeg = { value: 0 };

export const useView = create<ViewState>()(
  persist(
    (set, get) => ({
      speed: 'auto',
      labels: false,
      pausedDeg: 0,
      setSpeed: (speed) => set(speed === 'paused' && get().speed !== 'paused' ? { speed, pausedDeg: shownDeg.value } : { speed }),
      togglePause: () => get().setSpeed(get().speed === 'paused' ? 'auto' : 'paused'),
      toggleLabels: () => set({ labels: !get().labels }),
      scrub: (delta, fromDeg) => {
        const base = get().speed === 'paused' ? get().pausedDeg : (fromDeg ?? shownDeg.value);
        set({ speed: 'paused', pausedDeg: (((base + delta) % 720) + 720) % 720 });
      },
    }),
    { name: 'engine-bench:view', partialize: (s) => ({ labels: s.labels }) },
  ),
);
