/**
 * The player hands 老周 a brief; he works through builds on private engines
 * (the live bench keeps running), then fits the best one he found.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { partOpen, vehiclePartOpen } from '../game/career';
import { currentJob } from '../game/session';
import { changedParts, money, partChanged, PARTS, type PartId } from '../game/parts';
import { useGame } from '../game/store';
import { changedVehicleParts, VEHICLE_PARTS, vehiclePartChanged, type VehicleConfig, type VehiclePartId } from '../sim/vehicle';
import { baseVehicle, useBench } from '../state/benchStore';
import type { EcuConfig, EngineConfig } from '../sim/config';
import { crankForMe, mentorEdit } from './actions';
import { engineer } from './engineer/engineer';
import { useLive } from '../state/liveStore';
import { briefForJob, effectiveGoals, gap, GOALS, idleCapFor, type Brief, type Goal } from './goals';
import { openPool, type Pool } from './pool';
import { costOf, ctxOf, summary, type Tried } from './search';
import { addDespair, say, useMentor } from './store';

export interface Draft {
  goals: Goal[];
  parts: PartId[];
  ecu: boolean;
  /** Vehicle parts he may change (older drafts: all). */
  vehicleParts?: VehiclePartId[];
}

export interface GoalRow {
  goal: Goal;
  start: number | null;
  best: number | null;
  met: boolean;
}

export interface QuestRun {
  stage: string;
  log: string[];
  tried: number;
  budget: number;
  rows: GoalRow[];
  survived: boolean;
  cost: number;
  stopping: boolean;
}

interface QuestState {
  /** Brief editor open. */
  editing: boolean;
  /** The sandbox brief, kept between visits. */
  sandbox: Draft | null;
  /** Briefs edited for a job this session. */
  jobs: Record<string, Draft>;
  run: QuestRun | null;
  /** Build before 老周's last fit, for undo. */
  undo: { config: EngineConfig; ecu: EcuConfig; vehicle: VehicleConfig } | null;
}

export const useQuest = create<QuestState>()(
  persist(() => ({ editing: false, sandbox: null, jobs: {}, run: null, undo: null }) as QuestState, {
    name: 'engine-bench:quest',
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ sandbox: s.sandbox }),
  }),
);

const ALL_PARTS = PARTS.map((p) => p.id);
const ALL_VEHICLE = VEHICLE_PARTS.map((p) => p.id);

/** What the editor opens with. */
export function draftNow(): Draft {
  const q = useQuest.getState();
  const job = currentJob();
  if (job) {
    if (q.jobs[job.id]) return q.jobs[job.id]!;
    const b = briefForJob(job, useBench.getState().baseline.config);
    return { goals: b.goals, parts: b.parts, ecu: true, vehicleParts: b.vehicleParts };
  }
  if (q.sandbox) return q.sandbox;
  const engLocked = new Set(lockedParts());
  const vehLocked = new Set(lockedVehicleParts());
  return {
    goals: [
      { kind: 'peakHp', value: 20, must: true },
      { kind: 'budget', value: 2000, must: false },
    ],
    parts: ALL_PARTS.filter((p) => p !== 'fuel' && !engLocked.has(p)),
    ecu: true,
    vehicleParts: ALL_VEHICLE.filter((p) => !vehLocked.has(p)),
  };
}

export function saveDraft(d: Draft): void {
  const job = currentJob();
  if (job) useQuest.setState({ jobs: { ...useQuest.getState().jobs, [job.id]: d } });
  else useQuest.setState({ sandbox: d });
}

export function jobDraft(): Draft | null {
  const job = currentJob();
  if (!job) return null;
  const b = briefForJob(job, useBench.getState().baseline.config);
  return { goals: b.goals, parts: b.parts, ecu: true, vehicleParts: b.vehicleParts };
}

export function lockedParts(): PartId[] {
  const job = currentJob();
  if (job) return job.locked ?? [];
  if (useGame.getState().mode !== 'sandbox') return [];
  const { baseline, config } = useBench.getState();
  return PARTS.filter((p) => !partOpen(p.id) && !partChanged(p, baseline.config, config)).map((p) => p.id);
}

export function lockedVehicleParts(): VehiclePartId[] {
  if (useGame.getState().mode !== 'sandbox') return [];
  const { baseline, vehicle } = useBench.getState();
  const base = baseVehicle(baseline, vehicle);
  return VEHICLE_PARTS.filter((p) => !vehiclePartOpen(p.id) && !vehiclePartChanged(p, base, vehicle)).map((p) => p.id);
}

function briefFrom(d: Draft): Brief {
  const job = currentJob();
  const b = useBench.getState();
  const base = job ? briefForJob(job, b.baseline.config) : null;
  const engLocked = new Set(lockedParts());
  const vehLocked = new Set(lockedVehicleParts());
  return {
    goals: d.goals,
    parts: d.parts.filter((p) => !engLocked.has(p)),
    ecu: d.ecu,
    lock: base?.lock ?? {},
    mufflers: base?.mufflers ?? null,
    plan: job ? job.plan : { bench: b.bench },
    baseline: b.baseline.config,
    vehicle: b.vehicle,
    vehicleBaseline: baseVehicle(b.baseline, b.vehicle),
    vehicleParts: (d.vehicleParts ?? ALL_VEHICLE).filter((p) => !vehLocked.has(p)),
    idleCap: idleCapFor(d.goals, Math.max(b.ecu.idleRpm, b.baseline.ecu.idleRpm)),
  };
}

function rows(goals: Goal[], start: Tried | null, best: Tried | null): GoalRow[] {
  return effectiveGoals(goals).map((g) => ({
    goal: g,
    start: start ? GOALS[g.kind].measure(g, ctxOf(start)) : null,
    best: best ? GOALS[g.kind].measure(g, ctxOf(best)) : null,
    met: best ? (gap(g, ctxOf(best)) ?? 1) <= 0 : false,
  }));
}

let pool: Pool | null = null;
let stopFlag = false;
/** Bumped per run, so a run that was abandoned cannot report into a newer one. */
let runId = 0;

const patch = (p: Partial<QuestRun>): void => {
  const r = useQuest.getState().run;
  if (r) useQuest.setState({ run: { ...r, ...p } });
};

export function stopQuest(): void {
  stopFlag = true;
  patch({ stopping: true, stage: '收尾：把目前最好的那套再正式跑一遍' });
}

export function abandonQuest(): void {
  stopFlag = true;
  runId++;
  pool?.close();
  pool = null;
  useQuest.setState({ run: null });
  say('quest', 'say', '行，不弄了。你的台架我一点没动。');
}

/** Put the build from before 老周's last fit back. */
export function undoQuest(): void {
  const u = useQuest.getState().undo;
  if (!u) return;
  fit(u.config, u.ecu, u.vehicle);
  useQuest.setState({ undo: null });
  say('quest', 'say', '换回去了，还是你原来那套。');
}

function sameObj<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((k) => a[k] === b[k]);
}

function fit(config: EngineConfig, ecu: EcuConfig, vehicle: VehicleConfig): void {
  mentorEdit(() => {
    const b = useBench.getState();
    if (!sameObj(config, b.config)) b.setConfig(config);
    b.setEcu(ecu);
    b.setVehicle(vehicle);
  });
}

export async function startQuest(d: Draft): Promise<void> {
  if (useQuest.getState().run) return;
  saveDraft(d);
  const brief = briefFrom(d);
  if (brief.goals.length === 0) return;
  const b = useBench.getState();
  stopFlag = false;
  const id = ++runId;
  const mine = openPool({
    onDegraded: () =>
      say('quest', 'warn', '后台台架起不来（多半是网站刚更新过，这个页面还是旧的），我只能在你这页里一台一台慢慢算，会很慢。先让我停下，刷新页面再来，快得多。', {
        head: '慢下来了：',
        actions: [{ label: '刷新页面', run: () => location.reload(), primary: true }],
      }),
  });
  pool = mine;
  const budget = Math.max(160, Math.min(320, 80 + 40 * mine.width));
  useQuest.setState({
    editing: false,
    run: { stage: '准备', log: [], tried: 0, budget, rows: rows(brief.goals, null, null), survived: true, cost: 0, stopping: false },
  });
  useMentor.getState().set({ open: true });
  say('quest', 'say', `交给我。先体检，再逐点标定，然后对症换零件，最后细调和复核。后面 ${mine.width} 台台架同时跑，你这边照常玩。`);

  let start: Tried | null = null;
  const from = { config: b.config, ecu: b.ecu, vehicle: b.vehicle, wish: b.ecu.limiterRpm };
  try {
    const out = await engineer(
      brief,
      from,
      {
        evaluate: (jobs) => mine.evaluate(jobs),
        tasks: (config, ecu, specs) => mine.tasks(config, ecu, specs),
        width: mine.width,
        log: (t) => {
          const r = useQuest.getState().run;
          if (r) patch({ log: [...r.log, t].slice(-60) });
        },
        stage: (t) => patch({ stage: t }),
        progress: (best, tried) => {
          start ??= best;
          patch({ tried, rows: rows(brief.goals, start, best), survived: best.score.survived, cost: best.cost });
        },
        stopped: () => stopFlag || id !== runId,
      },
      budget,
    );
    if (id === runId) finish(brief, d, out.start, out.verified, out.tried);
  } catch (err) {
    if (id !== runId) return; // abandoned
    useQuest.setState({ run: null });
    const msg = err instanceof Error ? err.message : String(err);
    say('quest', 'warn', `出岔子了：${/worker|Failed to fetch|import/i.test(msg) ? '后台台架起不来，多半是网站刚更新过、这个页面还是旧的。刷新一下页面再让我试' : msg}。你的台架没动。`, {
      actions: [{ label: '刷新页面', run: () => location.reload(), primary: true }],
    });
  } finally {
    mine.close();
    if (pool === mine) pool = null;
  }
}

function finish(brief: Brief, d: Draft, start: Tried, v: Tried, tried: number): void {
  const before = useBench.getState();
  const goals = brief.goals;
  const better = v.score.loss < start.score.loss - 1e-6;
  useQuest.setState({ run: null });
  if (!better) {
    say('quest', 'warn', `试了 ${tried} 套，没有一套比你现在的好。${summary(goals, v)}。要么目标定得太狠，要么得放开更多零件让我动。`, {
      head: '没找到更好的。',
      actions: [{ label: '改目标', run: () => useQuest.setState({ editing: true }), primary: true }],
    });
    return;
  }
  useQuest.setState({ undo: { config: before.config, ecu: before.ecu, vehicle: before.vehicle } });
  const parts = [...changedParts(before.baseline.config, v.config), ...changedVehicleParts(brief.vehicleBaseline, v.vehicle)];
  const changedNow = [...changedParts(before.config, v.config), ...changedVehicleParts(before.vehicle, v.vehicle).map((p) => ({ ...p, block: false }))];
  const block = changedNow.some((p) => p.block);
  if (before.runs.length === 0 || before.runs.at(-1)?.label !== '老周前') before.addRun(start.result.curve, '老周前');
  const wasRunning = useLive.getState().snapshot?.status === 'running';
  fit(v.config, v.ecu, v.vehicle);
  useBench.getState().addRun(v.result.curve, '老周方案');
  // Block parts stop the crank; start it again the way it was.
  if (block && wasRunning) void crankForMe();

  const cost = costOf(brief, v);
  const met = v.score.allMet;
  const mustOk = v.score.mustMet;
  const missed = effectiveGoals(goals).filter((g) => (gap(g, ctxOf(v)) ?? 0) > 0);
  const ecuDiff = (Object.keys(v.ecu) as (keyof EcuConfig)[]).filter((k) => v.ecu[k] !== before.ecu[k]).length;
  const what = [changedNow.length ? `换了${changedNow.map((p) => p.name).join('、')}` : '', ecuDiff ? `ECU 动了 ${ecuDiff} 项` : ''].filter(Boolean).join('，');
  const head = met ? '全部达标。' : mustOk ? '必须的都达到了。' : '尽力了，还差一点。';
  const tail = met ? '' : `没够上的：${missed.map((g) => GOALS[g.kind].name).join('、')}。${mustOk ? '' : '放开更多零件，或者把目标放低一点再试。'}`;
  say(
    'quest',
    met ? 'good' : mustOk ? 'say' : 'warn',
    `试了 ${tried} 套。${what || '参数微调'}，零件 ${money(cost)}${parts.length ? `（${parts.map((p) => p.name).join('、')}）` : ''}。正式跑一遍：${summary(goals, v)}。${tail}已经装上了，测功面板里有前后两条曲线。${block && wasRunning ? '动了缸体得停机装，我已经重新打着了。' : ''}`,
    {
      head,
      actions: [
        { label: '换回原来的', run: undoQuest },
        ...(met ? [] : [{ label: '改目标再试', run: () => useQuest.setState({ editing: true }), primary: true }]),
      ],
    },
  );
  if (met) addDespair(-0.5);
  saveDraft(d);
}
