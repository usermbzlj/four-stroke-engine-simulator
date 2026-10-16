/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsStore {
  volume: number;
  muted: boolean;
  setVolume: (volume: number) => void;
  toggleMuted: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      volume: 0.35,
      muted: false,
      setVolume: (volume) => set({ volume }),
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
    }),
    {
      name: 'four-stroke-sim:settings',
      partialize: ({ volume, muted }) => ({ volume, muted }),
    }
  )
);
