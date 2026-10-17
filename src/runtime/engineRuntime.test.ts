/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import { autoTune, defaultBuild, resolveBuild } from '../engine';
import { EngineState, type EngineBuild } from '../types';
import { EngineRuntime } from './engineRuntime';

const stockBuild = defaultBuild();

const createRuntime = () => new EngineRuntime({ build: stockBuild, tune: autoTune(resolveBuild(stockBuild)), rng: () => 0.99 });

it("Holding the starter through a stall re-engages it.", () => {
  const rt = createRuntime();
  rt.input.set('keyboard', { starter: true });
  rt.advance(1 / 60);
  assert.equal(rt.getPhysicsState().engineState, EngineState.STARTING);

  rt.patchPhysics({ engineState: EngineState.STALLED });
  rt.advance(1 / 60);
  assert.equal(rt.getPhysicsState().engineState, EngineState.STARTING, 'the held key cranks again');
});

it("Holding the starter does not override a kill switch flipped meanwhile; a fresh press does.", () => {
  const rt = createRuntime();
  rt.input.set('keyboard', { starter: true });
  rt.advance(1 / 60);
  rt.patchPhysics({ engineState: EngineState.RUNNING, rpm: 1500 });
  rt.toggleCutoff();
  rt.advance(1 / 60);
  assert.equal(rt.getPhysicsState().engineState, EngineState.STALLED, 'the kill switch wins over a held key');
  assert.equal(rt.getPhysicsState().ignitionCut, true);

  rt.input.set('keyboard', { starter: false });
  rt.advance(1 / 60);
  rt.input.set('keyboard', { starter: true });
  rt.advance(1 / 60);
  assert.equal(rt.getPhysicsState().engineState, EngineState.STARTING, 'a deliberate new press restores ignition');
  assert.equal(rt.getPhysicsState().ignitionCut, false);
});

it("Changing the redline moves the rev limiter with it.", () => {
  const rt = createRuntime();
  const raced: EngineBuild = { ...stockBuild, installed: { ...stockBuild.installed, cam: 'cam-race' } };
  const racedRedline = resolveBuild(raced).redlineRpm;
  assert.notEqual(racedRedline, resolveBuild(stockBuild).redlineRpm, 'precondition: the cam moves the redline');

  rt.setBuild(raced);
  assert.equal(rt.getSnapshot().controls.limiterRpm, racedRedline);
  rt.setBuild(stockBuild);
  assert.equal(rt.getSnapshot().controls.limiterRpm, resolveBuild(stockBuild).redlineRpm);
});

it("The oil control can drain but never tops up for free.", () => {
  const rt = createRuntime();
  const start = rt.getSnapshot().controls.oilLevel;
  rt.setControls({ oilLevel: 100 });
  assert.equal(rt.getSnapshot().controls.oilLevel, start, 'filling is a paid oil change');
  rt.setControls({ oilLevel: 50 });
  assert.equal(rt.getSnapshot().controls.oilLevel, 50);
  rt.resetControls();
  assert.equal(rt.getSnapshot().controls.oilLevel, 50, 'resetting the controls does not refill the sump');
});

it("A manual spark cannot revive an engine with the ignition cut or the rings gone.", () => {
  const rt = createRuntime();
  rt.input.set('keyboard', { throttle: true });
  rt.advance(0.05);
  const healthyWear = rt.getPhysicsState().wear;

  rt.patchPhysics({ engineState: EngineState.STALLED, rpm: 2000, ignitionCut: true });
  rt.manualSpark();
  assert.equal(rt.getPhysicsState().engineState, EngineState.STALLED, 'no spark with the ignition cut');

  rt.patchPhysics({ ignitionCut: false, wear: { ...healthyWear, pistonRings: 0 } });
  rt.manualSpark();
  assert.equal(rt.getPhysicsState().engineState, EngineState.STALLED, 'no compression, no combustion');

  rt.patchPhysics({ wear: healthyWear });
  rt.manualSpark();
  assert.equal(rt.getPhysicsState().engineState, EngineState.RUNNING, 'a healthy engine still bump-starts');
});
