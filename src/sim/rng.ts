/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Rng = () => number;

/** xorshift32 — tiny, seeded, and available inside an AudioWorklet. */
export function createRng(seed = 1): Rng {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
