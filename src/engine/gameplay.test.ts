/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { ChallengeProgress, ComponentWear, EngineState } from '../types';
import { ENGINE_SPECS } from './physics';
import {
  INITIAL_CHALLENGE,
  challengeReward,
  challengeScore,
  dynoCreditReward,
  runDynoSweep,
  tickChallenge,
} from './gameplay';

const stock = ENGINE_SPECS[0];
const pristine: ComponentWear = {
  pistonRings: 100,
  cylinderWall: 100,
  conrodBearings: 100,
  crankshaftJournal: 100,
  sparkPlug: 100,
  valves: 100,
};

// Dyno sweep produces a monotonic-rpm curve with sane peaks.
{
  const result = runDynoSweep(stock, 0.92, 18, pristine, 40);
  assert.equal(result.curve.length, 41, 'sweep should include both endpoints');
  assert.ok(result.peakPowerHp > 0, 'peak power should be positive');
  assert.ok(result.peakTorqueNm > 0, 'peak torque should be positive');
  assert.ok(
    result.peakPowerRpm >= result.peakTorqueRpm,
    'peak power should occur at or above peak-torque rpm'
  );
  for (let i = 1; i < result.curve.length; i++) {
    assert.ok(result.curve[i].rpm > result.curve[i - 1].rpm, 'rpm must increase along the sweep');
  }
}

// Idle challenge accumulates while in the stable band and resolves on target.
{
  const progress: ChallengeProgress = {
    ...INITIAL_CHALLENGE,
    active: 'idle',
    status: 'running',
    startedAt: 0,
    targetValue: 10,
    metricLabel: 'idle',
  };
  let idle = 0;
  let cur = progress;
  let finished: { passed: boolean; value: number } | undefined;
  // 11 seconds at 1100 rpm, 100ms ticks
  for (let t = 0; t < 110; t++) {
    const res = tickChallenge({
      progress: cur,
      idleStableSeconds: idle,
      dt: 0.1,
      rpm: 1100,
      wear: pristine,
      engineState: EngineState.RUNNING,
      spec: stock,
      now: (t + 1) * 100,
    });
    cur = res.progress;
    idle = res.idleStableSeconds;
    if (res.finished) {
      finished = res.finished;
      break;
    }
  }
  assert.ok(finished?.passed, 'holding the idle band should pass the idle challenge');
}

// Idle challenge bleeds progress when out of band.
{
  const progress: ChallengeProgress = {
    ...INITIAL_CHALLENGE,
    active: 'idle',
    status: 'running',
    startedAt: 0,
    targetValue: 10,
  };
  const res = tickChallenge({
    progress,
    idleStableSeconds: 5,
    dt: 0.1,
    rpm: 4000, // way out of band
    wear: pristine,
    engineState: EngineState.RUNNING,
    spec: stock,
    now: 100,
  });
  assert.ok(res.idleStableSeconds < 5, 'out-of-band rpm should reduce accumulated stable time');
}

// Endurance challenge fails the moment a component breaks.
{
  const progress: ChallengeProgress = {
    ...INITIAL_CHALLENGE,
    active: 'endurance',
    status: 'running',
    startedAt: 0,
    targetValue: 60,
  };
  const broken: ComponentWear = { ...pristine, conrodBearings: 50 };
  const res = tickChallenge({
    progress,
    idleStableSeconds: 0,
    dt: 0.1,
    rpm: 3000,
    wear: broken,
    engineState: EngineState.RUNNING,
    spec: stock,
    now: 5000,
  });
  assert.equal(res.finished?.passed, false, 'a broken component fails endurance');
}

// Redline challenge passes when rpm reaches the target band.
{
  const progress: ChallengeProgress = {
    ...INITIAL_CHALLENGE,
    active: 'redline',
    status: 'running',
    startedAt: 0,
    targetValue: (stock.redlineRpm - 200) / 1000,
  };
  const res = tickChallenge({
    progress,
    idleStableSeconds: 0,
    dt: 0.1,
    rpm: stock.redlineRpm - 100,
    wear: pristine,
    engineState: EngineState.RUNNING,
    spec: stock,
    now: 3000,
  });
  assert.equal(res.finished?.passed, true, 'reaching the redline band passes the sprint');
}

// Reward math is positive and ordered as designed.
{
  assert.ok(challengeReward('endurance') > challengeReward('idle'));
  assert.ok(challengeScore('endurance', 60) > 0);
  assert.ok(dynoCreditReward(30) > dynoCreditReward(10), 'more power => more credits');
}
