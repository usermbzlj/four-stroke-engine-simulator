/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Composition root for the game's long-lived objects.
 *
 * There is exactly one live engine and one career. They are created here, wired
 * to each other, and exposed to React through hooks (`src/hooks/useGame.ts`).
 * Neither side knows about the other: the runtime emits events, the garage
 * store exposes actions, and this file is the only place that connects them.
 */

import { loadProgress, saveProgress } from './engine';
import { EngineRuntime } from './runtime/engineRuntime';
import { createGarageStore } from './store/garageStore';
import { useLogStore } from './store/logStore';
import { useSettingsStore } from './store/settingsStore';
import { useTutorialStore } from './store/tutorialStore';
import { engineAudio } from './utils/engineAudio';

const SAVE_DEBOUNCE_MS = 400;

const progress = loadProgress();

export const runtime = new EngineRuntime({ build: progress.build, tune: progress.tune, audio: engineAudio });

export const garage = createGarageStore(progress, {
  log: (level, message) => useLogStore.getState().add(level, message),
  onPartInstalled: (slot, blockChanged) => runtime.refit(slot, blockChanged),
  onRebuild: () => runtime.completeRebuild(),
  now: () => runtime.getClockMs(),
});

/** Drive the on-screen pedal / starter / nitrous buttons. */
export const pointerControls = {
  throttle: (active: boolean) => runtime.input.set('pointer', { throttle: active }),
  starter: (active: boolean) => runtime.input.set('pointer', { starter: active }),
  nitrous: (active: boolean) => runtime.input.set('pointer', { nitrous: active }),
};

let greeted = false;

/**
 * Connect everything and start the simulation loop. Returns a disposer, so it
 * is safe under React StrictMode and hot reload.
 */
export function startGame(): () => void {
  const disposers: (() => void)[] = [];

  // Runtime events -> logs, career, tutorial.
  disposers.push(
    runtime.onEvent((event) => {
      switch (event.type) {
        case 'log':
          useLogStore.getState().add(event.level, event.message);
          break;
        case 'tick':
          garage.getState().tick(event.ctx);
          useTutorialStore.getState().observe({
            engineState: event.ctx.engineState,
            cranking: event.ctx.cranking,
            rpm: event.ctx.rpm,
            pedal: event.ctx.pedal,
          });
          break;
        case 'dynoComplete':
          garage.getState().resolveDyno(event.result);
          useTutorialStore.getState().mark('dynoed');
          break;
        case 'catastrophe':
          garage.getState().handleCatastrophe(event.state);
          break;
      }
    })
  );

  // The engine follows the garage's build and tune.
  runtime.setBuild(garage.getState().build);
  runtime.setTune(garage.getState().tune);
  disposers.push(
    garage.subscribe((state, previous) => {
      if (state.build !== previous.build) runtime.setBuild(state.build);
      if (state.tune !== previous.tune) runtime.setTune(state.tune);
    })
  );

  // Persist durable progress, debounced: the garage changes while you drive.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const { garage: g, build, tune, presets, onboarded } = garage.getState();
    saveProgress({ garage: g, build, tune, presets, onboarded });
  };
  disposers.push(
    garage.subscribe((state, previous) => {
      const changed =
        state.garage !== previous.garage ||
        state.build !== previous.build ||
        state.tune !== previous.tune ||
        state.presets !== previous.presets ||
        state.onboarded !== previous.onboarded;
      if (changed && saveTimer === undefined) saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
    })
  );
  const flushOnHide = () => {
    if (saveTimer !== undefined) saveNow();
  };
  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('visibilitychange', flushOnHide);
  disposers.push(() => {
    flushOnHide();
    window.removeEventListener('pagehide', flushOnHide);
    document.removeEventListener('visibilitychange', flushOnHide);
  });

  // Sound settings -> audio engine; the context itself needs a user gesture.
  const applySettings = ({ volume, muted }: { volume: number; muted: boolean }) => {
    engineAudio.setVolume(volume);
    engineAudio.setMute(muted);
  };
  applySettings(useSettingsStore.getState());
  disposers.push(useSettingsStore.subscribe(applySettings));

  const unlockAudio = () => engineAudio.init();
  const gestures = ['click', 'keydown', 'touchstart'] as const;
  for (const name of gestures) window.addEventListener(name, unlockAudio);
  disposers.push(() => {
    for (const name of gestures) window.removeEventListener(name, unlockAudio);
  });

  // Losing focus must not leave the throttle stuck open.
  const releaseInput = () => runtime.input.releaseAll();
  window.addEventListener('blur', releaseInput);
  document.addEventListener('visibilitychange', releaseInput);
  disposers.push(() => {
    window.removeEventListener('blur', releaseInput);
    document.removeEventListener('visibilitychange', releaseInput);
  });

  if (!greeted) {
    greeted = true;
    runtime.addLog('info', '四冲程单缸汽油发动机仿真模型已就绪。');
    runtime.addLog('info', '按住 S 接合起动机；空格踩油门。祝你玩得开心，也别炸太多台。');
  }

  runtime.start();
  disposers.push(() => runtime.stop());

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
