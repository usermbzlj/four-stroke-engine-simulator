/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import { clearProgress, defaultProgress, loadProgress, saveProgress } from './persistence';
import { PART_SLOTS, resolveBuild, stockPartFor } from './parts';
import { TUNE_POINTS, flatTune } from './tune';

// --- minimal localStorage stub so the module thinks it is in a browser -----
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };

const reset = () => storage.clear();

it("A fresh install gets a coherent, playable default.", () => {
  reset();
  const fresh = loadProgress();
  assert.equal(fresh.garage.tier, 0);
  assert.equal(fresh.onboarded, false);
  assert.ok(fresh.garage.credits > 0, 'you start with something to spend');
  assert.equal(fresh.build.blockId, 'block-250');
  for (const slot of PART_SLOTS) {
    assert.equal(fresh.build.installed[slot], stockPartFor(slot).id, `${slot} should start stock`);
  }
  assert.equal(fresh.tune.ignition.length, TUNE_POINTS);
  assert.deepEqual(fresh.presets, []);
});

it("Round-trip: everything that matters survives a save/load cycle.", () => {
  reset();
  const progress = defaultProgress();
  progress.garage.credits = 4321;
  progress.garage.tier = 3;
  progress.garage.stars = { 'first-fire': 3 };
  progress.garage.best = { 'sprint-1': 5.25 };
  progress.garage.owned = [...progress.garage.owned, 'cam-race', 'ecu-standalone'];
  progress.build = { ...progress.build, installed: { ...progress.build.installed, cam: 'cam-race', ecu: 'ecu-standalone' } };
  progress.tune = flatTune(18, 0.9);
  progress.presets = [{ name: 'race', tune: flatTune(22, 0.88) }];
  progress.onboarded = true;
  saveProgress(progress);

  const loaded = loadProgress();
  assert.equal(loaded.garage.credits, 4321);
  assert.equal(loaded.garage.tier, 3);
  assert.equal(loaded.garage.stars['first-fire'], 3);
  assert.equal(loaded.garage.best['sprint-1'], 5.25);
  assert.equal(loaded.build.installed.cam, 'cam-race');
  assert.equal(loaded.onboarded, true);
  assert.equal(loaded.presets.length, 1);
  assert.equal(loaded.presets[0]?.name, 'race');
  assert.ok(loaded.garage.owned.includes('cam-race'));
});

it("Stock parts are always owned, even if the save says otherwise.", () => {
  reset();
  const progress = defaultProgress();
  progress.garage.owned = ['cam-race'];
  saveProgress(progress);
  const loaded = loadProgress();
  for (const slot of PART_SLOTS) {
    assert.ok(loaded.garage.owned.includes(stockPartFor(slot).id), `${slot} stock must always be owned`);
  }
  assert.ok(loaded.garage.owned.includes('cam-race'), 'and the saved extras are kept');
});

it("Corrupt JSON degrades to a fresh career instead of throwing.", () => {
  reset();
  storage.setItem('four-stroke-sim:v2', '{not json');
  const loaded = loadProgress();
  assert.equal(loaded.garage.tier, 0);
  assert.ok(loaded.garage.credits > 0);
});

it("A part saved into the wrong slot, or one that no longer exists, falls back to stock.", () => {
  reset();
  storage.setItem(
    'four-stroke-sim:v2',
    JSON.stringify({
      ...defaultProgress(),
      build: { blockId: 'block-250', installed: { cam: 'piston-race-128', head: 'deleted-part' } },
    })
  );
  const loaded = loadProgress();
  assert.equal(loaded.build.installed.cam, stockPartFor('cam').id, 'a piston cannot be installed as a camshaft');
  assert.equal(loaded.build.installed.head, stockPartFor('head').id, 'a deleted part falls back to stock');
});

it("A detailed map saved on a standalone ECU is flattened when loaded on a stock one.", () => {
  reset();
  const progress = defaultProgress();
  progress.build = { ...progress.build, installed: { ...progress.build.installed, ecu: stockPartFor('ecu').id } };
  progress.tune = { ignition: [5, 10, 15, 20, 25, 30, 35], lambda: [1, 1, 1, 1, 1, 1, 1] };
  saveProgress(progress);

  const loaded = loadProgress();
  assert.equal(resolveBuild(loaded.build).ecuTier, 0);
  assert.equal(new Set(loaded.tune.ignition).size, 1, 'a stock ECU cannot hold a shaped curve');
});

it("Out-of-range values in a save are clamped rather than trusted.", () => {
  reset();
  storage.setItem(
    'four-stroke-sim:v2',
    JSON.stringify({
      ...defaultProgress(),
      garage: { credits: 'lots', runtimeHours: NaN, score: null, tier: -4, stars: { a: 'x' }, best: {}, owned: 'nope' },
      tune: { ignition: [999, -999], lambda: 'bad' },
    })
  );
  const loaded = loadProgress();
  assert.ok(Number.isFinite(loaded.garage.credits));
  assert.equal(loaded.garage.runtimeHours, 0);
  assert.equal(loaded.garage.tier, 0, 'a negative tier is clamped');
  assert.deepEqual(loaded.garage.stars, {}, 'non-numeric stars are dropped');
  assert.equal(loaded.tune.ignition.length, TUNE_POINTS);
  assert.ok(loaded.tune.ignition.every((v) => v >= 0 && v <= 45));
  assert.ok(loaded.tune.lambda.every((v) => v >= 0.6 && v <= 1.5));
});

it("A v1 save is migrated: the player keeps their credits, hours and score.", () => {
  reset();
  storage.setItem(
    'four-stroke-sim:v1',
    JSON.stringify({ garage: { credits: 1500, runtimeHours: 2.75, score: 640 }, presets: [], best: { idle: 12 } })
  );
  const loaded = loadProgress();
  assert.equal(loaded.garage.credits, 1500, 'legacy credits carry over');
  assert.equal(loaded.garage.runtimeHours, 2.75);
  assert.equal(loaded.garage.score, 640);
  assert.equal(loaded.garage.tier, 0, 'but the new career starts at the beginning');
  assert.equal(loaded.build.blockId, 'block-250');
});

it("Clearing wipes both schema versions.", () => {
  reset();
  storage.setItem('four-stroke-sim:v1', JSON.stringify({ garage: { credits: 99 } }));
  saveProgress({ ...defaultProgress(), garage: { ...defaultProgress().garage, credits: 777 } });
  clearProgress();
  const loaded = loadProgress();
  assert.notEqual(loaded.garage.credits, 777);
  assert.notEqual(loaded.garage.credits, 99, 'the legacy key is cleared too');
});
