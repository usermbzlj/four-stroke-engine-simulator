/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-run checklist progress. A newcomer facing a dozen sliders has no idea
 * that the first move is "hold S", so the guide ticks steps off as the player
 * actually does them.
 */

import { EngineState } from '../types';

export interface OnboardingProgress {
  /** Engine has been cranked at least once. */
  cranked: boolean;
  /** Engine reached a self-sustaining idle. */
  idled: boolean;
  /** Player has blipped the throttle. */
  revved: boolean;
  /** A dyno pull has completed. */
  dynoed: boolean;
  /** The ECU map has been touched. */
  tuned: boolean;
  /** A part has been bought. */
  shopped: boolean;
}

export const EMPTY_ONBOARDING: OnboardingProgress = {
  cranked: false,
  idled: false,
  revved: false,
  dynoed: false,
  tuned: false,
  shopped: false,
};

/** Derive whichever steps can be inferred from live engine state. */
export function observeOnboarding(
  previous: OnboardingProgress,
  ctx: { engineState: EngineState; cranking: boolean; rpm: number; pedal: number }
): OnboardingProgress {
  const running = ctx.engineState === EngineState.RUNNING;
  const cranked = previous.cranked || ctx.cranking;
  const idled = previous.idled || (running && !ctx.cranking && ctx.rpm > 400);
  const revved = previous.revved || (running && ctx.pedal > 0.5);
  if (cranked === previous.cranked && idled === previous.idled && revved === previous.revved) return previous;
  return { ...previous, cranked, idled, revved };
}
