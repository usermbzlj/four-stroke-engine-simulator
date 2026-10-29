import { create } from 'zustand';
import type { CoreEvent, CycleTrace } from '../sim/core';
import type { EngineSnapshot } from '../sim/snapshot';

export type FeedTone = 'knock' | 'pop' | 'misfire' | 'warn' | 'fail';

export interface FeedItem {
  id: number;
  tone: FeedTone;
  /** Grouping key; repeated events within a short window add to the count. */
  key: string;
  text: string;
  count: number;
  /** Severity used to pick which occurrence a merged item shows. */
  level: number;
  /** Bench time of the latest occurrence, s. */
  time: number;
}

const MAX_TRACES = 8;
const MAX_FEED = 6;
const MERGE_WINDOW = 1.5;
/** Time constant of the smoothed read-outs, s. */
const METRIC_TAU = 0.4;

/** Cycle results smoothed over a few tenths of a second, for comparing before and after a change. */
export interface Metrics {
  rpm: number;
  torque: number;
  brakeTorque: number;
  ve: number;
  lambda: number;
  pmaxDeg: number;
  egt: number;
}

interface LiveState {
  snapshot: EngineSnapshot | null;
  metrics: Metrics | null;
  /** Most recent first. */
  traces: CycleTrace[];
  traceSerial: number;
  feed: FeedItem[];
  setSnapshot: (s: EngineSnapshot) => void;
  pushTrace: (t: CycleTrace) => void;
  pushEvents: (events: CoreEvent[]) => void;
  clearFeed: () => void;
}

let feedId = 0;

type Described = Pick<FeedItem, 'tone' | 'key' | 'text' | 'level'>;

function describe(e: CoreEvent): Described | null {
  switch (e.kind) {
    case 'knock':
      return {
        tone: 'knock',
        key: 'knock',
        text: `爆震 ${Math.round(e.intensity * 100)}%，点火提前 ${e.advance.toFixed(1)}°`,
        level: e.intensity,
      };
    case 'afterfire':
      return { tone: 'pop', key: 'pop', text: '排气管放炮', level: 0 };
    case 'misfire': {
      const why = e.reason === 'lean' ? '混合气太稀' : e.reason === 'rich' ? '混合气太浓' : '缸里废气太多';
      return { tone: 'misfire', key: `misfire-${e.reason}`, text: `失火：${why}`, level: 0 };
    }
    case 'limiter':
      return { tone: 'warn', key: 'limiter', text: '撞到断火转速', level: 0 };
    case 'valveFloat':
      return { tone: 'warn', key: 'float', text: `${Math.round(e.rpm)} rpm 气门开始飘浮`, level: 0 };
    case 'failure':
      return { tone: 'fail', key: 'fail', text: e.failure.title, level: 0 };
  }
}

type EventListener = (events: CoreEvent[]) => void;
const eventListeners = new Set<EventListener>();

/** Raw solver events as they arrive. Returns an unsubscribe function. */
export function onCoreEvents(fn: EventListener): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

let metricCycle = -1;
let metricTime = 0;

function nextMetrics(prev: Metrics | null, s: EngineSnapshot): Metrics | null {
  const c = s.cycle;
  if (s.status !== 'running' || !c) {
    metricCycle = -1;
    return null;
  }
  if (c.index === metricCycle) return prev;
  metricCycle = c.index;
  const now: Metrics = {
    rpm: c.rpm,
    torque: c.torque,
    brakeTorque: c.brakeTorque,
    ve: c.ve,
    lambda: c.misfire ? (prev?.lambda ?? c.lambda) : c.lambda,
    pmaxDeg: c.pmaxDeg,
    egt: s.egtC,
  };
  const dt = Math.max(0, s.time - metricTime);
  metricTime = s.time;
  if (!prev) return now;
  const a = 1 - Math.exp(-dt / METRIC_TAU);
  const mix = (k: keyof Metrics): number => prev[k] + (now[k] - prev[k]) * a;
  return {
    rpm: mix('rpm'),
    torque: mix('torque'),
    brakeTorque: mix('brakeTorque'),
    ve: mix('ve'),
    lambda: mix('lambda'),
    pmaxDeg: mix('pmaxDeg'),
    egt: mix('egt'),
  };
}

export const useLive = create<LiveState>()((set, get) => ({
  snapshot: null,
  metrics: null,
  traces: [],
  traceSerial: 0,
  feed: [],
  setSnapshot: (snapshot) => set({ snapshot, metrics: nextMetrics(get().metrics, snapshot) }),
  pushTrace: (t) => set({ traces: [t, ...get().traces].slice(0, MAX_TRACES), traceSerial: get().traceSerial + 1 }),
  pushEvents: (events) => {
    for (const fn of eventListeners) fn(events);
    const now = get().snapshot?.time ?? 0;
    let feed = get().feed;
    for (const e of events) {
      const d = describe(e);
      if (!d) continue;
      const hit = feed.find((f) => f.key === d.key && now - f.time < MERGE_WINDOW);
      if (hit) {
        // A burst is summarised by its worst event.
        const worse = d.level >= hit.level;
        feed = feed.map((f) =>
          f === hit
            ? { ...f, count: f.count + 1, time: now, text: worse ? d.text : f.text, level: Math.max(f.level, d.level) }
            : f,
        );
      } else {
        feed = [{ id: ++feedId, ...d, count: 1, time: now }, ...feed].slice(0, MAX_FEED);
      }
    }
    set({ feed });
  },
  clearFeed: () => set({ feed: [] }),
}));
