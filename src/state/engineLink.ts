import { create } from 'zustand';
import { startEngineHost, type EngineHost } from '../audio/host';
import type { EngineMessage, HostCommand } from '../audio/protocol';
import { blockChanged } from '../sim/config';
import { useBench, type DynoRun } from './benchStore';
import { effectiveThrottle, useControls } from './controlStore';
import { useLive } from './liveStore';

const PULL_BIN = 100;
const SWEEP_RATE = 350;

interface LinkState {
  started: boolean;
  audible: boolean;
  /** Torque per 100 rpm bin of the WOT brake pull in progress: rpm → [sum, n]. */
  pull: Record<number, [number, number]>;
}

export const useLink = create<LinkState>()(() => ({ started: false, audible: false, pull: {} }));

let host: EngineHost | null = null;
let lastCycle = -1;
/** False while a sweep waits for the engine to settle at its first set point. */
let recording = true;

export function send(cmd: HostCommand): void {
  host?.send(cmd);
}

function onMessage(msg: EngineMessage): void {
  const live = useLive.getState();
  switch (msg.type) {
    case 'snapshot':
      live.setSnapshot(msg.snapshot);
      recordPull();
      break;
    case 'trace':
      live.pushTrace(msg.trace);
      break;
    case 'events':
      live.pushEvents(msg.events);
      break;
  }
}

/** Collect brake torque while the cell holds speed at full throttle. */
function recordPull(): void {
  const s = useLive.getState().snapshot;
  const c = useControls.getState();
  const cycle = s?.cycle;
  if (!s || !cycle || cycle.index === lastCycle) return;
  lastCycle = cycle.index;
  if (!recording || c.brakeMode !== 'speed' || s.throttle < 0.95 || s.status !== 'running') return;
  if (Math.abs(cycle.rpm - c.brakeRpm) > 150) return;
  const bin = Math.round(cycle.rpm / PULL_BIN) * PULL_BIN;
  const pull = { ...useLink.getState().pull };
  const [sum, n] = pull[bin] ?? [0, 0];
  pull[bin] = [sum + cycle.brakeTorque, n + 1];
  useLink.setState({ pull });
}

export function pullPoints(pull: Record<number, [number, number]>): [number, number][] {
  return Object.entries(pull)
    .map(([rpm, [sum, n]]): [number, number] => [Number(rpm), sum / n])
    .sort((a, b) => a[0] - b[0]);
}

export function clearPull(): void {
  useLink.setState({ pull: {} });
}

export function savePull(label?: string): DynoRun | null {
  const points = pullPoints(useLink.getState().pull);
  const run = points.length >= 3 ? useBench.getState().addRun(points, label) : null;
  clearPull();
  return run;
}

let sweepTimer = 0;
let sweepLabel: string | undefined;
let sweepDone: ((run: DynoRun | null) => void) | undefined;

/** Hold full throttle and walk the brake set point from low to high speed. */
export function startSweep(opts: { label?: string; onDone?: (run: DynoRun | null) => void } = {}): void {
  const { ecu } = useBench.getState();
  const s = useLive.getState().snapshot;
  if (!s || s.status !== 'running') {
    opts.onDone?.(null);
    return;
  }
  sweepLabel = opts.label;
  sweepDone = opts.onDone;
  clearPull();
  const from = Math.max(ecu.idleRpm + 600, 2000);
  const to = ecu.limiterRpm - 250;
  useControls.getState().set({ sweeping: true, brakeMode: 'speed', brakeRpm: from });
  let rpm = from;
  let settle = 1.2;
  recording = false;
  window.clearInterval(sweepTimer);
  sweepTimer = window.setInterval(() => {
    const live = useLive.getState().snapshot;
    if (!live || live.status !== 'running' || !useControls.getState().sweeping) {
      stopSweep(false);
      return;
    }
    if (settle > 0) {
      settle -= 0.05;
      recording = settle <= 0;
      return;
    }
    rpm += SWEEP_RATE * 0.05;
    if (rpm >= to) {
      stopSweep(true);
      return;
    }
    useControls.getState().set({ brakeRpm: Math.round(rpm) });
  }, 50);
}

export function stopSweep(save: boolean): void {
  window.clearInterval(sweepTimer);
  recording = true;
  useControls.getState().set({ sweeping: false, brakeMode: 'off' });
  const run = save ? savePull(sweepLabel) : null;
  const done = sweepDone;
  sweepDone = undefined;
  sweepLabel = undefined;
  done?.(run);
}

/** Bring the cell up. Must be called from a user gesture so audio can start. */
export async function startBench(): Promise<void> {
  if (host) return;
  const { config, ecu, bench, volume } = useBench.getState();
  host = await startEngineHost({ config, ecu, bench }, onMessage);
  host.send({ type: 'volume', volume });
  pushControls();
  useLink.setState({ started: true, audible: host.audible });
}

function pushControls(): void {
  const c = useControls.getState();
  send({
    type: 'controls',
    controls: {
      throttle: effectiveThrottle(c),
      starter: c.starter,
      ignition: c.ignition,
      brakeMode: c.brakeMode,
      brakeRpm: c.brakeRpm,
    },
  });
}

useControls.subscribe(pushControls);

useBench.subscribe((s, prev) => {
  if (s.config !== prev.config) {
    send({ type: blockChanged(prev.config, s.config) ? 'rebuild' : 'tune', config: s.config });
    clearPull();
  }
  if (s.ecu !== prev.ecu) send({ type: 'ecu', ecu: s.ecu });
  if (s.bench !== prev.bench) send({ type: 'bench', bench: s.bench });
  if (s.volume !== prev.volume) send({ type: 'volume', volume: s.volume });
});

/** Fit new parts after a failure. */
export function restoreEngine(): void {
  send({ type: 'restore' });
  useControls.getState().set({ starter: false, hand: 0, pedal: 0, sweeping: false, brakeMode: 'off', autoThrottle: null });
  useLive.getState().clearFeed();
}
