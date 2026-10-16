/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { EMPTY_ONBOARDING, observeOnboarding, type OnboardingProgress } from '../engine/onboarding';

interface TutorialStore {
  progress: OnboardingProgress;
  /** Infer steps from live engine state. Cheap and idempotent — safe to call every frame. */
  observe: (ctx: Parameters<typeof observeOnboarding>[1]) => void;
  /** Tick a step that cannot be inferred from the engine (tuning, shopping, dyno). */
  mark: (step: 'dynoed' | 'tuned' | 'shopped') => void;
}

export const useTutorialStore = create<TutorialStore>()((set, get) => ({
  progress: EMPTY_ONBOARDING,
  observe: (ctx) => {
    const next = observeOnboarding(get().progress, ctx);
    if (next !== get().progress) set({ progress: next });
  },
  mark: (step) => {
    if (!get().progress[step]) set((s) => ({ progress: { ...s.progress, [step]: true } }));
  },
}));
