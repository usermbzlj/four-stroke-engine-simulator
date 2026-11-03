import { useBench } from '../state/benchStore';
import { useControls } from '../state/controlStore';
import { useLive } from '../state/liveStore';
import type { Fix } from './advice';

let quietUntil = 0;
let halt = false;
let cranking: Promise<boolean> | null = null;

/** True while the mentor's own edits are landing, so it does not comment on itself. */
export function isMentorEdit(): boolean {
  return performance.now() < quietUntil;
}

export function mentorEdit(fn: () => void): void {
  quietUntil = performance.now() + 400;
  fn();
}

export function applyFix(fix: Fix): void {
  mentorEdit(() => {
    const b = useBench.getState();
    if (fix.config) b.setConfig(fix.config);
    if (fix.ecu) b.setEcu(fix.ecu);
    if (fix.bench) b.setBench(fix.bench);
  });
}

/** Apply a spark offset delta against the live ECU, not a captured absolute. */
export function retardSpark(deg: number): void {
  const e = useBench.getState().ecu;
  applyFix({ label: '', ecu: { advanceOffset: Math.max(-20, Math.min(20, e.advanceOffset - deg)) } });
}

export const wait = (ms: number): Promise<void> =>
  new Promise((r) => {
    window.setTimeout(r, ms);
  });

const running = (): boolean => useLive.getState().snapshot?.status === 'running';

export function haltActions(): void {
  halt = true;
}

export function clearHalt(): void {
  halt = false;
}

export function isHalted(): boolean {
  return halt;
}

/** Turn the key and hold the starter until it catches. Resolves true once it runs. */
export async function crankForMe(): Promise<boolean> {
  if (running()) return true;
  if (useLive.getState().snapshot?.failure) return false;
  if (cranking) return cranking;
  cranking = (async () => {
    const c = useControls.getState();
    const held = c.autoThrottle;
    c.set({ ignition: true, starter: true, autoThrottle: 0 });
    const t0 = performance.now();
    while (!running() && !halt && performance.now() - t0 < 3000) await wait(50);
    useControls.getState().set({ starter: false });
    if (halt) {
      useControls.getState().set({ autoThrottle: held });
      return running();
    }
    await wait(700);
    if (!halt) useControls.getState().set({ autoThrottle: held });
    return running();
  })().finally(() => {
    cranking = null;
  });
  return cranking;
}
