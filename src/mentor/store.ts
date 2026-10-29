import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * say: plain talk · joke: teasing · warn: heads-up · danger: serious, no jokes · good: praise.
 */
export type Tone = 'say' | 'joke' | 'warn' | 'danger' | 'good';

export interface MentorAction {
  label: string;
  run: () => void;
  primary?: boolean;
}

export interface MentorMessage {
  id: number;
  key: string;
  tone: Tone;
  text: string;
  actions: MentorAction[];
  /** Optional heading in bold before the text. */
  head?: string;
}

export interface TuningState {
  stage: string;
  log: string[];
}

interface MentorState {
  messages: MentorMessage[];
  /** Panel expanded. */
  open: boolean;
  /** Mentor steps in before a failure. */
  protect: boolean;
  visits: number;
  /** Engines lost, ever. */
  failures: number;
  graduated: boolean;
  /** 0 = fresh, 4 = beyond help. Session only. */
  despair: number;
  lesson: number | null;
  tuning: TuningState | null;
  set: (patch: Partial<Omit<MentorState, 'set'>>) => void;
}

export const useMentor = create<MentorState>()(
  persist(
    (set) => ({
      messages: [],
      open: true,
      protect: true,
      visits: 0,
      failures: 0,
      graduated: false,
      despair: 0,
      lesson: null,
      tuning: null,
      set: (patch) => set(patch),
    }),
    {
      name: 'engine-bench:mentor',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ protect: s.protect, visits: s.visits, failures: s.failures, graduated: s.graduated, open: s.open }),
    },
  ),
);

const MAX_MESSAGES = 30;
let messageId = 0;
const lastSaid = new Map<string, number>();

/**
 * Post a message. `cooldown` seconds must pass before the same key speaks
 * again; a repeated key replaces its previous message instead of stacking.
 */
export function say(
  key: string,
  tone: Tone,
  text: string,
  opts: { actions?: MentorAction[]; cooldown?: number; head?: string } = {},
): boolean {
  const now = performance.now();
  const prev = lastSaid.get(key);
  if (prev !== undefined && now - prev < (opts.cooldown ?? 0) * 1000) return false;
  lastSaid.set(key, now);
  const msg: MentorMessage = { id: ++messageId, key, tone, text, actions: opts.actions ?? [], ...(opts.head ? { head: opts.head } : {}) };
  const rest = useMentor.getState().messages.filter((m) => m.key !== key);
  useMentor.setState({ messages: [msg, ...rest].slice(0, MAX_MESSAGES) });
  return true;
}

export function dismiss(id: number): void {
  useMentor.setState({ messages: useMentor.getState().messages.filter((m) => m.id !== id) });
}

/** Seconds since `key` last spoke, Infinity if never. */
export function sinceSaid(key: string): number {
  const t = lastSaid.get(key);
  return t === undefined ? Infinity : (performance.now() - t) / 1000;
}

export function addDespair(d: number): void {
  const s = useMentor.getState();
  useMentor.setState({ despair: Math.max(0, Math.min(4.9, s.despair + d)) });
}
