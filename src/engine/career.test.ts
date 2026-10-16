/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { ComponentWear, Contract, GarageState } from '../types';
import { EngineState } from '../types';
import {
  CONTRACTS,
  INITIAL_GARAGE,
  beginContract,
  getContract,
  isDynoResolved,
  isLocked,
  lowerIsBetter,
  rewardFor,
  settleContract,
  starsFor,
  tickContract,
  visibleContracts,
} from './career';
import { defaultBuild, resolveBuild, PARTS, ENGINE_BLOCKS } from './parts';
import { INITIAL_WEAR } from './simulation';

const spec = resolveBuild(defaultBuild());
const healthy: ComponentWear = { ...INITIAL_WEAR };
const worn: ComponentWear = { ...INITIAL_WEAR, conrodBearings: 80 };

const required = (id: string): Contract => {
  const c = getContract(id);
  assert.ok(c, `missing contract ${id}`);
  return c!;
};

it("Ladder integrity: unique ids, ascending tiers, sane stretch goals, real unlocks.", () => {
  const ids = new Set<string>();
  const allItemIds = new Set([...PARTS.map((p) => p.id), ...ENGINE_BLOCKS.map((b) => b.id)]);
  let previousTier = -1;

  for (const c of CONTRACTS) {
    assert.ok(!ids.has(c.id), `duplicate contract id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.tier >= previousTier, 'contracts should be listed in tier order');
    previousTier = c.tier;
    assert.ok(c.reward > 0, `${c.id} should pay something`);
    assert.ok(c.how.length > 0, `${c.id} must tell the player what to do`);

    if (lowerIsBetter(c.kind)) {
      assert.ok(c.stretch < c.target, `${c.id}: a lower-is-better stretch must be below target`);
    } else {
      assert.ok(c.stretch > c.target, `${c.id}: stretch must be beyond target`);
    }
    if (c.knockLimit !== undefined) {
      assert.equal(c.kind, 'dyno', `${c.id}: only a dyno contract can gate on knock`);
      assert.ok(c.knockLimit >= 0 && c.knockLimit <= 1, `${c.id}: knock limit must be a 0-1 severity`);
    }
    for (const unlock of c.unlocks) assert.ok(allItemIds.has(unlock), `${c.id} unlocks unknown item ${unlock}`);
  }

  // Rewards grow with tier so later work is worth doing.
  const tier0 = CONTRACTS.filter((c) => c.tier === 0).reduce((a, c) => a + c.reward, 0);
  const top = Math.max(...CONTRACTS.map((c) => c.tier));
  const tierTop = CONTRACTS.filter((c) => c.tier === top).reduce((a, c) => a + c.reward, 0);
  assert.ok(tierTop > tier0, 'later tiers should pay more');
});

it("Visibility: one tier of look-ahead, and anything above your tier is locked.", () => {
  const fresh: GarageState = { ...INITIAL_GARAGE };
  const visible = visibleContracts(fresh);
  assert.ok(visible.every((c) => c.tier <= 1), 'a fresh garage sees at most tier 1');
  assert.ok(visible.some((c) => c.tier === 0), 'and definitely sees tier 0');
  assert.equal(isLocked(required('first-fire'), fresh), false);
  assert.equal(isLocked(required('dyno-5'), fresh), true);
});

it("Star thresholds, in both directions.", () => {
  const idle = required('first-fire'); // target 12, stretch 20, higher is better
  assert.equal(starsFor(idle, 5, false), 0, 'a failure earns nothing');
  assert.equal(starsFor(idle, 12, true), 1);
  assert.equal(starsFor(idle, 16, true), 2);
  assert.equal(starsFor(idle, 20, true), 3);

  const sprint = required('sprint-1'); // target 9, stretch 6, lower is better
  assert.equal(starsFor(sprint, 8.9, true), 1);
  assert.equal(starsFor(sprint, 7.4, true), 2);
  assert.equal(starsFor(sprint, 5.5, true), 3);
});

it("Repeat runs pay a fraction; beating your own star count pays full.", () => {
  const c = required('first-fire');
  const firstTime = rewardFor(c, 2, 0);
  const repeat = rewardFor(c, 2, 2);
  const improved = rewardFor(c, 3, 2);
  assert.ok(firstTime > repeat, 'grinding a solved contract should not pay full price');
  assert.ok(improved > repeat, 'improving your star count should pay full price');
  assert.equal(rewardFor(c, 0, 0), 0, 'failing pays nothing');
});

const tickFor = (contract: Contract, over: Partial<Parameters<typeof tickContract>[0]> = {}) =>
  tickContract({
    run: beginContract(contract, spec, 0),
    contract,
    accumulator: 0,
    dt: 0.1,
    rpm: spec.idleRpm,
    wear: healthy,
    engineState: EngineState.RUNNING,
    spec,
    now: 1000,
    ...over,
  });

it("Idle contract accumulates only inside the window, and decays outside it.", () => {
  const c = required('first-fire');
  const inside = tickFor(c, { rpm: spec.idleRpm });
  assert.ok(inside.accumulator > 0, 'holding idle should bank time');
  assert.ok(inside.run.hint.includes('保持'), 'and should tell the player they are doing it right');

  const outside = tickFor(c, { rpm: spec.idleRpm + 900, accumulator: 5 });
  assert.ok(outside.accumulator < 5, 'drifting out of the window should lose banked time');
  assert.ok(outside.run.hint.length > 0, 'and should say which way to correct');

  const finished = tickFor(c, { rpm: spec.idleRpm, accumulator: c.target });
  assert.ok(finished.finished?.passed, 'reaching the target should pass');
});

it("Powerband contract only banks time inside the window around the torque peak.", () => {
  const c = required('powerband-1');
  const onPeak = tickFor(c, { rpm: spec.torquePeakRpm });
  assert.ok(onPeak.accumulator > 0, 'sitting on the torque peak banks time');

  const tooHigh = tickFor(c, { rpm: spec.torquePeakRpm + 1200, accumulator: 4 });
  assert.ok(tooHigh.accumulator < 4, 'overshooting the window loses time');
  assert.ok(tooHigh.run.hint.includes('收油'), 'and it should say to back off');
});

it("Thermal and dyno contracts are both resolved by the pull, never by the tick.", () => {
  for (const id of ['thermal-1', 'baseline-pull'] as const) {
    const c = required(id);
    assert.ok(isDynoResolved(c.kind), `${id} should be dyno-resolved`);
    const tick = tickFor(c, { rpm: spec.redlineRpm });
    assert.equal(tick.finished, undefined, `${id} must wait for the dyno, however hard the engine is running`);
    assert.ok(tick.run.hint.includes('测功机'), 'and it should point at the dyno page');
  }
  // Thermal is scored on peak temperature, so lower is better.
  assert.equal(lowerIsBetter('thermal'), true);
  const thermal = required('thermal-1');
  assert.equal(starsFor(thermal, thermal.stretch, true), 3, 'hitting the cool target is three stars');
  assert.equal(starsFor(thermal, thermal.target, true), 1, 'just scraping the ceiling is one star');
  assert.ok(starsFor(thermal, thermal.target + 10, false) === 0, 'overheating fails');
});

it("Endurance fails on any component wear, and only passes at the stretch length.", () => {
  const c = required('bed-in');
  assert.equal(tickFor(c, { wear: worn }).finished?.passed, false, 'any wear fails an endurance run');
  assert.equal(
    tickFor(c, { engineState: EngineState.STALLED }).finished?.passed,
    false,
    'stalling fails an endurance run'
  );
  const long = tickFor(c, { now: (c.stretch + 1) * 1000 });
  assert.equal(long.finished?.passed, true, 'surviving to the stretch length passes');
});

it("Redline sprint passes on reaching the target rpm, and only if it was quick enough.", () => {
  const c = required('sprint-1');
  const quick = tickFor(c, { rpm: spec.redlineRpm, now: 5000 });
  assert.equal(quick.finished?.passed, true, '5s is inside the 9s target');

  const slow = tickFor(c, { rpm: spec.redlineRpm, now: 12000 });
  assert.equal(slow.finished?.passed, false, '12s is outside the target');

  const timeout = tickFor(c, { rpm: 2000, now: 31000 });
  assert.equal(timeout.finished?.passed, false, 'the sprint times out');
});

it("Dyno contracts are never resolved by the tick loop.", () => {
  const c = required('baseline-pull');
  assert.equal(tickFor(c).finished, undefined, 'a dyno contract waits for the pull');
});

it("Settling a pass promotes the tier, pays out, and hands over the gifts once.", () => {
  const c = required('bed-in'); // tier 0, unlocks the programmable ECU
  const fresh: GarageState = { ...INITIAL_GARAGE, credits: 0, score: 0 };

  const first = settleContract(fresh, c, true, c.stretch);
  assert.equal(first.stars, 3);
  assert.equal(first.promoted, true, 'passing a tier-0 contract should promote to tier 1');
  assert.equal(first.garage.tier, 1);
  assert.ok(first.reward > 0 && first.garage.credits === first.reward);
  assert.ok(first.garage.owned.includes('ecu-tuner'), 'the gift should be granted');
  assert.equal(first.garage.best[c.id], c.stretch);

  // Running it again neither re-gifts nor pays full price nor double-promotes.
  const second = settleContract(first.garage, c, true, c.stretch);
  assert.deepEqual(second.gifts, [], 'gifts are handed over once');
  assert.ok(second.reward < first.reward, 'a repeat pays a fraction');
  assert.equal(second.garage.tier, 1, 'no double promotion');

  // A failure leaves progress untouched.
  const failed = settleContract(second.garage, c, false, 3);
  assert.equal(failed.stars, 0);
  assert.equal(failed.reward, 0);
  assert.equal(failed.garage.credits, second.garage.credits);
  assert.equal(failed.garage.stars[c.id], 3, 'a later failure does not erase your best stars');
});

it("Best score tracking respects direction.", () => {
  const sprint = required('sprint-1');
  const g1 = settleContract({ ...INITIAL_GARAGE }, sprint, true, 8).garage;
  const g2 = settleContract(g1, sprint, true, 6.5).garage;
  assert.equal(g2.best[sprint.id], 6.5, 'a faster sprint is a better sprint');
  const g3 = settleContract(g2, sprint, true, 8.5).garage;
  assert.equal(g3.best[sprint.id], 6.5, 'a slower run does not overwrite the record');
});
