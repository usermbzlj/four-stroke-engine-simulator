import { create } from 'zustand';
import type { BrakeMode } from '../sim/core';

interface ControlState {
  /** Hand throttle set by wheel / slider, 0-1. */
  hand: number;
  /** Momentary full throttle (space / RT), 0-1. */
  pedal: number;
  starter: boolean;
  ignition: boolean;
  brakeMode: BrakeMode;
  brakeRpm: number;
  /** An automatic dyno pull is running. */
  sweeping: boolean;
  set: (patch: Partial<Omit<ControlState, 'set'>>) => void;
}

export const useControls = create<ControlState>()((set) => ({
  hand: 0,
  pedal: 0,
  starter: false,
  ignition: true,
  brakeMode: 'off',
  brakeRpm: 4000,
  sweeping: false,
  set: (patch) => set(patch),
}));

export function effectiveThrottle(s: Pick<ControlState, 'hand' | 'pedal' | 'sweeping'>): number {
  return s.sweeping ? 1 : Math.max(s.hand, s.pedal);
}
