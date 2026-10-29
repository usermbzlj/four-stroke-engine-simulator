import type { EngineSetup, HostCommand } from './protocol';
import { EngineRunner } from './runner';

// AudioWorkletGlobalScope is not in TypeScript's libs.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(name: string, ctor: new (options: { processorOptions: unknown }) => unknown): void;

class EngineProcessor extends AudioWorkletProcessor {
  private readonly runner: EngineRunner;

  constructor(options: { processorOptions: unknown }) {
    super(options);
    const setup = options.processorOptions as EngineSetup;
    this.runner = new EngineRunner(sampleRate, setup, true, (msg) => this.port.postMessage(msg));
    this.port.onmessage = (e: MessageEvent<HostCommand>) => this.runner.handle(e.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0];
    if (!out || !left) return true;
    const right = out[1] ?? new Float32Array(left.length);
    this.runner.run(left.length, left, right);
    return true;
  }
}

registerProcessor('engine-bench', EngineProcessor);
