/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Raw operator intent.
 *
 * A throttle you drag with a slider is a spreadsheet cell; a throttle you hold
 * and blip is a toy. This module only records *which controls are being held*.
 * The runtime integrates that into an analog pedal position on the simulation
 * clock, so pedal travel and physics always share the same `dt`.
 *
 * Keyboard and on-screen controls are tracked separately so releasing one does
 * not cancel the other (e.g. holding Space while pressing the on-screen pedal).
 */

export interface ControlIntent {
  /** Throttle held down (keyboard or on-screen pedal). */
  throttle: boolean;
  /** Stab the pedal: skip the ramp and go straight to wide open. */
  stab: boolean;
  /** Starter motor engaged. */
  starter: boolean;
  /** Nitrous button held. */
  nitrous: boolean;
}

export type IntentSource = 'keyboard' | 'pointer';

const idle = (): ControlIntent => ({ throttle: false, stab: false, starter: false, nitrous: false });

export class InputIntent {
  private readonly sources: Record<IntentSource, ControlIntent> = { keyboard: idle(), pointer: idle() };
  private merged: ControlIntent = idle();

  /** The combined intent. Stable identity until something changes. */
  get current(): Readonly<ControlIntent> {
    return this.merged;
  }

  set(source: IntentSource, patch: Partial<ControlIntent>): void {
    Object.assign(this.sources[source], patch);
    this.merge();
  }

  /** Losing focus (alt-tab, devtools) must not leave the throttle stuck open. */
  releaseAll(): void {
    this.sources.keyboard = idle();
    this.sources.pointer = idle();
    this.merge();
  }

  private merge(): void {
    const { keyboard, pointer } = this.sources;
    this.merged = {
      throttle: keyboard.throttle || pointer.throttle,
      // A stab only makes sense with the physical pedal held.
      stab: keyboard.stab,
      starter: keyboard.starter || pointer.starter,
      nitrous: keyboard.nitrous || pointer.nitrous,
    };
  }
}

/** Pedal travel rates (fraction per second). Tuned so a tap is a clean blip. */
export const PEDAL = { rampUp: 4.5, rampDown: 6.5 } as const;

/** Integrate held-pedal intent into an analog pedal position over `dt`. */
export function advancePedal(pedal: number, intent: Readonly<ControlIntent>, dt: number): number {
  if (intent.stab && intent.throttle) return 1;
  if (intent.throttle) return Math.min(1, pedal + PEDAL.rampUp * dt);
  return Math.max(0, pedal - PEDAL.rampDown * dt);
}
