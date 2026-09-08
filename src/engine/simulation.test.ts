/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { EngineParameters, EngineState } from '../types';
import { ENGINE_SPECS } from './physics';
import { EngineEvent, EngineSimState, createEngineState, stepEngine } from './simulation';

const baseParams: EngineParameters = {
  throttle: 0.2,
  load: 0.8,
  fuelAirRatio: 1.0,
  oilLevel: 90,
  ignitionTiming: 12,
  hasLimiter: false,
  limiterRpm: 6800,
  hasNitrous: false,
  coolantPump: 0.6,
  choke: 0,
};

const stock = ENGINE_SPECS[0];

/** Advance the sim N fixed steps with a fixed RNG, returning the final state + all events. */
function simulate(
  state: EngineSimState,
  params: EngineParameters,
  steps: number,
  dt: number,
  rng: () => number,
  startTimestamp = 0
): { state: EngineSimState; events: EngineEvent[] } {
  let cur = state;
  const events: EngineEvent[] = [];
  let t = startTimestamp;
  for (let i = 0; i < steps; i++) {
    t += dt * 1000;
    const res = stepEngine(cur, params, stock, dt, t, rng);
    cur = res.state;
    events.push(...res.events);
  }
  return { state: cur, events };
}

// Purity: stepEngine does not mutate the input state object.
{
  const initial = createEngineState(40);
  const snapshot = JSON.stringify(initial);
  stepEngine(initial, baseParams, stock, 1 / 60, 16, () => 0.99);
  assert.equal(JSON.stringify(initial), snapshot, 'stepEngine must not mutate its input state');
}

// Starter cranking spins the engine up from rest.
{
  const state = createEngineState(40);
  state.engineState = EngineState.STARTING;
  state.cranking = true;
  const { state: after } = simulate(state, baseParams, 120, 1 / 60, () => 0.99);
  assert.ok(after.rpm > 0, 'cranking should produce rotation');
}

// A healthy engine catches and runs when cranked with a sane tune.
{
  const state = createEngineState(40);
  state.engineState = EngineState.STARTING;
  state.cranking = true;
  // Give it a moment to catch, then release the starter.
  const warmup = simulate(state, baseParams, 90, 1 / 60, () => 0.99);
  warmup.state.cranking = false;
  const run = simulate(warmup.state, baseParams, 240, 1 / 60, () => 0.99);
  assert.ok(
    run.state.engineState === EngineState.RUNNING || run.state.rpm > 400,
    `expected a self-sustaining idle, got state=${run.state.engineState} rpm=${run.state.rpm.toFixed(0)}`
  );
}

// Over-rev past destruct RPM blows the engine up.
{
  const state = createEngineState(90);
  state.engineState = EngineState.RUNNING;
  state.rpm = stock.destructRpm + 50;
  const { state: after, events } = simulate(state, { ...baseParams, throttle: 1.5 }, 2, 1 / 60, () => 0.99);
  assert.equal(after.engineState, EngineState.EXPLODED, 'exceeding destruct rpm should explode');
  assert.ok(
    events.some((e) => e.kind === 'failure' && e.state === EngineState.EXPLODED),
    'an explosion failure event should be emitted'
  );
  assert.ok(events.some((e) => e.kind === 'explosion'), 'an explosion audio cue should be emitted');
}

// Extreme overheat seizes the engine.
{
  const state = createEngineState(146);
  state.engineState = EngineState.RUNNING;
  state.rpm = 3000;
  const { state: after, events } = simulate(state, baseParams, 1, 1 / 60, () => 0.99);
  assert.equal(after.engineState, EngineState.SEIZED, 'coolant above seize temp should seize');
  assert.ok(after.rpm === 0, 'a seized engine should stop');
  assert.ok(events.some((e) => e.kind === 'failure' && e.state === EngineState.SEIZED));
}

// Running dry (no oil) at speed rapidly destroys components.
{
  const state = createEngineState(100);
  state.engineState = EngineState.RUNNING;
  state.rpm = 5000;
  const dryParams = { ...baseParams, oilLevel: 0, throttle: 1.0 };
  const { state: after } = simulate(state, dryParams, 600, 1 / 60, () => 0.99);
  const anyWorn =
    after.wear.pistonRings < 100 ||
    after.wear.cylinderWall < 100 ||
    after.wear.conrodBearings < 100 ||
    after.wear.crankshaftJournal < 100;
  assert.ok(anyWorn, 'running dry should wear components');
}

// A dead engine ignores throttle/starter (no resurrection without rebuild).
{
  const state = createEngineState(40);
  state.engineState = EngineState.EXPLODED;
  state.cranking = true;
  const { state: after } = simulate(state, { ...baseParams, throttle: 1.5 }, 60, 1 / 60, () => 0.99);
  assert.equal(after.engineState, EngineState.EXPLODED, 'exploded engine stays dead');
  assert.equal(after.rpm, 0, 'dead engine does not spin');
}

// dt is clamped so a huge frame gap cannot explode the integrator.
{
  const state = createEngineState(40);
  state.engineState = EngineState.RUNNING;
  state.rpm = 3000;
  const res = stepEngine(state, baseParams, stock, 100 /* seconds */, 16, () => 0.99);
  assert.ok(Number.isFinite(res.state.rpm), 'rpm stays finite after a clamped giant dt');
  assert.ok(Number.isFinite(res.state.coolantTemp), 'temp stays finite after a clamped giant dt');
}
