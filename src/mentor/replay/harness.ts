/**
 * Headless replay bench for 老周.
 *
 * The real mentor runtime (brain, every zustand store, engineLink) drives the
 * real solver through EngineRunner on the fake clock: no audio, no DOM. A
 * script plays the user; everything the mentor says or does is recorded on a
 * timeline. Each session gets fresh modules, storage, clock and seed.
 *
 * Only usable from vitest (it relies on vi.mock / fake timers).
 */

import { vi } from 'vitest';
import type { EngineMessage, EngineSetup, HostCommand } from '../../audio/protocol';
import type { EngineRunner } from '../../audio/runner';
import type { BenchConfig, EcuConfig, EngineConfig } from '../../sim/config';
import type { CoreEvent } from '../../sim/core';
import type { EngineSnapshot } from '../../sim/snapshot';
import type * as BrainModule from '../brain';
import type * as StoreModule from '../store';
import type * as ActionsModule from '../actions';
import type * as LessonsModule from '../lessons';
import type * as AdviceModule from '../advice';
import type * as BenchModule from '../../state/benchStore';
import type * as ControlsModule from '../../state/controlStore';
import type * as LiveModule from '../../state/liveStore';
import type * as UiModule from '../../state/uiStore';
import type * as LinkModule from '../../state/engineLink';
import type * as ConfigModule from '../../sim/config';

// ---------------------------------------------------------------------------
// Browser stand-ins
// ---------------------------------------------------------------------------

const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string): string | null => mem.get(k) ?? null,
  setItem: (k: string, v: string): void => void mem.set(k, String(v)),
  removeItem: (k: string): void => void mem.delete(k),
  clear: (): void => mem.clear(),
  key: (i: number): string | null => [...mem.keys()][i] ?? null,
  get length(): number {
    return mem.size;
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });

/** Solver sample rate; the silent main-thread host uses the same. */
export const RATE = 24000;
/** The host is pumped from a fake interval this often, ms. */
export const PUMP_MS = 10;

interface HostHooks {
  runner: EngineRunner | null;
  onSay: ((key: string, tone: string, text: string, spoken: boolean) => void) | null;
}
const hooks: HostHooks = { runner: null, onSay: null };
g.__replayHooks = hooks;

/**
 * Mocks are (re)registered per session with doMock: vi.resetModules() does not
 * reset the mock registry, so a vi.mock'd store would leak cooldowns, protect
 * and despair from one session into the next.
 */
function installMocks(): void {
  vi.doUnmock('../../audio/host');
  vi.doUnmock('../store');
  vi.doMock('../../audio/host', async () => {
    const { EngineRunner: Runner } = await import('../../audio/runner');
    return {
      startEngineHost: async (setup: EngineSetup, listener: (m: EngineMessage) => void) => {
        const runner = new Runner(RATE, structuredClone(setup), false, (msg) => listener(structuredClone(msg)));
        hooks.runner = runner;
        const pump = window.setInterval(() => runner.run((RATE * PUMP_MS) / 1000), PUMP_MS);
        return {
          audible: false,
          send: (cmd: HostCommand) => runner.handle(structuredClone(cmd)),
          dispose: () => window.clearInterval(pump),
        };
      },
    };
  });
  vi.doMock('../store', async (importOriginal) => {
    const mod = await importOriginal<typeof StoreModule>();
    return {
      ...mod,
      say: (...args: Parameters<typeof mod.say>) => {
        const spoken = mod.say(...args);
        hooks.onSay?.(args[0], args[1], args[2], spoken);
        return spoken;
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Modules under test, imported fresh per session
// ---------------------------------------------------------------------------

export interface Modules {
  brain: typeof BrainModule;
  store: typeof StoreModule;
  actions: typeof ActionsModule;
  lessons: typeof LessonsModule;
  advice: typeof AdviceModule;
  bench: typeof BenchModule;
  controls: typeof ControlsModule;
  live: typeof LiveModule;
  ui: typeof UiModule;
  link: typeof LinkModule;
  config: typeof ConfigModule;
}

async function importAll(): Promise<Modules> {
  return {
    brain: await import('../brain'),
    store: await import('../store'),
    actions: await import('../actions'),
    lessons: await import('../lessons'),
    advice: await import('../advice'),
    bench: await import('../../state/benchStore'),
    controls: await import('../../state/controlStore'),
    live: await import('../../state/liveStore'),
    ui: await import('../../state/uiStore'),
    link: await import('../../state/engineLink'),
    config: await import('../../sim/config'),
  };
}

type Controls = ReturnType<Modules['controls']['useControls']['getState']>;

/** Slider / choice labels as the panels show them, keyed by `scope.field`. */
export const LABELS: Record<string, string> = {
  'ecu.advanceOffset': '点火角修正',
  'ecu.knockControl': '爆震控制',
  'ecu.cruiseLambda': '部分负荷 λ',
  'ecu.wotLambda': '全油门 λ',
  'ecu.overrunFuelCut': '松油门断油',
  'ecu.limiterRpm': '断火转速',
  'ecu.limiterMode': '限转方式',
  'ecu.idleRpm': '怠速目标',
  'bench.coolantConditioner': '水温机',
  'bench.coolantSetpoint': '水温设定',
  'config.bore': '缸径',
  'config.stroke': '行程',
  'config.rodLength': '连杆中心距',
  'config.compressionRatio': '压缩比',
  'config.intakeValves': '每缸进气门',
  'config.exhaustValves': '每缸排气门',
  'config.intakeValveDiameter': '进气门直径',
  'config.exhaustValveDiameter': '排气门直径',
  'config.intakeDuration': '进气持续角',
  'config.exhaustDuration': '排气持续角',
  'config.intakeLift': '进气升程',
  'config.exhaustLift': '排气升程',
  'config.lobeSeparation': '凸轮夹角',
  'config.intakeCenterline': '进气中心角',
  'config.valveSpringForce': '气门弹簧力',
  'config.throttleDiameter': '节气门直径',
  'config.intakeRunnerLength': '进气道长度',
  'config.intakeRunnerDiameter': '进气道直径',
  'config.exhaustHeaderLength': '排气头段长度',
  'config.exhaustHeaderDiameter': '排气头段直径',
  'config.muffler': '消音器',
  'config.flywheelInertia': '飞轮惯量',
  'config.reciprocatingMass': '往复质量',
  'config.rodStrength': '连杆强度',
  'config.fuelOctane': '燃油辛烷值',
  'config.radiatorCapacity': '散热器',
};

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type LineKind = 'say' | 'player' | 'act' | 'engine' | 'lesson' | 'tune' | 'note';

export interface Line {
  t: number;
  kind: LineKind;
  text: string;
  key?: string;
  tone?: string;
}

export interface SpokenMessage {
  t: number;
  id: number;
  key: string;
  tone: string;
  head?: string;
  text: string;
  actions: string[];
  replaced: boolean;
  /** Seconds it stayed among the 3 visible messages, null while still visible at the end. */
  visibleFor: number | null;
  /** Key of the message that pushed it out of view. */
  buriedBy?: string;
}

export interface Sample {
  t: number;
  status: string;
  rpm: number;
  thr: number;
  dmg: number;
  fat: number;
  coolant: number;
  knockRetard: number;
  auto: number | null;
}

export interface SessionStats {
  seconds: number;
  messages: number;
  perMinute: number;
  byKey: Record<string, number>;
  replaced: number;
  /** say() calls swallowed by the cooldown, per key. */
  suppressed: Record<string, number>;
  longestSilence: { from: number; to: number };
  rescues: number;
  failures: string[];
  despair: number;
  title: string;
  events: Record<string, number>;
  maxDamage: number;
  maxFatigue: number;
  maxCoolant: number;
  maxRpm: number;
  /** Status flips that reverted within 0.3 s (running ↔ off while the crank keeps turning). */
  flickers: number;
  /** Danger messages that left the visible three within 4 s. */
  buriedDanger: { t: number; key: string; seconds: number; by: string }[];
}

export interface SessionResult {
  id: string;
  title: string;
  setup: string;
  lines: Line[];
  messages: SpokenMessage[];
  samples: Sample[];
  stats: SessionStats;
  checks: { ok: boolean; text: string }[];
}

export interface BootOptions {
  id: string;
  title: string;
  setup?: string;
  preset?: 'street-250' | 'race-450' | 'thumper-650';
  /** Persisted mentor state; default is a graduated returning user (visits 3). */
  mentor?: Partial<{ visits: number; graduated: boolean; failures: number; protect: boolean; open: boolean }>;
  /** Build saved from an earlier visit, applied before the bench starts. */
  config?: Partial<EngineConfig>;
  ecu?: Partial<EcuConfig>;
  bench?: Partial<BenchConfig>;
  seed?: number;
  /** Seconds between telemetry samples kept in the raw log. */
  sampleEvery?: number;
}

/** A scripted player session; see scripts.ts. */
export interface Session {
  id: string;
  title: string;
  opts: Omit<BootOptions, 'id' | 'title'>;
  run: (h: Replay) => Promise<void>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const fmtRpm = (v: number): string => Math.round(v).toLocaleString('en-US');
const fmtVal = (v: unknown): string =>
  typeof v === 'number' ? (Number.isInteger(v) ? (Math.abs(v) >= 1000 ? fmtRpm(v) : String(v)) : String(Math.round(v * 1000) / 1000)) : String(v);

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export class Replay {
  readonly lines: Line[] = [];
  readonly messages: SpokenMessage[] = [];
  readonly samples: Sample[] = [];
  readonly checks: { ok: boolean; text: string }[] = [];
  private readonly t0: number;
  private readonly unsubs: (() => void)[] = [];
  private readonly seen = new Map<number, SpokenMessage>();
  private readonly suppressed: Record<string, number> = {};
  private readonly events: Record<string, number> = {};
  private actor: string | null = null;
  private rescues = 0;
  private failures: string[] = [];
  private max = { dmg: 0, fat: 0, coolant: 0, rpm: 0 };
  private lastSample = -Infinity;
  private visible: number[] = [];

  constructor(
    readonly M: Modules,
    readonly opts: BootOptions,
  ) {
    this.t0 = performance.now();
  }

  /** Seconds since boot on the fake clock. */
  t(): number {
    return (performance.now() - this.t0) / 1000;
  }

  get snap(): EngineSnapshot | null {
    return this.M.live.useLive.getState().snapshot;
  }

  get runner(): EngineRunner {
    if (!hooks.runner) throw new Error('bench not started');
    return hooks.runner;
  }

  private push(kind: LineKind, text: string, extra: Partial<Line> = {}): void {
    this.lines.push({ t: this.t(), kind, text, ...extra });
  }

  /** Short engine state for a timeline line. */
  stateText(full = false): string {
    const s = this.snap;
    if (!s) return 'no engine';
    const parts = [`rpm ${fmtRpm(s.rpm)}`, `thr ${s.throttle.toFixed(2)}`];
    if (s.status !== 'running') parts.push(s.status);
    if (full || s.pistonDamage > 0.005) parts.push(`dmg ${Math.round(s.pistonDamage * 100)}%`);
    if (full || s.rodFatigue > 0.005) parts.push(`fat ${Math.round(s.rodFatigue * 100)}%`);
    if (full || s.coolantC > 100) parts.push(`水温 ${s.coolantC.toFixed(0)}`);
    if (s.knockRetard > 0.5) parts.push(`退角 ${s.knockRetard.toFixed(1)}`);
    const c = this.M.controls.useControls.getState();
    if (c.brakeMode === 'speed') {
      const m = this.M.live.useLive.getState().metrics;
      parts.push(`测功 ${fmtRpm(c.brakeRpm)}${m ? ` 扭矩 ${m.brakeTorque.toFixed(1)}` : ''}`);
    }
    if (c.autoThrottle !== null) parts.push(`老周油门 ${c.autoThrottle}`);
    return parts.join(' ');
  }

  // ---- recording -----------------------------------------------------------

  attach(): void {
    const { store, controls, bench, live, actions, lessons } = this.M;
    hooks.onSay = (key, _tone, _text, spoken) => {
      if (!spoken) this.suppressed[key] = (this.suppressed[key] ?? 0) + 1;
    };

    this.unsubs.push(
      store.useMentor.subscribe((s, p) => {
        if (s.messages !== p.messages) this.onMessages(s.messages, p.messages);
        if (s.lesson !== p.lesson) {
          if (s.lesson === null) this.push('lesson', `课程结束${s.graduated ? '（已毕业）' : ''}`);
          else {
            const step = lessons.LESSON[s.lesson];
            const btns = [step?.manual, step?.help?.label].filter(Boolean).map((b) => `[${b}]`).join('');
            this.push('lesson', `第 ${s.lesson + 1}/${lessons.LESSON.length} 步「${step?.title}」${btns} ${step?.text() ?? ''}`);
          }
        }
        if (s.tuning !== p.tuning) {
          if (!s.tuning) this.push('tune', '调校面板关闭');
          else if (!p.tuning || s.tuning.stage !== p.tuning.stage) this.push('tune', `阶段：${s.tuning.stage}`);
          if (s.tuning && s.tuning.log !== p.tuning?.log && s.tuning.log.length > 0) {
            const last = s.tuning.log.at(-1)!;
            if (last !== p.tuning?.log.at(-1)) this.push('tune', `日志：${last}`);
          }
        }
        if (Math.floor(s.despair) !== Math.floor(p.despair)) {
          const titles = ['台架老师傅', '还有耐心', '在找降压药', '已放弃治疗', '正在写辞职信'];
          this.push('act', `绝望值 ${p.despair.toFixed(1)} → ${s.despair.toFixed(1)}，头衔「${titles[Math.min(4, Math.floor(s.despair))]}」`);
        }
        if (s.protect !== p.protect) this.push('act', `保护模式 ${s.protect ? '开' : '关'}`);
      }),
    );

    this.unsubs.push(
      controls.useControls.subscribe((s, p) => {
        if (s.autoThrottle !== p.autoThrottle) {
          this.push('act', s.autoThrottle === null ? `老周放开油门 | ${this.stateText()}` : `老周握油门 → ${s.autoThrottle} | ${this.stateText()}`);
        }
        if (s.sweeping !== p.sweeping) this.push('act', s.sweeping ? `测功机开始自动扫转速（${fmtRpm(s.brakeRpm)} 起）` : `自动扫转速结束 | ${this.stateText()}`);
        else if (s.brakeMode !== p.brakeMode && !this.actor) this.push('act', `测功机 ${s.brakeMode === 'speed' ? `定速 ${fmtRpm(s.brakeRpm)}` : '松开'}`);
        else if (s.brakeRpm !== p.brakeRpm && !s.sweeping && s.brakeMode === 'speed' && !this.actor) this.push('act', `测功机定速 → ${fmtRpm(s.brakeRpm)}`);
        if (s.starter !== p.starter && !this.actor) this.push('act', `起动机 ${s.starter ? '按下' : '松开'}（老周）`);
        if (s.hand !== p.hand && !this.actor) this.push('act', `手油门被设成 ${s.hand}`);
        if (s.ignition !== p.ignition && !this.actor) this.push('act', `点火 ${s.ignition ? '开' : '关'}`);
      }),
    );

    this.unsubs.push(
      bench.useBench.subscribe((s, p) => {
        const changes: string[] = [];
        const diff = <T extends object>(scope: string, a: T, b: T): void => {
          for (const k of Object.keys(a) as (keyof T)[]) {
            if (a[k] !== b[k]) changes.push(`${LABELS[`${scope}.${String(k)}`] ?? String(k)} ${fmtVal(b[k])} → ${fmtVal(a[k])}`);
          }
        };
        diff('config', s.config, p.config);
        diff('ecu', s.ecu, p.ecu);
        diff('bench', s.bench, p.bench);
        if (changes.length > 0 && this.actor !== '玩家') {
          const who = this.actor ?? (actions.isMentorEdit() ? '老周' : '系统');
          this.push('act', `${who}改：${changes.length > 6 ? `${changes.slice(0, 6).join('，')} …共 ${changes.length} 项` : changes.join('，')}`);
        }
        if (s.runs !== p.runs && s.runs.length > 0 && s.runs.at(-1) !== p.runs.at(-1)) {
          const r = s.runs.at(-1)!;
          let best: [number, number] = [0, 0];
          for (const pt of r.points) if (pt[1] > best[1]) best = pt;
          this.push('act', `测功曲线「${r.label}」存档：${r.points.length} 点，峰值 ${best[1].toFixed(1)} Nm @ ${fmtRpm(best[0])}`);
        }
      }),
    );

    this.unsubs.push(
      live.useLive.subscribe((s, p) => {
        const a = s.snapshot;
        const b = p.snapshot;
        if (!a) return;
        this.trackStatus(a, b);
        this.max.dmg = Math.max(this.max.dmg, a.pistonDamage);
        this.max.fat = Math.max(this.max.fat, a.rodFatigue);
        this.max.coolant = Math.max(this.max.coolant, a.coolantC);
        this.max.rpm = Math.max(this.max.rpm, a.rpm);
        const t = this.t();
        if (t - this.lastSample >= (this.opts.sampleEvery ?? 0.25)) {
          this.lastSample = t;
          this.samples.push({
            t: Math.round(t * 100) / 100,
            status: a.status,
            rpm: Math.round(a.rpm),
            thr: Math.round(a.throttle * 100) / 100,
            dmg: Math.round(a.pistonDamage * 1000) / 1000,
            fat: Math.round(a.rodFatigue * 1000) / 1000,
            coolant: Math.round(a.coolantC * 10) / 10,
            knockRetard: Math.round(a.knockRetard * 10) / 10,
            auto: this.M.controls.useControls.getState().autoThrottle,
          });
        }
      }),
    );

    this.unsubs.push(
      live.onCoreEvents((evs: CoreEvent[]) => {
        for (const e of evs) {
          this.events[e.kind] = (this.events[e.kind] ?? 0) + 1;
          if (e.kind === 'valveFloat') this.push('engine', `气门开始飘浮 @ ${fmtRpm(e.rpm)} rpm`);
        }
      }),
    );
  }

  /**
   * Status changes, debounced: a status that flips back within 0.3 s is a
   * flicker (counted, summarised at most every 3 s) rather than a transition.
   */
  private trackStatus(a: EngineSnapshot, b: EngineSnapshot | null): void {
    const st = this.status;
    const t = this.t();
    if (a.status === 'broken') {
      if (b?.status !== 'broken' && a.failure) {
        this.failures.push(a.failure.title);
        st.shown = 'broken';
        st.pending = null;
        this.push('engine', `💥 ${a.failure.title} @ ${fmtRpm(a.failure.rpm)} rpm —— ${a.failure.detail} | ${this.stateText(true)}`);
      }
      return;
    }
    if (a.status !== st.shown) {
      if (!st.pending || st.pending.to !== a.status) st.pending = { to: a.status, t, state: this.stateText() };
      else if (t - st.pending.t >= 0.3) {
        this.lines.push({ t: st.pending.t, kind: 'engine', text: `状态 ${st.shown} → ${a.status} | ${st.pending.state}` });
        st.shown = a.status;
        st.pending = null;
      }
    } else if (st.pending) {
      st.flickers++;
      if (t - st.lastLog > 3) {
        st.lastLog = t;
        this.push('engine', `状态闪烁 ${st.shown}→${st.pending.to}→${st.shown}（累计 ${st.flickers} 次）| ${st.pending.state}`);
      }
      st.pending = null;
    }
  }

  private readonly status = { shown: 'none', pending: null as { to: string; t: number; state: string } | null, flickers: 0, lastLog: -Infinity };

  private onMessages(now: { id: number; key: string; tone: string; text: string; head?: string; actions: { label: string }[] }[], prev: { id: number; key: string }[]): void {
    const t = this.t();
    const fresh = now.filter((m) => !this.seen.has(m.id)).reverse();
    for (const m of fresh) {
      const replaced = prev.some((x) => x.key === m.key);
      const rec: SpokenMessage = {
        t,
        id: m.id,
        key: m.key,
        tone: m.tone,
        ...(m.head ? { head: m.head } : {}),
        text: m.text,
        actions: m.actions.map((a) => a.label),
        replaced,
        visibleFor: null,
      };
      this.seen.set(m.id, rec);
      this.messages.push(rec);
      if (m.key === 'rescue') this.rescues++;
      const btns = rec.actions.map((a) => `[${a}]`).join('');
      this.push('say', `[${m.tone}] ${m.key}: 「${m.head ?? ''}${m.text}」${btns ? ` 按钮${btns}` : ''}${replaced ? ' (替换同 key 旧消息)' : ''} | ${this.stateText()}`, {
        key: m.key,
        tone: m.tone,
      });
    }
    const top = now.slice(0, 3).map((m) => m.id);
    const pusher = fresh.at(-1)?.key ?? '(关闭/替换)';
    for (const id of this.visible) {
      if (top.includes(id)) continue;
      const rec = this.seen.get(id);
      if (rec && rec.visibleFor === null) {
        rec.visibleFor = t - rec.t;
        rec.buriedBy = now.some((m) => m.id === id) ? pusher : '(被移除)';
      }
    }
    this.visible = top;
  }

  // ---- player --------------------------------------------------------------

  /** Note a player action on the timeline. */
  player(text: string): void {
    this.push('player', `▶ 玩家：${text} | ${this.stateText()}`);
  }

  note(text: string): void {
    this.push('note', text);
  }

  /** Print the full engine state. */
  mark(label = '状态'): void {
    this.push('engine', `${label} | ${this.stateText(true)}`);
  }

  check(ok: boolean, text: string): void {
    this.checks.push({ ok, text });
    this.push('note', `${ok ? '✔' : '✘'} 检查：${text}`);
  }

  private as<T>(actor: string, fn: () => T): T {
    const prev = this.actor;
    this.actor = actor;
    try {
      return fn();
    } finally {
      this.actor = prev;
    }
  }

  async wait(seconds: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(Math.round(seconds * 1000));
  }

  /** Advance until `pred` holds or `timeout` seconds pass; true if it held. */
  async until(pred: () => boolean, timeout: number, step = 0.05): Promise<boolean> {
    const end = this.t() + timeout;
    while (this.t() < end) {
      if (pred()) return true;
      await this.wait(step);
    }
    return pred();
  }

  ctl(patch: Partial<Omit<Controls, 'set'>>, text?: string): void {
    if (text) this.player(text);
    this.as('玩家', () => this.M.controls.useControls.getState().set(patch));
  }

  hand(v: number): void {
    this.ctl({ hand: v }, `手油门 ${v}`);
  }

  pedal(v: number): void {
    this.ctl({ pedal: v }, v > 0 ? '按住空格（全油门）' : '松开空格');
  }

  /** Hold S until it runs (or `max` s), then let go, like the lesson says. */
  async crank(max = 5): Promise<boolean> {
    this.ctl({ starter: true }, '按住 S 起动');
    const ok = await this.until(() => this.snap?.status === 'running', max);
    await this.wait(0.2);
    this.ctl({ starter: false }, ok ? '看到「运转」，松开 S' : `拖了 ${max} 秒没着，松开 S`);
    return ok;
  }

  /** B key: hold the current speed, or let go. */
  brakeHere(): void {
    const c = this.M.controls.useControls.getState();
    if (c.brakeMode === 'speed') this.ctl({ brakeMode: 'off', sweeping: false }, '按 B 松开测功机');
    else {
      const rpm = Math.max(1000, Math.round((this.snap?.rpm ?? 3000) / 100) * 100);
      this.ctl({ brakeMode: 'speed', brakeRpm: rpm }, `按 B 测功机定在 ${fmtRpm(rpm)}`);
    }
  }

  brake(rpm: number | null): void {
    if (rpm === null) this.ctl({ brakeMode: 'off', sweeping: false }, '测功机松开');
    else this.ctl({ brakeMode: 'speed', brakeRpm: rpm }, `测功机定速 ${fmtRpm(rpm)}`);
  }

  /** Grab a slider (touch), then drag it to `value` through `steps` onChange calls over `seconds`. */
  async edit(param: string, value: number | boolean | string, opts: { steps?: number; seconds?: number; quiet?: boolean } = {}): Promise<void> {
    const [scope, key] = param.split('.') as ['config' | 'ecu' | 'bench', string];
    const b = this.M.bench.useBench.getState();
    const from = (scope === 'config' ? b.config : scope === 'ecu' ? b.ecu : b.bench) as unknown as Record<string, unknown>;
    const start = from[key];
    const label = LABELS[param] ?? param;
    if (!opts.quiet) this.player(`拧「${label}」${fmtVal(start)} → ${fmtVal(value)}`);
    this.M.ui.useUi.getState().touch(param, label);
    const steps = typeof value === 'number' && typeof start === 'number' ? Math.max(1, opts.steps ?? 3) : 1;
    for (let i = 1; i <= steps; i++) {
      const v = typeof value === 'number' && typeof start === 'number' ? (i === steps ? value : start + ((value - start) * i) / steps) : value;
      this.as('玩家', () => {
        const st = this.M.bench.useBench.getState();
        if (scope === 'config') st.setConfig({ [key]: v } as Partial<EngineConfig>);
        else if (scope === 'ecu') st.setEcu({ [key]: v } as Partial<EcuConfig>);
        else st.setBench({ [key]: v } as Partial<BenchConfig>);
      });
      if (i < steps) await this.wait((opts.seconds ?? 0.3) / steps);
    }
  }

  value(param: string): unknown {
    const [scope, key] = param.split('.') as ['config' | 'ecu' | 'bench', string];
    const b = this.M.bench.useBench.getState();
    return ((scope === 'config' ? b.config : scope === 'ecu' ? b.ecu : b.bench) as unknown as Record<string, unknown>)[key];
  }

  /** Click a button on a mentor message (visible three first, like the panel). Returns false if none. */
  click(label: string): boolean {
    const msgs = this.M.store.useMentor.getState().messages;
    let where = '';
    let msg = msgs.slice(0, 3).find((m) => m.actions.some((a) => a.label.includes(label)));
    if (!msg) {
      msg = msgs.find((m) => m.actions.some((a) => a.label.includes(label)));
      where = msg ? '（得点开「更早的」才找得到）' : '';
    }
    if (!msg) {
      this.player(`想点「${label}」，但面板上没有这个按钮`);
      return false;
    }
    const action = msg.actions.find((a) => a.label.includes(label))!;
    this.player(`点老周消息 ${msg.key} 上的按钮「${action.label}」${where}`);
    this.as('按钮', () => action.run());
    this.M.store.dismiss(msg.id);
    return true;
  }

  /** Buttons on the lesson card. */
  lesson(button: 'manual' | 'help' | 'skip' | 'quit'): boolean {
    const { brain, lessons, store } = this.M;
    const i = store.useMentor.getState().lesson;
    const step = i === null ? undefined : lessons.LESSON[i];
    if (!step) {
      this.player(`想点课程卡按钮（${button}），但没有课程`);
      return false;
    }
    if (button === 'manual') {
      if (!step.manual) return (this.player(`第 ${i! + 1} 步没有手动按钮`), false);
      this.player(`点课程卡「${step.manual}」`);
      this.as('按钮', () => brain.nextLessonStep());
    } else if (button === 'help') {
      if (!step.help) return (this.player(`第 ${i! + 1} 步没有帮助按钮`), false);
      this.player(`点课程卡「${step.help.label}」`);
      this.as('按钮', () => step.help!.run());
    } else if (button === 'skip') {
      this.player('点课程卡「跳过这步」');
      brain.nextLessonStep();
    } else {
      this.player('点课程卡「不学了」');
      brain.quitLesson();
    }
    return true;
  }

  /** DynoPanel「自动扫转速」. */
  sweep(): void {
    this.player('点测功面板「自动扫转速」');
    this.as('玩家', () => this.M.link.startSweep());
  }

  async sweepDone(timeout = 40): Promise<boolean> {
    return this.until(() => !this.M.controls.useControls.getState().sweeping, timeout);
  }

  /** MentorPanel「老周调一遍」; resolves when the tune ends. */
  autoTune(): Promise<void> {
    this.player('点「老周调一遍」');
    return this.M.brain.autoTune();
  }

  stopTune(): void {
    this.player('点「停下」');
    this.M.brain.stopTune();
  }

  get tuning(): boolean {
    return this.M.store.useMentor.getState().tuning !== null;
  }

  protect(on: boolean): void {
    this.player(`把保护模式拨到「${on ? '开' : '关'}」`);
    this.M.store.useMentor.getState().set({ protect: on });
  }

  /** FailureReport「原样换新零件」. */
  restore(): void {
    this.player('点拆机报告「原样换新零件」');
    this.as('按钮', () => this.M.link.restoreEngine());
  }

  /** FailureReport「按老周说的改，换新零件」. */
  restoreWithFixes(): void {
    const f = this.snap?.failure;
    if (!f) return this.player('想点拆机报告，但没炸');
    const fixes = this.M.brain.failureFixes(f);
    this.player(`点拆机报告「按老周说的改，换新零件」（${fixes.map((x) => x.label).join('、')}）`);
    this.as('按钮', () => {
      for (const fx of fixes) this.M.actions.applyFix(fx);
      this.M.link.restoreEngine();
    });
  }

  /** Fixes the teardown card would list for the current failure. */
  failureCard(): string {
    const f = this.snap?.failure;
    if (!f) return '';
    const fixes = this.M.brain.failureFixes(f);
    const tail = this.M.store.useMentor.getState().messages.find((m) => m.key === 'failure-tail')?.text ?? '';
    return `拆机报告：${f.title}｜老周：${this.M.brain.failureCause(f)}｜建议：${fixes.map((x) => x.label).join('、') || '（无）'}｜${tail}`;
  }

  // ---- wrap up -------------------------------------------------------------

  finish(): SessionResult {
    const end = this.t();
    for (const u of this.unsubs) u();
    hooks.onSay = null;
    const ts = [0, ...this.messages.map((m) => m.t), end];
    let gap = { from: 0, to: 0 };
    for (let i = 1; i < ts.length; i++) if (ts[i]! - ts[i - 1]! > gap.to - gap.from) gap = { from: ts[i - 1]!, to: ts[i]! };
    const byKey: Record<string, number> = {};
    for (const m of this.messages) byKey[m.key] = (byKey[m.key] ?? 0) + 1;
    const despair = this.M.store.useMentor.getState().despair;
    const titles = ['台架老师傅', '台架老师傅（还有耐心）', '台架老师傅（在找降压药）', '台架老师傅（已放弃治疗）', '台架老师傅（正在写辞职信）'];
    const stats: SessionStats = {
      seconds: end,
      messages: this.messages.length,
      perMinute: this.messages.length / Math.max(1 / 60, end / 60),
      byKey,
      replaced: this.messages.filter((m) => m.replaced).length,
      suppressed: { ...this.suppressed },
      longestSilence: gap,
      rescues: this.rescues,
      failures: [...this.failures],
      despair,
      title: titles[Math.min(4, Math.floor(despair))]!,
      events: { ...this.events },
      maxDamage: this.max.dmg,
      maxFatigue: this.max.fat,
      maxCoolant: this.max.coolant,
      maxRpm: this.max.rpm,
      flickers: this.status.flickers,
      buriedDanger: this.messages
        .filter((m) => m.tone === 'danger' && m.visibleFor !== null && m.visibleFor < 4)
        .map((m) => ({ t: m.t, key: m.key, seconds: m.visibleFor!, by: m.buriedBy ?? '' })),
    };
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    return {
      id: this.opts.id,
      title: this.opts.title,
      setup: this.opts.setup ?? '',
      lines: this.lines,
      messages: this.messages,
      samples: this.samples,
      stats,
      checks: this.checks,
    };
  }
}

/** Fresh modules, storage, clock and seed; bench and mentor started as the app does after the start screen. */
export async function boot(opts: BootOptions): Promise<Replay> {
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.resetModules();
  installMocks();
  hooks.runner = null;
  mem.clear();
  const rng = mulberry32(opts.seed ?? hash(opts.id));
  vi.spyOn(Math, 'random').mockImplementation(rng);
  const mentor = { visits: 3, graduated: true, failures: 0, protect: true, open: true, ...opts.mentor };
  mem.set('engine-bench:mentor', JSON.stringify({ state: mentor, version: 1 }));

  const M = await importAll();
  const fresh = M.store.useMentor.getState();
  if (fresh.messages.length > 0 || fresh.despair !== 0 || fresh.visits !== mentor.visits || fresh.protect !== mentor.protect) {
    throw new Error('replay: mentor store leaked from a previous session');
  }
  const r = new Replay(M, opts);
  const b = M.bench.useBench.getState();
  if (opts.preset) b.loadPreset(opts.preset);
  if (opts.config) b.setConfig(opts.config);
  if (opts.ecu) b.setEcu(opts.ecu);
  if (opts.bench) b.setBench(opts.bench);
  r.attach();
  r.note(
    `开局：${M.bench.useBench.getState().presetId}，visits ${mentor.visits}${mentor.graduated ? '，已毕业' : ''}，保护${mentor.protect ? '开' : '关'}${opts.setup ? `；${opts.setup}` : ''}`,
  );
  await M.link.startBench();
  M.brain.startMentor();
  if ((M.store.useMentor.getState().messages.at(-1)?.id ?? 1) !== 1) throw new Error('replay: message ids leaked from a previous session');
  return r;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const KIND_MARK: Record<LineKind, string> = { say: '老周', player: '', act: '◆', engine: '·', lesson: '■ 课程', tune: '■ 调校', note: '#' };

export function formatLine(l: Line): string {
  const mark = KIND_MARK[l.kind];
  return `t=${l.t.toFixed(1)}s ${mark ? `${mark} ` : ''}${l.text}`;
}

export function formatSession(r: SessionResult): string {
  const s = r.stats;
  const out: string[] = [];
  out.push(`## ${r.id} ${r.title}`, '');
  if (r.setup) out.push(`设置：${r.setup}`, '');
  out.push('```text', ...r.lines.map(formatLine), '```', '');
  const top = Object.entries(s.byKey)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}×${n}`)
    .join(' ');
  const sup = Object.entries(s.suppressed)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}×${n}`)
    .join(' ');
  const ev = Object.entries(s.events)
    .map(([k, n]) => `${k}×${n}`)
    .join(' ');
  out.push(
    `统计：${s.seconds.toFixed(0)} s 模拟，${s.messages} 条消息（${s.perMinute.toFixed(1)}/分），替换 ${s.replaced}，救场 ${s.rescues}，炸 ${s.failures.length}${s.failures.length ? `（${s.failures.join('、')}）` : ''}`,
    '',
    `- 按 key：${top || '—'}`,
    `- 被冷却吞掉的 say：${sup || '—'}`,
    `- 最长沉默：${s.longestSilence.from.toFixed(1)}–${s.longestSilence.to.toFixed(1)} s（${(s.longestSilence.to - s.longestSilence.from).toFixed(1)} s）`,
    `- 内核事件：${ev || '—'}；峰值 rpm ${fmtRpm(s.maxRpm)}，活塞损伤 ${Math.round(s.maxDamage * 100)}%，连杆疲劳 ${Math.round(s.maxFatigue * 100)}%，水温 ${s.maxCoolant.toFixed(0)} °C；状态闪烁 ${s.flickers} 次`,
    `- 结束时绝望值 ${s.despair.toFixed(1)}，头衔「${s.title}」`,
  );
  if (s.buriedDanger.length) out.push(`- 危险消息在可见三条里待不到 4 s：${s.buriedDanger.map((b) => `t=${b.t.toFixed(1)} ${b.key} ${b.seconds.toFixed(1)}s（被 ${b.by} 顶掉）`).join('；')}`);
  if (r.checks.length) out.push(`- 检查：${r.checks.map((c) => `${c.ok ? '✔' : '✘'} ${c.text}`).join('；')}`);
  out.push('', `<!-- 观察:${r.id} -->`, '');
  return out.join('\n');
}
