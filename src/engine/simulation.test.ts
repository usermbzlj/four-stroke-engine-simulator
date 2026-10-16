/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { EngineParameters, TuneMap } from '../types';
import { EngineState } from '../types';
import { defaultBuild, resolveBuild } from './parts';
import { autoTune, flatTune } from './tune';
import type { EngineEvent, EngineSimState} from './simulation';
import { createEngineState, stepEngine } from './simulation';

const stock = resolveBuild(defaultBuild());
const stockTune = autoTune(stock);

const baseParams: EngineParameters = {
  throttle: 0,
  load: 0.8,
  oilLevel: 90,
  hasLimiter: false,
  limiterRpm: 6800,
  hasNitrous: false,
  coolantPump: 0.6,
  choke: 0,
};

/** Advance the sim N fixed steps with a fixed RNG, returning the final state + all events. */
function simulate(
  state: EngineSimState,
  params: EngineParameters,
  steps: number,
  dt: number,
  rng: () => number,
  tune: TuneMap = stockTune,
  startTimestamp = 0
): { state: EngineSimState; events: EngineEvent[] } {
  let cur = state;
  const events: EngineEvent[] = [];
  let t = startTimestamp;
  for (let i = 0; i < steps; i++) {
    t += dt * 1000;
    const res = stepEngine({ state: cur, params, spec: stock, tune, dt, timestampMs: t, rng });
    cur = res.state;
    events.push(...res.events);
  }
  return { state: cur, events };
}

it("Purity: stepEngine does not mutate the input state object.", () => {
  const initial = createEngineState(40);
  const snapshot = JSON.stringify(initial);
  stepEngine({ state: initial, params: baseParams, spec: stock, tune: stockTune, dt: 1 / 60, timestampMs: 16, rng: () => 0.99 });
  assert.equal(JSON.stringify(initial), snapshot, 'stepEngine must not mutate its input state');
});

it("Starter cranking spins the engine up from rest.", () => {
  const state = createEngineState(40);
  state.engineState = EngineState.STARTING;
  state.cranking = true;
  const { state: after } = simulate(state, baseParams, 120, 1 / 60, () => 0.99);
  assert.ok(after.rpm > 0, 'cranking should produce rotation');
});

it("A healthy engine catches and idles on the idle-air circuit with the pedal shut.", () => {
  const state = createEngineState(40);
  state.engineState = EngineState.STARTING;
  state.cranking = true;
  const warmup = simulate(state, baseParams, 90, 1 / 60, () => 0.99);
  warmup.state.cranking = false;
  const run = simulate(warmup.state, baseParams, 600, 1 / 60, () => 0.99);

  assert.equal(run.state.engineState, EngineState.RUNNING, 'engine should be running with the throttle closed');
  assert.ok(
    Math.abs(run.state.rpm - stock.idleRpm) < 260,
    `idle should settle near ${stock.idleRpm}, got ${run.state.rpm.toFixed(0)}`
  );
});

it("The idle bypass fades out off idle, so lifting still engine-brakes.", () => {
  const state = createEngineState(90);
  state.engineState = EngineState.RUNNING;
  state.rpm = 5000;
  const res = stepEngine({
    state,
    params: baseParams,
    spec: stock,
    tune: stockTune,
    dt: 1 / 60,
    timestampMs: 16,
    rng: () => 0.99,
  });
  assert.equal(res.derived.idleBypass, 0, 'no idle air at 5000 rpm');
  assert.ok(res.derived.effectiveThrottle < 0.02, 'closed pedal means closed throttle off idle');

  const decel = simulate(state, baseParams, 120, 1 / 60, () => 0.99);
  assert.ok(decel.state.rpm < 5000, 'a closed throttle should decelerate the engine');
});

it("The ECU map is honoured: a retarded curve makes less torque than MBT.", () => {
  const hot = createEngineState(90);
  hot.engineState = EngineState.RUNNING;
  hot.rpm = 4200;

  const good = stepEngine({
    state: hot,
    params: { ...baseParams, throttle: 1 },
    spec: stock,
    tune: flatTune(10 + 4200 / 280, 0.92),
    dt: 1 / 60,
    timestampMs: 16,
    rng: () => 0.99,
  });
  const retarded = stepEngine({
    state: hot,
    params: { ...baseParams, throttle: 1 },
    spec: stock,
    tune: flatTune(0, 0.92),
    dt: 1 / 60,
    timestampMs: 16,
    rng: () => 0.99,
  });

  assert.ok(
    good.derived.meanBrakeTorque > retarded.derived.meanBrakeTorque,
    'MBT timing from the map should out-torque zero advance'
  );
  assert.ok(Math.abs(good.derived.tune.ignition - (10 + 4200 / 280)) < 1e-6, 'the map is sampled at the live rpm');
});

it("Over-rev past destruct RPM blows the engine up.", () => {
  const state = createEngineState(90);
  state.engineState = EngineState.RUNNING;
  state.rpm = stock.destructRpm + 50;
  const { state: after, events } = simulate(state, { ...baseParams, throttle: 1 }, 2, 1 / 60, () => 0.99);
  assert.equal(after.engineState, EngineState.EXPLODED, 'exceeding destruct rpm should explode');
  assert.ok(events.some((e) => e.kind === 'failure' && e.state === EngineState.EXPLODED));
  assert.ok(events.some((e) => e.kind === 'explosion'), 'an explosion audio cue should be emitted');
});

it("Extreme overheat seizes the engine.", () => {
  const state = createEngineState(146);
  state.engineState = EngineState.RUNNING;
  state.rpm = 3000;
  const { state: after, events } = simulate(state, baseParams, 1, 1 / 60, () => 0.99);
  assert.equal(after.engineState, EngineState.SEIZED, 'coolant above seize temp should seize');
  assert.equal(after.rpm, 0, 'a seized engine should stop');
  assert.ok(events.some((e) => e.kind === 'failure' && e.state === EngineState.SEIZED));
});

it("Running dry (no oil) at speed rapidly destroys components.", () => {
  const state = createEngineState(100);
  state.engineState = EngineState.RUNNING;
  state.rpm = 5000;
  const { state: after } = simulate(state, { ...baseParams, oilLevel: 0, throttle: 1 }, 600, 1 / 60, () => 0.99);
  const anyWorn =
    after.wear.pistonRings < 100 ||
    after.wear.cylinderWall < 100 ||
    after.wear.conrodBearings < 100 ||
    after.wear.crankshaftJournal < 100;
  assert.ok(anyWorn, 'running dry should wear components');
});

it("A dead engine ignores throttle/starter (no resurrection without a rebuild).", () => {
  const state = createEngineState(40);
  state.engineState = EngineState.EXPLODED;
  state.cranking = true;
  const { state: after } = simulate(state, { ...baseParams, throttle: 1 }, 60, 1 / 60, () => 0.99);
  assert.equal(after.engineState, EngineState.EXPLODED, 'exploded engine stays dead');
  assert.equal(after.rpm, 0, 'dead engine does not spin');
});

it("dt is clamped so a huge frame gap cannot explode the integrator.", () => {
  const state = createEngineState(40);
  state.engineState = EngineState.RUNNING;
  state.rpm = 3000;
  const res = stepEngine({
    state,
    params: baseParams,
    spec: stock,
    tune: stockTune,
    dt: 100,
    timestampMs: 16,
    rng: () => 0.99,
  });
  assert.ok(Number.isFinite(res.state.rpm), 'rpm stays finite after a clamped giant dt');
  assert.ok(Number.isFinite(res.state.coolantTemp), 'temp stays finite after a clamped giant dt');
});

it("A knocking tune wears the bottom end far faster than a clean one.", () => {
  const makeHot = () => {
    const s = createEngineState(120);
    s.engineState = EngineState.RUNNING;
    s.rpm = 6000;
    return s;
  };
  const clean = simulate(makeHot(), { ...baseParams, throttle: 1 }, 300, 1 / 60, () => 0.99, flatTune(8, 0.9));
  const knocking = simulate(makeHot(), { ...baseParams, throttle: 1 }, 300, 1 / 60, () => 0.99, flatTune(44, 1.2));
  assert.ok(
    knocking.state.wear.conrodBearings < clean.state.wear.conrodBearings,
    'detonation should chew through the bearings much faster'
  );
});
