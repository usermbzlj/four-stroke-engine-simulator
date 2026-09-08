/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';

// Minimal localStorage polyfill so the persistence layer can run under Node.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as unknown as { window: unknown }).window = {
  localStorage: new MemoryStorage(),
};

// Import AFTER the polyfill so the module sees `window`.
const { loadProgress, saveProgress, clearProgress, DEFAULT_PROGRESS } = await import('./persistence');

// Fresh load returns defaults.
{
  clearProgress();
  const p = loadProgress();
  assert.deepEqual(p.garage, DEFAULT_PROGRESS.garage, 'fresh load yields default garage');
  assert.deepEqual(p.best, DEFAULT_PROGRESS.best, 'fresh load yields empty bests');
  assert.deepEqual(p.presets, [], 'fresh load yields no presets');
}

// Round-trips garage (including runtimeHours), bests, and presets.
{
  clearProgress();
  saveProgress({
    garage: { credits: 999, runtimeHours: 1.234, score: 555 },
    best: { idle: 12, dyno: 30, endurance: 60, redline: 4.2 },
    presets: [
      { name: 'A', params: { fuelAirRatio: 0.92, ignitionTiming: 14, limiterRpm: 7000, hasLimiter: true, coolantPump: 0.7 } },
    ],
  });
  const p = loadProgress();
  assert.equal(p.garage.credits, 999);
  assert.equal(p.garage.runtimeHours, 1.234, 'runtime hours must persist');
  assert.equal(p.garage.score, 555);
  assert.equal(p.best.redline, 4.2);
  assert.equal(p.presets.length, 1);
  assert.equal(p.presets[0].params.limiterRpm, 7000);
}

// Corrupt JSON falls back to defaults instead of throwing.
{
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.setItem(
    'four-stroke-sim:v1',
    '{not valid json'
  );
  const p = loadProgress();
  assert.equal(p.garage.credits, DEFAULT_PROGRESS.garage.credits, 'corrupt data falls back to defaults');
}

// Partial / wrong-typed data is coerced to safe numbers.
{
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.setItem(
    'four-stroke-sim:v1',
    JSON.stringify({ garage: { credits: 'oops', score: 10 }, best: { idle: 'x' }, presets: 'nope' })
  );
  const p = loadProgress();
  assert.equal(p.garage.credits, DEFAULT_PROGRESS.garage.credits, 'non-numeric credits => default');
  assert.equal(p.garage.score, 10, 'valid numeric field preserved');
  assert.equal(p.best.idle, 0, 'non-numeric best => 0');
  assert.deepEqual(p.presets, [], 'non-array presets => empty');
}
