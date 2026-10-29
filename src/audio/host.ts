import type { EngineMessage, EngineSetup, HostCommand } from './protocol';
import { EngineRunner } from './runner';
import workletUrl from './engine.worklet.ts?worker&url';

export type HostListener = (msg: EngineMessage) => void;

export interface EngineHost {
  /** True when the solver is running in the audio thread with sound. */
  readonly audible: boolean;
  send(cmd: HostCommand): void;
  dispose(): void;
}

/**
 * Start the bench. Prefers the AudioWorklet, where the solver runs at the
 * audio sample rate and its gas flows become the sound; falls back to a
 * silent main-thread loop if audio is unavailable.
 */
export async function startEngineHost(setup: EngineSetup, listener: HostListener): Promise<EngineHost> {
  try {
    return await startWorkletHost(setup, listener);
  } catch (err) {
    console.warn('AudioWorklet unavailable, running silently on the main thread', err);
    return startSilentHost(setup, listener);
  }
}

async function startWorkletHost(setup: EngineSetup, listener: HostListener): Promise<EngineHost> {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, 'engine-bench', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: setup,
  });
  node.port.onmessage = (e: MessageEvent<EngineMessage>) => listener(e.data);
  node.connect(ctx.destination);
  await ctx.resume();

  return {
    audible: true,
    send: (cmd) => node.port.postMessage(cmd),
    dispose: () => {
      node.disconnect();
      void ctx.close();
    },
  };
}

function startSilentHost(setup: EngineSetup, listener: HostListener): EngineHost {
  const rate = 24000;
  const runner = new EngineRunner(rate, setup, false, listener);
  let last = performance.now();
  let raf = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    runner.run(Math.round(dt * rate));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    audible: false,
    send: (cmd) => runner.handle(cmd),
    dispose: () => cancelAnimationFrame(raf),
  };
}
