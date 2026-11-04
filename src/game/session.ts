/**
 * Moving between the sandbox and work orders, and running acceptance.
 */

import { create } from 'zustand';
import { DEFAULT_BENCH, DEFAULT_PRESET } from '../sim/config';
import { buildSig, presetBaseline, useBench } from '../state/benchStore';
import { mentorEdit } from '../mentor/actions';
import { say, useMentor } from '../mentor/store';
import { resetStand } from '../state/engineLink';
import { runAcceptance, type AcceptancePhase, type AcceptanceResult } from './acceptance';
import type { AcceptanceReply, AcceptanceRequest } from './acceptance.worker';
import { grade, jobById, jobStart, type Grade, type Job } from './jobs';
import { buildCost } from './parts';
import { awardStars } from './career';
import { useGame, type SavedBuild } from './store';

function currentBuild(): SavedBuild {
  const b = useBench.getState();
  return { presetId: b.presetId, baseline: b.baseline, config: b.config, ecu: b.ecu, vehicle: b.vehicle, bench: b.bench, runs: b.runs };
}

function freshJobBuild(job: Job): SavedBuild {
  const start = jobStart(job);
  return {
    presetId: 'custom',
    baseline: { name: '接单时', config: start.config, ecu: start.ecu },
    config: start.config,
    ecu: start.ecu,
    bench: { ...DEFAULT_BENCH, ...job.plan.bench },
    runs: [],
  };
}

function put(b: SavedBuild): void {
  mentorEdit(() => useBench.getState().loadBuild(b));
  resetStand();
}

/** Remember where the player is before switching builds. */
function stash(): void {
  const g = useGame.getState();
  if (g.mode === 'sandbox') g.set({ sandbox: currentBuild() });
  else if (g.jobId) g.set({ drafts: { ...g.drafts, [g.jobId]: currentBuild() } });
}

export function enterJob(id: string): void {
  const job = jobById(id);
  if (!job) return;
  const g = useGame.getState();
  if (g.mode === 'job' && g.jobId === id) return;
  stash();
  closeAcceptance();
  useGame.getState().set({ mode: 'job', jobId: id });
  put(useGame.getState().drafts[id] ?? freshJobBuild(job));
  useMentor.setState({ messages: [] });
  say('job', 'say', `${job.client.split(' · ')[1] ?? job.client}的活。要求在上面，改好了点「提交验收」。没头绪就点「问老周」。`);
}

export function enterSandbox(): void {
  const g = useGame.getState();
  if (g.mode === 'sandbox') return;
  stash();
  closeAcceptance();
  useGame.getState().set({ mode: 'sandbox', jobId: null });
  useMentor.setState({ messages: [] });
  const saved = useGame.getState().sandbox;
  put(
    saved ?? {
      presetId: DEFAULT_PRESET.id,
      baseline: presetBaseline(DEFAULT_PRESET),
      config: DEFAULT_PRESET.engine,
      ecu: DEFAULT_PRESET.ecu,
      bench: DEFAULT_BENCH,
      runs: [],
    },
  );
}

/** Start the current job over from the customer's engine. */
export function resetJob(): void {
  const g = useGame.getState();
  const job = jobById(g.jobId);
  if (!job) return;
  const drafts = { ...g.drafts };
  delete drafts[job.id];
  g.set({ drafts });
  closeAcceptance();
  put(freshJobBuild(job));
}

/** Keep the job draft current so a reload resumes where the player was. */
useBench.subscribe((s, prev) => {
  if (s.config === prev.config && s.ecu === prev.ecu && s.runs === prev.runs) return;
  const g = useGame.getState();
  if (g.mode !== 'job' || !g.jobId) return;
  g.set({ drafts: { ...g.drafts, [g.jobId]: currentBuild() } });
});

export function currentJob(): Job | undefined {
  const g = useGame.getState();
  return g.mode === 'job' ? jobById(g.jobId) : undefined;
}

export function currentCost(): number {
  const b = useBench.getState();
  return buildCost(b.baseline.config, b.config);
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

export type AcceptanceStatus = 'idle' | 'running' | 'done' | 'error';

interface AcceptanceState {
  status: AcceptanceStatus;
  open: boolean;
  jobId: string | null;
  phase: AcceptancePhase;
  fraction: number;
  curve: [number, number][];
  result: AcceptanceResult | null;
  grade: Grade | null;
  cost: number;
  /** Stars held before this run, to show what was gained. */
  prevStars: number;
  /** Best result before this run, to draw for comparison. */
  prevBest: { hp: number; curve: [number, number][] } | null;
  error: string | null;
}

export const useAcceptance = create<AcceptanceState>()(() => ({
  status: 'idle',
  open: false,
  jobId: null,
  phase: 'start',
  fraction: 0,
  curve: [],
  result: null,
  grade: null,
  cost: 0,
  prevStars: 0,
  prevBest: null,
  error: null,
}));

let worker: Worker | null = null;
let requestId = 0;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./acceptance.worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('Acceptance worker unavailable, running on the main thread', err);
    worker = null;
  }
  return worker;
}

function finish(job: Job, sig: string, cost: number, result: AcceptanceResult): void {
  const b = useBench.getState();
  const g = grade(job, { config: b.config, ecu: b.ecu, cost, result });
  const game = useGame.getState();
  const prev = game.progress[job.id];
  const better = !prev || g.stars > prev.stars || (g.stars === prev.stars && result.peakHp > prev.bestHp);
  game.set({
    results: { ...game.results, [job.id]: { sig, cost, result } },
    ...(better && g.stars > 0
      ? { progress: { ...game.progress, [job.id]: { stars: Math.max(g.stars, prev?.stars ?? 0), bestHp: result.peakHp, bestCurve: result.curve, cost } } }
      : {}),
  });
  useAcceptance.setState({ status: 'done', result, grade: g, fraction: 1, phase: 'done', curve: result.curve });
  const paid = awardStars(job.id, job.title, g.stars);
  if (paid > 0) say('job', 'good', `客户付了工钱 ¥${paid}。`, { head: '进账：' });
}

export function startAcceptance(): void {
  const job = currentJob();
  if (!job || useAcceptance.getState().status === 'running') return;
  const { config, ecu } = useBench.getState();
  const sig = buildSig(config, ecu);
  const cost = currentCost();
  const id = ++requestId;
  useAcceptance.setState({
    status: 'running',
    open: true,
    jobId: job.id,
    phase: 'start',
    fraction: 0,
    curve: [],
    result: null,
    grade: null,
    cost,
    prevStars: useGame.getState().progress[job.id]?.stars ?? 0,
    prevBest: (() => {
      const p = useGame.getState().progress[job.id];
      return p && p.bestCurve.length > 1 ? { hp: p.bestHp, curve: p.bestCurve } : null;
    })(),
    error: null,
  });

  const w = getWorker();
  if (!w) {
    // Let the dialog paint before the main thread is busy.
    window.setTimeout(() => {
      try {
        finish(job, sig, cost, runAcceptance(config, ecu, job.plan));
      } catch (err) {
        useAcceptance.setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }, 50);
    return;
  }
  w.onmessage = (e: MessageEvent<AcceptanceReply>) => {
    const msg = e.data;
    if (msg.id !== requestId) return;
    if (msg.type === 'progress') {
      useAcceptance.setState({ phase: msg.progress.phase, fraction: msg.progress.fraction, curve: msg.progress.curve });
    } else if (msg.type === 'done') {
      finish(job, sig, cost, msg.result);
    } else if (msg.type === 'error') {
      useAcceptance.setState({ status: 'error', error: msg.message });
    }
  };
  w.onerror = (e) => {
    useAcceptance.setState({ status: 'error', error: e.message || '验收进程出错' });
  };
  const req: AcceptanceRequest = { id, config, ecu, plan: job.plan };
  w.postMessage(req);
}

export function cancelAcceptance(): void {
  if (useAcceptance.getState().status !== 'running') return;
  requestId++;
  worker?.terminate();
  worker = null;
  useAcceptance.setState({ status: 'idle', open: false });
}

export function closeAcceptance(): void {
  if (useAcceptance.getState().status === 'running') cancelAcceptance();
  else useAcceptance.setState({ open: false });
}
