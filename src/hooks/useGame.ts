/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { garage, runtime } from '../game';
import type { RuntimeSnapshot } from '../runtime/engineRuntime';
import type { GarageStore } from '../store/garageStore';

/** Subscribe to a slice of the live engine snapshot. */
export function useRuntime<T>(selector: (snapshot: RuntimeSnapshot) => T): T {
  return useSyncExternalStore(runtime.subscribe, () => selector(runtime.getSnapshot()));
}

/** Subscribe to a slice of the career / garage store. */
export function useGarage<T>(selector: (state: GarageStore) => T): T {
  return useStore(garage, selector);
}
