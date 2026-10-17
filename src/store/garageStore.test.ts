/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import { THERMAL, defaultProgress } from '../engine';
import type { DynoResult } from '../types';
import { createGarageStore } from './garageStore';

const pull = (overrides: Partial<DynoResult>): DynoResult => ({
  id: 'test-pull',
  specName: 'test',
  curve: [],
  peakPowerHp: 12,
  peakPowerRpm: 6000,
  peakTorqueNm: 18,
  peakTorqueRpm: 4500,
  maxKnock: 0,
  startTemp: THERMAL.thermostatTemp + 2,
  maxTemp: 95,
  wearCost: 0.1,
  aborted: null,
  timestamp: 0,
  ...overrides,
});

const createTestStore = () => {
  const progress = defaultProgress();
  const store = createGarageStore(
    { ...progress, garage: { ...progress.garage, tier: 1 } },
    { log: () => {}, onPartInstalled: () => {}, onRebuild: () => {}, now: () => 0 }
  );
  store.getState().startContract('thermal-1');
  return store;
};

it("A cold pull does not count toward the thermal contract; the run stays open.", () => {
  const store = createTestStore();
  store.getState().resolveDyno(pull({ startTemp: 40, maxTemp: 80 }));
  assert.equal(store.getState().contract.status, 'running', 'a cold engine proves nothing about cooling');
  assert.equal(store.getState().garage.best['thermal-1'], undefined);

  store.getState().resolveDyno(pull({}));
  assert.equal(store.getState().contract.status, 'passed', 'a warm pull under the limit passes');
});

it("A warm pull that boils over fails the thermal contract.", () => {
  const store = createTestStore();
  store.getState().resolveDyno(pull({ maxTemp: 104 }));
  assert.equal(store.getState().contract.status, 'failed');
});
