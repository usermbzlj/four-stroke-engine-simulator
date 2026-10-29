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

interface LiveState {
  snapshot: EngineSnapshot | null;
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

export const useLive = create<LiveState>()((set, get) => ({
  snapshot: null,
  traces: [],
  traceSerial: 0,
  feed: [],
  setSnapshot: (snapshot) => set({ snapshot }),
  pushTrace: (t) => set({ traces: [t, ...get().traces].slice(0, MAX_TRACES), traceSerial: get().traceSerial + 1 }),
  pushEvents: (events) => {
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
